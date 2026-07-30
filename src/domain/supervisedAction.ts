import { timingSafeEqual } from 'node:crypto';
import { evidenceFingerprint } from './phase2Proof';
import { credentialFingerprint, G6ActionPolicyManifest } from './g6Policy';

export const G6_TABLES = {
  policies: 'supervised_action_policies',
  proposals: 'supervised_action_proposals',
  previews: 'supervised_action_previews',
  approvals: 'supervised_action_approvals',
  attempts: 'supervised_action_attempts',
  events: 'supervised_action_events',
} as const;

export type ActionPreviewKind = 'execute' | 'rollback';
export type ActionApprovalDecision = 'approved' | 'rejected';
export type ActionAttemptStatus = 'in_progress' | 'succeeded' | 'failed' | 'reconciliation_required';
export type ActionEventType =
  | 'proposed'
  | 'execute_previewed'
  | 'execute_approved'
  | 'execute_rejected'
  | 'execution_started'
  | 'execution_succeeded'
  | 'execution_failed'
  | 'rollback_previewed'
  | 'rollback_approved'
  | 'rollback_rejected'
  | 'rollback_started'
  | 'rollback_succeeded'
  | 'rollback_failed';

export interface SupervisedActionPolicyRecord {
  id: string;
  tenant_id: string;
  source_connection_id: string;
  g5_release_decision_id: string;
  policy_id: string;
  environment: 'test' | 'production';
  command_key: string;
  command_version: string;
  adapter_id: string;
  risk_tier: 'low' | 'medium';
  target_project_id: string;
  target_tenant_key: string;
  target_endpoint_url: string;
  target_credential_sha256: string;
  valid_from: string;
  valid_until: string;
  policy_fingerprint: string;
  manifest_json: string;
  created_at: string;
}

export interface SupervisedActionProposal {
  id: string;
  tenant_id: string;
  source_connection_id: string;
  policy_record_id: string;
  g5_release_decision_id: string;
  policy_id: string;
  policy_fingerprint: string;
  command_key: string;
  command_version: string;
  adapter_id: string;
  payload_json: string;
  payload_fingerprint: string;
  reason_code: string;
  expected_impact_code: string;
  evidence_refs_json: string;
  estimated_cost_minor: number;
  currency: string;
  idempotency_key: string;
  requested_by: string;
  requested_at: string;
  expires_at: string;
  proposal_fingerprint: string;
  created_at: string;
}

export interface SupervisedActionPreview {
  id: string;
  tenant_id: string;
  proposal_id: string;
  kind: ActionPreviewKind;
  subject_execution_id: string | null;
  policy_fingerprint: string;
  proposal_fingerprint: string;
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
  previewed_at: string;
  expires_at: string;
  preview_fingerprint: string;
  created_at: string;
}

export interface SupervisedActionApproval {
  id: string;
  tenant_id: string;
  proposal_id: string;
  preview_id: string;
  kind: ActionPreviewKind;
  decision: ActionApprovalDecision;
  policy_fingerprint: string;
  proposal_fingerprint: string;
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

export interface SupervisedActionAttempt {
  id: string;
  tenant_id: string;
  proposal_id: string;
  preview_id: string;
  approval_id: string;
  kind: ActionPreviewKind;
  subject_execution_id: string | null;
  idempotency_key: string;
  request_fingerprint: string;
  status: ActionAttemptStatus;
  operator: string;
  reserved_cost_minor: number;
  started_at: string;
  lease_expires_at: string;
  finished_at: string | null;
  external_request_id: string | null;
  result_fingerprint: string | null;
  result_code: string | null;
  actual_cost_minor: number | null;
  currency: string;
  external_mutation_count: number | null;
  latency_ms: number | null;
  created_at: string;
}

export interface SupervisedActionEvent {
  id: string;
  tenant_id: string;
  proposal_id: string;
  sequence: number;
  event_type: ActionEventType;
  actor: string;
  evidence_fingerprint: string;
  reason_code: string;
  event_key: string;
  occurred_at: string;
  created_at: string;
}

export interface ActionPreviewEvidence {
  summary_code: string;
  request_fingerprint: string;
  target_fingerprint: string;
  effect_fingerprint: string;
  rollback_strategy_code: string;
  estimated_cost_minor: number;
  currency: string;
  external_mutation_count: 0;
}

export interface ActionExecutionEvidence {
  outcome: 'succeeded' | 'failed';
  external_request_id: string;
  result_fingerprint: string;
  result_code: string;
  actual_cost_minor: number;
  currency: string;
  external_mutation_count: 0 | 1;
}

export interface SupervisedActionAdapter {
  readonly descriptor: {
    adapter_id: string;
    adapter_version: string;
    command_key: string;
    command_version: string;
    environment: 'test' | 'production';
    target_endpoint_url: string;
    supports_dry_run: true;
    supports_idempotency: true;
    supports_rollback: true;
  };
  validatePayload(payload: unknown): void;
  preview(input: {
    payload: unknown;
    targetProjectId: string;
    targetTenantKey: string;
    targetEndpointUrl: string;
    targetCredentialFingerprint: string;
    idempotencyKey: string;
  }): Promise<ActionPreviewEvidence>;
  execute(input: {
    payload: unknown;
    targetProjectId: string;
    targetTenantKey: string;
    targetEndpointUrl: string;
    targetCredentialFingerprint: string;
    idempotencyKey: string;
    preview: SupervisedActionPreview;
  }): Promise<ActionExecutionEvidence>;
  previewRollback(input: {
    proposal: SupervisedActionProposal;
    execution: SupervisedActionAttempt;
    targetProjectId: string;
    targetTenantKey: string;
    targetEndpointUrl: string;
    targetCredentialFingerprint: string;
    idempotencyKey: string;
  }): Promise<ActionPreviewEvidence>;
  rollback(input: {
    proposal: SupervisedActionProposal;
    execution: SupervisedActionAttempt;
    targetProjectId: string;
    targetTenantKey: string;
    targetEndpointUrl: string;
    targetCredentialFingerprint: string;
    idempotencyKey: string;
    preview: SupervisedActionPreview;
  }): Promise<ActionExecutionEvidence>;
}

export class SupervisedActionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'SupervisedActionError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^sha256:[0-9a-f]{64}$/;
const SAFE_CODE = /^[a-z0-9][a-z0-9._:-]{1,127}$/;
const SAFE_IDEMPOTENCY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,191}$/;

export function actionIso(value: unknown, code = 'invalid_timestamp'): string {
  const millis = value instanceof Date ? value.getTime() : Date.parse(String(value));
  if (!Number.isFinite(millis)) throw new SupervisedActionError(code, 'timestamp is invalid');
  return new Date(millis).toISOString();
}

export function actionUuid(value: unknown, code: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new SupervisedActionError(code, 'identifier must be a UUID');
  }
  return value;
}

export function actionHash(value: unknown, code: string): string {
  if (typeof value !== 'string' || !HASH.test(value)) {
    throw new SupervisedActionError(code, 'fingerprint must be a sha256 value');
  }
  return value;
}

export function actionCode(value: unknown, code: string): string {
  if (typeof value !== 'string' || !SAFE_CODE.test(value)) {
    throw new SupervisedActionError(code, 'value must be a safe code');
  }
  return value;
}

export function actionActor(value: unknown, code: string): string {
  if (
    typeof value !== 'string'
    || value.length < 2
    || value.length > 128
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
  ) throw new SupervisedActionError(code, 'actor identity is invalid');
  return value;
}

export function actionMoney(value: unknown, code: string, max = 1_000_000): number {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > max) {
    throw new SupervisedActionError(code, 'cost must be a bounded non-negative integer');
  }
  return Number(value);
}

export function actionCurrency(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) {
    throw new SupervisedActionError('invalid_currency', 'currency must be an ISO-style three-letter code');
  }
  return value;
}

export function actionIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !SAFE_IDEMPOTENCY.test(value)) {
    throw new SupervisedActionError(
      'invalid_idempotency_key',
      'idempotency key must be 16 to 192 safe characters',
    );
  }
  return value;
}

export function actionEvidenceRefs(value: unknown): string {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw new SupervisedActionError('invalid_evidence_refs', 'one to twenty evidence references are required');
  }
  const refs = value.map((item) => actionCode(item, 'invalid_evidence_ref'));
  if (new Set(refs).size !== refs.length) {
    throw new SupervisedActionError('duplicate_evidence_ref', 'evidence references must be unique');
  }
  return JSON.stringify([...refs].sort());
}

export function actionFingerprint(value: unknown): string {
  return evidenceFingerprint(value);
}

export function credentialMatches(secret: string, expectedFingerprint: string): boolean {
  let actual: string;
  try {
    actual = credentialFingerprint(secret);
  } catch {
    return false;
  }
  if (!HASH.test(expectedFingerprint) || actual.length !== expectedFingerprint.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expectedFingerprint));
}

export function policyIsActive(policy: G6ActionPolicyManifest, at: string): boolean {
  const time = Date.parse(actionIso(at));
  return time >= Date.parse(policy.valid_from) && time < Date.parse(policy.valid_until);
}

export function assertAdapterMatchesPolicy(
  adapter: SupervisedActionAdapter,
  policy: G6ActionPolicyManifest,
): void {
  const descriptor = adapter.descriptor;
  if (
    descriptor.adapter_id !== policy.command.adapter_id
    || descriptor.command_key !== policy.command.key
    || descriptor.command_version !== policy.command.version
    || descriptor.environment !== policy.environment
    || descriptor.target_endpoint_url !== policy.target.command_endpoint_url
    || descriptor.supports_dry_run !== true
    || descriptor.supports_idempotency !== true
    || descriptor.supports_rollback !== true
  ) {
    throw new SupervisedActionError(
      'adapter_policy_mismatch',
      'registered adapter does not exactly match the accepted policy',
    );
  }
  actionCode(descriptor.adapter_version, 'invalid_adapter_version');
}

export function validatePreviewEvidence(
  input: ActionPreviewEvidence,
  policy: G6ActionPolicyManifest,
): ActionPreviewEvidence {
  const evidence: ActionPreviewEvidence = {
    summary_code: actionCode(input.summary_code, 'invalid_preview_summary'),
    request_fingerprint: actionHash(input.request_fingerprint, 'invalid_request_fingerprint'),
    target_fingerprint: actionHash(input.target_fingerprint, 'invalid_target_fingerprint'),
    effect_fingerprint: actionHash(input.effect_fingerprint, 'invalid_effect_fingerprint'),
    rollback_strategy_code: actionCode(input.rollback_strategy_code, 'invalid_rollback_strategy'),
    estimated_cost_minor: actionMoney(
      input.estimated_cost_minor,
      'invalid_preview_cost',
      policy.limits.max_cost_minor,
    ),
    currency: actionCurrency(input.currency),
    external_mutation_count: 0,
  };
  if (input.external_mutation_count !== 0) {
    throw new SupervisedActionError('dry_run_mutated', 'dry-run must report zero external mutations');
  }
  if (evidence.currency !== policy.limits.currency) {
    throw new SupervisedActionError('preview_currency_mismatch', 'preview currency does not match policy');
  }
  return evidence;
}

export function validateExecutionEvidence(
  input: ActionExecutionEvidence,
  policy: G6ActionPolicyManifest,
): ActionExecutionEvidence {
  const evidence: ActionExecutionEvidence = {
    outcome: input.outcome === 'succeeded' ? 'succeeded' : 'failed',
    external_request_id: actionCode(input.external_request_id, 'invalid_external_request_id'),
    result_fingerprint: actionHash(input.result_fingerprint, 'invalid_result_fingerprint'),
    result_code: actionCode(input.result_code, 'invalid_result_code'),
    actual_cost_minor: actionMoney(input.actual_cost_minor, 'invalid_actual_cost', policy.limits.max_cost_minor),
    currency: actionCurrency(input.currency),
    external_mutation_count: input.external_mutation_count,
  };
  if (evidence.currency !== policy.limits.currency) {
    throw new SupervisedActionError('execution_currency_mismatch', 'execution currency does not match policy');
  }
  if (
    !Number.isInteger(evidence.external_mutation_count)
    || evidence.external_mutation_count < 0
    || evidence.external_mutation_count > policy.command.mutation_count_max
  ) {
    throw new SupervisedActionError('mutation_limit_exceeded', 'execution mutation count exceeds policy');
  }
  if (evidence.outcome === 'succeeded' && evidence.external_mutation_count !== 1) {
    throw new SupervisedActionError('mutation_evidence_mismatch', 'successful action must report one mutation');
  }
  if (evidence.outcome === 'failed' && evidence.external_mutation_count !== 0) {
    throw new SupervisedActionError(
      'unsafe_failed_execution',
      'failed action reporting a mutation requires manual reconciliation',
    );
  }
  return evidence;
}

export function attemptIsLeaseExpired(attempt: SupervisedActionAttempt, at: string): boolean {
  return attempt.status === 'in_progress' && Date.parse(actionIso(at)) >= Date.parse(attempt.lease_expires_at);
}
