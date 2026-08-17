import fs from 'node:fs';
import path from 'node:path';
import * as dotenv from 'dotenv';
import {
  secretEnvironmentName,
  validateLiveObserverDeployment,
} from './domain/liveObserver';
import { runtimeSecretIsUsable } from './security/runtimeSecret';

dotenv.config();

export interface LiveObserverPreflightResult {
  ok: boolean;
  code: 'ready' | 'blocked';
  issues: string[];
  manifest_fingerprint?: string;
  target?: { provider: string; project_id: string; service_id: string; region: string };
}

export type LiveObserverPreflightScope = 'server' | 'observer';

export function inspectLiveObserverPreflight(
  raw: unknown,
  env: NodeJS.ProcessEnv,
  scope: LiveObserverPreflightScope = 'observer',
): LiveObserverPreflightResult {
  const validation = validateLiveObserverDeployment(raw);
  if (!validation.ok || !validation.value || !validation.fingerprint) {
    return { ok: false, code: 'blocked', issues: validation.issues };
  }
  const issues: string[] = [];
  if (env.NODE_ENV !== 'production') issues.push('NODE_ENV must equal production');
  if (env.INTEGRATION_MODE !== validation.value.runtime_profile) {
    issues.push(`INTEGRATION_MODE must equal ${validation.value.runtime_profile}`);
  }
  const bindingKeys: Array<keyof typeof validation.value.secret_bindings> = scope === 'server'
    ? ['database_url', 'output_auth_secret']
    : [
      'database_url', 'source_bearer_token', 'source_operator_token',
      'proactive_operator_token', 'observer_operator_token',
    ];
  for (const key of bindingKeys) {
    const reference = validation.value.secret_bindings[key];
    const name = secretEnvironmentName(reference);
    if (!name || !runtimeSecretIsUsable(env[name])) issues.push(`${reference} is not injected with a usable value`);
  }
  if (env.LEOZOPS_RUNTIME_PROJECT_ID !== validation.value.target.project_id) {
    issues.push('runtime project identity does not match deployment');
  }
  if (env.LEOZOPS_DATABASE_ID !== validation.value.target.database_id) {
    issues.push('database identity does not match deployment');
  }
  if (env.LEOZOPS_EGORIC_PROJECT_ID !== validation.value.source.egoric_project_id) {
    issues.push('Egoric project identity does not match deployment');
  }
  return {
    ok: issues.length === 0,
    code: issues.length === 0 ? 'ready' : 'blocked',
    issues,
    manifest_fingerprint: validation.fingerprint,
    target: {
      provider: validation.value.target.provider,
      project_id: validation.value.target.project_id,
      service_id: validation.value.target.service_id,
      region: validation.value.target.region,
    },
  };
}

function main(): void {
  const manifestPath = process.env.LEOZOPS_LIVE_DEPLOYMENT_MANIFEST;
  if (!manifestPath) throw new Error('LEOZOPS_LIVE_DEPLOYMENT_MANIFEST is required');
  const raw = JSON.parse(fs.readFileSync(path.resolve(manifestPath), 'utf8')) as unknown;
  const scope = process.argv[2] ?? 'observer';
  if (scope !== 'server' && scope !== 'observer') throw new Error('preflight scope must be server or observer');
  const result = inspectLiveObserverPreflight(raw, process.env, scope);
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 2;
}

if (require.main === module) {
  try {
    main();
  } catch {
    console.error(JSON.stringify({ ok: false, code: 'blocked', issues: ['preflight input is missing or invalid'] }));
    process.exitCode = 2;
  }
}
