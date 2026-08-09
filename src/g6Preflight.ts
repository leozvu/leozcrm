import fs from 'node:fs';
import path from 'node:path';
import { G6ActionPolicyManifest, validateG6ActionPolicy } from './domain/g6Policy';
import { assertAdapterMatchesPolicy, policyIsActive } from './domain/supervisedAction';
import { db } from './db/knex';
import { buildActionAdapterRegistry } from './integrations/actions/buildActionAdapterRegistry';
import { SupervisedActionRepository } from './repositories/supervisedActionRepository';

export function runtimeIdentityIssues(
  policy: G6ActionPolicyManifest,
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const expected = {
    LEOZOPS_ACTION_ENVIRONMENT: policy.environment,
    LEOZOPS_ACTION_TARGET_PROJECT_ID: policy.target.project_id,
    LEOZOPS_ACTION_TARGET_TENANT_KEY: policy.target.tenant_key,
    LEOZOPS_ACTION_COMMAND_ENDPOINT_URL: policy.target.command_endpoint_url,
    LEOZOPS_ACTION_COMMAND_CREDENTIAL_SHA256: policy.target.command_credential_sha256,
    LEOZOPS_ACTION_APPROVAL_CREDENTIAL_SHA256: policy.identities.approval_credential_sha256,
    LEOZOPS_ACTION_OPERATOR_CREDENTIAL_SHA256: policy.identities.operator_credential_sha256,
  };
  return Object.entries(expected).flatMap(([key, value]) => {
    const actual = environment[key];
    if (!actual) return [`${key} is required`];
    return actual === value ? [] : [`${key} does not match the accepted policy`];
  });
}

async function main(): Promise<void> {
  const file = path.resolve(process.argv[2] ?? 'config/g6.action-policy.example.json');
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    console.error(JSON.stringify({ status: 'blocked', issues: ['policy file is unreadable or invalid JSON'] }, null, 2));
    process.exitCode = 2;
    return;
  }

  const initial = validateG6ActionPolicy(raw);
  if (!initial.ok || !initial.value) {
    console.error(JSON.stringify({ status: 'blocked', issues: initial.issues }, null, 2));
    process.exitCode = 2;
    return;
  }
  const repository = new SupervisedActionRepository(db);
  const g5 = await repository.findG5Decision(initial.value.g5_release.decision_id);
  const validation = g5 ? validateG6ActionPolicy(raw, g5) : initial;
  const issues = g5 ? [...validation.issues] : ['referenced G5 decision does not exist'];
  const latest = await repository.findLatestG5Decision(
    initial.value.tenant_id,
    initial.value.source_connection_id,
  );
  if (!latest || !g5 || latest.id !== g5.id || latest.decision !== 'go') {
    issues.push('referenced G5 go is not the current release decision');
  }
  if (!policyIsActive(initial.value, new Date().toISOString())) {
    issues.push('policy is not active at the current time');
  }
  issues.push(...runtimeIdentityIssues(initial.value));
  try {
    const adapter = buildActionAdapterRegistry().resolve({
      environment: initial.value.environment,
      commandKey: initial.value.command.key,
      commandVersion: initial.value.command.version,
      adapterId: initial.value.command.adapter_id,
    });
    assertAdapterMatchesPolicy(adapter, initial.value);
  } catch {
    issues.push('exact command adapter is not registered in this build');
  }
  if (issues.length > 0) {
    console.error(JSON.stringify({
      status: 'blocked',
      policy_id: initial.value.policy_id,
      policy_fingerprint: initial.fingerprint,
      issues: [...new Set(issues)],
    }, null, 2));
    process.exitCode = 2;
    return;
  }
  console.log(JSON.stringify({
    status: 'ready',
    policy_id: validation.value!.policy_id,
    policy_fingerprint: validation.fingerprint,
    g5_release_decision_id: g5!.id,
    command_key: validation.value!.command.key,
    environment: validation.value!.environment,
  }, null, 2));
}

if (require.main === module) {
  main()
    .catch(() => {
      console.error(JSON.stringify({ status: 'blocked', issues: ['G6 preflight failed safely'] }, null, 2));
      process.exitCode = 2;
    })
    .finally(() => db.destroy());
}
