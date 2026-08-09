import { evidenceFingerprint } from './phase2Proof';
import { credentialFingerprint, type G6ActionPolicyManifest } from './g6Policy';
import type { G7BoundedAutonomyPolicyManifest } from './g7Policy';

export const PHASE5_ASSURANCE_POLICY_SCHEMA = 'leozops_phase5_operational_assurance_policy_v1' as const;

export interface OperationalAssurancePolicyManifest {
  schema_version: typeof PHASE5_ASSURANCE_POLICY_SCHEMA;
  policy_id: string;
  status: 'accepted';
  assurance_mode: 'local_rehearsal';
  environment: 'test' | 'production';
  approved_by: string;
  approved_at: string;
  valid_from: string;
  valid_until: string;
  tenant_id: string;
  source_connection_id: string;
  g7_policy: {
    policy_id: string;
    policy_fingerprint: string;
  };
  identities: {
    assurance_authority: string;
    authority_credential_sha256: string;
    assessor: string;
    assessor_credential_sha256: string;
    release_reviewer: string;
    reviewer_credential_sha256: string;
  };
  window: {
    days: number;
    max_assessment_age_minutes: number;
    min_successful_executions: number;
    max_failed_executions: 0;
    max_reconciliation_required_executions: 0;
    require_successful_human_recovery: true;
    require_resolved_incident_halt_drill: true;
  };
  safety: {
    release_package_must_remain_blocked_external: true;
    external_evidence_may_not_be_inferred: true;
    production_adapter_registry_must_remain_empty: true;
    waivers_allowed: false;
  };
  verdict: 'accepted';
}

export interface OperationalAssurancePolicyValidation {
  ok: boolean;
  issues: string[];
  value?: OperationalAssurancePolicyManifest;
  fingerprint?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,191}$/;
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

export function operationalAssurancePolicyFingerprint(value: OperationalAssurancePolicyManifest): string {
  return evidenceFingerprint(value);
}

export function validateOperationalAssurancePolicy(
  input: unknown,
  g7?: G7BoundedAutonomyPolicyManifest,
  g6?: G6ActionPolicyManifest,
): OperationalAssurancePolicyValidation {
  const issues: string[] = [];
  const root = objectAt(input, 'policy', issues);
  exactKeys(root, [
    'schema_version', 'policy_id', 'status', 'assurance_mode', 'environment', 'approved_by',
    'approved_at', 'valid_from', 'valid_until', 'tenant_id', 'source_connection_id',
    'g7_policy', 'identities', 'window', 'safety', 'verdict',
  ], 'policy', issues);
  if (root.schema_version !== PHASE5_ASSURANCE_POLICY_SCHEMA) {
    issues.push(`policy.schema_version must equal ${PHASE5_ASSURANCE_POLICY_SCHEMA}`);
  }
  if (root.status !== 'accepted') issues.push('policy.status must equal accepted');
  if (root.assurance_mode !== 'local_rehearsal') issues.push('policy.assurance_mode must equal local_rehearsal');
  if (root.environment !== 'test' && root.environment !== 'production') {
    issues.push('policy.environment must equal test or production');
  }
  if (root.verdict !== 'accepted') issues.push('policy.verdict must equal accepted');

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

  const g7Root = objectAt(root.g7_policy, 'policy.g7_policy', issues);
  exactKeys(g7Root, ['policy_id', 'policy_fingerprint'], 'policy.g7_policy', issues);
  const g7Binding = {
    policy_id: safeString(g7Root.policy_id, 'policy.g7_policy.policy_id', issues, /^G7-[A-Za-z0-9._-]{4,64}$/),
    policy_fingerprint: safeString(g7Root.policy_fingerprint, 'policy.g7_policy.policy_fingerprint', issues, HASH),
  };

  const identitiesRoot = objectAt(root.identities, 'policy.identities', issues);
  exactKeys(identitiesRoot, [
    'assurance_authority', 'authority_credential_sha256', 'assessor',
    'assessor_credential_sha256', 'release_reviewer', 'reviewer_credential_sha256',
  ], 'policy.identities', issues);
  const identities = {
    assurance_authority: safeString(identitiesRoot.assurance_authority, 'policy.identities.assurance_authority', issues, ACTOR, 128),
    authority_credential_sha256: safeString(identitiesRoot.authority_credential_sha256, 'policy.identities.authority_credential_sha256', issues, HASH),
    assessor: safeString(identitiesRoot.assessor, 'policy.identities.assessor', issues, ACTOR, 128),
    assessor_credential_sha256: safeString(identitiesRoot.assessor_credential_sha256, 'policy.identities.assessor_credential_sha256', issues, HASH),
    release_reviewer: safeString(identitiesRoot.release_reviewer, 'policy.identities.release_reviewer', issues, ACTOR, 128),
    reviewer_credential_sha256: safeString(identitiesRoot.reviewer_credential_sha256, 'policy.identities.reviewer_credential_sha256', issues, HASH),
  };
  if (new Set([
    identities.authority_credential_sha256,
    identities.assessor_credential_sha256,
    identities.reviewer_credential_sha256,
  ].filter(Boolean)).size !== 3) issues.push('Phase 5 credentials must be different');

  const windowRoot = objectAt(root.window, 'policy.window', issues);
  exactKeys(windowRoot, [
    'days', 'max_assessment_age_minutes', 'min_successful_executions', 'max_failed_executions',
    'max_reconciliation_required_executions', 'require_successful_human_recovery',
    'require_resolved_incident_halt_drill',
  ], 'policy.window', issues);
  if (windowRoot.max_failed_executions !== 0) issues.push('policy.window.max_failed_executions must equal 0');
  if (windowRoot.max_reconciliation_required_executions !== 0) {
    issues.push('policy.window.max_reconciliation_required_executions must equal 0');
  }
  if (windowRoot.require_successful_human_recovery !== true) {
    issues.push('policy.window.require_successful_human_recovery must equal true');
  }
  if (windowRoot.require_resolved_incident_halt_drill !== true) {
    issues.push('policy.window.require_resolved_incident_halt_drill must equal true');
  }
  const window = {
    days: integer(windowRoot.days, 'policy.window.days', issues, 7, 30),
    max_assessment_age_minutes: integer(
      windowRoot.max_assessment_age_minutes,
      'policy.window.max_assessment_age_minutes',
      issues,
      5,
      60,
    ),
    min_successful_executions: integer(windowRoot.min_successful_executions, 'policy.window.min_successful_executions', issues, 1, 50),
    max_failed_executions: 0 as const,
    max_reconciliation_required_executions: 0 as const,
    require_successful_human_recovery: true as const,
    require_resolved_incident_halt_drill: true as const,
  };

  const safetyRoot = objectAt(root.safety, 'policy.safety', issues);
  exactKeys(safetyRoot, [
    'release_package_must_remain_blocked_external', 'external_evidence_may_not_be_inferred',
    'production_adapter_registry_must_remain_empty', 'waivers_allowed',
  ], 'policy.safety', issues);
  for (const key of [
    'release_package_must_remain_blocked_external',
    'external_evidence_may_not_be_inferred',
    'production_adapter_registry_must_remain_empty',
  ] as const) if (safetyRoot[key] !== true) issues.push(`policy.safety.${key} must equal true`);
  if (safetyRoot.waivers_allowed !== false) issues.push('policy.safety.waivers_allowed must equal false');
  const safety = {
    release_package_must_remain_blocked_external: true as const,
    external_evidence_may_not_be_inferred: true as const,
    production_adapter_registry_must_remain_empty: true as const,
    waivers_allowed: false as const,
  };

  const tenantId = safeString(root.tenant_id, 'policy.tenant_id', issues, UUID);
  const sourceConnectionId = safeString(root.source_connection_id, 'policy.source_connection_id', issues, UUID);
  const value: OperationalAssurancePolicyManifest = {
    schema_version: PHASE5_ASSURANCE_POLICY_SCHEMA,
    policy_id: safeString(root.policy_id, 'policy.policy_id', issues, /^P5-[A-Za-z0-9._-]{4,64}$/),
    status: 'accepted',
    assurance_mode: 'local_rehearsal',
    environment: root.environment === 'production' ? 'production' : 'test',
    approved_by: safeString(root.approved_by, 'policy.approved_by', issues, ACTOR, 128),
    approved_at: approvedAt,
    valid_from: validFrom,
    valid_until: validUntil,
    tenant_id: tenantId,
    source_connection_id: sourceConnectionId,
    g7_policy: g7Binding,
    identities,
    window,
    safety,
    verdict: 'accepted',
  };
  if (value.approved_by && identities.assurance_authority && value.approved_by !== identities.assurance_authority) {
    issues.push('policy.approved_by must equal assurance_authority');
  }

  if (g7) {
    if (g7.policy_id !== value.g7_policy.policy_id) issues.push('policy G7 ID does not match');
    if (evidenceFingerprint(g7) !== value.g7_policy.policy_fingerprint) issues.push('policy G7 fingerprint does not match');
    if (g7.environment !== value.environment) issues.push('policy environment does not match G7');
    if (g7.tenant_id !== value.tenant_id) issues.push('policy tenant does not match G7');
    if (g7.source_connection_id !== value.source_connection_id) issues.push('policy source does not match G7');
    if (validFrom && Date.parse(validFrom) < Date.parse(g7.valid_from)) issues.push('policy cannot start before G7');
    if (validUntil && Date.parse(validUntil) > Date.parse(g7.valid_until)) issues.push('policy cannot outlive G7');
    const upstream = [
      g7.identities.release_credential_sha256,
      g7.identities.executor_credential_sha256,
      g7.identities.kill_switch_credential_sha256,
    ];
    if ([
      identities.authority_credential_sha256,
      identities.assessor_credential_sha256,
      identities.reviewer_credential_sha256,
    ].some((fingerprint) => upstream.includes(fingerprint))) {
      issues.push('Phase 5 credentials must differ from every G7 credential');
    }
  }
  if (g6) {
    const upstream = [
      g6.target.command_credential_sha256,
      g6.identities.approval_credential_sha256,
      g6.identities.operator_credential_sha256,
    ];
    if ([
      identities.authority_credential_sha256,
      identities.assessor_credential_sha256,
      identities.reviewer_credential_sha256,
    ].some((fingerprint) => upstream.includes(fingerprint))) {
      issues.push('Phase 5 credentials must differ from every G6 credential');
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, issues: [], value, fingerprint: operationalAssurancePolicyFingerprint(value) };
}

export function operationalAssuranceCredentialFingerprint(secret: string): string {
  return credentialFingerprint(secret);
}
