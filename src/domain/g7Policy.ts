import { evidenceFingerprint } from './phase2Proof';
import type { G6ActionPolicyManifest } from './g6Policy';

export const G7_POLICY_SCHEMA_VERSION = 'leozops_g7_bounded_autonomy_policy_v1' as const;
export const G7_SCENARIO_SET_VERSION = 'g7-core-v1' as const;

export interface G7BoundedAutonomyPolicyManifest {
  schema_version: typeof G7_POLICY_SCHEMA_VERSION;
  policy_id: string;
  status: 'accepted';
  environment: 'test' | 'production';
  approved_by: string;
  approved_at: string;
  valid_from: string;
  valid_until: string;
  tenant_id: string;
  source_connection_id: string;
  g6_policy: {
    policy_id: string;
    policy_fingerprint: string;
    command_key: string;
    command_version: string;
    adapter_id: string;
    target_fingerprint: string;
  };
  identities: {
    release_authority: string;
    release_credential_sha256: string;
    executor: string;
    executor_credential_sha256: string;
    kill_switch_operator: string;
    kill_switch_credential_sha256: string;
  };
  history: {
    window_days: number;
    min_successful_executions: number;
    require_successful_rollback_drill: true;
    max_non_successful_executions: 0;
  };
  limits: {
    max_cost_minor_per_action: number;
    max_cost_minor_per_day: number;
    currency: string;
    max_executions_per_hour: number;
    max_executions_per_day: number;
    cooldown_seconds: number;
    max_source_age_minutes: number;
    execution_lease_seconds: number;
    mutation_count_max: 1;
  };
  safety: {
    scenario_set_version: typeof G7_SCENARIO_SET_VERSION;
    initial_kill_switch_state: 'engaged';
    require_no_open_incident: true;
    halt_on_any_failure: true;
    halt_on_unknown_outcome: true;
  };
  verdict: 'accepted';
}

export interface G7PolicyValidation {
  ok: boolean;
  issues: string[];
  value?: G7BoundedAutonomyPolicyManifest;
  fingerprint?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,191}$/;
const COMMAND = /^egoric\.[a-z0-9]+(?:[._-][a-z0-9]+)*\.v[1-9][0-9]*$/;
const PLACEHOLDER = /(?:^|[-_:/])(?:tbd|todo|pending|unknown|null|n\/a|replace(?:_me)?)(?:$|[-_:/])|<.*>/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectAt(value: unknown, path: string, issues: string[]): Record<string, unknown> {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object`);
    return {};
  }
  return value;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], path: string, issues: string[]): void {
  const expected = new Set(keys);
  for (const key of Object.keys(value)) if (!expected.has(key)) issues.push(`${path}.${key} is not allowed`);
  for (const key of keys) if (!(key in value)) issues.push(`${path}.${key} is required`);
}

function safeString(
  value: unknown,
  path: string,
  issues: string[],
  pattern: RegExp = SAFE_ID,
  max = 256,
): string {
  if (
    typeof value !== 'string'
    || value.length < 2
    || value.length > max
    || value.trim() !== value
    || PLACEHOLDER.test(value)
    || /[\u0000-\u001f\u007f]/.test(value)
    || !pattern.test(value)
  ) {
    issues.push(`${path} must be a concrete safe value`);
    return '';
  }
  return value;
}

function timestamp(value: unknown, path: string, issues: string[]): string {
  const result = safeString(
    value,
    path,
    issues,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
  );
  if (result && Number.isNaN(Date.parse(result))) issues.push(`${path} must be a valid timestamp`);
  return result;
}

function integer(value: unknown, path: string, issues: string[], min: number, max: number): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    issues.push(`${path} must be an integer from ${min} to ${max}`);
    return min;
  }
  return Number(value);
}

export function g7TargetFingerprint(g6: G6ActionPolicyManifest): string {
  return evidenceFingerprint({
    system: 'egoric',
    project_id: g6.target.project_id,
    tenant_key: g6.target.tenant_key,
    command_endpoint_url: g6.target.command_endpoint_url,
    command_credential_sha256: g6.target.command_credential_sha256,
  });
}

export function g7PolicyFingerprint(value: G7BoundedAutonomyPolicyManifest): string {
  return evidenceFingerprint(value);
}

export function validateG7Policy(
  input: unknown,
  g6?: G6ActionPolicyManifest,
): G7PolicyValidation {
  const issues: string[] = [];
  const root = objectAt(input, 'policy', issues);
  exactKeys(root, [
    'schema_version', 'policy_id', 'status', 'environment', 'approved_by', 'approved_at',
    'valid_from', 'valid_until', 'tenant_id', 'source_connection_id', 'g6_policy',
    'identities', 'history', 'limits', 'safety', 'verdict',
  ], 'policy', issues);

  if (root.schema_version !== G7_POLICY_SCHEMA_VERSION) {
    issues.push(`policy.schema_version must equal ${G7_POLICY_SCHEMA_VERSION}`);
  }
  if (root.status !== 'accepted') issues.push('policy.status must equal accepted');
  if (root.verdict !== 'accepted') issues.push('policy.verdict must equal accepted');
  if (root.environment !== 'test' && root.environment !== 'production') {
    issues.push('policy.environment must equal test or production');
  }

  const approvedAt = timestamp(root.approved_at, 'policy.approved_at', issues);
  const validFrom = timestamp(root.valid_from, 'policy.valid_from', issues);
  const validUntil = timestamp(root.valid_until, 'policy.valid_until', issues);
  if (approvedAt && validFrom && Date.parse(approvedAt) > Date.parse(validFrom)) {
    issues.push('policy.approved_at cannot follow valid_from');
  }
  if (validFrom && validUntil && Date.parse(validUntil) <= Date.parse(validFrom)) {
    issues.push('policy.valid_until must follow valid_from');
  }
  if (validFrom && validUntil && Date.parse(validUntil) - Date.parse(validFrom) > 30 * 86_400_000) {
    issues.push('policy validity cannot exceed 30 days');
  }

  const tenantId = safeString(root.tenant_id, 'policy.tenant_id', issues, UUID);
  const sourceConnectionId = safeString(root.source_connection_id, 'policy.source_connection_id', issues, UUID);

  const g6Root = objectAt(root.g6_policy, 'policy.g6_policy', issues);
  exactKeys(g6Root, [
    'policy_id', 'policy_fingerprint', 'command_key', 'command_version', 'adapter_id', 'target_fingerprint',
  ], 'policy.g6_policy', issues);
  const g6Policy = {
    policy_id: safeString(g6Root.policy_id, 'policy.g6_policy.policy_id', issues, /^G6-[A-Za-z0-9._-]{4,64}$/),
    policy_fingerprint: safeString(g6Root.policy_fingerprint, 'policy.g6_policy.policy_fingerprint', issues, HASH),
    command_key: safeString(g6Root.command_key, 'policy.g6_policy.command_key', issues, COMMAND),
    command_version: safeString(g6Root.command_version, 'policy.g6_policy.command_version', issues, /^v[1-9][0-9]*$/),
    adapter_id: safeString(g6Root.adapter_id, 'policy.g6_policy.adapter_id', issues),
    target_fingerprint: safeString(g6Root.target_fingerprint, 'policy.g6_policy.target_fingerprint', issues, HASH),
  };

  const identitiesRoot = objectAt(root.identities, 'policy.identities', issues);
  exactKeys(identitiesRoot, [
    'release_authority', 'release_credential_sha256', 'executor', 'executor_credential_sha256',
    'kill_switch_operator', 'kill_switch_credential_sha256',
  ], 'policy.identities', issues);
  const actorPattern = /^[^\u0000-\u001f\u007f]{2,128}$/;
  const identities = {
    release_authority: safeString(identitiesRoot.release_authority, 'policy.identities.release_authority', issues, actorPattern, 128),
    release_credential_sha256: safeString(identitiesRoot.release_credential_sha256, 'policy.identities.release_credential_sha256', issues, HASH),
    executor: safeString(identitiesRoot.executor, 'policy.identities.executor', issues, actorPattern, 128),
    executor_credential_sha256: safeString(identitiesRoot.executor_credential_sha256, 'policy.identities.executor_credential_sha256', issues, HASH),
    kill_switch_operator: safeString(identitiesRoot.kill_switch_operator, 'policy.identities.kill_switch_operator', issues, actorPattern, 128),
    kill_switch_credential_sha256: safeString(identitiesRoot.kill_switch_credential_sha256, 'policy.identities.kill_switch_credential_sha256', issues, HASH),
  };
  const credentialSet = new Set([
    identities.release_credential_sha256,
    identities.executor_credential_sha256,
    identities.kill_switch_credential_sha256,
  ].filter(Boolean));
  if (credentialSet.size !== 3) issues.push('release, executor, and kill-switch credentials must be different');

  const historyRoot = objectAt(root.history, 'policy.history', issues);
  exactKeys(historyRoot, [
    'window_days', 'min_successful_executions', 'require_successful_rollback_drill',
    'max_non_successful_executions',
  ], 'policy.history', issues);
  if (historyRoot.require_successful_rollback_drill !== true) {
    issues.push('policy.history.require_successful_rollback_drill must equal true');
  }
  if (historyRoot.max_non_successful_executions !== 0) {
    issues.push('policy.history.max_non_successful_executions must equal 0');
  }
  const history = {
    window_days: integer(historyRoot.window_days, 'policy.history.window_days', issues, 7, 90),
    min_successful_executions: integer(
      historyRoot.min_successful_executions,
      'policy.history.min_successful_executions',
      issues,
      5,
      100,
    ),
    require_successful_rollback_drill: true as const,
    max_non_successful_executions: 0 as const,
  };

  const limitsRoot = objectAt(root.limits, 'policy.limits', issues);
  exactKeys(limitsRoot, [
    'max_cost_minor_per_action', 'max_cost_minor_per_day', 'currency',
    'max_executions_per_hour', 'max_executions_per_day', 'cooldown_seconds',
    'max_source_age_minutes', 'execution_lease_seconds', 'mutation_count_max',
  ], 'policy.limits', issues);
  if (limitsRoot.mutation_count_max !== 1) issues.push('policy.limits.mutation_count_max must equal 1');
  const limits = {
    max_cost_minor_per_action: integer(
      limitsRoot.max_cost_minor_per_action,
      'policy.limits.max_cost_minor_per_action',
      issues,
      0,
      1_000_000,
    ),
    max_cost_minor_per_day: integer(
      limitsRoot.max_cost_minor_per_day,
      'policy.limits.max_cost_minor_per_day',
      issues,
      0,
      1_000_000,
    ),
    currency: safeString(limitsRoot.currency, 'policy.limits.currency', issues, /^[A-Z]{3}$/),
    max_executions_per_hour: integer(
      limitsRoot.max_executions_per_hour,
      'policy.limits.max_executions_per_hour',
      issues,
      1,
      10,
    ),
    max_executions_per_day: integer(
      limitsRoot.max_executions_per_day,
      'policy.limits.max_executions_per_day',
      issues,
      1,
      50,
    ),
    cooldown_seconds: integer(limitsRoot.cooldown_seconds, 'policy.limits.cooldown_seconds', issues, 60, 3_600),
    max_source_age_minutes: integer(
      limitsRoot.max_source_age_minutes,
      'policy.limits.max_source_age_minutes',
      issues,
      5,
      30,
    ),
    execution_lease_seconds: integer(
      limitsRoot.execution_lease_seconds,
      'policy.limits.execution_lease_seconds',
      issues,
      30,
      300,
    ),
    mutation_count_max: 1 as const,
  };
  if (limits.max_executions_per_hour > limits.max_executions_per_day) {
    issues.push('hourly execution limit cannot exceed daily execution limit');
  }
  if (limits.max_cost_minor_per_action > limits.max_cost_minor_per_day) {
    issues.push('per-action cost cannot exceed daily cost');
  }

  const safetyRoot = objectAt(root.safety, 'policy.safety', issues);
  exactKeys(safetyRoot, [
    'scenario_set_version', 'initial_kill_switch_state', 'require_no_open_incident',
    'halt_on_any_failure', 'halt_on_unknown_outcome',
  ], 'policy.safety', issues);
  if (safetyRoot.scenario_set_version !== G7_SCENARIO_SET_VERSION) {
    issues.push(`policy.safety.scenario_set_version must equal ${G7_SCENARIO_SET_VERSION}`);
  }
  if (safetyRoot.initial_kill_switch_state !== 'engaged') {
    issues.push('policy.safety.initial_kill_switch_state must equal engaged');
  }
  for (const key of ['require_no_open_incident', 'halt_on_any_failure', 'halt_on_unknown_outcome'] as const) {
    if (safetyRoot[key] !== true) issues.push(`policy.safety.${key} must equal true`);
  }
  const safety = {
    scenario_set_version: G7_SCENARIO_SET_VERSION,
    initial_kill_switch_state: 'engaged' as const,
    require_no_open_incident: true as const,
    halt_on_any_failure: true as const,
    halt_on_unknown_outcome: true as const,
  };

  if (g6) {
    if (g6.policy_id !== g6Policy.policy_id) issues.push('policy G6 policy ID does not match');
    if (evidenceFingerprint(g6) !== g6Policy.policy_fingerprint) issues.push('policy G6 fingerprint does not match');
    if (g6.command.key !== g6Policy.command_key) issues.push('policy command key does not match G6');
    if (g6.command.version !== g6Policy.command_version) issues.push('policy command version does not match G6');
    if (g6.command.adapter_id !== g6Policy.adapter_id) issues.push('policy adapter does not match G6');
    if (g7TargetFingerprint(g6) !== g6Policy.target_fingerprint) issues.push('policy target does not match G6');
    if (g6.command.risk_tier !== 'low') issues.push('bounded autonomy requires a low-risk G6 command');
    if (g6.environment !== root.environment) issues.push('policy environment does not match G6');
    if (g6.tenant_id !== tenantId) issues.push('policy tenant does not match G6');
    if (g6.source_connection_id !== sourceConnectionId) issues.push('policy source does not match G6');
    if (validFrom && Date.parse(validFrom) < Date.parse(g6.valid_from)) issues.push('policy cannot start before G6');
    if (validUntil && Date.parse(validUntil) > Date.parse(g6.valid_until)) issues.push('policy cannot outlive G6');
    if (limits.currency !== g6.limits.currency) issues.push('policy currency does not match G6');
    if (limits.max_cost_minor_per_action > g6.limits.max_cost_minor) issues.push('per-action cost exceeds G6');
    if (limits.max_cost_minor_per_day > g6.limits.max_cost_minor) issues.push('daily cost exceeds G6');
    if (limits.max_executions_per_hour > g6.limits.max_executions_per_hour) issues.push('hourly limit exceeds G6');
    if (limits.max_executions_per_day > g6.limits.max_executions_per_day) issues.push('daily limit exceeds G6');
    if (limits.execution_lease_seconds > g6.limits.execution_lease_seconds) issues.push('execution lease exceeds G6');
    if ([
      identities.release_credential_sha256,
      identities.executor_credential_sha256,
      identities.kill_switch_credential_sha256,
    ].some((fingerprint) => [
      g6.target.command_credential_sha256,
      g6.identities.approval_credential_sha256,
      g6.identities.operator_credential_sha256,
    ].includes(fingerprint))) {
      issues.push('G7 credentials must differ from every G6 command and human credential');
    }
  }

  const value: G7BoundedAutonomyPolicyManifest = {
    schema_version: G7_POLICY_SCHEMA_VERSION,
    policy_id: safeString(root.policy_id, 'policy.policy_id', issues, /^G7-[A-Za-z0-9._-]{4,64}$/),
    status: 'accepted',
    environment: root.environment === 'production' ? 'production' : 'test',
    approved_by: safeString(root.approved_by, 'policy.approved_by', issues, actorPattern, 128),
    approved_at: approvedAt,
    valid_from: validFrom,
    valid_until: validUntil,
    tenant_id: tenantId,
    source_connection_id: sourceConnectionId,
    g6_policy: g6Policy,
    identities,
    history,
    limits,
    safety,
    verdict: 'accepted',
  };
  if (value.approved_by && identities.release_authority && value.approved_by !== identities.release_authority) {
    issues.push('policy.approved_by must equal the release authority');
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, issues: [], value, fingerprint: g7PolicyFingerprint(value) };
}
