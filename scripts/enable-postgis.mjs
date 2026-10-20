/**
 * Enables PostGIS before migrations run.
 *
 * The extension must exist before any geography(Point,4326) column can be
 * created, and drizzle-kit has no hook for "run this first". So this runs as a
 * step of `npm run db:migrate` rather than living in the migrations folder,
 * where drizzle-kit would ignore it (its journal only tracks generated files).
 *
 * Idempotent: safe to run on every migrate.
 *
 * Uses the direct connection, not the pooled one. A connection pooler hands out
 * a different backend per statement, which is fine for ordinary queries but
 * wrong for schema changes. Neon publishes both; DATABASE_URL_UNPOOLED is the
 * direct host. Falls back to DATABASE_URL for a Postgres with no pooler.
 */
import postgres from 'postgres';

// `||`, not `??`: a copied .env.example leaves DATABASE_URL_UNPOOLED as an
// empty string, which `??` would keep instead of falling back.
const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (!url) {
  console.error(
    'Neither DATABASE_URL_UNPOOLED nor DATABASE_URL is set. Both should be in ' +
      '.env.local — run `neon link` if they are missing.',
  );
  process.exit(1);
}

// Without onnotice, every run after the first dumps a raw "extension already
// exists" notice object that reads like a failure.
const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  await sql`CREATE EXTENSION IF NOT EXISTS postgis`;
  const [row] = await sql`SELECT postgis_version() AS version`;
  console.log(`PostGIS ready (${row.version})`);
} catch (error) {
  console.error('Could not enable PostGIS:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
