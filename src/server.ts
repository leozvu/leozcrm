import * as dotenv from 'dotenv';
import { createApp, resolveRuntimeProfile } from './http/app';
import { AuthConfig } from './http/auth';
import { db } from './db/knex';
import fs from 'node:fs';
import path from 'node:path';
import { inspectLiveObserverPreflight } from './liveObserverPreflight';
import { validateLiveObserverDeployment } from './domain/liveObserver';
import { StructuredLogger } from './observability/structuredLogger';

dotenv.config();

const port = Number(process.env.PORT || 3000);
const logger = new StructuredLogger();

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

const profile = resolveRuntimeProfile();
let deploymentFingerprint: string | undefined;
let maxFreshnessSeconds: number | undefined;
let observabilityCredentialFingerprint = process.env.LEOZOPS_OBSERVABILITY_TOKEN_SHA256;
if ((process.env.NODE_ENV ?? 'development') === 'production' && profile === 'egoric-readonly') {
  const manifestPath = process.env.LEOZOPS_LIVE_DEPLOYMENT_MANIFEST;
  if (!manifestPath) throw new Error('LEOZOPS_LIVE_DEPLOYMENT_MANIFEST is required in production.');
  const raw = JSON.parse(fs.readFileSync(path.resolve(manifestPath), 'utf8')) as unknown;
  const preflight = inspectLiveObserverPreflight(raw, process.env, 'server');
  const validation = validateLiveObserverDeployment(raw);
  if (!preflight.ok || !validation.value || !validation.fingerprint) {
    logger.log('error', 'production_preflight_blocked', { issue_count: preflight.issues.length });
    throw new Error('Phase 12 production preflight is blocked.');
  }
  deploymentFingerprint = validation.fingerprint;
  maxFreshnessSeconds = validation.value.schedule.max_freshness_seconds;
  observabilityCredentialFingerprint = validation.value.monitoring.observability_credential_sha256;
}
const app = profile === 'egoric-readonly'
  ? createApp({
    profile,
    structuredLogger: logger,
    deploymentFingerprint,
    observabilityCredentialFingerprint,
    maxFreshnessSeconds,
  })
  : createApp({ profile, auth: authConfig() });

const server = app.listen(port, () => {
  logger.log('info', 'server_started', {
    profile,
    port,
    deployment_fingerprint: deploymentFingerprint ?? 'local-unbound',
  });
});

// Graceful shutdown so the DB pool closes cleanly.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.log('info', 'server_shutdown_requested', { signal });
    server.close(() => {
      db.destroy().finally(() => process.exit(0));
    });
  });
}
