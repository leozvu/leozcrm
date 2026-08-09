import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import knexFactory from 'knex';
import config from '../../knexfile';
import { validateEgoricSalesV1Snapshot } from '../domain/businessMemory';
import { provisionLocalStaging } from '../localStagingProvision';

const db = knexFactory(config.test);
const secretNames = [
  'DATABASE_URL', 'LEOZOPS_OUTPUT_AUTH_SECRET', 'LEOZOPS_SOURCE_BEARER_TOKEN',
  'LEOZOPS_OPERATOR_TOKEN', 'LEOZOPS_PROACTIVE_OPERATOR_TOKEN', 'LEOZOPS_LIVE_OBSERVER_TOKEN',
];
const observability = 'local-staging-observability-test-token';

function manifest() {
  return {
    schema_version: 'leozops_phase12_live_observer_v1', status: 'accepted', environment: 'staging',
    runtime_profile: 'egoric-readonly',
    target: {
      provider: 'docker-local', project_id: 'leozops-local-staging',
      service_id: 'leozops-local-staging-web', region: 'localhost',
      database_id: 'leozops-local-staging-postgres-16',
    },
    source: {
      tenant_id: '11111111-1111-4111-8111-111111111116', tenant_key: 'egoric-local-staging',
      connection_id: '22222222-2222-4222-8222-222222222216',
      egoric_project_id: 'repositoryrealms-local-staging-stub',
      endpoint_url: 'https://repositoryrealms-source.local:3443/api/integrations/leozops/v1/lead-snapshot',
      method: 'GET', request_body_present: false,
    },
    owners: { product_owner: 'Leoz', runtime_owner: 'Leoz', incident_owner: 'Leoz' },
    secret_bindings: {
      database_url: 'env://DATABASE_URL', output_auth_secret: 'env://LEOZOPS_OUTPUT_AUTH_SECRET',
      source_bearer_token: 'env://LEOZOPS_SOURCE_BEARER_TOKEN', source_operator_token: 'env://LEOZOPS_OPERATOR_TOKEN',
      proactive_operator_token: 'env://LEOZOPS_PROACTIVE_OPERATOR_TOKEN', observer_operator_token: 'env://LEOZOPS_LIVE_OBSERVER_TOKEN',
    },
    schedule: { poll_interval_seconds: 300, max_freshness_seconds: 900, observer_timeout_seconds: 120 },
    monitoring: {
      dashboard_id: 'leozops-local-staging-operations', alert_route_id: 'leozops-local-staging-console',
      observability_credential_sha256: `sha256:${createHash('sha256').update(observability).digest('hex')}`,
    },
    safety: { source_read_only: true, action_authority: 'none', background_loops_in_http_process: false, waivers_allowed: false },
  };
}

function environment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'production', INTEGRATION_MODE: 'egoric-readonly',
    LEOZOPS_DEPLOY_ENV: 'local-staging', LEOZOPS_LOCAL_STAGING_ACK: 'PROVISION_ISOLATED_LOCAL_STAGING_ONLY',
    LEOZOPS_RUNTIME_PROJECT_ID: 'leozops-local-staging', LEOZOPS_DATABASE_ID: 'leozops-local-staging-postgres-16',
    LEOZOPS_EGORIC_PROJECT_ID: 'repositoryrealms-local-staging-stub',
  };
  for (const [index, name] of secretNames.entries()) env[name] = `isolated-test-secret-${index}`;
  return env;
}

before(async () => { await db.migrate.latest(); });
after(async () => { await db.destroy(); });

test('local staging provisioning is exact, idempotent, and secret-free', async () => {
  const first = await provisionLocalStaging(db, manifest(), environment());
  const replay = await provisionLocalStaging(db, manifest(), environment());
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal((await db('tenants').where({ id: first.tenant_id })).length, 1);
  assert.equal((await db('source_connections').where({ id: first.source_connection_id })).length, 1);
  const serialized = JSON.stringify(first);
  for (const value of Object.values(environment())) {
    if (value?.startsWith('isolated-test-secret')) assert.equal(serialized.includes(value), false);
  }
});

test('local staging provisioning rejects missing acknowledgement and retargeting', async () => {
  const missingAck = environment();
  delete missingAck.LEOZOPS_LOCAL_STAGING_ACK;
  await assert.rejects(provisionLocalStaging(db, manifest(), missingAck), /local_staging_acknowledgement_missing/);
  const retargeted = structuredClone(manifest()) as any;
  retargeted.target.database_id = 'another-database';
  const env = environment();
  env.LEOZOPS_DATABASE_ID = 'another-database';
  await assert.rejects(provisionLocalStaging(db, retargeted, env), /local_staging_target_mismatch/);
});

test('local staging source fixture emits the exact canonical source contract', () => {
  const generatedAt = '2026-08-09T14:45:00.000Z';
  const result = spawnSync(process.execPath, [
    path.resolve('deploy/local-staging/source-stub.mjs'),
    '--print-snapshot',
    generatedAt,
  ], { encoding: 'utf8', shell: false });
  assert.equal(result.status, 0, result.stderr);
  const snapshot = JSON.parse(result.stdout);
  const validated = validateEgoricSalesV1Snapshot(snapshot, 'egoric-local-staging');
  assert.equal(validated.generated_at, generatedAt);
  assert.match(validated.snapshot_id, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(validated.leads, []);
});
