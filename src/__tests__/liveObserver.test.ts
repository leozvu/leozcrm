import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import knexFactory from 'knex';
import config from '../../knexfile';
import { LiveObserverDeployment, validateLiveObserverDeployment } from '../domain/liveObserver';
import { inspectLiveObserverPreflight } from '../liveObserverPreflight';
import { StructuredLogger } from '../observability/structuredLogger';
import { backupCommand, restoreCommands } from '../recoveryOperator';
import { BusinessMemoryRepository } from '../repositories/businessMemoryRepository';
import { LiveObserverRepository } from '../repositories/liveObserverRepository';
import { createApp } from '../http/app';
import { EGORIC_SCHEMA_VERSION } from '../domain/businessMemory';

const db = knexFactory(config.test);
const token = 'phase12-observability-test-token';
const tokenHash = `sha256:${createHash('sha256').update(token).digest('hex')}`;

function manifest(): LiveObserverDeployment {
  return {
    schema_version: 'leozops_phase12_live_observer_v1',
    status: 'accepted',
    environment: 'production',
    runtime_profile: 'egoric-readonly',
    target: {
      provider: 'example-cloud', project_id: 'project-live', service_id: 'leozops-live',
      region: 'us-east-1', database_id: 'database-live',
    },
    source: {
      tenant_id: '11111111-1111-4111-8111-111111111111',
      tenant_key: 'egoric-live',
      connection_id: '22222222-2222-4222-8222-222222222222',
      egoric_project_id: 'egoric-project-live',
      endpoint_url: 'https://egoric.example/api/integrations/leozops/v1/lead-snapshot',
      method: 'GET', request_body_present: false,
    },
    owners: { product_owner: 'Leoz', runtime_owner: 'Leoz', incident_owner: 'Leoz' },
    secret_bindings: {
      database_url: 'env://DATABASE_URL',
      output_auth_secret: 'env://LEOZOPS_OUTPUT_AUTH_SECRET',
      source_bearer_token: 'env://LEOZOPS_SOURCE_BEARER_TOKEN',
      source_operator_token: 'env://LEOZOPS_OPERATOR_TOKEN',
      proactive_operator_token: 'env://LEOZOPS_PROACTIVE_OPERATOR_TOKEN',
      observer_operator_token: 'env://LEOZOPS_LIVE_OBSERVER_TOKEN',
    },
    schedule: { poll_interval_seconds: 300, max_freshness_seconds: 900, observer_timeout_seconds: 120 },
    monitoring: {
      dashboard_id: 'leozops-live-overview',
      alert_route_id: 'leozops-live-p1',
      observability_credential_sha256: tokenHash,
    },
    safety: {
      source_read_only: true, action_authority: 'none',
      background_loops_in_http_process: false, waivers_allowed: false,
    },
  };
}

before(async () => { await db.migrate.latest(); });
after(async () => { await db.destroy(); });

test('Phase 12 deployment is exact, production-only, read-only, and secret-reference-only', () => {
  const valid = validateLiveObserverDeployment(manifest());
  assert.equal(valid.ok, true);
  assert.match(valid.fingerprint ?? '', /^sha256:[0-9a-f]{64}$/);
  const rawSecret = structuredClone(manifest()) as any;
  rawSecret.secret_bindings.database_url = 'postgres://user:password@example/db';
  assert.equal(validateLiveObserverDeployment(rawSecret).ok, false);
  const writeSource = structuredClone(manifest()) as any;
  writeSource.source.method = 'POST';
  writeSource.source.request_body_present = true;
  assert.equal(validateLiveObserverDeployment(writeSource).ok, false);
});

test('preflight verifies exact identities and bindings without returning values', () => {
  const deployment = manifest();
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: 'production', INTEGRATION_MODE: 'egoric-readonly',
    LEOZOPS_RUNTIME_PROJECT_ID: deployment.target.project_id,
    LEOZOPS_DATABASE_ID: deployment.target.database_id,
    LEOZOPS_EGORIC_PROJECT_ID: deployment.source.egoric_project_id,
  };
  for (const reference of Object.values(deployment.secret_bindings)) env[reference.slice(6)] = 'injected-secret';
  const result = inspectLiveObserverPreflight(deployment, env);
  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(result).includes('injected-secret'), false);
  delete env.LEOZOPS_SOURCE_BEARER_TOKEN;
  assert.equal(inspectLiveObserverPreflight(deployment, env).ok, false);
  assert.equal(inspectLiveObserverPreflight(deployment, env, 'server').ok, true);
});

test('structured logger redacts credentials and preserves correlation fields', () => {
  const lines: string[] = [];
  new StructuredLogger((line) => lines.push(line)).log('info', 'test_event', {
    trace_id: 'trace-123', authorization: 'Bearer should-not-appear',
    nested: { database_url: 'postgres://should-not-appear' },
  });
  assert.equal(lines[0].includes('should-not-appear'), false);
  const parsed = JSON.parse(lines[0]) as any;
  assert.equal(parsed.trace_id, 'trace-123');
  assert.equal(parsed.authorization, '[REDACTED]');
});

test('recovery plans refuse production restore and missing acknowledgement', () => {
  assert.deepEqual(backupCommand('leozops_prod', '/backup/live.dump'), {
    program: 'pg_dump',
    args: ['--dbname', 'service=leozops_prod', '--format=custom', '--no-owner', '--no-privileges', '--file', '/backup/live.dump'],
  });
  assert.throws(() => restoreCommands(
    'leozops_prod', 'leozops_prod', '/backup/live.dump', 'RESTORE_TO_DISPOSABLE_DATABASE_ONLY',
  ), /restore_target_must_differ/);
  assert.throws(() => restoreCommands('leozops_prod', 'leozops_drill', '/backup/live.dump', undefined), /acknowledgement/);
  assert.equal(restoreCommands(
    'leozops_prod', 'leozops_drill', '/backup/live.dump', 'RESTORE_TO_DISPOSABLE_DATABASE_ONLY',
  ).length, 2);
});

test('live observer and recovery evidence are append-only', async () => {
  const memory = new BusinessMemoryRepository(db);
  const tenant = await memory.ensureTenant({ tenantKey: `phase12-${randomUUID()}`, displayName: 'Phase 12 Test' });
  const connection = await memory.ensureSourceConnection({
    tenantId: tenant.id, sourceSystem: 'egoric', sourceTenantKey: `source-${randomUUID()}`,
    schemaVersion: EGORIC_SCHEMA_VERSION,
    endpointUrl: 'https://egoric.example/api/integrations/leozops/v1/lead-snapshot',
  });
  const repository = new LiveObserverRepository(db);
  const event = await repository.appendEvent({
    tenant_id: tenant.id, source_connection_id: connection.id, cycle_id: randomUUID(), sequence: 1,
    invocation_key: `invocation:${randomUUID()}`, event_type: 'cycle_started', outcome: 'started',
    reason_code: 'scheduler_invoked', correlation_id: randomUUID(),
    deployment_fingerprint: validateLiveObserverDeployment(manifest()).fingerprint!,
  });
  await assert.rejects(db('live_observer_events').where({ id: event.id }).update({ reason_code: 'rewritten' }));
  await assert.rejects(db('live_observer_events').where({ id: event.id }).delete());
  assert.equal((await repository.findInvocation(tenant.id, event.invocation_key))[0].id, event.id);
  const now = new Date().toISOString();
  const drill = await repository.recordRecoveryDrill({
    drill_key: `drill:${randomUUID()}`,
    kind: 'restore',
    target_class: 'disposable_restore_target',
    status: 'succeeded',
    artifact_sha256: `sha256:${'a'.repeat(64)}`,
    artifact_bytes: 1024,
    tool_version: 'postgresql-16.4',
    reason_code: 'disposable_restore_verified',
    deployment_fingerprint: validateLiveObserverDeployment(manifest()).fingerprint!,
    started_at: now,
    completed_at: now,
  });
  await assert.rejects(db('live_recovery_drills').where({ id: drill.id }).update({ status: 'failed' }));
  await assert.rejects(db('live_recovery_drills').where({ id: drill.id }).delete());
});

test('operational endpoints require a separate credential and emit aggregates', async () => {
  const app = createApp({
    profile: 'egoric-readonly', knex: db, integrationReadAuth: { secret: 'read-secret' },
    observabilityCredentialFingerprint: tokenHash, maxFreshnessSeconds: 900,
  });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('server did not bind');
    const base = `http://127.0.0.1:${address.port}`;
    assert.equal((await fetch(`${base}/internal/operations/snapshot`)).status, 401);
    const response = await fetch(`${base}/internal/operations/snapshot`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.match(body, /leozops_phase12_operational_snapshot_v1/);
    assert.equal(body.includes('phase12-'), false);
    const metrics = await fetch(`${base}/internal/operations/metrics`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(metrics.status, 200);
    assert.match(await metrics.text(), /leozops_source_poll_failed_total/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('live observer stays one-shot and is never an HTTP background loop', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../liveObserverOperator.ts'), 'utf8');
  assert.equal(source.includes('setInterval('), false);
  assert.match(source, /runBoundedChild\('shadowOperator'/);
  assert.match(source, /runBoundedChild\('proactiveOperator'/);
});

test('production container is compiled, non-root, and carries no checked-in environment', () => {
  const dockerfile = fs.readFileSync(path.resolve(__dirname, '../../Dockerfile'), 'utf8');
  assert.match(dockerfile, /FROM node:24-bookworm-slim AS runtime/);
  assert.match(dockerfile, /USER leozops/);
  assert.match(dockerfile, /CMD \["node", "dist\/src\/server\.js"\]/);
  assert.equal(/COPY\s+\.env/m.test(dockerfile), false);
  assert.equal(dockerfile.includes('tsx src/server.ts'), false);
});
