import { createHash, createPublicKey } from 'node:crypto';
import { evidenceFingerprint } from './phase2Proof';
import { credentialFingerprint, type G6ActionPolicyManifest } from './g6Policy';
import type { G7BoundedAutonomyPolicyManifest } from './g7Policy';
import type { OperationalAssurancePolicyManifest } from './operationalAssurancePolicy';

export const PHASE6_EXTERNAL_EVIDENCE_POLICY_SCHEMA = 'leozops_phase6_external_evidence_policy_v1' as const;

export const PHASE6_ISSUER_ROLES = [
  'product_owner',
  'implementation',
  'monitoring',
  'independent_qa',
] as const;

export type ExternalEvidenceIssuerRole = typeof PHASE6_ISSUER_ROLES[number];

export const PHASE6_EVIDENCE_MATRIX = [
  { evidence_type: 'external_g5_release', blocker_code: 'external_g5_release_unproven', issuer_role: 'product_owner' },
  { evidence_type: 'command_specific_g6_release', blocker_code: 'command_specific_g6_release_unproven', issuer_role: 'product_owner' },
  { evidence_type: 'production_supervised_history', blocker_code: 'production_supervised_history_unproven', issuer_role: 'monitoring' },
  { evidence_type: 'production_adapter_and_credential', blocker_code: 'production_adapter_and_credential_absent', issuer_role: 'implementation' },
  { evidence_type: 'deployed_monitoring_and_kill_switch', blocker_code: 'deployed_monitoring_and_kill_switch_unproven', issuer_role: 'monitoring' },
  { evidence_type: 'production_canary', blocker_code: 'production_canary_unproven', issuer_role: 'independent_qa' },
  { evidence_type: 'external_incident_recovery_drill', blocker_code: 'external_incident_recovery_drill_unproven', issuer_role: 'independent_qa' },
  { evidence_type: 'product_owner_g7_release', blocker_code: 'product_owner_g7_release_unproven', issuer_role: 'product_owner' },
] as const satisfies readonly {
  evidence_type: string;
  blocker_code: string;
  issuer_role: ExternalEvidenceIssuerRole;
}[];

export type ExternalEvidenceType = typeof PHASE6_EVIDENCE_MATRIX[number]['evidence_type'];

export interface ExternalEvidenceIssuer {
  issuer_id: string;
  key_id: string;
  algorithm: 'ed25519';
  public_key_pem: string;
  public_key_sha256: string;
}

export interface ExternalEvidencePolicyManifest {
  schema_version: typeof PHASE6_EXTERNAL_EVIDENCE_POLICY_SCHEMA;
  policy_id: string;
  status: 'accepted';
  admission_mode: 'local_trust_bridge';
  environment: 'test' | 'production';
  approved_by: string;
  approved_at: string;
  valid_from: string;
  valid_until: string;
  tenant_id: string;
  source_connection_id: string;
  phase5: {
    policy_id: string;
    policy_fingerprint: string;
    assessment_fingerprint: string;
    release_package_fingerprint: string;
  };
  identities: {
    trust_authority: string;
    authority_credential_sha256: string;
    assessor: string;
    assessor_credential_sha256: string;
  };
  issuers: Record<ExternalEvidenceIssuerRole, ExternalEvidenceIssuer>;
  limits: {
    max_clock_skew_seconds: number;
    max_attestation_age_hours: number;
    max_attestation_validity_hours: number;
  };
  safety: {
    evidence_matrix_version: 'phase6-eight-blockers-v1';
    require_all_eight: true;
    reject_unknown_issuer: true;
    reject_replay_and_non_monotonic_statements: true;
    release_authority_not_granted: true;
    production_adapter_registry_must_remain_empty: true;
    waivers_allowed: false;
  };
  verdict: 'accepted';
}

export interface ExternalEvidencePolicyValidation {
  ok: boolean;
  issues: string[];
  value?: ExternalEvidencePolicyManifest;
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

function safeString(value: unknown, path: string, issues: string[], pattern = SAFE_ID, max = 256): string {
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

export function externalPublicKeyFingerprint(publicKeyPem: string): string {
  const key = createPublicKey(publicKeyPem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('public key must be Ed25519');
  const der = key.export({ type: 'spki', format: 'der' });
  return `sha256:${createHash('sha256').update(der).digest('hex')}`;
}

function issuerAt(value: unknown, role: ExternalEvidenceIssuerRole, issues: string[]): ExternalEvidenceIssuer {
  const path = `policy.issuers.${role}`;
  const root = objectAt(value, path, issues);
  exactKeys(root, ['issuer_id', 'key_id', 'algorithm', 'public_key_pem', 'public_key_sha256'], path, issues);
  if (root.algorithm !== 'ed25519') issues.push(`${path}.algorithm must equal ed25519`);
  const pem = typeof root.public_key_pem === 'string' ? root.public_key_pem : '';
  let normalizedPem = '';
  let fingerprint = '';
  try {
    if (!/^-----BEGIN PUBLIC KEY-----\n[0-9A-Za-z+/=\n]+-----END PUBLIC KEY-----\n$/.test(pem)) {
      throw new Error('not canonical public PEM');
    }
    const key = createPublicKey(pem);
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('not Ed25519');
    normalizedPem = key.export({ type: 'spki', format: 'pem' }).toString();
    if (normalizedPem !== pem) throw new Error('not canonical');
    fingerprint = externalPublicKeyFingerprint(pem);
  } catch {
    issues.push(`${path}.public_key_pem must be a canonical Ed25519 public key`);
  }
  const declaredFingerprint = safeString(root.public_key_sha256, `${path}.public_key_sha256`, issues, HASH);
  if (fingerprint && declaredFingerprint && fingerprint !== declaredFingerprint) {
    issues.push(`${path}.public_key_sha256 does not match public_key_pem`);
  }
  return {
    issuer_id: safeString(root.issuer_id, `${path}.issuer_id`, issues),
    key_id: safeString(root.key_id, `${path}.key_id`, issues),
    algorithm: 'ed25519',
    public_key_pem: normalizedPem,
    public_key_sha256: declaredFingerprint,
  };
}

export function externalEvidencePolicyFingerprint(value: ExternalEvidencePolicyManifest): string {
  return evidenceFingerprint(value);
}

export function validateExternalEvidencePolicy(
  input: unknown,
  phase5?: OperationalAssurancePolicyManifest,
  g7?: G7BoundedAutonomyPolicyManifest,
  g6?: G6ActionPolicyManifest,
): ExternalEvidencePolicyValidation {
  const issues: string[] = [];
  const root = objectAt(input, 'policy', issues);
  exactKeys(root, [
    'schema_version', 'policy_id', 'status', 'admission_mode', 'environment', 'approved_by',
    'approved_at', 'valid_from', 'valid_until', 'tenant_id', 'source_connection_id',
    'phase5', 'identities', 'issuers', 'limits', 'safety', 'verdict',
  ], 'policy', issues);
  if (root.schema_version !== PHASE6_EXTERNAL_EVIDENCE_POLICY_SCHEMA) {
    issues.push(`policy.schema_version must equal ${PHASE6_EXTERNAL_EVIDENCE_POLICY_SCHEMA}`);
  }
  if (root.status !== 'accepted') issues.push('policy.status must equal accepted');
  if (root.admission_mode !== 'local_trust_bridge') issues.push('policy.admission_mode must equal local_trust_bridge');
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

  const phase5Root = objectAt(root.phase5, 'policy.phase5', issues);
  exactKeys(phase5Root, [
    'policy_id', 'policy_fingerprint', 'assessment_fingerprint', 'release_package_fingerprint',
  ], 'policy.phase5', issues);
  const phase5Binding = {
    policy_id: safeString(phase5Root.policy_id, 'policy.phase5.policy_id', issues, /^P5-[A-Za-z0-9._-]{4,64}$/),
    policy_fingerprint: safeString(phase5Root.policy_fingerprint, 'policy.phase5.policy_fingerprint', issues, HASH),
    assessment_fingerprint: safeString(phase5Root.assessment_fingerprint, 'policy.phase5.assessment_fingerprint', issues, HASH),
    release_package_fingerprint: safeString(phase5Root.release_package_fingerprint, 'policy.phase5.release_package_fingerprint', issues, HASH),
  };

  const identitiesRoot = objectAt(root.identities, 'policy.identities', issues);
  exactKeys(identitiesRoot, [
    'trust_authority', 'authority_credential_sha256', 'assessor', 'assessor_credential_sha256',
  ], 'policy.identities', issues);
  const identities = {
    trust_authority: safeString(identitiesRoot.trust_authority, 'policy.identities.trust_authority', issues, ACTOR, 128),
    authority_credential_sha256: safeString(identitiesRoot.authority_credential_sha256, 'policy.identities.authority_credential_sha256', issues, HASH),
    assessor: safeString(identitiesRoot.assessor, 'policy.identities.assessor', issues, ACTOR, 128),
    assessor_credential_sha256: safeString(identitiesRoot.assessor_credential_sha256, 'policy.identities.assessor_credential_sha256', issues, HASH),
  };
  if (identities.authority_credential_sha256 === identities.assessor_credential_sha256) {
    issues.push('Phase 6 credentials must be different');
  }

  const issuersRoot = objectAt(root.issuers, 'policy.issuers', issues);
  exactKeys(issuersRoot, PHASE6_ISSUER_ROLES, 'policy.issuers', issues);
  const issuers = Object.fromEntries(
    PHASE6_ISSUER_ROLES.map((role) => [role, issuerAt(issuersRoot[role], role, issues)]),
  ) as Record<ExternalEvidenceIssuerRole, ExternalEvidenceIssuer>;
  const issuerIds = PHASE6_ISSUER_ROLES.map((role) => issuers[role].issuer_id).filter(Boolean);
  const keyIds = PHASE6_ISSUER_ROLES.map((role) => issuers[role].key_id).filter(Boolean);
  const keyFingerprints = PHASE6_ISSUER_ROLES.map((role) => issuers[role].public_key_sha256).filter(Boolean);
  if (new Set(issuerIds).size !== issuerIds.length) issues.push('Phase 6 issuer IDs must be unique');
  if (new Set(keyIds).size !== keyIds.length) issues.push('Phase 6 key IDs must be unique');
  if (new Set(keyFingerprints).size !== keyFingerprints.length) issues.push('Phase 6 issuer public keys must be unique');

  const limitsRoot = objectAt(root.limits, 'policy.limits', issues);
  exactKeys(limitsRoot, [
    'max_clock_skew_seconds', 'max_attestation_age_hours', 'max_attestation_validity_hours',
  ], 'policy.limits', issues);
  const limits = {
    max_clock_skew_seconds: integer(limitsRoot.max_clock_skew_seconds, 'policy.limits.max_clock_skew_seconds', issues, 0, 300),
    max_attestation_age_hours: integer(limitsRoot.max_attestation_age_hours, 'policy.limits.max_attestation_age_hours', issues, 1, 168),
    max_attestation_validity_hours: integer(limitsRoot.max_attestation_validity_hours, 'policy.limits.max_attestation_validity_hours', issues, 1, 168),
  };

  const safetyRoot = objectAt(root.safety, 'policy.safety', issues);
  exactKeys(safetyRoot, [
    'evidence_matrix_version', 'require_all_eight', 'reject_unknown_issuer',
    'reject_replay_and_non_monotonic_statements', 'release_authority_not_granted',
    'production_adapter_registry_must_remain_empty', 'waivers_allowed',
  ], 'policy.safety', issues);
  if (safetyRoot.evidence_matrix_version !== 'phase6-eight-blockers-v1') issues.push('policy.safety.evidence_matrix_version is invalid');
  for (const key of [
    'require_all_eight', 'reject_unknown_issuer', 'reject_replay_and_non_monotonic_statements',
    'release_authority_not_granted', 'production_adapter_registry_must_remain_empty',
  ] as const) if (safetyRoot[key] !== true) issues.push(`policy.safety.${key} must equal true`);
  if (safetyRoot.waivers_allowed !== false) issues.push('policy.safety.waivers_allowed must equal false');
  const safety = {
    evidence_matrix_version: 'phase6-eight-blockers-v1' as const,
    require_all_eight: true as const,
    reject_unknown_issuer: true as const,
    reject_replay_and_non_monotonic_statements: true as const,
    release_authority_not_granted: true as const,
    production_adapter_registry_must_remain_empty: true as const,
    waivers_allowed: false as const,
  };

  const value: ExternalEvidencePolicyManifest = {
    schema_version: PHASE6_EXTERNAL_EVIDENCE_POLICY_SCHEMA,
    policy_id: safeString(root.policy_id, 'policy.policy_id', issues, /^P6-[A-Za-z0-9._-]{4,64}$/),
    status: 'accepted',
    admission_mode: 'local_trust_bridge',
    environment: root.environment === 'production' ? 'production' : 'test',
    approved_by: safeString(root.approved_by, 'policy.approved_by', issues, ACTOR, 128),
    approved_at: approvedAt,
    valid_from: validFrom,
    valid_until: validUntil,
    tenant_id: safeString(root.tenant_id, 'policy.tenant_id', issues, UUID),
    source_connection_id: safeString(root.source_connection_id, 'policy.source_connection_id', issues, UUID),
    phase5: phase5Binding,
    identities,
    issuers,
    limits,
    safety,
    verdict: 'accepted',
  };
  if (value.approved_by && identities.trust_authority && value.approved_by !== identities.trust_authority) {
    issues.push('policy.approved_by must equal trust_authority');
  }

  if (phase5) {
    if (phase5.policy_id !== value.phase5.policy_id) issues.push('policy Phase 5 ID does not match');
    if (evidenceFingerprint(phase5) !== value.phase5.policy_fingerprint) issues.push('policy Phase 5 fingerprint does not match');
    if (phase5.environment !== value.environment) issues.push('policy environment does not match Phase 5');
    if (phase5.tenant_id !== value.tenant_id) issues.push('policy tenant does not match Phase 5');
    if (phase5.source_connection_id !== value.source_connection_id) issues.push('policy source does not match Phase 5');
    if (validFrom && Date.parse(validFrom) < Date.parse(phase5.valid_from)) issues.push('policy cannot start before Phase 5');
    if (validUntil && Date.parse(validUntil) > Date.parse(phase5.valid_until)) issues.push('policy cannot outlive Phase 5');
    const upstream = [
      phase5.identities.authority_credential_sha256,
      phase5.identities.assessor_credential_sha256,
      phase5.identities.reviewer_credential_sha256,
    ];
    if ([identities.authority_credential_sha256, identities.assessor_credential_sha256].some((item) => upstream.includes(item))) {
      issues.push('Phase 6 credentials must differ from every Phase 5 credential');
    }
  }
  if (g7) {
    const upstream = [
      g7.identities.release_credential_sha256,
      g7.identities.executor_credential_sha256,
      g7.identities.kill_switch_credential_sha256,
    ];
    if ([identities.authority_credential_sha256, identities.assessor_credential_sha256].some((item) => upstream.includes(item))) {
      issues.push('Phase 6 credentials must differ from every G7 credential');
    }
  }
  if (g6) {
    const upstream = [
      g6.target.command_credential_sha256,
      g6.identities.approval_credential_sha256,
      g6.identities.operator_credential_sha256,
    ];
    if ([identities.authority_credential_sha256, identities.assessor_credential_sha256].some((item) => upstream.includes(item))) {
      issues.push('Phase 6 credentials must differ from every G6 credential');
    }
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, issues: [], value, fingerprint: externalEvidencePolicyFingerprint(value) };
}

export function externalEvidenceCredentialFingerprint(secret: string): string {
  return credentialFingerprint(secret);
}
