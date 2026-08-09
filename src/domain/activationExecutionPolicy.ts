import type { ActivationCeremonyHandoffRecord } from './activationCeremony';
import type { ActivationCeremonyPolicyManifest } from './activationCeremonyPolicy';
import { credentialFingerprint, type G6ActionPolicyManifest } from './g6Policy';
import type { G7BoundedAutonomyPolicyManifest } from './g7Policy';
import type { OperationalAssurancePolicyManifest } from './operationalAssurancePolicy';
import type { ExternalEvidencePolicyManifest } from './externalEvidencePolicy';
import { evidenceFingerprint } from './phase2Proof';

export const PHASE8_EXECUTION_POLICY_SCHEMA = 'leozops_phase8_activation_execution_policy_v1' as const;

export interface ActivationExecutionPolicyManifest {
  schema_version: typeof PHASE8_EXECUTION_POLICY_SCHEMA;
  policy_id: string;
  status: 'accepted';
  execution_mode: 'controlled_single_activation';
  environment: 'test' | 'production';
  approved_by: string;
  approved_at: string;
  valid_from: string;
  valid_until: string;
  tenant_id: string;
  source_connection_id: string;
  phase7: {
    policy_id: string;
    policy_fingerprint: string;
    handoff_fingerprint: string;
    dossier_fingerprint: string;
    verification_fingerprint: string;
    phase6_evidence_set_fingerprint: string;
  };
  identities: {
    release_authority: string;
    release_credential_sha256: string;
    executor: string;
    executor_credential_sha256: string;
    safety_observer: string;
    observer_credential_sha256: string;
    rollback_operator: string;
    rollback_credential_sha256: string;
  };
  target: {
    deployment_id: string;
    target_fingerprint: string;
    target_contract_fingerprint: string;
    adapter_id: string;
    adapter_version: string;
    adapter_artifact_digest: string;
    configuration_digest: string;
    credential_reference_sha256: string;
  };
  canary: {
    contract_fingerprint: string;
    cohort_size: 1;
    max_activation_mutations: 1;
    observation_minutes: number;
    success_metric_fingerprint: string;
    abort_metric_fingerprint: string;
  };
  rollback: {
    contract_fingerprint: string;
    rollback_artifact_digest: string;
    procedure_digest: string;
    max_recovery_minutes: number;
    max_rollback_mutations: 1;
  };
  limits: {
    release_validity_minutes: number;
    claim_lease_seconds: number;
    observation_deadline_minutes: number;
    rollback_window_minutes: number;
  };
  safety: {
    kill_switch_starts_engaged: true;
    dual_credential_release_required: true;
    source_idempotency_required: true;
    automatic_retry_forbidden: true;
    automatic_rollback_forbidden: true;
    production_adapter_registry_empty_by_default: true;
    waivers_allowed: false;
  };
  verdict: 'accepted';
}

export interface ActivationExecutionPolicyContext {
  phase7: ActivationCeremonyPolicyManifest;
  handoff: ActivationCeremonyHandoffRecord;
  phase6: ExternalEvidencePolicyManifest;
  phase5: OperationalAssurancePolicyManifest;
  g7: G7BoundedAutonomyPolicyManifest;
  g6: G6ActionPolicyManifest;
}

export interface ActivationExecutionPolicyValidation {
  ok: boolean;
  issues: string[];
  value?: ActivationExecutionPolicyManifest;
  fingerprint?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,191}$/;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/;
const ACTOR = /^[^\u0000-\u001f\u007f]{2,128}$/;
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

function safeString(value: unknown, path: string, issues: string[], pattern = SAFE_ID, max = 256): string {
  if (
    typeof value !== 'string'
    || value.length < 2
    || value.length > max
    || value.trim() !== value
    || PLACEHOLDER.test(value)
    || !pattern.test(value)
    || /^https?:\/\//i.test(value)
  ) {
    issues.push(`${path} must be a concrete safe value`);
    return '';
  }
  return value;
}

function timestamp(value: unknown, path: string, issues: string[]): string {
  const result = safeString(value, path, issues, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);
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

export function activationExecutionPolicyFingerprint(policy: ActivationExecutionPolicyManifest): string {
  return evidenceFingerprint(policy);
}

export function activationExecutionCredentialFingerprint(secret: string): string {
  return credentialFingerprint(secret);
}

export function validateActivationExecutionPolicy(
  input: unknown,
  context?: ActivationExecutionPolicyContext,
): ActivationExecutionPolicyValidation {
  const issues: string[] = [];
  const root = objectAt(input, 'policy', issues);
  exactKeys(root, [
    'schema_version', 'policy_id', 'status', 'execution_mode', 'environment', 'approved_by',
    'approved_at', 'valid_from', 'valid_until', 'tenant_id', 'source_connection_id',
    'phase7', 'identities', 'target', 'canary', 'rollback', 'limits', 'safety', 'verdict',
  ], 'policy', issues);
  if (root.schema_version !== PHASE8_EXECUTION_POLICY_SCHEMA) issues.push(`policy.schema_version must equal ${PHASE8_EXECUTION_POLICY_SCHEMA}`);
  if (root.status !== 'accepted') issues.push('policy.status must equal accepted');
  if (root.execution_mode !== 'controlled_single_activation') issues.push('policy.execution_mode must equal controlled_single_activation');
  if (root.environment !== 'test' && root.environment !== 'production') issues.push('policy.environment must equal test or production');
  if (root.verdict !== 'accepted') issues.push('policy.verdict must equal accepted');

  const approvedAt = timestamp(root.approved_at, 'policy.approved_at', issues);
  const validFrom = timestamp(root.valid_from, 'policy.valid_from', issues);
  const validUntil = timestamp(root.valid_until, 'policy.valid_until', issues);
  if (approvedAt && validFrom && Date.parse(approvedAt) > Date.parse(validFrom)) issues.push('policy.approved_at cannot follow valid_from');
  if (validFrom && validUntil && Date.parse(validUntil) <= Date.parse(validFrom)) issues.push('policy.valid_until must follow valid_from');
  if (validFrom && validUntil && Date.parse(validUntil) - Date.parse(validFrom) > 24 * 3_600_000) issues.push('policy validity cannot exceed 24 hours');

  const phase7Root = objectAt(root.phase7, 'policy.phase7', issues);
  exactKeys(phase7Root, [
    'policy_id', 'policy_fingerprint', 'handoff_fingerprint', 'dossier_fingerprint',
    'verification_fingerprint', 'phase6_evidence_set_fingerprint',
  ], 'policy.phase7', issues);
  const phase7 = {
    policy_id: safeString(phase7Root.policy_id, 'policy.phase7.policy_id', issues, /^P7-[A-Za-z0-9._-]{4,64}$/),
    policy_fingerprint: safeString(phase7Root.policy_fingerprint, 'policy.phase7.policy_fingerprint', issues, HASH),
    handoff_fingerprint: safeString(phase7Root.handoff_fingerprint, 'policy.phase7.handoff_fingerprint', issues, HASH),
    dossier_fingerprint: safeString(phase7Root.dossier_fingerprint, 'policy.phase7.dossier_fingerprint', issues, HASH),
    verification_fingerprint: safeString(phase7Root.verification_fingerprint, 'policy.phase7.verification_fingerprint', issues, HASH),
    phase6_evidence_set_fingerprint: safeString(phase7Root.phase6_evidence_set_fingerprint, 'policy.phase7.phase6_evidence_set_fingerprint', issues, HASH),
  };

  const identitiesRoot = objectAt(root.identities, 'policy.identities', issues);
  exactKeys(identitiesRoot, [
    'release_authority', 'release_credential_sha256', 'executor', 'executor_credential_sha256',
    'safety_observer', 'observer_credential_sha256', 'rollback_operator', 'rollback_credential_sha256',
  ], 'policy.identities', issues);
  const identities = {
    release_authority: safeString(identitiesRoot.release_authority, 'policy.identities.release_authority', issues, ACTOR, 128),
    release_credential_sha256: safeString(identitiesRoot.release_credential_sha256, 'policy.identities.release_credential_sha256', issues, HASH),
    executor: safeString(identitiesRoot.executor, 'policy.identities.executor', issues, ACTOR, 128),
    executor_credential_sha256: safeString(identitiesRoot.executor_credential_sha256, 'policy.identities.executor_credential_sha256', issues, HASH),
    safety_observer: safeString(identitiesRoot.safety_observer, 'policy.identities.safety_observer', issues, ACTOR, 128),
    observer_credential_sha256: safeString(identitiesRoot.observer_credential_sha256, 'policy.identities.observer_credential_sha256', issues, HASH),
    rollback_operator: safeString(identitiesRoot.rollback_operator, 'policy.identities.rollback_operator', issues, ACTOR, 128),
    rollback_credential_sha256: safeString(identitiesRoot.rollback_credential_sha256, 'policy.identities.rollback_credential_sha256', issues, HASH),
  };
  const credentials = [
    identities.release_credential_sha256,
    identities.executor_credential_sha256,
    identities.observer_credential_sha256,
    identities.rollback_credential_sha256,
  ].filter(Boolean);
  if (new Set(credentials).size !== 4) issues.push('Phase 8 credentials must be different');

  const targetRoot = objectAt(root.target, 'policy.target', issues);
  exactKeys(targetRoot, [
    'deployment_id', 'target_fingerprint', 'target_contract_fingerprint', 'adapter_id',
    'adapter_version', 'adapter_artifact_digest', 'configuration_digest', 'credential_reference_sha256',
  ], 'policy.target', issues);
  const target = {
    deployment_id: safeString(targetRoot.deployment_id, 'policy.target.deployment_id', issues, SAFE_NAME),
    target_fingerprint: safeString(targetRoot.target_fingerprint, 'policy.target.target_fingerprint', issues, HASH),
    target_contract_fingerprint: safeString(targetRoot.target_contract_fingerprint, 'policy.target.target_contract_fingerprint', issues, HASH),
    adapter_id: safeString(targetRoot.adapter_id, 'policy.target.adapter_id', issues, SAFE_NAME),
    adapter_version: safeString(targetRoot.adapter_version, 'policy.target.adapter_version', issues, SAFE_NAME),
    adapter_artifact_digest: safeString(targetRoot.adapter_artifact_digest, 'policy.target.adapter_artifact_digest', issues, HASH),
    configuration_digest: safeString(targetRoot.configuration_digest, 'policy.target.configuration_digest', issues, HASH),
    credential_reference_sha256: safeString(targetRoot.credential_reference_sha256, 'policy.target.credential_reference_sha256', issues, HASH),
  };

  const canaryRoot = objectAt(root.canary, 'policy.canary', issues);
  exactKeys(canaryRoot, [
    'contract_fingerprint', 'cohort_size', 'max_activation_mutations', 'observation_minutes',
    'success_metric_fingerprint', 'abort_metric_fingerprint',
  ], 'policy.canary', issues);
  if (canaryRoot.cohort_size !== 1) issues.push('policy.canary.cohort_size must equal 1');
  if (canaryRoot.max_activation_mutations !== 1) issues.push('policy.canary.max_activation_mutations must equal 1');
  const canary = {
    contract_fingerprint: safeString(canaryRoot.contract_fingerprint, 'policy.canary.contract_fingerprint', issues, HASH),
    cohort_size: 1 as const,
    max_activation_mutations: 1 as const,
    observation_minutes: integer(canaryRoot.observation_minutes, 'policy.canary.observation_minutes', issues, 15, 1440),
    success_metric_fingerprint: safeString(canaryRoot.success_metric_fingerprint, 'policy.canary.success_metric_fingerprint', issues, HASH),
    abort_metric_fingerprint: safeString(canaryRoot.abort_metric_fingerprint, 'policy.canary.abort_metric_fingerprint', issues, HASH),
  };
  if (canary.success_metric_fingerprint === canary.abort_metric_fingerprint) issues.push('Phase 8 success and abort metrics must differ');

  const rollbackRoot = objectAt(root.rollback, 'policy.rollback', issues);
  exactKeys(rollbackRoot, [
    'contract_fingerprint', 'rollback_artifact_digest', 'procedure_digest',
    'max_recovery_minutes', 'max_rollback_mutations',
  ], 'policy.rollback', issues);
  if (rollbackRoot.max_rollback_mutations !== 1) issues.push('policy.rollback.max_rollback_mutations must equal 1');
  const rollback = {
    contract_fingerprint: safeString(rollbackRoot.contract_fingerprint, 'policy.rollback.contract_fingerprint', issues, HASH),
    rollback_artifact_digest: safeString(rollbackRoot.rollback_artifact_digest, 'policy.rollback.rollback_artifact_digest', issues, HASH),
    procedure_digest: safeString(rollbackRoot.procedure_digest, 'policy.rollback.procedure_digest', issues, HASH),
    max_recovery_minutes: integer(rollbackRoot.max_recovery_minutes, 'policy.rollback.max_recovery_minutes', issues, 5, 60),
    max_rollback_mutations: 1 as const,
  };

  const limitsRoot = objectAt(root.limits, 'policy.limits', issues);
  exactKeys(limitsRoot, [
    'release_validity_minutes', 'claim_lease_seconds', 'observation_deadline_minutes', 'rollback_window_minutes',
  ], 'policy.limits', issues);
  const limits = {
    release_validity_minutes: integer(limitsRoot.release_validity_minutes, 'policy.limits.release_validity_minutes', issues, 5, 30),
    claim_lease_seconds: integer(limitsRoot.claim_lease_seconds, 'policy.limits.claim_lease_seconds', issues, 30, 300),
    observation_deadline_minutes: integer(limitsRoot.observation_deadline_minutes, 'policy.limits.observation_deadline_minutes', issues, 15, 1440),
    rollback_window_minutes: integer(limitsRoot.rollback_window_minutes, 'policy.limits.rollback_window_minutes', issues, 5, 1440),
  };
  if (limits.observation_deadline_minutes < canary.observation_minutes) issues.push('observation deadline cannot be shorter than canary observation');

  const safetyRoot = objectAt(root.safety, 'policy.safety', issues);
  exactKeys(safetyRoot, [
    'kill_switch_starts_engaged', 'dual_credential_release_required', 'source_idempotency_required',
    'automatic_retry_forbidden', 'automatic_rollback_forbidden',
    'production_adapter_registry_empty_by_default', 'waivers_allowed',
  ], 'policy.safety', issues);
  for (const key of [
    'kill_switch_starts_engaged', 'dual_credential_release_required', 'source_idempotency_required',
    'automatic_retry_forbidden', 'automatic_rollback_forbidden', 'production_adapter_registry_empty_by_default',
  ] as const) if (safetyRoot[key] !== true) issues.push(`policy.safety.${key} must equal true`);
  if (safetyRoot.waivers_allowed !== false) issues.push('policy.safety.waivers_allowed must equal false');
  const safety = {
    kill_switch_starts_engaged: true as const,
    dual_credential_release_required: true as const,
    source_idempotency_required: true as const,
    automatic_retry_forbidden: true as const,
    automatic_rollback_forbidden: true as const,
    production_adapter_registry_empty_by_default: true as const,
    waivers_allowed: false as const,
  };

  const value: ActivationExecutionPolicyManifest = {
    schema_version: PHASE8_EXECUTION_POLICY_SCHEMA,
    policy_id: safeString(root.policy_id, 'policy.policy_id', issues, /^P8-[A-Za-z0-9._-]{4,64}$/),
    status: 'accepted',
    execution_mode: 'controlled_single_activation',
    environment: root.environment === 'production' ? 'production' : 'test',
    approved_by: safeString(root.approved_by, 'policy.approved_by', issues, ACTOR, 128),
    approved_at: approvedAt,
    valid_from: validFrom,
    valid_until: validUntil,
    tenant_id: safeString(root.tenant_id, 'policy.tenant_id', issues, UUID),
    source_connection_id: safeString(root.source_connection_id, 'policy.source_connection_id', issues, UUID),
    phase7,
    identities,
    target,
    canary,
    rollback,
    limits,
    safety,
    verdict: 'accepted',
  };
  if (value.approved_by && identities.release_authority && value.approved_by !== identities.release_authority) issues.push('policy.approved_by must equal release_authority');

  if (context) {
    const p7 = context.phase7;
    const handoff = context.handoff;
    if (p7.policy_id !== phase7.policy_id || evidenceFingerprint(p7) !== phase7.policy_fingerprint) issues.push('Phase 7 policy binding does not match');
    if (
      handoff.handoff_fingerprint !== phase7.handoff_fingerprint
      || handoff.dossier_fingerprint !== phase7.dossier_fingerprint
      || handoff.verification_fingerprint !== phase7.verification_fingerprint
      || handoff.phase6_evidence_set_fingerprint !== phase7.phase6_evidence_set_fingerprint
      || handoff.activation_status !== 'not_executed'
      || handoff.external_execution_required !== true
    ) issues.push('Phase 7 handoff binding does not match an unexecuted external handoff');
    if (p7.environment !== value.environment || p7.tenant_id !== value.tenant_id || p7.source_connection_id !== value.source_connection_id) issues.push('Phase 8 environment/tenant/source must match Phase 7');
    if (validFrom && Date.parse(validFrom) < Date.parse(p7.valid_from)) issues.push('Phase 8 cannot start before Phase 7');
    if (validUntil && Date.parse(validUntil) > Date.parse(p7.valid_until)) issues.push('Phase 8 cannot outlive Phase 7');
    const expectedTarget = p7.target;
    if (
      target.deployment_id !== expectedTarget.deployment_id
      || target.target_fingerprint !== expectedTarget.target_fingerprint
      || target.target_contract_fingerprint !== evidenceFingerprint(expectedTarget)
      || target.adapter_id !== expectedTarget.adapter_id
      || target.adapter_version !== expectedTarget.adapter_version
      || target.adapter_artifact_digest !== expectedTarget.adapter_artifact_digest
      || target.configuration_digest !== expectedTarget.configuration_digest
      || target.credential_reference_sha256 !== expectedTarget.credential_reference_sha256
    ) issues.push('Phase 8 target contract does not exactly match Phase 7');
    if (
      canary.contract_fingerprint !== evidenceFingerprint(p7.canary)
      || canary.cohort_size !== p7.canary.cohort_size
      || canary.observation_minutes !== p7.canary.observation_minutes
      || canary.success_metric_fingerprint !== p7.canary.success_metric_fingerprint
      || canary.abort_metric_fingerprint !== p7.canary.abort_metric_fingerprint
    ) issues.push('Phase 8 canary contract does not exactly match Phase 7');
    if (
      rollback.contract_fingerprint !== evidenceFingerprint(p7.rollback)
      || rollback.rollback_artifact_digest !== p7.rollback.rollback_artifact_digest
      || rollback.procedure_digest !== p7.rollback.procedure_digest
      || rollback.max_recovery_minutes !== p7.rollback.max_recovery_minutes
    ) issues.push('Phase 8 rollback contract does not exactly match Phase 7');

    const upstreamCredentials = [
      p7.identities.authority_credential_sha256,
      p7.identities.verifier_credential_sha256,
      p7.identities.operator_credential_sha256,
      context.phase6.identities.authority_credential_sha256,
      context.phase6.identities.assessor_credential_sha256,
      context.phase5.identities.authority_credential_sha256,
      context.phase5.identities.assessor_credential_sha256,
      context.phase5.identities.reviewer_credential_sha256,
      context.g7.identities.release_credential_sha256,
      context.g7.identities.executor_credential_sha256,
      context.g7.identities.kill_switch_credential_sha256,
      context.g6.target.command_credential_sha256,
      context.g6.identities.approval_credential_sha256,
      context.g6.identities.operator_credential_sha256,
    ];
    if (credentials.some((credential) => upstreamCredentials.includes(credential))) issues.push('Phase 8 credentials must differ from every upstream credential');
  }
  if (issues.length) return { ok: false, issues };
  return { ok: true, issues: [], value, fingerprint: activationExecutionPolicyFingerprint(value) };
}
