import * as dotenv from 'dotenv';
import { createApp } from './http/app';
import { AuthConfig } from './http/auth';
import { db } from './db/knex';

dotenv.config();

const port = Number(process.env.PORT || 3000);

/**
 * Resolve auth config. Production MUST supply AUTH_SECRET (fail loud if absent);
 * outside production we fall back to a clearly-insecure dev secret so the API is
 * runnable locally without setup.
 */
function authConfig(): AuthConfig {
  const isProd = (process.env.NODE_ENV || 'development') === 'production';
  let secret = process.env.AUTH_SECRET;
  let adminKey = process.env.ADMIN_API_KEY;
  if (isProd && !secret) {
    throw new Error('AUTH_SECRET must be set in production (auth fails closed without it).');
  }
  if (!secret) {
    secret = 'dev-insecure-secret';
    adminKey = adminKey ?? 'dev-admin-key';
    console.warn('[auth] AUTH_SECRET not set — using an insecure dev secret. Do NOT use in production.');
  }
  return { secret, adminKey };
}

const app = createApp({ auth: authConfig() });

const server = app.listen(port, () => {
  console.log(`LeozOps CRM API listening on http://localhost:${port}`);
});

// Graceful shutdown so the DB pool closes cleanly.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => {
      db.destroy().finally(() => process.exit(0));
    });
  });
}
