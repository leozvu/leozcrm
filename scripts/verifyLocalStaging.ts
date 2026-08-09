import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import * as dotenv from 'dotenv';
import { validateLiveObserverDeployment } from '../src/domain/liveObserver';
import { inspectLiveObserverPreflight } from '../src/liveObserverPreflight';

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env.local-staging.local');
const manifestPath = path.join(root, 'deploy', 'local-staging', 'deployment.local.json');
const caPath = path.join(root, 'deploy', 'local-staging', 'certs', 'ca', 'source-cert.pem');

interface HttpResult { status: number; headers: Record<string, string | string[] | undefined>; body: string }

function localHttps(pathname: string, token?: string, etag?: string): Promise<HttpResult> {
  const ca = fs.readFileSync(caPath);
  const env = dotenv.parse(fs.readFileSync(envPath));
  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: 'localhost',
      port: Number(env.LEOZOPS_LOCAL_SOURCE_PORT),
      path: pathname,
      method: 'GET',
      ca,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(etag ? { 'If-None-Match': etag } : {}),
      },
    }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body,
      }));
    });
    request.once('error', reject);
    request.setTimeout(10_000, () => request.destroy(new Error('source_probe_timeout')));
    request.end();
  });
}

async function json(url: string, init?: RequestInit): Promise<{ response: Response; body: any }> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  return { response, body: await response.json() };
}

function assert(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}

function compose(args: string[]): string {
  const result = spawnSync('docker', [
    'compose', '--env-file', envPath,
    '--file', path.join(root, 'deploy', 'local-staging', 'docker-compose.yml'),
    ...args,
  ], { cwd: root, encoding: 'utf8', shell: false });
  if (result.error || result.status !== 0) throw new Error('local_staging_compose_probe_failed');
  return String(result.stdout || '').trim();
}

async function main(): Promise<void> {
  assert(fs.existsSync(envPath) && fs.existsSync(manifestPath) && fs.existsSync(caPath), 'local_staging_artifacts_missing');
  const env = { ...process.env, ...dotenv.parse(fs.readFileSync(envPath)) };
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
  const validation = validateLiveObserverDeployment(manifest);
  assert(validation.ok && validation.value && validation.fingerprint, 'local_staging_manifest_invalid');
  assert(validation.value.environment === 'staging', 'local_staging_environment_mismatch');
  const preflight = inspectLiveObserverPreflight(manifest, env, 'observer');
  assert(preflight.ok, 'local_staging_preflight_blocked');

  const boundSecrets = Object.values(validation.value.secret_bindings).map((reference) => env[reference.slice(6)]);
  assert(boundSecrets.every(Boolean) && new Set(boundSecrets).size === boundSecrets.length, 'local_staging_secret_separation_failed');

  const base = `http://127.0.0.1:${env.LEOZOPS_LOCAL_STAGING_PORT}`;
  const health = await json(`${base}/health`);
  assert(health.response.status === 200 && health.body.ok === true && health.body.profile === 'egoric-readonly', 'local_staging_health_failed');
  const startup = await json(`${base}/startup`);
  assert(startup.response.status === 200 && startup.body.deployment_fingerprint === validation.fingerprint, 'local_staging_startup_binding_failed');
  const ready = await json(`${base}/ready`);
  assert(ready.response.status === 200 && ready.body.checks?.db === 'ok' && ready.body.checks?.migrations_current === true, 'local_staging_readiness_failed');

  const unauthenticated = await fetch(`${base}/v1/tenants/${validation.value.source.tenant_key}/brief`, { signal: AbortSignal.timeout(10_000) });
  assert(unauthenticated.status === 401, 'local_staging_tenant_auth_boundary_failed');
  const operationsDenied = await fetch(`${base}/internal/operations/snapshot`, { signal: AbortSignal.timeout(10_000) });
  assert(operationsDenied.status === 401, 'local_staging_operations_auth_boundary_failed');
  const operations = await json(`${base}/internal/operations/snapshot`, {
    headers: { Authorization: `Bearer ${env.LEOZOPS_OBSERVABILITY_TOKEN}` },
  });
  assert(operations.response.status === 200 && operations.body.schema_version === 'leozops_phase12_operational_snapshot_v1', 'local_staging_operations_probe_failed');

  const sourcePath = '/api/integrations/leozops/v1/lead-snapshot';
  const sourceDenied = await localHttps(sourcePath);
  assert(sourceDenied.status === 401, 'local_staging_source_auth_boundary_failed');
  const source = await localHttps(sourcePath, env.LEOZOPS_SOURCE_BEARER_TOKEN);
  assert(source.status === 200, 'local_staging_source_probe_failed');
  const sourceBody = JSON.parse(source.body) as any;
  assert(sourceBody.schema_version === '1.0' && sourceBody.source?.tenant_key === validation.value.source.tenant_key, 'local_staging_source_contract_failed');
  assert(!/(email|phone|password|credential|first_name|last_name)/i.test(source.body), 'local_staging_source_pii_boundary_failed');
  const etag = Array.isArray(source.headers.etag) ? source.headers.etag[0] : source.headers.etag;
  assert(typeof etag === 'string' && etag.startsWith('"sha256:'), 'local_staging_source_etag_missing');
  const unchanged = await localHttps(sourcePath, env.LEOZOPS_SOURCE_BEARER_TOKEN, etag);
  assert(unchanged.status === 304 && unchanged.body === '', 'local_staging_source_304_failed');

  const databaseIdentity = compose(['exec', '-T', 'postgres', 'sh', '-lc',
    'test "$POSTGRES_DB" = "leozops_local_staging" && test "$POSTGRES_USER" = "leozops_staging" && psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "SELECT current_database() = \'leozops_local_staging\' AND current_user = \'leozops_staging\'"',
  ]);
  assert(databaseIdentity === 't', 'local_staging_database_identity_failed');
  const runtimeUser = compose(['exec', '-T', 'web', 'id', '-un']);
  assert(runtimeUser === 'leozops', 'local_staging_runtime_user_failed');
  const sourceRuntimeUser = compose(['exec', '-T', 'repositoryrealms-source', 'id', '-un']);
  assert(sourceRuntimeUser === 'node', 'local_staging_source_runtime_user_failed');

  console.log(JSON.stringify({
    status: 'ok',
    environment: validation.value.target.project_id,
    deployment_fingerprint: validation.fingerprint,
    database: { identity: 'leozops_local_staging', migrations_current: true },
    runtime: { profile: 'egoric-readonly', user: 'leozops' },
    source: { kind: 'fixture_stub', user: 'node', pii_minimized: true, etag_replay: true },
    auth: { tenant_boundary: true, operations_boundary: true, secrets_printed: false },
    live_gate_claimed: false,
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(JSON.stringify({
    status: 'blocked',
    code: error instanceof Error ? error.message : 'local_staging_verification_failed',
  }));
  process.exitCode = 2;
});
