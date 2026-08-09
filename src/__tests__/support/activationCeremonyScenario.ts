import type { Knex } from 'knex';
import { credentialFingerprint } from '../../domain/g6Policy';
import { externalEvidenceFingerprint } from '../../domain/externalEvidence';
import type { ActivationCeremonyPolicyManifest } from '../../domain/activationCeremonyPolicy';
import { PHASE6_EVIDENCE_MATRIX } from '../../domain/externalEvidencePolicy';
import { ActionAdapterRegistry } from '../../integrations/actions/actionAdapterRegistry';
import { ActivationCeremonyRepository } from '../../repositories/activationCeremonyRepository';
import { ExternalEvidenceRepository } from '../../repositories/externalEvidenceRepository';
import { ActivationCeremonyService } from '../../services/activationCeremonyService';
import { ExternalEvidenceService } from '../../services/externalEvidenceService';
import {
  PHASE6_ASSESSOR_CREDENTIAL,
  createExternalEvidenceScenario,
} from './externalEvidenceScenario';

export const PHASE7_AUTHORITY_CREDENTIAL = 'test-phase7-authority-credential-0012';
export const PHASE7_VERIFIER_CREDENTIAL = 'test-phase7-verifier-credential-0013';
export const PHASE7_OPERATOR_CREDENTIAL = 'test-phase7-operator-credential-0014';

export async function createActivationCeremonyScenario(
  db: Knex,
  name: string,
  options: { acceptPolicy?: boolean } = {},
) {
  const external = await createExternalEvidenceScenario(db, `p7-${name}`);
  for (const item of PHASE6_EVIDENCE_MATRIX) {
    await external.service.admit({
      policyId: external.policy.policy_id,
      envelope: external.signAttestation(item.evidence_type),
      actor: 'Leoz',
      assessorCredential: PHASE6_ASSESSOR_CREDENTIAL,
    });
  }
  const phase6Assessment = await external.service.assess({
    policyId: external.policy.policy_id,
    assessmentKey: `phase7:${name}:phase6-assessment:0001`,
    actor: 'Leoz',
    assessorCredential: PHASE6_ASSESSOR_CREDENTIAL,
  });
  const policy: ActivationCeremonyPolicyManifest = {
    schema_version: 'leozops_phase7_activation_ceremony_policy_v1',
    policy_id: `P7-${name}`,
    status: 'accepted',
    ceremony_mode: 'sealed_external_handoff',
    environment: 'test',
    approved_by: 'Leoz',
    approved_at: '2026-08-17T14:05:00.000Z',
    valid_from: '2026-08-17T14:05:00.000Z',
    valid_until: '2026-08-18T11:00:00.000Z',
    tenant_id: external.policy.tenant_id,
    source_connection_id: external.policy.source_connection_id,
    phase6: {
      policy_id: external.policy.policy_id,
      policy_fingerprint: external.policyRecord!.policy_fingerprint,
      assessment_fingerprint: phase6Assessment.assessment_fingerprint,
    },
    identities: {
      ceremony_authority: 'Leoz',
      authority_credential_sha256: credentialFingerprint(PHASE7_AUTHORITY_CREDENTIAL),
      independent_verifier: 'Leoz',
      verifier_credential_sha256: credentialFingerprint(PHASE7_VERIFIER_CREDENTIAL),
      activation_operator: 'Leoz',
      operator_credential_sha256: credentialFingerprint(PHASE7_OPERATOR_CREDENTIAL),
    },
    target: {
      deployment_id: `deployment-p7-${name}`,
      target_fingerprint: externalEvidenceFingerprint({ target: `p7-${name}` }),
      provider: 'local-rehearsal-provider',
      region: 'test-region-1',
      project_id: `project-${name}`,
      service_id: 'leozops-control-plane',
      adapter_id: 'egoric-command-adapter',
      adapter_version: '1.0.0',
      command_key: 'egoric.reengage-customer.v1',
      adapter_artifact_digest: externalEvidenceFingerprint({ artifact: name }),
      configuration_digest: externalEvidenceFingerprint({ configuration: name }),
      credential_reference_sha256: externalEvidenceFingerprint({ credentialReference: name }),
    },
    canary: {
      cohort_size: 1,
      max_mutations: 1,
      observation_minutes: 30,
      success_metric_fingerprint: externalEvidenceFingerprint({ success: name }),
      abort_metric_fingerprint: externalEvidenceFingerprint({ abort: name }),
      manual_start_required: true,
      manual_continue_required: true,
    },
    rollback: {
      rollback_artifact_digest: externalEvidenceFingerprint({ rollbackArtifact: name }),
      procedure_digest: externalEvidenceFingerprint({ rollbackProcedure: name }),
      max_recovery_minutes: 15,
      kill_switch_must_start_engaged: true,
      manual_recovery_only: true,
    },
    limits: {
      max_phase6_assessment_age_minutes: 30,
      max_verification_age_minutes: 15,
    },
    safety: {
      handoff_only: true,
      activation_executor_not_implemented: true,
      external_execution_requires_new_authority: true,
      production_adapter_registry_must_remain_empty: true,
      waivers_allowed: false,
    },
    verdict: 'accepted',
  };
  const registry = new ActionAdapterRegistry();
  const repository = new ActivationCeremonyRepository(db);
  const externalRepository = new ExternalEvidenceRepository(db);
  const phase6Service = new ExternalEvidenceService(
    externalRepository,
    registry,
    () => new Date(external.assurance.bounded.supervised.clock.now),
  );
  const service = new ActivationCeremonyService(
    repository,
    phase6Service,
    registry,
    () => new Date(external.assurance.bounded.supervised.clock.now),
  );
  const policyRecord = options.acceptPolicy === false
    ? null
    : await service.acceptPolicy(policy, PHASE7_AUTHORITY_CREDENTIAL);

  async function createApprovedDossier(suffix = '0001') {
    const dossierKey = `phase7:${name}:dossier:${suffix}`;
    const dossier = await service.createDossier({
      policyId: policy.policy_id,
      dossierKey,
      actor: 'Leoz',
      authorityCredential: PHASE7_AUTHORITY_CREDENTIAL,
    });
    const verification = await service.verifyDossier({
      policyId: policy.policy_id,
      dossierKey,
      verificationKey: `phase7:${name}:verification:${suffix}`,
      decision: 'approved',
      reasonCode: 'independent_verification_passed',
      actor: 'Leoz',
      verifierCredential: PHASE7_VERIFIER_CREDENTIAL,
    });
    return { dossierKey, dossier, verification };
  }

  return {
    external,
    phase6Assessment,
    policy,
    registry,
    repository,
    phase6Service,
    service,
    policyRecord,
    createApprovedDossier,
  };
}
