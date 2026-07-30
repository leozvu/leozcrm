import { timingSafeEqual, verify } from 'node:crypto';
import { canonicalStringify } from './businessMemory';
import { credentialFingerprint } from './g6Policy';
import { evidenceFingerprint } from './phase2Proof';
import {
  ExternalEvidenceIssuerRole,
  ExternalEvidencePolicyManifest,
  ExternalEvidenceType,
  PHASE6_EVIDENCE_MATRIX,
  PHASE6_ISSUER_ROLES,
} from './externalEvidencePolicy';

export const PHASE6_EXTERNAL_ATTESTATION_SCHEMA = 'leozops_phase6_external_attestation_v1' as const;

export const PHASE6_TABLES = {
  policies: 'external_evidence_policies',
  attestations: 'external_evidence_attestations',
  assessments: 'external_evidence_assessments',
  events: 'external_evidence_events',
} as const;

export type ExternalEvidenceStatement = 'pass' | 'revoke';
export type ExternalEvidenceAssessmentStatus = 'incomplete' | 'complete_unreleased';
export type ExternalEvidenceReleaseStatus = 'blocked_external_activation';
export type ExternalEvidenceEventType =
  | 'policy_accepted'
  | 'attestation_admitted'
  | 'attestation_revoked'
  | 'assessment_incomplete'
  | 'assessment_complete_unreleased';

export interface ExternalEvidenceAttestation {
  schema_version: typeof PHASE6_EXTERNAL_ATTESTATION_SCHEMA;
  attestation_id: string;
  policy_id: string;
  environment: 'test' | 'production';
  tenant_id: string;
  source_connection_id: string;
  phase5_release_package_fingerprint: string;
  evidence_type: ExternalEvidenceType;
  statement: ExternalEvidenceStatement;
  supersedes_attestation_id: string | null;
  issuer: {
    role: ExternalEvidenceIssuerRole;
    issuer_id: string;
    key_id: string;
    algorithm: 'ed25519';
  };
  subject: {
    system: 'leozops';
    deployment_id: string;
    target_fingerprint: string;
  };
  evidence_digest: string;
  observed_from: string;
  observed_until: string;
  issued_at: string;
  expires_at: string;
  nonce: string;
}

export interface ExternalEvidenceEnvelope {
  attestation: ExternalEvidenceAttestation;
  signature: {
    algorithm: 'ed25519';
    value_base64: string;
  };
}

export interface ExternalEvidencePolicyRecord {
  id: string;
  tenant_id: string;
  source_connection_id: string;
  phase5_policy_record_id: string;
  policy_id: string;
  environment: 'test' | 'production';
  phase5_policy_fingerprint: string;
  phase5_assessment_fingerprint: string;
  phase5_release_package_fingerprint: string;
  valid_from: string;
  valid_until: string;
  policy_fingerprint: string;
  manifest_json: string;
  accepted_at: string;
  created_at: string;
}

export interface ExternalEvidenceAttestationRecord {
  id: string;
  tenant_id: string;
  policy_record_id: string;
  attestation_id: string;
  evidence_type: ExternalEvidenceType;
  statement: ExternalEvidenceStatement;
  supersedes_attestation_id: string | null;
  issuer_role: ExternalEvidenceIssuerRole;
  issuer_id: string;
  key_id: string;
  nonce: string;
  issued_at: string;
  expires_at: string;
  envelope_json: string;
  envelope_fingerprint: string;
  admitted_by: string;
  admitted_at: string;
  created_at: string;
}

export interface ExternalEvidenceMatrixRow {
  evidence_type: ExternalEvidenceType;
  blocker_code: string;
  issuer_role: ExternalEvidenceIssuerRole;
  status: 'satisfied' | 'missing' | 'revoked' | 'expired';
  attestation_id: string | null;
  envelope_fingerprint: string | null;
}

export interface ExternalEvidenceAssessmentRecord {
  id: string;
  tenant_id: string;
  policy_record_id: string;
  assessment_key: string;
  policy_fingerprint: string;
  phase5_release_package_fingerprint: string;
  matrix_json: string;
  matrix_fingerprint: string;
  status: ExternalEvidenceAssessmentStatus;
  release_status: ExternalEvidenceReleaseStatus;
  assessed_by: string;
  assessed_at: string;
  assessment_fingerprint: string;
  created_at: string;
}

export interface ExternalEvidenceEventRecord {
  id: string;
  tenant_id: string;
  policy_record_id: string;
  sequence: number;
  event_type: ExternalEvidenceEventType;
  actor: string;
  evidence_fingerprint: string;
  reason_code: string;
  occurred_at: string;
  event_fingerprint: string;
  created_at: string;
}

export interface ExternalEvidenceEnvelopeValidation {
  ok: boolean;
  issues: string[];
  value?: ExternalEvidenceEnvelope;
  fingerprint?: string;
}

export class ExternalEvidenceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 409) {
    super(message);
    this.name = 'ExternalEvidenceError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^sha256:[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{1,191}$/;
const NONCE = /^[A-Za-z0-9][A-Za-z0-9._:/+=-]{15,191}$/;
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
  const allowed = new Set(expected);
  for (const key of Object.keys(value)) if (!allowed.has(key)) issues.push(`${path}.${key} is not allowed`);
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

function nullableUuid(value: unknown, path: string, issues: string[]): string | null {
  if (value === null) return null;
  return safeString(value, path, issues, UUID);
}

function evidenceType(value: unknown, path: string, issues: string[]): ExternalEvidenceType {
  const type = PHASE6_EVIDENCE_MATRIX.find((item) => item.evidence_type === value)?.evidence_type;
  if (!type) issues.push(`${path} is not in the fixed Phase 6 evidence matrix`);
  return type ?? PHASE6_EVIDENCE_MATRIX[0].evidence_type;
}

function issuerRole(value: unknown, path: string, issues: string[]): ExternalEvidenceIssuerRole {
  const role = PHASE6_ISSUER_ROLES.find((item) => item === value);
  if (!role) issues.push(`${path} is not a Phase 6 issuer role`);
  return role ?? PHASE6_ISSUER_ROLES[0];
}

export function externalEvidenceFingerprint(value: unknown): string {
  return evidenceFingerprint(value);
}

export function externalEvidencePolicyIsActive(policy: ExternalEvidencePolicyManifest, at: string): boolean {
  const instant = Date.parse(at);
  return Number.isFinite(instant) && instant >= Date.parse(policy.valid_from) && instant < Date.parse(policy.valid_until);
}

export function externalEvidenceCredentialMatches(secret: string, expected: string): boolean {
  let actual: string;
  try {
    actual = credentialFingerprint(secret);
  } catch {
    return false;
  }
  if (!HASH.test(expected) || actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export function validateExternalEvidenceEnvelope(
  input: unknown,
  policy?: ExternalEvidencePolicyManifest,
): ExternalEvidenceEnvelopeValidation {
  const issues: string[] = [];
  const root = objectAt(input, 'envelope', issues);
  exactKeys(root, ['attestation', 'signature'], 'envelope', issues);
  const attestationRoot = objectAt(root.attestation, 'envelope.attestation', issues);
  exactKeys(attestationRoot, [
    'schema_version', 'attestation_id', 'policy_id', 'environment', 'tenant_id',
    'source_connection_id', 'phase5_release_package_fingerprint', 'evidence_type',
    'statement', 'supersedes_attestation_id', 'issuer', 'subject', 'evidence_digest',
    'observed_from', 'observed_until', 'issued_at', 'expires_at', 'nonce',
  ], 'envelope.attestation', issues);
  if (attestationRoot.schema_version !== PHASE6_EXTERNAL_ATTESTATION_SCHEMA) {
    issues.push(`envelope.attestation.schema_version must equal ${PHASE6_EXTERNAL_ATTESTATION_SCHEMA}`);
  }
  if (attestationRoot.environment !== 'test' && attestationRoot.environment !== 'production') {
    issues.push('envelope.attestation.environment must equal test or production');
  }
  if (attestationRoot.statement !== 'pass' && attestationRoot.statement !== 'revoke') {
    issues.push('envelope.attestation.statement must equal pass or revoke');
  }
  const issuerRoot = objectAt(attestationRoot.issuer, 'envelope.attestation.issuer', issues);
  exactKeys(issuerRoot, ['role', 'issuer_id', 'key_id', 'algorithm'], 'envelope.attestation.issuer', issues);
  if (issuerRoot.algorithm !== 'ed25519') issues.push('envelope.attestation.issuer.algorithm must equal ed25519');
  const subjectRoot = objectAt(attestationRoot.subject, 'envelope.attestation.subject', issues);
  exactKeys(subjectRoot, ['system', 'deployment_id', 'target_fingerprint'], 'envelope.attestation.subject', issues);
  if (subjectRoot.system !== 'leozops') issues.push('envelope.attestation.subject.system must equal leozops');

  const observedFrom = timestamp(attestationRoot.observed_from, 'envelope.attestation.observed_from', issues);
  const observedUntil = timestamp(attestationRoot.observed_until, 'envelope.attestation.observed_until', issues);
  const issuedAt = timestamp(attestationRoot.issued_at, 'envelope.attestation.issued_at', issues);
  const expiresAt = timestamp(attestationRoot.expires_at, 'envelope.attestation.expires_at', issues);
  if (observedFrom && observedUntil && Date.parse(observedUntil) < Date.parse(observedFrom)) {
    issues.push('attestation observed_until cannot precede observed_from');
  }
  if (observedUntil && issuedAt && Date.parse(issuedAt) < Date.parse(observedUntil)) {
    issues.push('attestation issued_at cannot precede observed_until');
  }
  if (issuedAt && expiresAt && Date.parse(expiresAt) <= Date.parse(issuedAt)) {
    issues.push('attestation expires_at must follow issued_at');
  }

  const type = evidenceType(attestationRoot.evidence_type, 'envelope.attestation.evidence_type', issues);
  const role = issuerRole(issuerRoot.role, 'envelope.attestation.issuer.role', issues);
  const statement: ExternalEvidenceStatement = attestationRoot.statement === 'revoke' ? 'revoke' : 'pass';
  const supersedes = nullableUuid(attestationRoot.supersedes_attestation_id, 'envelope.attestation.supersedes_attestation_id', issues);
  if (statement === 'pass' && supersedes !== null) issues.push('pass attestation cannot supersede another attestation');
  if (statement === 'revoke' && supersedes === null) issues.push('revoke attestation must supersede an attestation');

  const attestation: ExternalEvidenceAttestation = {
    schema_version: PHASE6_EXTERNAL_ATTESTATION_SCHEMA,
    attestation_id: safeString(attestationRoot.attestation_id, 'envelope.attestation.attestation_id', issues, UUID),
    policy_id: safeString(attestationRoot.policy_id, 'envelope.attestation.policy_id', issues, /^P6-[A-Za-z0-9._-]{4,64}$/),
    environment: attestationRoot.environment === 'production' ? 'production' : 'test',
    tenant_id: safeString(attestationRoot.tenant_id, 'envelope.attestation.tenant_id', issues, UUID),
    source_connection_id: safeString(attestationRoot.source_connection_id, 'envelope.attestation.source_connection_id', issues, UUID),
    phase5_release_package_fingerprint: safeString(
      attestationRoot.phase5_release_package_fingerprint,
      'envelope.attestation.phase5_release_package_fingerprint',
      issues,
      HASH,
    ),
    evidence_type: type,
    statement,
    supersedes_attestation_id: supersedes,
    issuer: {
      role,
      issuer_id: safeString(issuerRoot.issuer_id, 'envelope.attestation.issuer.issuer_id', issues),
      key_id: safeString(issuerRoot.key_id, 'envelope.attestation.issuer.key_id', issues),
      algorithm: 'ed25519',
    },
    subject: {
      system: 'leozops',
      deployment_id: safeString(subjectRoot.deployment_id, 'envelope.attestation.subject.deployment_id', issues),
      target_fingerprint: safeString(subjectRoot.target_fingerprint, 'envelope.attestation.subject.target_fingerprint', issues, HASH),
    },
    evidence_digest: safeString(attestationRoot.evidence_digest, 'envelope.attestation.evidence_digest', issues, HASH),
    observed_from: observedFrom,
    observed_until: observedUntil,
    issued_at: issuedAt,
    expires_at: expiresAt,
    nonce: safeString(attestationRoot.nonce, 'envelope.attestation.nonce', issues, NONCE, 192),
  };

  const signatureRoot = objectAt(root.signature, 'envelope.signature', issues);
  exactKeys(signatureRoot, ['algorithm', 'value_base64'], 'envelope.signature', issues);
  if (signatureRoot.algorithm !== 'ed25519') issues.push('envelope.signature.algorithm must equal ed25519');
  let signature = '';
  if (typeof signatureRoot.value_base64 === 'string') {
    try {
      const decoded = Buffer.from(signatureRoot.value_base64, 'base64');
      if (decoded.length !== 64 || decoded.toString('base64') !== signatureRoot.value_base64) throw new Error('invalid signature');
      signature = signatureRoot.value_base64;
    } catch {
      issues.push('envelope.signature.value_base64 must be a canonical 64-byte signature');
    }
  } else {
    issues.push('envelope.signature.value_base64 must be a canonical 64-byte signature');
  }
  const envelope: ExternalEvidenceEnvelope = {
    attestation,
    signature: { algorithm: 'ed25519', value_base64: signature },
  };

  if (policy) {
    const matrix = PHASE6_EVIDENCE_MATRIX.find((item) => item.evidence_type === type)!;
    const pinned = policy.issuers[matrix.issuer_role];
    if (attestation.policy_id !== policy.policy_id) issues.push('attestation policy ID does not match');
    if (attestation.environment !== policy.environment) issues.push('attestation environment does not match');
    if (attestation.tenant_id !== policy.tenant_id) issues.push('attestation tenant does not match');
    if (attestation.source_connection_id !== policy.source_connection_id) issues.push('attestation source does not match');
    if (attestation.phase5_release_package_fingerprint !== policy.phase5.release_package_fingerprint) {
      issues.push('attestation Phase 5 package does not match');
    }
    if (role !== matrix.issuer_role) issues.push('attestation issuer role is not authorized for evidence type');
    if (attestation.issuer.issuer_id !== pinned.issuer_id || attestation.issuer.key_id !== pinned.key_id) {
      issues.push('attestation issuer identity is not pinned by policy');
    }
    if (issuedAt && expiresAt && Date.parse(expiresAt) - Date.parse(issuedAt) > policy.limits.max_attestation_validity_hours * 3_600_000) {
      issues.push('attestation validity exceeds policy limit');
    }
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, issues: [], value: envelope, fingerprint: externalEvidenceFingerprint(envelope) };
}

export function verifyExternalEvidenceEnvelope(
  envelope: ExternalEvidenceEnvelope,
  policy: ExternalEvidencePolicyManifest,
): boolean {
  const role = PHASE6_EVIDENCE_MATRIX.find((item) => item.evidence_type === envelope.attestation.evidence_type)!.issuer_role;
  try {
    return verify(
      null,
      Buffer.from(canonicalStringify(envelope.attestation)),
      policy.issuers[role].public_key_pem,
      Buffer.from(envelope.signature.value_base64, 'base64'),
    );
  } catch {
    return false;
  }
}
