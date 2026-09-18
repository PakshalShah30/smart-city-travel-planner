import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// Neon writes DATABASE_URL into .env.local, which drizzle-kit does not read on its own.
loadEnv({ path: '.env.local' });

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  verbose: true,
  strict: true,
});
