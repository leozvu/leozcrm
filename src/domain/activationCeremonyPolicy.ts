import { credentialFingerprint, type G6ActionPolicyManifest } from './g6Policy';
import { evidenceFingerprint } from './phase2Proof';
import type { G7BoundedAutonomyPolicyManifest } from './g7Policy';
import type { OperationalAssurancePolicyManifest } from './operationalAssurancePolicy';
import type { ExternalEvidencePolicyManifest } from './externalEvidencePolicy';

export const PHASE7_ACTIVATION_POLICY_SCHEMA = 'leozops_phase7_activation_ceremony_policy_v1' as const;

export interface ActivationCeremonyPolicyManifest {
  schema_version: typeof PHASE7_ACTIVATION_POLICY_SCHEMA;
  policy_id: string;
  status: 'accepted';
  ceremony_mode: 'sealed_external_handoff';
  environment: 'test' | 'production';
  approved_by: string;
  approved_at: string;
  valid_from: string;
  valid_until: string;
  tenant_id: string;
  source_connection_id: string;
  phase6: {
    policy_id: string;
    policy_fingerprint: string;
    assessment_fingerprint: string;
  };
  identities: {
    ceremony_authority: string;
    authority_credential_sha256: string;
    independent_verifier: string;
    verifier_credential_sha256: string;
    activation_operator: string;
    operator_credential_sha256: string;
  };
  target: {
    deployment_id: string;
    target_fingerprint: string;
    provider: string;
    region: string;
    project_id: string;
    service_id: string;
    adapter_id: string;
    adapter_version: string;
    command_key: string;
    adapter_artifact_digest: string;
    configuration_digest: string;
    credential_reference_sha256: string;
  };
  canary: {
    cohort_size: 1;
    max_mutations: 1;
    observation_minutes: number;
    success_metric_fingerprint: string;
    abort_metric_fingerprint: string;
    manual_start_required: true;
    manual_continue_required: true;
  };
  rollback: {
    rollback_artifact_digest: string;
    procedure_digest: string;
    max_recovery_minutes: number;
    kill_switch_must_start_engaged: true;
    manual_recovery_only: true;
  };
  limits: {
    max_phase6_assessment_age_minutes: number;
    max_verification_age_minutes: number;
  };
  safety: {
    handoff_only: true;
    activation_executor_not_implemented: true;
    external_execution_requires_new_authority: true;
    production_adapter_registry_must_remain_empty: true;
    waivers_allowed: false;
  };
  verdict: 'accepted';
}

export interface ActivationCeremonyPolicyValidation {
  ok: boolean;
  issues: string[];
  value?: ActivationCeremonyPolicyManifest;
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

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string, issues: string[]): void {
  const keys = new Set(expected);
  for (const key of Object.keys(value)) if (!keys.has(key)) issues.push(`${path}.${key} is not allowed`);
  for (const key of expected) if (!(key in value)) issues.push(`${path}.${key} is required`);
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

export function activationCeremonyPolicyFingerprint(value: ActivationCeremonyPolicyManifest): string {
  return evidenceFingerprint(value);
}

export function validateActivationCeremonyPolicy(
  input: unknown,
  phase6?: ExternalEvidencePolicyManifest,
  phase5?: OperationalAssurancePolicyManifest,
  g7?: G7BoundedAutonomyPolicyManifest,
  g6?: G6ActionPolicyManifest,
): ActivationCeremonyPolicyValidation {
  const issues: string[] = [];
  const root = objectAt(input, 'policy', issues);
  exactKeys(root, [
    'schema_version', 'policy_id', 'status', 'ceremony_mode', 'environment', 'approved_by',
    'approved_at', 'valid_from', 'valid_until', 'tenant_id', 'source_connection_id',
    'phase6', 'identities', 'target', 'canary', 'rollback', 'limits', 'safety', 'verdict',
  ], 'policy', issues);
  if (root.schema_version !== PHASE7_ACTIVATION_POLICY_SCHEMA) {
    issues.push(`policy.schema_version must equal ${PHASE7_ACTIVATION_POLICY_SCHEMA}`);
  }
  if (root.status !== 'accepted') issues.push('policy.status must equal accepted');
  if (root.ceremony_mode !== 'sealed_external_handoff') issues.push('policy.ceremony_mode must equal sealed_external_handoff');
  if (root.environment !== 'test' && root.environment !== 'production') issues.push('policy.environment must equal test or production');
  if (root.verdict !== 'accepted') issues.push('policy.verdict must equal accepted');

  const approvedAt = timestamp(root.approved_at, 'policy.approved_at', issues);
  const validFrom = timestamp(root.valid_from, 'policy.valid_from', issues);
  const validUntil = timestamp(root.valid_until, 'policy.valid_until', issues);
  if (approvedAt && validFrom && Date.parse(approvedAt) > Date.parse(validFrom)) issues.push('policy.approved_at cannot follow valid_from');
  if (validFrom && validUntil && Date.parse(validUntil) <= Date.parse(validFrom)) issues.push('policy.valid_until must follow valid_from');
  if (validFrom && validUntil && Date.parse(validUntil) - Date.parse(validFrom) > 30 * 86_400_000) {
    issues.push('policy validity cannot exceed 30 days');
  }

  const phase6Root = objectAt(root.phase6, 'policy.phase6', issues);
  exactKeys(phase6Root, ['policy_id', 'policy_fingerprint', 'assessment_fingerprint'], 'policy.phase6', issues);
  const phase6Binding = {
    policy_id: safeString(phase6Root.policy_id, 'policy.phase6.policy_id', issues, /^P6-[A-Za-z0-9._-]{4,64}$/),
    policy_fingerprint: safeString(phase6Root.policy_fingerprint, 'policy.phase6.policy_fingerprint', issues, HASH),
    assessment_fingerprint: safeString(phase6Root.assessment_fingerprint, 'policy.phase6.assessment_fingerprint', issues, HASH),
  };

  const identitiesRoot = objectAt(root.identities, 'policy.identities', issues);
  exactKeys(identitiesRoot, [
    'ceremony_authority', 'authority_credential_sha256', 'independent_verifier',
    'verifier_credential_sha256', 'activation_operator', 'operator_credential_sha256',
  ], 'policy.identities', issues);
  const identities = {
    ceremony_authority: safeString(identitiesRoot.ceremony_authority, 'policy.identities.ceremony_authority', issues, ACTOR, 128),
    authority_credential_sha256: safeString(identitiesRoot.authority_credential_sha256, 'policy.identities.authority_credential_sha256', issues, HASH),
    independent_verifier: safeString(identitiesRoot.independent_verifier, 'policy.identities.independent_verifier', issues, ACTOR, 128),
    verifier_credential_sha256: safeString(identitiesRoot.verifier_credential_sha256, 'policy.identities.verifier_credential_sha256', issues, HASH),
    activation_operator: safeString(identitiesRoot.activation_operator, 'policy.identities.activation_operator', issues, ACTOR, 128),
    operator_credential_sha256: safeString(identitiesRoot.operator_credential_sha256, 'policy.identities.operator_credential_sha256', issues, HASH),
  };
  const phase7Credentials = [
    identities.authority_credential_sha256,
    identities.verifier_credential_sha256,
    identities.operator_credential_sha256,
  ].filter(Boolean);
  if (new Set(phase7Credentials).size !== 3) issues.push('Phase 7 credentials must be different');

  const targetRoot = objectAt(root.target, 'policy.target', issues);
  exactKeys(targetRoot, [
    'deployment_id', 'target_fingerprint', 'provider', 'region', 'project_id', 'service_id',
    'adapter_id', 'adapter_version', 'command_key', 'adapter_artifact_digest',
    'configuration_digest', 'credential_reference_sha256',
  ], 'policy.target', issues);
  const target = {
    deployment_id: safeString(targetRoot.deployment_id, 'policy.target.deployment_id', issues, SAFE_NAME),
    target_fingerprint: safeString(targetRoot.target_fingerprint, 'policy.target.target_fingerprint', issues, HASH),
    provider: safeString(targetRoot.provider, 'policy.target.provider', issues, SAFE_NAME),
    region: safeString(targetRoot.region, 'policy.target.region', issues, SAFE_NAME),
    project_id: safeString(targetRoot.project_id, 'policy.target.project_id', issues, SAFE_NAME),
    service_id: safeString(targetRoot.service_id, 'policy.target.service_id', issues, SAFE_NAME),
    adapter_id: safeString(targetRoot.adapter_id, 'policy.target.adapter_id', issues, SAFE_NAME),
    adapter_version: safeString(targetRoot.adapter_version, 'policy.target.adapter_version', issues, SAFE_NAME),
    command_key: safeString(targetRoot.command_key, 'policy.target.command_key', issues),
    adapter_artifact_digest: safeString(targetRoot.adapter_artifact_digest, 'policy.target.adapter_artifact_digest', issues, HASH),
    configuration_digest: safeString(targetRoot.configuration_digest, 'policy.target.configuration_digest', issues, HASH),
    credential_reference_sha256: safeString(targetRoot.credential_reference_sha256, 'policy.target.credential_reference_sha256', issues, HASH),
  };

  const canaryRoot = objectAt(root.canary, 'policy.canary', issues);
  exactKeys(canaryRoot, [
    'cohort_size', 'max_mutations', 'observation_minutes', 'success_metric_fingerprint',
    'abort_metric_fingerprint', 'manual_start_required', 'manual_continue_required',
  ], 'policy.canary', issues);
  if (canaryRoot.cohort_size !== 1) issues.push('policy.canary.cohort_size must equal 1');
  if (canaryRoot.max_mutations !== 1) issues.push('policy.canary.max_mutations must equal 1');
  if (canaryRoot.manual_start_required !== true) issues.push('policy.canary.manual_start_required must equal true');
  if (canaryRoot.manual_continue_required !== true) issues.push('policy.canary.manual_continue_required must equal true');
  const canary = {
    cohort_size: 1 as const,
    max_mutations: 1 as const,
    observation_minutes: integer(canaryRoot.observation_minutes, 'policy.canary.observation_minutes', issues, 15, 1440),
    success_metric_fingerprint: safeString(canaryRoot.success_metric_fingerprint, 'policy.canary.success_metric_fingerprint', issues, HASH),
    abort_metric_fingerprint: safeString(canaryRoot.abort_metric_fingerprint, 'policy.canary.abort_metric_fingerprint', issues, HASH),
    manual_start_required: true as const,
    manual_continue_required: true as const,
  };
  if (canary.success_metric_fingerprint === canary.abort_metric_fingerprint) {
    issues.push('Phase 7 success and abort metrics must be different');
  }

  const rollbackRoot = objectAt(root.rollback, 'policy.rollback', issues);
  exactKeys(rollbackRoot, [
    'rollback_artifact_digest', 'procedure_digest', 'max_recovery_minutes',
    'kill_switch_must_start_engaged', 'manual_recovery_only',
  ], 'policy.rollback', issues);
  if (rollbackRoot.kill_switch_must_start_engaged !== true) issues.push('policy.rollback.kill_switch_must_start_engaged must equal true');
  if (rollbackRoot.manual_recovery_only !== true) issues.push('policy.rollback.manual_recovery_only must equal true');
  const rollback = {
    rollback_artifact_digest: safeString(rollbackRoot.rollback_artifact_digest, 'policy.rollback.rollback_artifact_digest', issues, HASH),
    procedure_digest: safeString(rollbackRoot.procedure_digest, 'policy.rollback.procedure_digest', issues, HASH),
    max_recovery_minutes: integer(rollbackRoot.max_recovery_minutes, 'policy.rollback.max_recovery_minutes', issues, 5, 60),
    kill_switch_must_start_engaged: true as const,
    manual_recovery_only: true as const,
  };

  const limitsRoot = objectAt(root.limits, 'policy.limits', issues);
  exactKeys(limitsRoot, ['max_phase6_assessment_age_minutes', 'max_verification_age_minutes'], 'policy.limits', issues);
  const limits = {
    max_phase6_assessment_age_minutes: integer(limitsRoot.max_phase6_assessment_age_minutes, 'policy.limits.max_phase6_assessment_age_minutes', issues, 5, 60),
    max_verification_age_minutes: integer(limitsRoot.max_verification_age_minutes, 'policy.limits.max_verification_age_minutes', issues, 5, 60),
  };

  const safetyRoot = objectAt(root.safety, 'policy.safety', issues);
  exactKeys(safetyRoot, [
    'handoff_only', 'activation_executor_not_implemented', 'external_execution_requires_new_authority',
    'production_adapter_registry_must_remain_empty', 'waivers_allowed',
  ], 'policy.safety', issues);
  for (const key of [
    'handoff_only', 'activation_executor_not_implemented', 'external_execution_requires_new_authority',
    'production_adapter_registry_must_remain_empty',
  ] as const) if (safetyRoot[key] !== true) issues.push(`policy.safety.${key} must equal true`);
  if (safetyRoot.waivers_allowed !== false) issues.push('policy.safety.waivers_allowed must equal false');
  const safety = {
    handoff_only: true as const,
    activation_executor_not_implemented: true as const,
    external_execution_requires_new_authority: true as const,
    production_adapter_registry_must_remain_empty: true as const,
    waivers_allowed: false as const,
  };

  const value: ActivationCeremonyPolicyManifest = {
    schema_version: PHASE7_ACTIVATION_POLICY_SCHEMA,
    policy_id: safeString(root.policy_id, 'policy.policy_id', issues, /^P7-[A-Za-z0-9._-]{4,64}$/),
    status: 'accepted',
    ceremony_mode: 'sealed_external_handoff',
    environment: root.environment === 'production' ? 'production' : 'test',
    approved_by: safeString(root.approved_by, 'policy.approved_by', issues, ACTOR, 128),
    approved_at: approvedAt,
    valid_from: validFrom,
    valid_until: validUntil,
    tenant_id: safeString(root.tenant_id, 'policy.tenant_id', issues, UUID),
    source_connection_id: safeString(root.source_connection_id, 'policy.source_connection_id', issues, UUID),
    phase6: phase6Binding,
    identities,
    target,
    canary,
    rollback,
    limits,
    safety,
    verdict: 'accepted',
  };
  if (value.approved_by && identities.ceremony_authority && value.approved_by !== identities.ceremony_authority) {
    issues.push('policy.approved_by must equal ceremony_authority');
  }

  if (phase6) {
    if (phase6.policy_id !== value.phase6.policy_id) issues.push('policy Phase 6 ID does not match');
    if (evidenceFingerprint(phase6) !== value.phase6.policy_fingerprint) issues.push('policy Phase 6 fingerprint does not match');
    if (phase6.environment !== value.environment) issues.push('policy environment does not match Phase 6');
    if (phase6.tenant_id !== value.tenant_id) issues.push('policy tenant does not match Phase 6');
    if (phase6.source_connection_id !== value.source_connection_id) issues.push('policy source does not match Phase 6');
    if (validFrom && Date.parse(validFrom) < Date.parse(phase6.valid_from)) issues.push('policy cannot start before Phase 6');
    if (validUntil && Date.parse(validUntil) > Date.parse(phase6.valid_until)) issues.push('policy cannot outlive Phase 6');
    const upstream = [phase6.identities.authority_credential_sha256, phase6.identities.assessor_credential_sha256];
    if (phase7Credentials.some((item) => upstream.includes(item))) issues.push('Phase 7 credentials must differ from every Phase 6 credential');
  }
  if (phase5) {
    const upstream = [
      phase5.identities.authority_credential_sha256,
      phase5.identities.assessor_credential_sha256,
      phase5.identities.reviewer_credential_sha256,
    ];
    if (phase7Credentials.some((item) => upstream.includes(item))) issues.push('Phase 7 credentials must differ from every Phase 5 credential');
  }
  if (g7) {
    const upstream = [
      g7.identities.release_credential_sha256,
      g7.identities.executor_credential_sha256,
      g7.identities.kill_switch_credential_sha256,
    ];
    if (phase7Credentials.some((item) => upstream.includes(item))) issues.push('Phase 7 credentials must differ from every G7 credential');
  }
  if (g6) {
    const upstream = [
      g6.target.command_credential_sha256,
      g6.identities.approval_credential_sha256,
      g6.identities.operator_credential_sha256,
    ];
    if (phase7Credentials.some((item) => upstream.includes(item))) issues.push('Phase 7 credentials must differ from every G6 credential');
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, issues: [], value, fingerprint: activationCeremonyPolicyFingerprint(value) };
}

export function activationCeremonyCredentialFingerprint(secret: string): string {
  return credentialFingerprint(secret);
}
