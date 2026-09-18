/**
 * Enables PostGIS before migrations run.
 *
 * The extension must exist before any geography(Point,4326) column can be
 * created, and drizzle-kit has no hook for "run this first". So this runs as a
 * step of `npm run db:migrate` rather than living in the migrations folder,
 * where drizzle-kit would ignore it (its journal only tracks generated files).
 *
 * Idempotent: safe to run on every migrate.
 */
import postgres from 'postgres';

const url = process.env.DATABASE_URL;

if (!url) {
  console.error(
    'DATABASE_URL is not set. It should be in .env.local — run `neon link` if it is missing.',
  );
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

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
