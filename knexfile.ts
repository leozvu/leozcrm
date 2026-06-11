import fs from 'node:fs';
import path from 'node:path';
import type { Knex } from 'knex';
import * as dotenv from 'dotenv';

dotenv.config();

const MIGRATIONS_DIR = path.resolve(__dirname, 'src/db/migrations');

/**
 * One migration/seed contract, two dialects.
 *
 * - development / test -> SQLite (zero-setup, used to verify the schema locally)
 * - production         -> PostgreSQL
 *
 * Migrations are written with Knex's dialect-portable schema builder and
 * UUID primary keys are generated in application code, so the exact same
 * migration files run unchanged against both engines.
 */

const sqliteConnection = (file: string): Knex.Config => {
  // better-sqlite3 will not create the parent directory; do it ourselves.
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  }
  // An in-memory DB lives inside a single connection, so the whole pool must
  // be pinned to one connection — otherwise migrations and queries would land
  // in different, empty databases.
  const inMemory = file === ':memory:';
  return {
    client: 'better-sqlite3',
    connection: { filename: file },
    useNullAsDefault: true,
    // SQLite does not enforce foreign keys unless enabled per-connection.
    pool: {
      ...(inMemory ? { min: 1, max: 1 } : {}),
      afterCreate: (conn: any, done: (err: Error | null, conn: any) => void) => {
        conn.pragma('foreign_keys = ON');
        done(null, conn);
      },
    },
    migrations: { directory: MIGRATIONS_DIR, extension: 'ts', loadExtensions: ['.ts'] },
  };
};

const config: Record<string, Knex.Config> = {
  development: sqliteConnection(process.env.SQLITE_FILE || './data/leozops.dev.sqlite'),

  test: sqliteConnection(':memory:'),

  production: {
    client: 'pg',
    connection:
      process.env.DATABASE_URL || {
        host: process.env.PGHOST || 'localhost',
        port: Number(process.env.PGPORT || 5432),
        user: process.env.PGUSER || 'leozops',
        password: process.env.PGPASSWORD || 'leozops',
        database: process.env.PGDATABASE || 'leozops',
      },
    pool: { min: 2, max: 10 },
    migrations: { directory: MIGRATIONS_DIR, extension: 'ts', loadExtensions: ['.ts'] },
  },
};

export default config;
