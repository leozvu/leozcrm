import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const deployDir = path.join(root, 'deploy', 'local-staging');
const envPath = path.join(root, '.env.local-staging.local');
const manifestPath = path.join(deployDir, 'deployment.local.json');

function secret(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString('base64url')}`;
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function writePrivate(file: string, contents: string): void {
  fs.writeFileSync(file, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* Windows ACLs remain authoritative. */ }
}

function writeManifest(file: string, contents: string): void {
  fs.writeFileSync(file, contents, { encoding: 'utf8', flag: 'wx', mode: 0o644 });
  try { fs.chmodSync(file, 0o644); } catch { /* Windows ACLs remain authoritative. */ }
}

function main(): void {
  if (fs.existsSync(envPath) || fs.existsSync(manifestPath)) {
    throw new Error('local_staging_already_bootstrapped');
  }
  fs.mkdirSync(deployDir, { recursive: true });
  fs.mkdirSync(path.join(deployDir, 'certs', 'ca'), { recursive: true });
  fs.mkdirSync(path.join(deployDir, 'certs', 'server'), { recursive: true });

  const postgresPassword = secret('pg');
  const outputSecret = secret('output');
  const sourceToken = secret('source');
  const sourceOperatorToken = secret('sourceop');
  const proactiveOperatorToken = secret('proactive');
  const observerOperatorToken = secret('observer');
  const observabilityToken = secret('observe');
  const tenantId = '11111111-1111-4111-8111-111111111116';
  const connectionId = '22222222-2222-4222-8222-222222222216';

  const manifest = {
    schema_version: 'leozops_phase12_live_observer_v1',
    status: 'accepted',
    environment: 'staging',
    runtime_profile: 'egoric-readonly',
    target: {
      provider: 'docker-local',
      project_id: 'leozops-local-staging',
      service_id: 'leozops-local-staging-web',
      region: 'localhost',
      database_id: 'leozops-local-staging-postgres-16',
    },
    source: {
      tenant_id: tenantId,
      tenant_key: 'egoric-local-staging',
      connection_id: connectionId,
      egoric_project_id: 'repositoryrealms-local-staging-stub',
      endpoint_url: 'https://repositoryrealms-source.local:3443/api/integrations/leozops/v1/lead-snapshot',
      method: 'GET',
      request_body_present: false,
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
      dashboard_id: 'leozops-local-staging-operations',
      alert_route_id: 'leozops-local-staging-console',
      observability_credential_sha256: sha256(observabilityToken),
    },
    safety: {
      source_read_only: true,
      action_authority: 'none',
      background_loops_in_http_process: false,
      waivers_allowed: false,
    },
  };

  const databaseUrl = `postgresql://leozops_staging:${encodeURIComponent(postgresPassword)}@postgres:5432/leozops_local_staging`;
  const env = [
    'COMPOSE_PROJECT_NAME=leozops-local-staging',
    'NODE_ENV=production',
    'INTEGRATION_MODE=egoric-readonly',
    'LEOZOPS_DEPLOY_ENV=local-staging',
    'LEOZOPS_LOCAL_STAGING_ACK=PROVISION_ISOLATED_LOCAL_STAGING_ONLY',
    'LEOZOPS_ADVISOR_PROVIDER=deterministic',
    'LEOZOPS_LIVE_DEPLOYMENT_MANIFEST=/run/config/deployment.local.json',
    'LEOZOPS_RUNTIME_PROJECT_ID=leozops-local-staging',
    'LEOZOPS_DATABASE_ID=leozops-local-staging-postgres-16',
    'LEOZOPS_EGORIC_PROJECT_ID=repositoryrealms-local-staging-stub',
    'LEOZOPS_LOCAL_STAGING_PORT=3100',
    'LEOZOPS_LOCAL_SOURCE_PORT=3200',
    'LEOZOPS_LOCAL_POSTGRES_PORT=55437',
    'POSTGRES_USER=leozops_staging',
    'POSTGRES_DB=leozops_local_staging',
    `POSTGRES_PASSWORD=${postgresPassword}`,
    `DATABASE_URL=${databaseUrl}`,
    `LEOZOPS_OUTPUT_AUTH_SECRET=${outputSecret}`,
    `LEOZOPS_SOURCE_BEARER_TOKEN=${sourceToken}`,
    `LEOZOPS_OPERATOR_TOKEN=${sourceOperatorToken}`,
    `LEOZOPS_PROACTIVE_OPERATOR_TOKEN=${proactiveOperatorToken}`,
    `LEOZOPS_LIVE_OBSERVER_TOKEN=${observerOperatorToken}`,
    `LEOZOPS_LIVE_OBSERVER_TOKEN_SHA256=${sha256(observerOperatorToken)}`,
    `LEOZOPS_OBSERVABILITY_TOKEN=${observabilityToken}`,
    `LEOZOPS_OBSERVABILITY_TOKEN_SHA256=${sha256(observabilityToken)}`,
    'PGPOOL_MIN=1',
    'PGPOOL_MAX=5',
    'PORT=3000',
    'TZ=UTC',
    'NODE_EXTRA_CA_CERTS=/run/source-ca/source-cert.pem',
    '',
  ].join('\n');

  writePrivate(envPath, env);
  try {
    writeManifest(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  } catch (error) {
    fs.rmSync(envPath, { force: true });
    throw error;
  }
  console.log(JSON.stringify({
    status: 'ok',
    environment: 'leozops-local-staging',
    env_file: path.relative(root, envPath),
    deployment_manifest: path.relative(root, manifestPath),
    secrets_printed: false,
  }, null, 2));
}

try { main(); }
catch (error) {
  console.error(JSON.stringify({
    status: 'blocked',
    code: error instanceof Error ? error.message : 'local_staging_bootstrap_failed',
  }));
  process.exitCode = 2;
}
