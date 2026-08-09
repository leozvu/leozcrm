import fs from 'node:fs';
import path from 'node:path';
import * as dotenv from 'dotenv';
import { validateLiveObserverDeployment } from '../src/domain/liveObserver';
import { signTenantReadToken } from '../src/http/integrationReadAuth';

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env.local-staging.local');
const manifestPath = path.join(root, 'deploy', 'local-staging', 'deployment.local.json');

function main(): void {
  const env = dotenv.parse(fs.readFileSync(envPath));
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown;
  const validation = validateLiveObserverDeployment(manifest);
  if (
    !validation.ok
    || validation.value?.environment !== 'staging'
    || validation.value.target.project_id !== 'leozops-local-staging'
    || !env.LEOZOPS_OUTPUT_AUTH_SECRET
  ) throw new Error('local_staging_credential_binding_invalid');
  const tenantKey = validation.value.source.tenant_key;
  console.log(JSON.stringify({
    tenant_key: tenantKey,
    read_credential: signTenantReadToken(tenantKey, env.LEOZOPS_OUTPUT_AUTH_SECRET),
  }, null, 2));
}

try { main(); }
catch (error) {
  console.error(JSON.stringify({
    status: 'blocked',
    code: error instanceof Error ? error.message : 'local_staging_credential_failed',
  }));
  process.exitCode = 2;
}
