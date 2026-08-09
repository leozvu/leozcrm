import fs from 'node:fs';
import path from 'node:path';
import { db } from './db/knex';
import { G7BoundedAutonomyPolicyManifest, validateG7Policy } from './domain/g7Policy';
import { g7PolicyIsActive } from './domain/boundedAutonomy';
import { assertAdapterMatchesPolicy, policyIsActive } from './domain/supervisedAction';
import { buildActionAdapterRegistry } from './integrations/actions/buildActionAdapterRegistry';
import { BoundedAutonomyRepository } from './repositories/boundedAutonomyRepository';
import { runtimeIdentityIssues as g6RuntimeIdentityIssues } from './g6Preflight';

export function g7RuntimeIdentityIssues(
  policy: G7BoundedAutonomyPolicyManifest,
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const expected = {
    LEOZOPS_G7_ENVIRONMENT: policy.environment,
    LEOZOPS_G7_POLICY_SHA256: policy ? requirePolicyFingerprint(policy) : '',
    LEOZOPS_G7_G6_POLICY_SHA256: policy.g6_policy.policy_fingerprint,
    LEOZOPS_G7_TARGET_SHA256: policy.g6_policy.target_fingerprint,
    LEOZOPS_G7_RELEASE_CREDENTIAL_SHA256: policy.identities.release_credential_sha256,
    LEOZOPS_G7_EXECUTOR_CREDENTIAL_SHA256: policy.identities.executor_credential_sha256,
    LEOZOPS_G7_KILL_SWITCH_CREDENTIAL_SHA256: policy.identities.kill_switch_credential_sha256,
  };
  return Object.entries(expected).flatMap(([key, value]) => {
    const actual = environment[key];
    if (!actual) return [`${key} is required`];
    return actual === value ? [] : [`${key} does not match the accepted policy`];
  });
}

function requirePolicyFingerprint(policy: G7BoundedAutonomyPolicyManifest): string {
  const validation = validateG7Policy(policy);
  return validation.fingerprint ?? 'invalid';
}

async function main(): Promise<void> {
  const file = path.resolve(process.argv[2] ?? 'config/g7.bounded-autonomy-policy.example.json');
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    console.error(JSON.stringify({ status: 'blocked', issues: ['policy file is unreadable or invalid JSON'] }, null, 2));
    process.exitCode = 2;
    return;
  }
  const initial = validateG7Policy(raw);
  if (!initial.ok || !initial.value || !initial.fingerprint) {
    console.error(JSON.stringify({ status: 'blocked', issues: initial.issues }, null, 2));
    process.exitCode = 2;
    return;
  }
  const repository = new BoundedAutonomyRepository(db);
  const issues: string[] = [];
  let g6;
  try {
    g6 = await repository.findG6Policy(initial.value.g6_policy.policy_id);
  } catch {
    issues.push('bound G6 policy does not exist');
  }
  const validation = g6 ? validateG7Policy(raw, g6.manifest) : initial;
  issues.push(...validation.issues);
  const at = new Date().toISOString();
  if (!g7PolicyIsActive(initial.value, at)) issues.push('G7 policy is not active at the current time');
  if (g6 && !policyIsActive(g6.manifest, at)) issues.push('bound G6 policy is not active at the current time');
  const latestG5 = await repository.findLatestG5Decision(initial.value.tenant_id, initial.value.source_connection_id);
  if (!g6 || !latestG5 || latestG5.id !== g6.manifest.g5_release.decision_id || latestG5.decision !== 'go') {
    issues.push('bound G5 go is not the current release decision');
  }
  let stored;
  try {
    stored = await repository.findPolicy(initial.value.policy_id);
    if (stored.record.policy_fingerprint !== initial.fingerprint) issues.push('stored G7 policy fingerprint does not match');
    if (!stored.simulation.passed) issues.push('bound G7 simulation did not pass');
    if ((await repository.latestKillSwitch(stored.record.id)).state !== 'released') issues.push('kill switch is engaged');
    if (await repository.countOpenIncidents(stored.record.id) > 0) issues.push('an autonomy incident is open');
    const history = await repository.supervisedHistory(
      stored.g6.record.id,
      stored.manifest.history.window_days,
      at,
    );
    if (
      history.successful_executions < stored.manifest.history.min_successful_executions
      || history.non_successful_executions !== 0
      || history.successful_rollbacks < 1
    ) issues.push('supervised history does not qualify');
  } catch {
    issues.push('exact accepted G7 policy and simulation do not exist');
  }
  const receivedAt = await repository.latestSourceReceivedAt(initial.value.tenant_id, initial.value.source_connection_id);
  const sourceAge = receivedAt ? Date.parse(at) - Date.parse(receivedAt) : Number.POSITIVE_INFINITY;
  if (!receivedAt || sourceAge < 0 || sourceAge > initial.value.limits.max_source_age_minutes * 60_000) {
    issues.push('source snapshot is stale or absent');
  }
  issues.push(...g7RuntimeIdentityIssues(initial.value));
  if (g6) issues.push(...g6RuntimeIdentityIssues(g6.manifest));
  try {
    if (!g6) throw new Error('missing G6');
    const adapter = buildActionAdapterRegistry().resolve({
      environment: initial.value.environment,
      commandKey: initial.value.g6_policy.command_key,
      commandVersion: initial.value.g6_policy.command_version,
      adapterId: initial.value.g6_policy.adapter_id,
    });
    assertAdapterMatchesPolicy(adapter, g6.manifest);
    if (typeof adapter.previewRecovery !== 'function' || typeof adapter.recover !== 'function') {
      throw new Error('missing human recovery contract');
    }
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
    policy_id: initial.value.policy_id,
    policy_fingerprint: initial.fingerprint,
    g6_policy_id: initial.value.g6_policy.policy_id,
    command_key: initial.value.g6_policy.command_key,
    environment: initial.value.environment,
  }, null, 2));
}

if (require.main === module) {
  main().catch(() => {
    console.error(JSON.stringify({ status: 'blocked', issues: ['G7 preflight failed safely'] }, null, 2));
    process.exitCode = 2;
  }).finally(() => db.destroy());
}
