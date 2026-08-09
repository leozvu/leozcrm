import type { Knex } from 'knex';
import {
  ActivationAdapterObservation,
  ActivationAdapterPreview,
  ActivationAdapterResult,
  ActivationAdapterRollback,
  ActivationExecutionAdapter,
  PHASE8_OBSERVATION_SCHEMA,
  PHASE8_PREVIEW_SCHEMA,
  PHASE8_RESULT_SCHEMA,
  PHASE8_ROLLBACK_SCHEMA,
  activationExecutionFingerprint,
} from '../../domain/activationExecution';
import {
  ActivationExecutionPolicyManifest,
  activationExecutionCredentialFingerprint,
} from '../../domain/activationExecutionPolicy';
import { activationCeremonyFingerprint } from '../../domain/activationCeremony';
import { ActivationExecutionAdapterRegistry } from '../../integrations/actions/activationExecutionAdapterRegistry';
import { ActivationExecutionRepository } from '../../repositories/activationExecutionRepository';
import { ActivationExecutionService } from '../../services/activationExecutionService';
import {
  PHASE7_AUTHORITY_CREDENTIAL,
  PHASE7_OPERATOR_CREDENTIAL,
  PHASE7_VERIFIER_CREDENTIAL,
  createActivationCeremonyScenario,
} from './activationCeremonyScenario';

export const PHASE8_RELEASE_CREDENTIAL = 'test-phase8-release-credential-0021';
export const PHASE8_EXECUTOR_CREDENTIAL = 'test-phase8-executor-credential-0022';
export const PHASE8_OBSERVER_CREDENTIAL = 'test-phase8-observer-credential-0023';
export const PHASE8_ROLLBACK_CREDENTIAL = 'test-phase8-rollback-credential-0024';

export class DeterministicActivationAdapter implements ActivationExecutionAdapter {
  readonly calls = { preview: 0, activate: 0, observe: 0, rollback: 0 };
  activateMode: 'succeeded' | 'failed' | 'throw' = 'succeeded';
  observationMode: 'healthy' | 'unhealthy' | 'throw' = 'healthy';
  rollbackMode: 'succeeded' | 'failed' | 'throw' = 'succeeded';
  activationGate: Promise<void> | null = null;
  onActivate: (() => void) | null = null;

  constructor(
    readonly descriptor: ActivationExecutionAdapter['descriptor'],
    private readonly policy: ActivationExecutionPolicyManifest,
  ) {}

  async preview(input: { previewKey: string; requestedAt: string }): Promise<ActivationAdapterPreview> {
    this.calls.preview += 1;
    return {
      schema_version: PHASE8_PREVIEW_SCHEMA,
      policy_id: this.policy.policy_id,
      handoff_fingerprint: this.policy.phase7.handoff_fingerprint,
      target_fingerprint: this.policy.target.target_fingerprint,
      mutation_count: 0,
      readiness_fingerprint: activationExecutionFingerprint({ preview: input.previewKey }),
      summary_code: 'exact_target_ready',
      generated_at: input.requestedAt,
      expires_at: new Date(Date.parse(input.requestedAt) + 10 * 60_000).toISOString(),
    };
  }

  async activate(input: { activationIdempotencyKey: string; requestedAt: string }): Promise<ActivationAdapterResult> {
    this.calls.activate += 1;
    this.onActivate?.();
    if (this.activationGate) await this.activationGate;
    if (this.activateMode === 'throw') throw new Error('simulated lost activation response');
    const succeeded = this.activateMode === 'succeeded';
    return {
      schema_version: PHASE8_RESULT_SCHEMA,
      policy_id: this.policy.policy_id,
      handoff_fingerprint: this.policy.phase7.handoff_fingerprint,
      target_fingerprint: this.policy.target.target_fingerprint,
      activation_idempotency_key: input.activationIdempotencyKey,
      outcome: this.activateMode,
      mutation_count: succeeded ? 1 : 0,
      provider_receipt_fingerprint: succeeded ? activationExecutionFingerprint({ receipt: input.activationIdempotencyKey }) : null,
      external_state_fingerprint: succeeded ? activationExecutionFingerprint({ state: 'activated' }) : null,
      result_code: succeeded ? 'activation_confirmed' : 'activation_rejected_before_mutation',
      completed_at: input.requestedAt,
    };
  }

  async observe(input: { activation: ActivationAdapterResult; requestedAt: string }): Promise<ActivationAdapterObservation> {
    this.calls.observe += 1;
    if (this.observationMode === 'throw') throw new Error('simulated lost observation response');
    const healthy = this.observationMode === 'healthy';
    return {
      schema_version: PHASE8_OBSERVATION_SCHEMA,
      policy_id: this.policy.policy_id,
      target_fingerprint: this.policy.target.target_fingerprint,
      provider_receipt_fingerprint: input.activation.provider_receipt_fingerprint!,
      verdict: this.observationMode,
      metric_fingerprint: healthy
        ? this.policy.canary.success_metric_fingerprint
        : this.policy.canary.abort_metric_fingerprint,
      external_state_fingerprint: activationExecutionFingerprint({ state: healthy ? 'healthy' : 'unhealthy' }),
      result_code: healthy ? 'canary_healthy' : 'canary_abort_threshold_reached',
      observed_at: input.requestedAt,
    };
  }

  async rollback(input: { activation: ActivationAdapterResult; rollbackKey: string; requestedAt: string }): Promise<ActivationAdapterRollback> {
    this.calls.rollback += 1;
    if (this.rollbackMode === 'throw') throw new Error('simulated lost rollback response');
    const succeeded = this.rollbackMode === 'succeeded';
    return {
      schema_version: PHASE8_ROLLBACK_SCHEMA,
      policy_id: this.policy.policy_id,
      target_fingerprint: this.policy.target.target_fingerprint,
      activation_receipt_fingerprint: input.activation.provider_receipt_fingerprint!,
      rollback_idempotency_key: input.rollbackKey,
      outcome: this.rollbackMode,
      mutation_count: succeeded ? 1 : 0,
      rollback_receipt_fingerprint: succeeded ? activationExecutionFingerprint({ rollback: input.rollbackKey }) : null,
      restored_state_fingerprint: succeeded ? activationExecutionFingerprint({ state: 'restored' }) : null,
      result_code: succeeded ? 'rollback_confirmed' : 'rollback_rejected_before_mutation',
      completed_at: input.requestedAt,
    };
  }
}

export async function createActivationExecutionScenario(
  db: Knex,
  name: string,
  options: { acceptPolicy?: boolean } = {},
) {
  const ceremony = await createActivationCeremonyScenario(db, `p8-${name}`);
  const approved = await ceremony.createApprovedDossier();
  const handoff = await ceremony.service.sealHandoff({
    policyId: ceremony.policy.policy_id,
    dossierKey: approved.dossierKey,
    handoffKey: `phase8:${name}:handoff:0001`,
    actor: 'Leoz',
    operatorCredential: PHASE7_OPERATOR_CREDENTIAL,
  });
  const policy: ActivationExecutionPolicyManifest = {
    schema_version: 'leozops_phase8_activation_execution_policy_v1',
    policy_id: `P8-${name}`,
    status: 'accepted',
    execution_mode: 'controlled_single_activation',
    environment: 'test',
    approved_by: 'Leoz',
    approved_at: '2026-08-17T14:05:00.000Z',
    valid_from: '2026-08-17T14:05:00.000Z',
    valid_until: '2026-08-18T10:00:00.000Z',
    tenant_id: ceremony.policy.tenant_id,
    source_connection_id: ceremony.policy.source_connection_id,
    phase7: {
      policy_id: ceremony.policy.policy_id,
      policy_fingerprint: activationCeremonyFingerprint(ceremony.policy),
      handoff_fingerprint: handoff.handoff_fingerprint,
      dossier_fingerprint: approved.dossier.dossier_fingerprint,
      verification_fingerprint: approved.verification.verification_fingerprint,
      phase6_evidence_set_fingerprint: handoff.phase6_evidence_set_fingerprint,
    },
    identities: {
      release_authority: 'Leoz',
      release_credential_sha256: activationExecutionCredentialFingerprint(PHASE8_RELEASE_CREDENTIAL),
      executor: 'Leoz',
      executor_credential_sha256: activationExecutionCredentialFingerprint(PHASE8_EXECUTOR_CREDENTIAL),
      safety_observer: 'Leoz',
      observer_credential_sha256: activationExecutionCredentialFingerprint(PHASE8_OBSERVER_CREDENTIAL),
      rollback_operator: 'Leoz',
      rollback_credential_sha256: activationExecutionCredentialFingerprint(PHASE8_ROLLBACK_CREDENTIAL),
    },
    target: {
      deployment_id: ceremony.policy.target.deployment_id,
      target_fingerprint: ceremony.policy.target.target_fingerprint,
      target_contract_fingerprint: activationCeremonyFingerprint(ceremony.policy.target),
      adapter_id: ceremony.policy.target.adapter_id,
      adapter_version: ceremony.policy.target.adapter_version,
      adapter_artifact_digest: ceremony.policy.target.adapter_artifact_digest,
      configuration_digest: ceremony.policy.target.configuration_digest,
      credential_reference_sha256: ceremony.policy.target.credential_reference_sha256,
    },
    canary: {
      contract_fingerprint: activationCeremonyFingerprint(ceremony.policy.canary),
      cohort_size: 1,
      max_activation_mutations: 1,
      observation_minutes: ceremony.policy.canary.observation_minutes,
      success_metric_fingerprint: ceremony.policy.canary.success_metric_fingerprint,
      abort_metric_fingerprint: ceremony.policy.canary.abort_metric_fingerprint,
    },
    rollback: {
      contract_fingerprint: activationCeremonyFingerprint(ceremony.policy.rollback),
      rollback_artifact_digest: ceremony.policy.rollback.rollback_artifact_digest,
      procedure_digest: ceremony.policy.rollback.procedure_digest,
      max_recovery_minutes: ceremony.policy.rollback.max_recovery_minutes,
      max_rollback_mutations: 1,
    },
    limits: {
      release_validity_minutes: 5,
      claim_lease_seconds: 30,
      observation_deadline_minutes: 60,
      rollback_window_minutes: 120,
    },
    safety: {
      kill_switch_starts_engaged: true,
      dual_credential_release_required: true,
      source_idempotency_required: true,
      automatic_retry_forbidden: true,
      automatic_rollback_forbidden: true,
      production_adapter_registry_empty_by_default: true,
      waivers_allowed: false,
    },
    verdict: 'accepted',
  };
  const adapter = new DeterministicActivationAdapter({
    environment: policy.environment,
    adapter_id: policy.target.adapter_id,
    adapter_version: policy.target.adapter_version,
    target_fingerprint: policy.target.target_fingerprint,
    adapter_artifact_digest: policy.target.adapter_artifact_digest,
    configuration_digest: policy.target.configuration_digest,
    credential_reference_sha256: policy.target.credential_reference_sha256,
    supports_idempotency: true,
    supports_observation: true,
    supports_rollback: true,
  }, policy);
  const registry = new ActivationExecutionAdapterRegistry([adapter]);
  const repository = new ActivationExecutionRepository(db);
  const service = new ActivationExecutionService(
    repository,
    ceremony.service,
    registry,
    () => new Date(ceremony.external.assurance.bounded.supervised.clock.now),
  );
  const policyRecord = options.acceptPolicy === false
    ? null
    : await service.acceptPolicy(policy, PHASE8_RELEASE_CREDENTIAL);

  async function previewAndRelease() {
    const preview = await service.preview({
      policyId: policy.policy_id,
      previewKey: `phase8:${name}:preview:0001`,
      actor: 'Leoz',
      executorCredential: PHASE8_EXECUTOR_CREDENTIAL,
    });
    const release = await service.release({
      policyId: policy.policy_id,
      releaseKey: `phase8:${name}:release:0001`,
      reasonCode: 'controlled_single_activation_approved',
      releaseActor: 'Leoz',
      releaseCredential: PHASE8_RELEASE_CREDENTIAL,
      observerActor: 'Leoz',
      observerCredential: PHASE8_OBSERVER_CREDENTIAL,
    });
    return { preview, release };
  }

  async function activate() {
    return service.activate({
      policyId: policy.policy_id,
      activationKey: `phase8:${name}:activation:0001`,
      actor: 'Leoz',
      executorCredential: PHASE8_EXECUTOR_CREDENTIAL,
    });
  }

  return {
    ceremony,
    approved,
    handoff,
    policy,
    adapter,
    registry,
    repository,
    service,
    policyRecord,
    previewAndRelease,
    activate,
    upstreamCredentials: [
      PHASE7_AUTHORITY_CREDENTIAL,
      PHASE7_VERIFIER_CREDENTIAL,
      PHASE7_OPERATOR_CREDENTIAL,
    ],
  };
}
