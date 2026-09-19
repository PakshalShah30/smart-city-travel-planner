/**
 * Loads a city, its places and its travel-time matrix into Postgres.
 *
 *   npm run build-matrix   (needs a local OSRM)
 *   npm run db:seed
 *
 * Safe to re-run: everything is keyed on a natural identifier and upserted, so
 * a second run updates rather than duplicating.
 *
 * Start points are stored as rows in `pois` with is_active = false. They need
 * to be in the matrix — every leg the app will ever need must be precomputed —
 * but they must never be offered as somewhere to visit. The candidate query
 * filters on is_active, so one flag covers both.
 */
import { readFileSync } from 'node:fs';

import { sql as raw } from 'drizzle-orm';

import { db, sql as client } from '../src/db';
import { cities, categories, poiCategories, pois, travelTimes } from '../src/db/schema';
import { normalise, takeTop, type OverpassResponse } from '../src/db/ingest/normalise';
import { CATEGORIES, MUMBAI } from '../src/db/seed/mumbai';
import { getStartPoints } from '../src/lib/pois';
import type { MatrixEntry, MatrixNode } from '../src/db/ingest/matrix';

const CITY = process.env.CITY ?? 'mumbai';
const LIMIT = Number(process.env.POI_LIMIT ?? 500);
const CHUNK = 2000;

type MatrixFile = {
  city: string;
  nodes: MatrixNode[];
  modes: Record<string, MatrixEntry[]>;
};

const chunked = <T,>(xs: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
};

async function main() {
  const rawExtract = JSON.parse(
    readFileSync(`src/db/ingest/fixtures/${CITY}-overpass.raw.json`, 'utf8'),
  ) as OverpassResponse;

  let matrix: MatrixFile | null = null;
  try {
    matrix = JSON.parse(
      readFileSync(`src/db/ingest/build/${CITY}-matrix.json`, 'utf8'),
    ) as MatrixFile;
  } catch {
    console.log('No matrix file found — seeding places only. Run npm run build-matrix first.');
  }

  const places = takeTop(normalise(rawExtract), LIMIT);
  const starts = getStartPoints(CITY);

  console.log(`Seeding ${CITY}: ${places.length} places, ${starts.length} start points`);

  const [city] = await db
    .insert(cities)
    .values({
      slug: MUMBAI.slug,
      name: MUMBAI.name,
      country: MUMBAI.country,
      center: { x: MUMBAI.center.lng, y: MUMBAI.center.lat },
      timezone: MUMBAI.timezone,
      defaultRadiusM: MUMBAI.defaultRadiusM,
    })
    .onConflictDoUpdate({
      target: cities.slug,
      set: { name: MUMBAI.name, timezone: MUMBAI.timezone },
    })
    .returning();

  const categoryRows = await db
    .insert(categories)
    .values(CATEGORIES.map((c) => ({ slug: c.slug, name: c.name })))
    .onConflictDoUpdate({ target: categories.slug, set: { name: raw`excluded.name` } })
    .returning();

  const categoryId = new Map(categoryRows.map((c) => [c.slug, c.id]));
  console.log(`  city #${city.id}, ${categoryRows.length} categories`);

  // --- places, then start points, both into pois ---
  const poiRows = [
    ...places.map((p) => ({
      cityId: city.id,
      source: 'osm',
      sourceId: p.sourceId,
      name: p.name,
      location: { x: p.location.lng, y: p.location.lat },
      visitDurationMin: p.visitDurationMin,
      popularity: p.popularity,
      primaryCategoryId: categoryId.get(p.categories[0]) ?? null,
      openingHours: p.hours,
      isActive: true,
      matrixKey: `poi:${p.id}`,
    })),
    ...starts.map((s) => ({
      cityId: city.id,
      source: 'manual',
      sourceId: `start/${s.id}`,
      name: s.label,
      location: { x: s.location.lng, y: s.location.lat },
      visitDurationMin: 0,
      popularity: 0,
      primaryCategoryId: null,
      openingHours: { kind: 'always' as const },
      isActive: false,
      matrixKey: `start:${s.id}`,
    })),
  ];

  const idByMatrixKey = new Map<string, number>();

  for (const batch of chunked(poiRows, 200)) {
    const inserted = await db
      .insert(pois)
      .values(batch.map(({ matrixKey: _ignored, ...row }) => row))
      .onConflictDoUpdate({
        target: [pois.source, pois.sourceId],
        set: {
          name: raw`excluded.name`,
          location: raw`excluded.location`,
          visitDurationMin: raw`excluded.visit_duration_min`,
          popularity: raw`excluded.popularity`,
          openingHours: raw`excluded.opening_hours`,
          primaryCategoryId: raw`excluded.primary_category_id`,
          isActive: raw`excluded.is_active`,
          updatedAt: new Date(),
        },
      })
      .returning({ id: pois.id, sourceId: pois.sourceId });

    for (const row of inserted) {
      const source = batch.find((b) => b.sourceId === row.sourceId);
      if (source) idByMatrixKey.set(source.matrixKey, row.id);
    }
  }
  console.log(`  ${idByMatrixKey.size} pois upserted (${starts.length} of them start points)`);

  // Drizzle emits geometry(point) with no SRID, so set it explicitly. Without
  // this, casting to ::geography for metre distances fails or misreports.
  await db.execute(
    raw`UPDATE pois SET location = ST_SetSRID(location, 4326) WHERE ST_SRID(location) = 0`,
  );
  await db.execute(
    raw`UPDATE cities SET center = ST_SetSRID(center, 4326) WHERE ST_SRID(center) = 0`,
  );

  // --- category links ---
  const links = places.flatMap((p) =>
    p.categories
      .map((slug) => ({ poiId: idByMatrixKey.get(`poi:${p.id}`), categoryId: categoryId.get(slug) }))
      .filter((l): l is { poiId: number; categoryId: number } => !!l.poiId && !!l.categoryId),
  );
  for (const batch of chunked(links, 1000)) {
    await db.insert(poiCategories).values(batch).onConflictDoNothing();
  }
  console.log(`  ${links.length} category links`);

  // --- travel times ---
  if (!matrix) {
    console.log('\nDone (no matrix). The app will keep using straight-line estimates.');
    return;
  }

  let written = 0;
  let skipped = 0;

  for (const [mode, entries] of Object.entries(matrix.modes)) {
    const rows = entries
      .map((e) => ({
        fromPoiId: idByMatrixKey.get(e.fromKey),
        toPoiId: idByMatrixKey.get(e.toKey),
        mode,
        durationS: e.durationS,
        distanceM: e.distanceM,
      }))
      .filter((r): r is typeof r & { fromPoiId: number; toPoiId: number } => {
        if (r.fromPoiId && r.toPoiId) return true;
        skipped += 1;
        return false;
      });

    for (const batch of chunked(rows, CHUNK)) {
      await db
        .insert(travelTimes)
        .values(batch)
        .onConflictDoUpdate({
          target: [travelTimes.fromPoiId, travelTimes.toPoiId, travelTimes.mode],
          set: {
            durationS: raw`excluded.duration_s`,
            distanceM: raw`excluded.distance_m`,
            computedAt: new Date(),
          },
        });
      written += batch.length;
      process.stdout.write(`  ${mode}: ${written.toLocaleString()} legs\r`);
    }
    console.log(`  ${mode}: ${written.toLocaleString()} legs written`);
    written = 0;
  }

  if (skipped > 0) {
    console.log(`  ${skipped} legs skipped — matrix node not found in the database`);
  }
  console.log('\nDone.');
}

main()
  .catch((error) => {
    console.error('\nSeed failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end();
  });
