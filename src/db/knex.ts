import knexFactory, { Knex } from 'knex';
import config from '../../knexfile';

const environment = process.env.NODE_ENV || 'development';

const envConfig = config[environment];
if (!envConfig) {
  throw new Error(
    `No knex configuration found for NODE_ENV="${environment}". ` +
      `Expected one of: ${Object.keys(config).join(', ')}.`,
  );
}

/** Shared, process-wide Knex connection. Import this everywhere. */
export const db: Knex = knexFactory(envConfig);

export type { Knex };
