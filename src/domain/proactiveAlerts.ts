import { createHash } from 'node:crypto';
import { canonicalStringify } from './businessMemory';

export const PROACTIVE_TABLES = Object.freeze({
  cycles: 'proactive_cycles',
  evaluations: 'proactive_rule_evaluations',
  alerts: 'proactive_alerts',
  alertEvents: 'proactive_alert_events',
  outbox: 'proactive_delivery_outbox',
  deliveryAttempts: 'proactive_delivery_attempts',
  deliveryResults: 'proactive_delivery_results',
});

export const PROACTIVE_POLICY = Object.freeze({
  version: 'proactive_alert_policy_v1',
  freshnessTargetSeconds: 1_800,
  cooldownSeconds: 14_400,
  maxSnoozeSeconds: 604_800,
  quietHoursUtc: Object.freeze({ startHour: 22, endHour: 7 }),
  shadow: Object.freeze({ minReviewedAlerts: 20, maxFalsePositiveRate: 0.1, maxAlertsPerDay: 3 }),
  rules: Object.freeze({
    overdue_expected_close: Object.freeze({ threshold: 1, urgentThreshold: 3 }),
    active_owner_gap: Object.freeze({ threshold: 1, urgentThreshold: 3 }),
  }),
});

export type ProactiveRuleId = keyof typeof PROACTIVE_POLICY.rules;
export type ProactiveSeverity = 'warning' | 'urgent';
export type ProactiveCycleMode = 'evaluate' | 'daily_brief';
export type ProactiveFreshnessStatus = 'fresh' | 'stale' | 'future_source_timestamp';
export type ProactiveEvidenceQuality = 'complete' | 'partial';
export type ProactiveEvaluationStatus =
  | 'triggered'
  | 'no_change'
  | 'resolved'
  | 'suppressed_stale'
  | 'suppressed_partial'
  | 'suppressed_cooldown'
  | 'suppressed_snooze';
export type ProactiveAlertEventType =
  | 'acknowledged'
  | 'snoozed'
  | 'resolved'
  | 'rated_useful'
  | 'rated_false_positive';
export type ProactiveAlertOutcome = 'useful' | 'false_positive';
export type ProactiveAlertState = 'open' | 'acknowledged' | 'snoozed' | 'resolved';
export type ProactiveDeliveryKind = 'daily_brief' | 'urgent_alert';
export type ProactiveDeliveryResultStatus = 'delivered' | 'failed' | 'unknown';

export class ProactiveAlertError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: 400 | 403 | 404 | 409 | 503 = 409,
  ) {
    super(message);
    this.name = 'ProactiveAlertError';
  }
}

export function proactiveHash(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalStringify(value)).digest('hex')}`;
}

export interface ProactiveCycleRecord {
  id: string;
  tenant_id: string;
  source_snapshot_id: string;
  intelligence_run_id: string;
  policy_version: string;
  mode: ProactiveCycleMode;
  idempotency_key: string;
  request_hash: string;
  freshness_status: ProactiveFreshnessStatus;
  evidence_quality: ProactiveEvidenceQuality;
  evaluated_at: string;
  source_generated_at: string;
  source_received_at: string;
  evidence_hash: string;
  created_at: string;
}

export interface ProactiveRuleEvaluationRecord {
  id: string;
  tenant_id: string;
  cycle_id: string;
  rule_id: ProactiveRuleId;
  status: ProactiveEvaluationStatus;
  severity: ProactiveSeverity | null;
  metric_value: number;
  previous_value: number | null;
  threshold_value: number;
  evidence_json: string;
  evidence_hash: string;
  created_at: string;
}

export interface ProactiveAlertRecord {
  id: string;
  tenant_id: string;
  cycle_id: string;
  rule_id: ProactiveRuleId;
  alert_key: string;
  episode_key: string;
  severity: ProactiveSeverity;
  confidence: 'confirmed';
  title: string;
  rationale: string;
  recommendation: string;
  source_snapshot_id: string;
  intelligence_run_id: string;
  evidence_json: string;
  evidence_hash: string;
  created_at: string;
}

export interface ProactiveAlertEventRecord {
  id: string;
  tenant_id: string;
  alert_id: string;
  event_type: ProactiveAlertEventType;
  event_key: string;
  actor: string;
  reason_code: string;
  snoozed_until: string | null;
  evidence_hash: string;
  created_at: string;
}

export interface ProactiveOutboxRecord {
  id: string;
  tenant_id: string;
  cycle_id: string;
  alert_id: string | null;
  delivery_kind: ProactiveDeliveryKind;
  logical_key: string;
  available_at: string;
  payload_json: string;
  evidence_hash: string;
  created_at: string;
}

export interface ProactiveDeliveryAttemptRecord {
  id: string;
  tenant_id: string;
  outbox_id: string;
  attempt_key: string;
  adapter_key: string;
  adapter_version: string;
  started_at: string;
  created_at: string;
}

export interface ProactiveDeliveryResultRecord {
  id: string;
  tenant_id: string;
  attempt_id: string;
  status: ProactiveDeliveryResultStatus;
  receipt_id: string | null;
  failure_code: string | null;
  completed_at: string;
  evidence_hash: string;
  created_at: string;
}

export interface ProactiveAlertView {
  alert: ProactiveAlertRecord;
  state: ProactiveAlertState;
  snoozed_until: string | null;
  latest_event: ProactiveAlertEventRecord | null;
  outcome: ProactiveAlertOutcome | null;
}

export interface ProactiveShadowBaseline {
  policy_version: typeof PROACTIVE_POLICY.version;
  from: string;
  to: string;
  days: number;
  alert_count: number;
  alerts_per_day: number;
  reviewed_alert_count: number;
  false_positive_count: number;
  false_positive_rate: number | null;
  delivered_count: number;
  failed_delivery_count: number;
  unknown_delivery_count: number;
  status: 'insufficient_sample' | 'candidate_pass' | 'rejected';
  reasons: string[];
}

export function evaluateProactiveShadow(input: Omit<
  ProactiveShadowBaseline,
  'policy_version' | 'status' | 'reasons'
>): ProactiveShadowBaseline {
  const falsePositiveRate = input.reviewed_alert_count === 0
    ? null
    : input.false_positive_count / input.reviewed_alert_count;
  const reasons: string[] = [];
  if (input.reviewed_alert_count < PROACTIVE_POLICY.shadow.minReviewedAlerts) reasons.push('minimum_reviewed_sample_not_met');
  if (falsePositiveRate !== null && falsePositiveRate > PROACTIVE_POLICY.shadow.maxFalsePositiveRate) reasons.push('false_positive_rate_above_limit');
  if (input.alerts_per_day > PROACTIVE_POLICY.shadow.maxAlertsPerDay) reasons.push('alert_volume_above_limit');
  if (input.unknown_delivery_count > 0) reasons.push('unknown_delivery_outcome_present');
  const status = input.reviewed_alert_count < PROACTIVE_POLICY.shadow.minReviewedAlerts
    ? 'insufficient_sample'
    : reasons.length ? 'rejected' : 'candidate_pass';
  return {
    ...input,
    false_positive_rate: falsePositiveRate,
    policy_version: PROACTIVE_POLICY.version,
    status,
    reasons,
  };
}

export interface ProactiveDeliveryView {
  outbox: ProactiveOutboxRecord;
  status: 'queued' | 'delivered' | 'failed' | 'unknown';
  latest_attempt: ProactiveDeliveryAttemptRecord | null;
  latest_result: ProactiveDeliveryResultRecord | null;
}
