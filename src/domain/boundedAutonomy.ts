import { timingSafeEqual } from 'node:crypto';
import { credentialFingerprint, type G6ActionPolicyManifest } from './g6Policy';
import {
  G7_SCENARIO_SET_VERSION,
  type G7BoundedAutonomyPolicyManifest,
} from './g7Policy';
import { evidenceFingerprint } from './phase2Proof';

export const G7_TABLES = {
  simulations: 'bounded_autonomy_simulations',
  policies: 'bounded_autonomy_policies',
  killSwitchEvents: 'bounded_autonomy_kill_switch_events',
  evaluations: 'bounded_autonomy_evaluations',
  attempts: 'bounded_autonomy_attempts',
  recoveryPreviews: 'bounded_autonomy_recovery_previews',
  recoveryApprovals: 'bounded_autonomy_recovery_approvals',
  incidentEvents: 'bounded_autonomy_incident_events',
  events: 'bounded_autonomy_events',
} as const;

export type AutonomyDecision = 'allow' | 'deny';
export type AutonomyAttemptStatus = 'in_progress' | 'succeeded' | 'failed' | 'reconciliation_required';
export type AutonomyAttemptKind = 'execute' | 'recovery';
export type KillSwitchState = 'engaged' | 'released';
export type IncidentEventKind = 'opened' | 'resolved';
export type AutonomyEventType =
  | 'policy_accepted'
  | 'kill_switch_engaged'
  | 'kill_switch_released'
  | 'evaluation_allowed'
  | 'evaluation_denied'
  | 'execution_started'
  | 'execution_succeeded'
  | 'execution_failed'
  | 'execution_reconciliation_required'
  | 'recovery_previewed'
  | 'recovery_approved'
  | 'recovery_rejected'
  | 'recovery_started'
  | 'recovery_succeeded'
  | 'recovery_failed'
  | 'recovery_reconciliation_required'
  | 'incident_opened'
  | 'incident_resolved';

export interface G7PolicySimulationRecord {
  id: string;
  tenant_id: string;
  source_connection_id: string;
  g6_policy_record_id: string;
  policy_id: string;
  policy_fingerprint: string;
  g6_policy_fingerprint: string;
  scenario_set_version: typeof G7_SCENARIO_SET_VERSION;
  scenario_count: number;
  passed: 0 | 1 | boolean;
  outcomes_json: string;
  simulation_fingerprint: string;
  simulated_by: string;
  simulated_at: string;
  created_at: string;
}

export interface BoundedAutonomyPolicyRecord {
  id: string;
  tenant_id: string;
  source_connection_id: string;
  g5_release_decision_id: string;
  g6_policy_record_id: string;
  simulation_id: string;
  policy_id: string;
  environment: 'test' | 'production';
  command_key: string;
  command_version: string;
  adapter_id: string;
  target_fingerprint: string;
  valid_from: string;
  valid_until: string;
  policy_fingerprint: string;
  manifest_json: string;
  accepted_at: string;
  created_at: string;
}

export interface KillSwitchEventRecord {
  id: string;
  tenant_id: string;
  policy_record_id: string;
  sequence: number;
  state: KillSwitchState;
  actor: string;
  reason_code: string;
  evidence_fingerprint: string;
  event_fingerprint: string;
  occurred_at: string;
  created_at: string;
}

export interface AutonomyEvaluationRecord {
  id: string;
  tenant_id: string;
  source_connection_id: string;
  policy_record_id: string;
  idempotency_key: string;
  payload_json: string;
  payload_fingerprint: string;
  reason_code: string;
  evidence_refs_json: string;
  request_fingerprint: string;
  target_fingerprint: string;
  preview_fingerprint: string | null;
  effect_fingerprint: string | null;
  summary_code: string | null;
  rollback_strategy_code: string | null;
  estimated_cost_minor: number;
  currency: string;
  preview_mutation_count: number | null;
  decision: AutonomyDecision;
  decision_code: string;
  evaluated_at: string;
  evaluation_fingerprint: string;
  created_at: string;
}

export interface AutonomyAttemptRecord {
  id: string;
  tenant_id: string;
  policy_record_id: string;
  evaluation_id: string | null;
  kind: AutonomyAttemptKind;
  subject_attempt_id: string | null;
  recovery_approval_id: string | null;
  idempotency_key: string;
  request_fingerprint: string;
  status: AutonomyAttemptStatus;
  executor: string;
  reserved_cost_minor: number;
  currency: string;
  started_at: string;
  lease_expires_at: string;
  finished_at: string | null;
  external_request_id: string | null;
  result_fingerprint: string | null;
  result_code: string | null;
  actual_cost_minor: number | null;
  external_mutation_count: number | null;
  latency_ms: number | null;
  created_at: string;
}

export interface AutonomyRecoveryPreviewRecord {
  id: string;
  tenant_id: string;
  policy_record_id: string;
  subject_attempt_id: string;
  adapter_id: string;
  adapter_version: string;
  request_fingerprint: string;
  target_fingerprint: string;
  effect_fingerprint: string;
  summary_code: string;
  rollback_strategy_code: string;
  estimated_cost_minor: number;
  currency: string;
  external_mutation_count: 0;
  previewed_by: string;
  previewed_at: string;
  expires_at: string;
  preview_fingerprint: string;
  created_at: string;
}

export interface AutonomyRecoveryApprovalRecord {
  id: string;
  tenant_id: string;
  policy_record_id: string;
  subject_attempt_id: string;
  preview_id: string;
  decision: 'approved' | 'rejected';
  policy_fingerprint: string;
  preview_fingerprint: string;
  approver: string;
  reason_code: string;
  nonce: string;
  max_cost_minor: number;
  currency: string;
  decided_at: string;
  expires_at: string;
  approval_fingerprint: string;
  created_at: string;
}

export interface AutonomyIncidentEventRecord {
  id: string;
  tenant_id: string;
  policy_record_id: string;
  incident_id: string;
  attempt_id: string | null;
  sequence: number;
  kind: IncidentEventKind;
  actor: string;
  reason_code: string;
  evidence_fingerprint: string;
  event_fingerprint: string;
  occurred_at: string;
  created_at: string;
}

export interface AutonomyEventRecord {
  id: string;
  tenant_id: string;
  policy_record_id: string;
  sequence: number;
  event_type: AutonomyEventType;
  actor: string;
  evidence_fingerprint: string;
  reason_code: string;
  event_fingerprint: string;
  occurred_at: string;
  created_at: string;
}

export interface SupervisedHistoryEvidence {
  successful_executions: number;
  non_successful_executions: number;
  successful_rollbacks: number;
  window_started_at: string;
  evaluated_at: string;
  evidence_fingerprint: string;
}

export interface AutonomyEnvelopeState {
  g5_current_go: boolean;
  g6_active: boolean;
  g7_active: boolean;
  history_qualified: boolean;
  simulation_passed: boolean;
  adapter_registered: boolean;
  source_age_minutes: number | null;
  kill_switch_released: boolean;
  open_incident_count: number;
  executions_last_hour: number;
  executions_last_day: number;
  cost_last_day: number;
  cooldown_elapsed_seconds: number | null;
  candidate_cost_minor: number;
  preview_mutation_count: number;
}

export interface AutonomyEnvelopeDecision {
  decision: AutonomyDecision;
  code: string;
}

export interface G7SimulationOutcome extends AutonomyEnvelopeDecision {
  scenario: string;
  expected: AutonomyDecision;
  expected_code: string;
  passed: boolean;
}

export interface G7SimulationResult {
  scenario_set_version: typeof G7_SCENARIO_SET_VERSION;
  policy_fingerprint: string;
  g6_policy_fingerprint: string;
  simulated_at: string;
  outcomes: G7SimulationOutcome[];
  passed: boolean;
  simulation_fingerprint: string;
}

export class BoundedAutonomyError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 409) {
    super(message);
    this.name = 'BoundedAutonomyError';
  }
}

export function autonomyFingerprint(value: unknown): string {
  return evidenceFingerprint(value);
}

export function autonomyCredentialMatches(secret: string, expected: string): boolean {
  let actual: string;
  try {
    actual = credentialFingerprint(secret);
  } catch {
    return false;
  }
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function g7PolicyIsActive(policy: G7BoundedAutonomyPolicyManifest, at: string): boolean {
  const instant = Date.parse(at);
  return instant >= Date.parse(policy.valid_from) && instant < Date.parse(policy.valid_until);
}

export function evaluateAutonomyEnvelope(
  policy: G7BoundedAutonomyPolicyManifest,
  state: AutonomyEnvelopeState,
): AutonomyEnvelopeDecision {
  if (!state.g5_current_go) return { decision: 'deny', code: 'g5_not_current_go' };
  if (!state.g6_active) return { decision: 'deny', code: 'g6_not_active' };
  if (!state.g7_active) return { decision: 'deny', code: 'g7_not_active' };
  if (!state.history_qualified) return { decision: 'deny', code: 'supervised_history_not_qualified' };
  if (!state.simulation_passed) return { decision: 'deny', code: 'simulation_not_passed' };
  if (!state.adapter_registered) return { decision: 'deny', code: 'adapter_not_registered' };
  if (state.source_age_minutes === null || state.source_age_minutes < 0) {
    return { decision: 'deny', code: 'source_freshness_unknown' };
  }
  if (state.source_age_minutes > policy.limits.max_source_age_minutes) {
    return { decision: 'deny', code: 'source_snapshot_stale' };
  }
  if (!state.kill_switch_released) return { decision: 'deny', code: 'kill_switch_engaged' };
  if (state.open_incident_count > 0) return { decision: 'deny', code: 'open_incident' };
  if (state.executions_last_hour >= policy.limits.max_executions_per_hour) {
    return { decision: 'deny', code: 'hourly_limit_exhausted' };
  }
  if (state.executions_last_day >= policy.limits.max_executions_per_day) {
    return { decision: 'deny', code: 'daily_limit_exhausted' };
  }
  if (
    state.cooldown_elapsed_seconds !== null
    && state.cooldown_elapsed_seconds < policy.limits.cooldown_seconds
  ) return { decision: 'deny', code: 'cooldown_active' };
  if (state.candidate_cost_minor < 0 || state.candidate_cost_minor > policy.limits.max_cost_minor_per_action) {
    return { decision: 'deny', code: 'action_cost_exceeds_limit' };
  }
  if (state.cost_last_day + state.candidate_cost_minor > policy.limits.max_cost_minor_per_day) {
    return { decision: 'deny', code: 'daily_cost_exceeds_limit' };
  }
  if (state.preview_mutation_count !== 0) return { decision: 'deny', code: 'dry_run_mutated' };
  return { decision: 'allow', code: 'bounded_candidate_allowed' };
}

export function simulateG7Policy(
  policy: G7BoundedAutonomyPolicyManifest,
  g6: G6ActionPolicyManifest,
  simulatedAt: string,
): G7SimulationResult {
  const baseline: AutonomyEnvelopeState = {
    g5_current_go: true,
    g6_active: true,
    g7_active: true,
    history_qualified: true,
    simulation_passed: true,
    adapter_registered: true,
    source_age_minutes: 0,
    kill_switch_released: true,
    open_incident_count: 0,
    executions_last_hour: 0,
    executions_last_day: 0,
    cost_last_day: 0,
    cooldown_elapsed_seconds: null,
    candidate_cost_minor: 0,
    preview_mutation_count: 0,
  };
  const cases: Array<{
    scenario: string;
    patch: Partial<AutonomyEnvelopeState>;
    expected: AutonomyDecision;
    code: string;
  }> = [
    { scenario: 'happy_path', patch: {}, expected: 'allow', code: 'bounded_candidate_allowed' },
    { scenario: 'g5_revoked', patch: { g5_current_go: false }, expected: 'deny', code: 'g5_not_current_go' },
    { scenario: 'g6_expired', patch: { g6_active: false }, expected: 'deny', code: 'g6_not_active' },
    { scenario: 'history_unqualified', patch: { history_qualified: false }, expected: 'deny', code: 'supervised_history_not_qualified' },
    { scenario: 'kill_switch_engaged', patch: { kill_switch_released: false }, expected: 'deny', code: 'kill_switch_engaged' },
    { scenario: 'source_stale', patch: { source_age_minutes: policy.limits.max_source_age_minutes + 1 }, expected: 'deny', code: 'source_snapshot_stale' },
    { scenario: 'incident_open', patch: { open_incident_count: 1 }, expected: 'deny', code: 'open_incident' },
    { scenario: 'hourly_exhausted', patch: { executions_last_hour: policy.limits.max_executions_per_hour }, expected: 'deny', code: 'hourly_limit_exhausted' },
    { scenario: 'daily_exhausted', patch: { executions_last_day: policy.limits.max_executions_per_day }, expected: 'deny', code: 'daily_limit_exhausted' },
    { scenario: 'cooldown_active', patch: { cooldown_elapsed_seconds: policy.limits.cooldown_seconds - 1 }, expected: 'deny', code: 'cooldown_active' },
    { scenario: 'action_cost_exceeded', patch: { candidate_cost_minor: policy.limits.max_cost_minor_per_action + 1 }, expected: 'deny', code: 'action_cost_exceeds_limit' },
    { scenario: 'daily_cost_exceeded', patch: { cost_last_day: policy.limits.max_cost_minor_per_day + 1, candidate_cost_minor: 0 }, expected: 'deny', code: 'daily_cost_exceeds_limit' },
    { scenario: 'dry_run_mutated', patch: { preview_mutation_count: 1 }, expected: 'deny', code: 'dry_run_mutated' },
  ];
  const outcomes = cases.map((item): G7SimulationOutcome => {
    const actual = evaluateAutonomyEnvelope(policy, { ...baseline, ...item.patch });
    return {
      scenario: item.scenario,
      expected: item.expected,
      expected_code: item.code,
      decision: actual.decision,
      code: actual.code,
      passed: actual.decision === item.expected && actual.code === item.code,
    };
  });
  const core = {
    scenario_set_version: G7_SCENARIO_SET_VERSION,
    policy_fingerprint: autonomyFingerprint(policy),
    g6_policy_fingerprint: autonomyFingerprint(g6),
    simulated_at: simulatedAt,
    outcomes,
    passed: outcomes.every((item) => item.passed),
  };
  return { ...core, simulation_fingerprint: autonomyFingerprint(core) };
}
