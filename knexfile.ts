import fs from 'node:fs';
import path from 'node:path';
import type { Knex } from 'knex';
import * as dotenv from 'dotenv';

dotenv.config();

const MIGRATIONS_DIR = path.resolve(__dirname, 'src/db/migrations');
const MIGRATION_EXTENSION = path.extname(__filename) === '.js' ? 'js' : 'ts';
const MIGRATION_LOAD_EXTENSION = [`.${MIGRATION_EXTENSION}`];

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
    migrations: {
      directory: MIGRATIONS_DIR,
      extension: MIGRATION_EXTENSION,
      loadExtensions: MIGRATION_LOAD_EXTENSION,
    },
  };
};

function productionConnection(): Knex.PgConnectionConfig | string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const required = ['PGHOST', 'PGUSER', 'PGPASSWORD', 'PGDATABASE'] as const;
  if (required.every((name) => Boolean(process.env[name]))) {
    return {
      host: process.env.PGHOST!,
      port: Number(process.env.PGPORT || 5432),
      user: process.env.PGUSER!,
      password: process.env.PGPASSWORD!,
      database: process.env.PGDATABASE!,
    };
  }
  if ((process.env.NODE_ENV ?? 'development') === 'production') {
    throw new Error('Production database credentials are incomplete; set DATABASE_URL or every required PG* value.');
  }
  // This branch is never selected by the development/test runtime. It keeps
  // config.production inspectable for tooling while production itself fails closed.
  return { host: '127.0.0.1', port: 5432, user: 'unset', password: 'unset', database: 'unset' };
}

const config: Record<string, Knex.Config> = {
  development: sqliteConnection(process.env.SQLITE_FILE || './data/leozops.dev.sqlite'),

  test: sqliteConnection(':memory:'),

  production: {
    client: 'pg',
    connection: productionConnection(),
    pool: {
      min: Number(process.env.PGPOOL_MIN || 2),
      max: Number(process.env.PGPOOL_MAX || 10),
      acquireTimeoutMillis: Number(process.env.PG_ACQUIRE_TIMEOUT_MS || 10_000),
    },
    migrations: {
      directory: MIGRATIONS_DIR,
      extension: MIGRATION_EXTENSION,
      loadExtensions: MIGRATION_LOAD_EXTENSION,
    },
  },
};

export default config;
