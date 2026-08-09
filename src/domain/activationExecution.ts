import { timingSafeEqual } from 'node:crypto';
import { canonicalStringify } from './businessMemory';
import { evidenceFingerprint } from './phase2Proof';
import { credentialFingerprint } from './g6Policy';
import type { ActivationExecutionPolicyManifest } from './activationExecutionPolicy';

export const PHASE8_TABLES = {
  policies: 'activation_execution_policies',
  killSwitchEvents: 'activation_execution_kill_switch_events',
  releases: 'activation_execution_releases',
  previews: 'activation_execution_previews',
  claims: 'activation_execution_claims',
  outcomes: 'activation_execution_outcomes',
  observations: 'activation_execution_observations',
  rollbacks: 'activation_execution_rollbacks',
  incidents: 'activation_execution_incidents',
  events: 'activation_execution_events',
} as const;

export const PHASE8_PREVIEW_SCHEMA = 'leozops_phase8_activation_preview_v1' as const;
export const PHASE8_RESULT_SCHEMA = 'leozops_phase8_activation_result_v1' as const;
export const PHASE8_OBSERVATION_SCHEMA = 'leozops_phase8_activation_observation_v1' as const;
export const PHASE8_ROLLBACK_SCHEMA = 'leozops_phase8_activation_rollback_v1' as const;

export type ActivationOutcomeStatus = 'succeeded' | 'failed' | 'unknown';
export type ActivationObservationVerdict = 'healthy' | 'unhealthy' | 'unknown';
export type ActivationKillSwitchState = 'engaged' | 'released';
export type ActivationExecutionEventType =
  | 'policy_accepted'
  | 'preview_recorded'
  | 'activation_released'
  | 'activation_claimed'
  | 'activation_succeeded'
  | 'activation_failed'
  | 'activation_unknown'
  | 'observation_healthy'
  | 'observation_unhealthy'
  | 'observation_unknown'
  | 'rollback_succeeded'
  | 'rollback_failed'
  | 'rollback_unknown'
  | 'incident_opened';

export interface ActivationAdapterDescriptor {
  environment: 'test' | 'production';
  adapter_id: string;
  adapter_version: string;
  target_fingerprint: string;
  adapter_artifact_digest: string;
  configuration_digest: string;
  credential_reference_sha256: string;
  supports_idempotency: true;
  supports_observation: true;
  supports_rollback: true;
}

export interface ActivationAdapterPreview {
  schema_version: typeof PHASE8_PREVIEW_SCHEMA;
  policy_id: string;
  handoff_fingerprint: string;
  target_fingerprint: string;
  mutation_count: 0;
  readiness_fingerprint: string;
  summary_code: string;
  generated_at: string;
  expires_at: string;
}

export interface ActivationAdapterResult {
  schema_version: typeof PHASE8_RESULT_SCHEMA;
  policy_id: string;
  handoff_fingerprint: string;
  target_fingerprint: string;
  activation_idempotency_key: string;
  outcome: ActivationOutcomeStatus;
  mutation_count: 0 | 1 | null;
  provider_receipt_fingerprint: string | null;
  external_state_fingerprint: string | null;
  result_code: string;
  completed_at: string;
}

export interface ActivationAdapterObservation {
  schema_version: typeof PHASE8_OBSERVATION_SCHEMA;
  policy_id: string;
  target_fingerprint: string;
  provider_receipt_fingerprint: string;
  verdict: ActivationObservationVerdict;
  metric_fingerprint: string | null;
  external_state_fingerprint: string | null;
  result_code: string;
  observed_at: string;
}

export interface ActivationAdapterRollback {
  schema_version: typeof PHASE8_ROLLBACK_SCHEMA;
  policy_id: string;
  target_fingerprint: string;
  activation_receipt_fingerprint: string;
  rollback_idempotency_key: string;
  outcome: ActivationOutcomeStatus;
  mutation_count: 0 | 1 | null;
  rollback_receipt_fingerprint: string | null;
  restored_state_fingerprint: string | null;
  result_code: string;
  completed_at: string;
}

export interface ActivationExecutionAdapter {
  readonly descriptor: ActivationAdapterDescriptor;
  preview(input: {
    policy: ActivationExecutionPolicyManifest;
    previewKey: string;
    requestedAt: string;
  }): Promise<ActivationAdapterPreview>;
  activate(input: {
    policy: ActivationExecutionPolicyManifest;
    preview: ActivationAdapterPreview;
    activationIdempotencyKey: string;
    requestedAt: string;
  }): Promise<ActivationAdapterResult>;
  observe(input: {
    policy: ActivationExecutionPolicyManifest;
    activation: ActivationAdapterResult;
    observationKey: string;
    requestedAt: string;
  }): Promise<ActivationAdapterObservation>;
  rollback(input: {
    policy: ActivationExecutionPolicyManifest;
    activation: ActivationAdapterResult;
    rollbackKey: string;
    requestedAt: string;
  }): Promise<ActivationAdapterRollback>;
}

export interface ActivationExecutionPolicyRecord {
  id: string;
  tenant_id: string;
  source_connection_id: string;
  phase7_policy_record_id: string;
  phase7_handoff_id: string;
  policy_id: string;
  environment: 'test' | 'production';
  phase7_policy_fingerprint: string;
  phase7_handoff_fingerprint: string;
  target_fingerprint: string;
  adapter_id: string;
  adapter_version: string;
  valid_from: string;
  valid_until: string;
  policy_fingerprint: string;
  manifest_json: string;
  accepted_at: string;
  created_at: string;
}

export interface ActivationKillSwitchEventRecord {
  id: string;
  tenant_id: string;
  policy_record_id: string;
  sequence: number;
  state: ActivationKillSwitchState;
  actor: string;
  reason_code: string;
  evidence_fingerprint: string;
  occurred_at: string;
  event_fingerprint: string;
  created_at: string;
}

export interface ActivationReleaseRecord {
  id: string;
  tenant_id: string;
  policy_record_id: string;
  preview_id: string;
  release_key: string;
  preview_fingerprint: string;
  released_by: string;
  observed_by: string;
  reason_code: string;
  released_at: string;
  expires_at: string;
  release_fingerprint: string;
  created_at: string;
}

export interface ActivationPreviewRecord {
  id: string;
  tenant_id: string;
  policy_record_id: string;
  preview_key: string;
  adapter_id: string;
  adapter_version: string;
  preview_json: string;
  preview_fingerprint: string;
  requested_by: string;
  recorded_at: string;
  created_at: string;
}

export interface ActivationClaimRecord {
  id: string;
  tenant_id: string;
  policy_record_id: string;
  release_id: string;
  preview_id: string;
  activation_key: string;
  release_fingerprint: string;
  preview_fingerprint: string;
  claimed_by: string;
  claimed_at: string;
  lease_expires_at: string;
  claim_fingerprint: string;
  created_at: string;
}

export interface ActivationOutcomeRecord {
  id: string;
  tenant_id: string;
  policy_record_id: string;
  claim_id: string;
  outcome: ActivationOutcomeStatus;
  result_json: string;
  result_fingerprint: string;
  recorded_at: string;
  outcome_fingerprint: string;
  created_at: string;
}

export interface ActivationObservationRecord {
  id: string;
  tenant_id: string;
  policy_record_id: string;
  outcome_id: string;
  observation_key: string;
  verdict: ActivationObservationVerdict;
  observation_json: string;
  observation_fingerprint: string;
  observed_by: string;
  recorded_at: string;
  record_fingerprint: string;
  created_at: string;
}

export interface ActivationRollbackRecord {
  id: string;
  tenant_id: string;
  policy_record_id: string;
  outcome_id: string;
  rollback_key: string;
  outcome: ActivationOutcomeStatus;
  rollback_json: string;
  rollback_fingerprint: string;
  authorized_by: string;
  operated_by: string;
  reason_code: string;
  recorded_at: string;
  record_fingerprint: string;
  created_at: string;
}

export interface ActivationIncidentRecord {
  id: string;
  tenant_id: string;
  policy_record_id: string;
  incident_key: string;
  reason_code: string;
  evidence_fingerprint: string;
  opened_by: string;
  opened_at: string;
  incident_fingerprint: string;
  created_at: string;
}

export interface ActivationExecutionEventRecord {
  id: string;
  tenant_id: string;
  policy_record_id: string;
  sequence: number;
  event_type: ActivationExecutionEventType;
  actor: string;
  reason_code: string;
  evidence_fingerprint: string;
  occurred_at: string;
  event_fingerprint: string;
  created_at: string;
}

export class ActivationExecutionError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 409) {
    super(message);
    this.name = 'ActivationExecutionError';
  }
}

export function activationExecutionFingerprint(value: unknown): string {
  return evidenceFingerprint(value);
}

export function activationExecutionCredentialMatches(secret: string, expected: string): boolean {
  let actual: string;
  try {
    actual = credentialFingerprint(secret);
  } catch {
    return false;
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(expected) || expected.length !== actual.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export function activationExecutionPolicyIsActive(policy: ActivationExecutionPolicyManifest, at: string): boolean {
  const instant = Date.parse(at);
  return Number.isFinite(instant) && instant >= Date.parse(policy.valid_from) && instant < Date.parse(policy.valid_until);
}

const HASH = /^sha256:[0-9a-f]{64}$/;
const CODE = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:/=-]{15,191}$/;

function exactKeys(value: unknown, keys: readonly string[], code: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ActivationExecutionError(code, 'adapter evidence must be an object');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join('\0') !== [...keys].sort().join('\0')) throw new ActivationExecutionError(code, 'adapter evidence keys are invalid');
  return record;
}

function string(value: unknown, pattern: RegExp, code: string, name: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) throw new ActivationExecutionError(code, `${name} is invalid`);
  return value;
}

function iso(value: unknown, code: string, name: string): string {
  const result = string(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/, code, name);
  if (Number.isNaN(Date.parse(result))) throw new ActivationExecutionError(code, `${name} is invalid`);
  return new Date(result).toISOString();
}

function hashOrNull(value: unknown, code: string, name: string): string | null {
  return value === null ? null : string(value, HASH, code, name);
}

export function validateActivationAdapterDescriptor(
  value: ActivationAdapterDescriptor,
  policy: ActivationExecutionPolicyManifest,
): ActivationAdapterDescriptor {
  const root = exactKeys(value, [
    'environment', 'adapter_id', 'adapter_version', 'target_fingerprint', 'adapter_artifact_digest',
    'configuration_digest', 'credential_reference_sha256', 'supports_idempotency',
    'supports_observation', 'supports_rollback',
  ], 'invalid_activation_adapter');
  if (
    root.environment !== policy.environment
    || root.adapter_id !== policy.target.adapter_id
    || root.adapter_version !== policy.target.adapter_version
    || root.target_fingerprint !== policy.target.target_fingerprint
    || root.adapter_artifact_digest !== policy.target.adapter_artifact_digest
    || root.configuration_digest !== policy.target.configuration_digest
    || root.credential_reference_sha256 !== policy.target.credential_reference_sha256
    || root.supports_idempotency !== true
    || root.supports_observation !== true
    || root.supports_rollback !== true
  ) throw new ActivationExecutionError('activation_adapter_binding_mismatch', 'adapter descriptor does not match the exact policy');
  return value;
}

export function validateActivationAdapterPreview(
  value: unknown,
  policy: ActivationExecutionPolicyManifest,
  at: string,
): ActivationAdapterPreview {
  const code = 'invalid_activation_preview';
  const root = exactKeys(value, [
    'schema_version', 'policy_id', 'handoff_fingerprint', 'target_fingerprint', 'mutation_count',
    'readiness_fingerprint', 'summary_code', 'generated_at', 'expires_at',
  ], code);
  const preview: ActivationAdapterPreview = {
    schema_version: PHASE8_PREVIEW_SCHEMA,
    policy_id: string(root.policy_id, /^P8-[A-Za-z0-9._-]{4,64}$/, code, 'policy_id'),
    handoff_fingerprint: string(root.handoff_fingerprint, HASH, code, 'handoff_fingerprint'),
    target_fingerprint: string(root.target_fingerprint, HASH, code, 'target_fingerprint'),
    mutation_count: 0,
    readiness_fingerprint: string(root.readiness_fingerprint, HASH, code, 'readiness_fingerprint'),
    summary_code: string(root.summary_code, CODE, code, 'summary_code'),
    generated_at: iso(root.generated_at, code, 'generated_at'),
    expires_at: iso(root.expires_at, code, 'expires_at'),
  };
  if (root.schema_version !== PHASE8_PREVIEW_SCHEMA || root.mutation_count !== 0) throw new ActivationExecutionError(code, 'preview schema or mutation count is invalid');
  if (preview.policy_id !== policy.policy_id || preview.handoff_fingerprint !== policy.phase7.handoff_fingerprint || preview.target_fingerprint !== policy.target.target_fingerprint) throw new ActivationExecutionError(code, 'preview binding is invalid');
  if (
    Date.parse(preview.generated_at) > Date.parse(at)
    || Date.parse(preview.expires_at) <= Date.parse(at)
    || Date.parse(preview.expires_at) - Date.parse(preview.generated_at) > 30 * 60_000
  ) throw new ActivationExecutionError(code, 'preview time bounds are invalid');
  return preview;
}

export function validateActivationAdapterResult(value: unknown, policy: ActivationExecutionPolicyManifest): ActivationAdapterResult {
  const code = 'invalid_activation_result';
  const root = exactKeys(value, [
    'schema_version', 'policy_id', 'handoff_fingerprint', 'target_fingerprint',
    'activation_idempotency_key', 'outcome', 'mutation_count', 'provider_receipt_fingerprint',
    'external_state_fingerprint', 'result_code', 'completed_at',
  ], code);
  if (root.schema_version !== PHASE8_RESULT_SCHEMA || !['succeeded', 'failed', 'unknown'].includes(String(root.outcome))) throw new ActivationExecutionError(code, 'activation result schema or outcome is invalid');
  const result: ActivationAdapterResult = {
    schema_version: PHASE8_RESULT_SCHEMA,
    policy_id: string(root.policy_id, /^P8-[A-Za-z0-9._-]{4,64}$/, code, 'policy_id'),
    handoff_fingerprint: string(root.handoff_fingerprint, HASH, code, 'handoff_fingerprint'),
    target_fingerprint: string(root.target_fingerprint, HASH, code, 'target_fingerprint'),
    activation_idempotency_key: string(root.activation_idempotency_key, KEY, code, 'activation_idempotency_key'),
    outcome: root.outcome as ActivationOutcomeStatus,
    mutation_count: root.mutation_count as 0 | 1 | null,
    provider_receipt_fingerprint: hashOrNull(root.provider_receipt_fingerprint, code, 'provider_receipt_fingerprint'),
    external_state_fingerprint: hashOrNull(root.external_state_fingerprint, code, 'external_state_fingerprint'),
    result_code: string(root.result_code, CODE, code, 'result_code'),
    completed_at: iso(root.completed_at, code, 'completed_at'),
  };
  if (result.policy_id !== policy.policy_id || result.handoff_fingerprint !== policy.phase7.handoff_fingerprint || result.target_fingerprint !== policy.target.target_fingerprint) throw new ActivationExecutionError(code, 'activation result binding is invalid');
  if (result.outcome === 'succeeded' && (result.mutation_count !== 1 || !result.provider_receipt_fingerprint || !result.external_state_fingerprint)) throw new ActivationExecutionError(code, 'successful activation result is incomplete');
  if (result.outcome === 'failed' && result.mutation_count !== 0) throw new ActivationExecutionError(code, 'failed activation must report zero mutations');
  if (result.outcome === 'unknown' && result.mutation_count !== null) throw new ActivationExecutionError(code, 'unknown activation must report unknown mutation count');
  return result;
}

export function validateActivationAdapterObservation(
  value: unknown,
  policy: ActivationExecutionPolicyManifest,
  activation: ActivationAdapterResult,
): ActivationAdapterObservation {
  const code = 'invalid_activation_observation';
  const root = exactKeys(value, [
    'schema_version', 'policy_id', 'target_fingerprint', 'provider_receipt_fingerprint', 'verdict',
    'metric_fingerprint', 'external_state_fingerprint', 'result_code', 'observed_at',
  ], code);
  if (root.schema_version !== PHASE8_OBSERVATION_SCHEMA || !['healthy', 'unhealthy', 'unknown'].includes(String(root.verdict))) throw new ActivationExecutionError(code, 'observation schema or verdict is invalid');
  const observation: ActivationAdapterObservation = {
    schema_version: PHASE8_OBSERVATION_SCHEMA,
    policy_id: string(root.policy_id, /^P8-[A-Za-z0-9._-]{4,64}$/, code, 'policy_id'),
    target_fingerprint: string(root.target_fingerprint, HASH, code, 'target_fingerprint'),
    provider_receipt_fingerprint: string(root.provider_receipt_fingerprint, HASH, code, 'provider_receipt_fingerprint'),
    verdict: root.verdict as ActivationObservationVerdict,
    metric_fingerprint: hashOrNull(root.metric_fingerprint, code, 'metric_fingerprint'),
    external_state_fingerprint: hashOrNull(root.external_state_fingerprint, code, 'external_state_fingerprint'),
    result_code: string(root.result_code, CODE, code, 'result_code'),
    observed_at: iso(root.observed_at, code, 'observed_at'),
  };
  if (observation.policy_id !== policy.policy_id || observation.target_fingerprint !== policy.target.target_fingerprint || observation.provider_receipt_fingerprint !== activation.provider_receipt_fingerprint) throw new ActivationExecutionError(code, 'observation binding is invalid');
  if (observation.verdict === 'healthy' && (observation.metric_fingerprint !== policy.canary.success_metric_fingerprint || !observation.external_state_fingerprint)) throw new ActivationExecutionError(code, 'healthy observation evidence is invalid');
  if (observation.verdict === 'unhealthy' && observation.metric_fingerprint !== policy.canary.abort_metric_fingerprint) throw new ActivationExecutionError(code, 'unhealthy observation metric is invalid');
  if (observation.verdict === 'unknown' && observation.metric_fingerprint !== null) throw new ActivationExecutionError(code, 'unknown observation cannot claim a metric');
  return observation;
}

export function validateActivationAdapterRollback(
  value: unknown,
  policy: ActivationExecutionPolicyManifest,
  activation: ActivationAdapterResult,
): ActivationAdapterRollback {
  const code = 'invalid_activation_rollback';
  const root = exactKeys(value, [
    'schema_version', 'policy_id', 'target_fingerprint', 'activation_receipt_fingerprint',
    'rollback_idempotency_key', 'outcome', 'mutation_count', 'rollback_receipt_fingerprint',
    'restored_state_fingerprint', 'result_code', 'completed_at',
  ], code);
  if (root.schema_version !== PHASE8_ROLLBACK_SCHEMA || !['succeeded', 'failed', 'unknown'].includes(String(root.outcome))) throw new ActivationExecutionError(code, 'rollback schema or outcome is invalid');
  const rollback: ActivationAdapterRollback = {
    schema_version: PHASE8_ROLLBACK_SCHEMA,
    policy_id: string(root.policy_id, /^P8-[A-Za-z0-9._-]{4,64}$/, code, 'policy_id'),
    target_fingerprint: string(root.target_fingerprint, HASH, code, 'target_fingerprint'),
    activation_receipt_fingerprint: string(root.activation_receipt_fingerprint, HASH, code, 'activation_receipt_fingerprint'),
    rollback_idempotency_key: string(root.rollback_idempotency_key, KEY, code, 'rollback_idempotency_key'),
    outcome: root.outcome as ActivationOutcomeStatus,
    mutation_count: root.mutation_count as 0 | 1 | null,
    rollback_receipt_fingerprint: hashOrNull(root.rollback_receipt_fingerprint, code, 'rollback_receipt_fingerprint'),
    restored_state_fingerprint: hashOrNull(root.restored_state_fingerprint, code, 'restored_state_fingerprint'),
    result_code: string(root.result_code, CODE, code, 'result_code'),
    completed_at: iso(root.completed_at, code, 'completed_at'),
  };
  if (rollback.policy_id !== policy.policy_id || rollback.target_fingerprint !== policy.target.target_fingerprint || rollback.activation_receipt_fingerprint !== activation.provider_receipt_fingerprint) throw new ActivationExecutionError(code, 'rollback binding is invalid');
  if (rollback.outcome === 'succeeded' && (rollback.mutation_count !== 1 || !rollback.rollback_receipt_fingerprint || !rollback.restored_state_fingerprint)) throw new ActivationExecutionError(code, 'successful rollback evidence is incomplete');
  if (rollback.outcome === 'failed' && rollback.mutation_count !== 0) throw new ActivationExecutionError(code, 'failed rollback must report zero mutations');
  if (rollback.outcome === 'unknown' && rollback.mutation_count !== null) throw new ActivationExecutionError(code, 'unknown rollback must report unknown mutation count');
  return rollback;
}

export function canonicalActivationEvidence(value: unknown): string {
  return canonicalStringify(value);
}
