/**
 * Computes the travel-time matrix for a city and writes it to disk.
 *
 * Requires a local OSRM (see scripts/osrm-up.sh). Run the car profile on :5000
 * and, if you want walking legs too, the foot profile on :5001.
 *
 *   npm run build-matrix
 *
 * Start points are included as matrix nodes alongside POIs. That is what lets
 * the running application avoid calling a router at all: every leg it will ever
 * need is already in the table.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

import { normalise, takeTop, type OverpassResponse } from '../src/db/ingest/normalise';
import { buildMatrix, type MatrixNode } from '../src/db/ingest/matrix';
import { createOsrmTable } from '../src/db/ingest/osrm';
import { getStartPoints } from '../src/lib/pois';

const CITY = process.env.CITY ?? 'mumbai';
const LIMIT = Number(process.env.POI_LIMIT ?? 500);
const RAW = `src/db/ingest/fixtures/${CITY}-overpass.raw.json`;
const OUT_DIR = 'src/db/ingest/build';

type ProfileSpec = { mode: 'car' | 'foot'; port: number; osrmProfile: string };

const PROFILES: ProfileSpec[] = [
  { mode: 'car', port: 5000, osrmProfile: 'driving' },
  { mode: 'foot', port: 5001, osrmProfile: 'foot' },
];

async function reachable(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/table/v1/driving/72.83,18.92;72.82,18.94`);
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  const raw = JSON.parse(readFileSync(RAW, 'utf8')) as OverpassResponse;
  const pois = takeTop(normalise(raw), LIMIT);

  const starts = getStartPoints(CITY);
  const nodes: MatrixNode[] = [
    ...pois.map((p) => ({ key: `poi:${p.id}`, location: p.location })),
    ...starts.map((s) => ({ key: `start:${s.id}`, location: s.location })),
  ];

  console.log(`${CITY}: ${pois.length} places + ${starts.length} start points = ${nodes.length} nodes`);
  console.log(`${(nodes.length * (nodes.length - 1)).toLocaleString()} ordered pairs per mode\n`);

  mkdirSync(OUT_DIR, { recursive: true });
  const built: Record<string, unknown> = {};

  for (const profile of PROFILES) {
    if (!(await reachable(profile.port))) {
      console.log(`skipping ${profile.mode}: nothing answering on :${profile.port}`);
      console.log(`  start it with:  ./scripts/osrm-up.sh ${profile.mode}\n`);
      continue;
    }

    const table = createOsrmTable({
      baseUrl: `http://127.0.0.1:${profile.port}`,
      profile: profile.osrmProfile,
    });

    let lastPct = -1;
    const started = Date.now();

    const result = await buildMatrix(nodes, table, {
      chunkSize: 50,
      maxDurationS: 45 * 60,
      onProgress: (done, total) => {
        const pct = Math.floor((done / total) * 100);
        if (pct >= lastPct + 10) {
          lastPct = pct;
          process.stdout.write(`  ${profile.mode}: ${pct}%\r`);
        }
      },
    });

    const secs = ((Date.now() - started) / 1000).toFixed(1);
    const keptPct = ((result.entries.length / result.pairsConsidered) * 100).toFixed(1);

    console.log(
      `  ${profile.mode}: ${result.entries.length.toLocaleString()} legs kept of ` +
        `${result.pairsConsidered.toLocaleString()} (${keptPct}%), ` +
        `${result.pairsPruned.toLocaleString()} over 45 min, ` +
        `${result.pairsUnreachable.toLocaleString()} unroutable, ` +
        `${result.requests} requests, ${secs}s`,
    );

    built[profile.mode] = result.entries;
  }

  if (Object.keys(built).length === 0) {
    console.error('\nNo routing engine reachable. Start one first:  ./scripts/osrm-up.sh car');
    process.exit(1);
  }

  const outPath = `${OUT_DIR}/${CITY}-matrix.json`;
  writeFileSync(outPath, JSON.stringify({ city: CITY, nodes, modes: built }));
  console.log(`\nwrote ${outPath}`);
  console.log('next:  npm run db:seed');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
