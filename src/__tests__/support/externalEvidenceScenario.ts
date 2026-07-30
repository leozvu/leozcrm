import { generateKeyPairSync, KeyObject, sign } from 'node:crypto';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { canonicalStringify } from '../../domain/businessMemory';
import {
  ExternalEvidenceAttestation,
  ExternalEvidenceEnvelope,
  externalEvidenceFingerprint,
} from '../../domain/externalEvidence';
import {
  ExternalEvidenceIssuerRole,
  ExternalEvidencePolicyManifest,
  ExternalEvidenceType,
  PHASE6_EVIDENCE_MATRIX,
  PHASE6_ISSUER_ROLES,
  externalPublicKeyFingerprint,
} from '../../domain/externalEvidencePolicy';
import { credentialFingerprint } from '../../domain/g6Policy';
import { ActionAdapterRegistry } from '../../integrations/actions/actionAdapterRegistry';
import { ExternalEvidenceRepository } from '../../repositories/externalEvidenceRepository';
import { ExternalEvidenceService } from '../../services/externalEvidenceService';
import {
  PHASE5_ASSESSOR_CREDENTIAL,
  PHASE5_REVIEWER_CREDENTIAL,
  createOperationalAssuranceScenario,
  preparePassingAssuranceEvidence,
} from './operationalAssuranceScenario';

export const PHASE6_AUTHORITY_CREDENTIAL = 'test-phase6-authority-credential-0010';
export const PHASE6_ASSESSOR_CREDENTIAL = 'test-phase6-assessor-credential-0011';

export interface ExternalEvidenceSigningOptions {
  attestationId?: string;
  statement?: 'pass' | 'revoke';
  supersedesAttestationId?: string | null;
  issuedAt?: string;
  expiresAt?: string;
  observedFrom?: string;
  observedUntil?: string;
  nonce?: string;
  issuerRole?: ExternalEvidenceIssuerRole;
  issuerId?: string;
  keyId?: string;
  privateKey?: KeyObject;
  policyId?: string;
  tenantId?: string;
  sourceConnectionId?: string;
  packageFingerprint?: string;
}

export async function createExternalEvidenceScenario(
  db: Knex,
  name: string,
  options: { acceptPolicy?: boolean } = {},
) {
  const assurance = await createOperationalAssuranceScenario(db, `p6-${name}`);
  await preparePassingAssuranceEvidence(assurance);
  const phase5Assessment = await assurance.service.assess({
    policyId: assurance.policy.policy_id,
    assessmentKey: `phase6:${name}:phase5-assessment:0001`,
    actor: 'Leoz',
    assessorCredential: PHASE5_ASSESSOR_CREDENTIAL,
  });
  const phase5Package = await assurance.service.createReleasePackage({
    policyId: assurance.policy.policy_id,
    assessmentKey: phase5Assessment.assessment_key,
    packageKey: `phase6:${name}:phase5-package:0001`,
    actor: 'Leoz',
    reviewerCredential: PHASE5_REVIEWER_CREDENTIAL,
  });
  const keys = Object.fromEntries(PHASE6_ISSUER_ROLES.map((role) => {
    const pair = generateKeyPairSync('ed25519');
    return [role, pair];
  })) as Record<ExternalEvidenceIssuerRole, { publicKey: KeyObject; privateKey: KeyObject }>;
  const policy: ExternalEvidencePolicyManifest = {
    schema_version: 'leozops_phase6_external_evidence_policy_v1',
    policy_id: `P6-${name}`,
    status: 'accepted',
    admission_mode: 'local_trust_bridge',
    environment: 'test',
    approved_by: 'Leoz',
    approved_at: '2026-08-17T14:05:00.000Z',
    valid_from: '2026-08-17T14:05:00.000Z',
    valid_until: '2026-08-18T12:00:00.000Z',
    tenant_id: assurance.policy.tenant_id,
    source_connection_id: assurance.policy.source_connection_id,
    phase5: {
      policy_id: assurance.policy.policy_id,
      policy_fingerprint: assurance.policyRecord!.policy_fingerprint,
      assessment_fingerprint: phase5Assessment.assessment_fingerprint,
      release_package_fingerprint: phase5Package.package_fingerprint,
    },
    identities: {
      trust_authority: 'Leoz',
      authority_credential_sha256: credentialFingerprint(PHASE6_AUTHORITY_CREDENTIAL),
      assessor: 'Leoz',
      assessor_credential_sha256: credentialFingerprint(PHASE6_ASSESSOR_CREDENTIAL),
    },
    issuers: Object.fromEntries(PHASE6_ISSUER_ROLES.map((role) => {
      const pem = keys[role].publicKey.export({ type: 'spki', format: 'pem' }).toString();
      return [role, {
        issuer_id: `phase6-${role}-issuer`,
        key_id: `phase6-${role}-key-2026-01`,
        algorithm: 'ed25519',
        public_key_pem: pem,
        public_key_sha256: externalPublicKeyFingerprint(pem),
      }];
    })) as ExternalEvidencePolicyManifest['issuers'],
    limits: {
      max_clock_skew_seconds: 300,
      max_attestation_age_hours: 168,
      max_attestation_validity_hours: 168,
    },
    safety: {
      evidence_matrix_version: 'phase6-eight-blockers-v1',
      require_all_eight: true,
      reject_unknown_issuer: true,
      reject_replay_and_non_monotonic_statements: true,
      release_authority_not_granted: true,
      production_adapter_registry_must_remain_empty: true,
      waivers_allowed: false,
    },
    verdict: 'accepted',
  };
  const repository = new ExternalEvidenceRepository(db);
  const service = new ExternalEvidenceService(
    repository,
    new ActionAdapterRegistry(),
    () => new Date(assurance.bounded.supervised.clock.now),
  );
  const policyRecord = options.acceptPolicy === false
    ? null
    : await service.acceptPolicy(policy, PHASE6_AUTHORITY_CREDENTIAL);

  function signAttestation(type: ExternalEvidenceType, input: ExternalEvidenceSigningOptions = {}): ExternalEvidenceEnvelope {
    const matrix = PHASE6_EVIDENCE_MATRIX.find((item) => item.evidence_type === type)!;
    const role = input.issuerRole ?? matrix.issuer_role;
    const attestation: ExternalEvidenceAttestation = {
      schema_version: 'leozops_phase6_external_attestation_v1',
      attestation_id: input.attestationId ?? uuidv4(),
      policy_id: input.policyId ?? policy.policy_id,
      environment: policy.environment,
      tenant_id: input.tenantId ?? policy.tenant_id,
      source_connection_id: input.sourceConnectionId ?? policy.source_connection_id,
      phase5_release_package_fingerprint: input.packageFingerprint ?? policy.phase5.release_package_fingerprint,
      evidence_type: type,
      statement: input.statement ?? 'pass',
      supersedes_attestation_id: input.supersedesAttestationId ?? null,
      issuer: {
        role,
        issuer_id: input.issuerId ?? policy.issuers[role].issuer_id,
        key_id: input.keyId ?? policy.issuers[role].key_id,
        algorithm: 'ed25519',
      },
      subject: {
        system: 'leozops',
        deployment_id: `deployment-${name}`,
        target_fingerprint: externalEvidenceFingerprint({ target: name }),
      },
      evidence_digest: externalEvidenceFingerprint({ evidence: type, scenario: name }),
      observed_from: input.observedFrom ?? '2026-08-17T13:00:00.000Z',
      observed_until: input.observedUntil ?? '2026-08-17T14:04:00.000Z',
      issued_at: input.issuedAt ?? '2026-08-17T14:05:00.000Z',
      expires_at: input.expiresAt ?? '2026-08-18T11:00:00.000Z',
      nonce: input.nonce ?? `nonce:${name}:${type}:${uuidv4()}`,
    };
    const signature = sign(
      null,
      Buffer.from(canonicalStringify(attestation)),
      input.privateKey ?? keys[role].privateKey,
    ).toString('base64');
    return { attestation, signature: { algorithm: 'ed25519', value_base64: signature } };
  }

  return {
    assurance,
    phase5Assessment,
    phase5Package,
    policy,
    keys,
    repository,
    service,
    policyRecord,
    signAttestation,
  };
}
