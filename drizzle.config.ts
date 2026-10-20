import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Neon writes both connection strings into .env.local, which drizzle-kit does
// not read on its own.
loadEnv({ path: '.env.local' });

// Migrations go through the direct connection. A pooler gives each statement a
// different backend, so anything that has to hold one for the duration of the
// change — and drizzle-kit's own migration bookkeeping — belongs on the direct
// host. DATABASE_URL is the pooled one and stays reserved for app traffic.
// `||`, not `??`: a copied .env.example leaves DATABASE_URL_UNPOOLED as an
// empty string, which `??` would keep instead of falling back.
const migrationUrl = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || '';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: migrationUrl,
  },
  verbose: true,
  strict: true,
});
