import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.');
}

/**
 * Serverless-friendly pool. Next.js hot-reloads modules in development, so the
 * client is cached on globalThis to avoid opening a new pool on every reload.
 */
const globalForDb = globalThis as unknown as { sql?: ReturnType<typeof postgres> };

const sql = globalForDb.sql ?? postgres(connectionString, { max: 5 });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.sql = sql;
}

export const db = drizzle(sql, { schema });
export { schema, sql };
