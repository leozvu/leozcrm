import {
  ActivationAdapterObservation,
  ActivationAdapterResult,
  ActivationAdapterRollback,
  ActivationExecutionError,
  PHASE8_OBSERVATION_SCHEMA,
  PHASE8_RESULT_SCHEMA,
  PHASE8_ROLLBACK_SCHEMA,
  activationExecutionCredentialMatches,
  activationExecutionPolicyIsActive,
  validateActivationAdapterDescriptor,
  validateActivationAdapterObservation,
  validateActivationAdapterResult,
  validateActivationAdapterRollback,
} from '../domain/activationExecution';
import {
  ActivationExecutionPolicyManifest,
  validateActivationExecutionPolicy,
} from '../domain/activationExecutionPolicy';
import { actionIdempotencyKey, actionIso } from '../domain/supervisedAction';
import { ActivationExecutionAdapterRegistry } from '../integrations/actions/activationExecutionAdapterRegistry';
import { ActivationExecutionRepository } from '../repositories/activationExecutionRepository';
import { ActivationCeremonyService } from './activationCeremonyService';

type FoundPolicy = Awaited<ReturnType<ActivationExecutionRepository['findPolicy']>>;

export class ActivationExecutionService {
  constructor(
    private readonly repository: ActivationExecutionRepository,
    private readonly phase7: ActivationCeremonyService,
    private readonly registry: ActivationExecutionAdapterRegistry,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async acceptPolicy(input: unknown, releaseCredential: string) {
    const initial = validateActivationExecutionPolicy(input);
    if (!initial.ok || !initial.value) {
      throw new ActivationExecutionError('invalid_activation_execution_policy', initial.issues.join('; '), 400);
    }
    const phase7 = await this.repository.findPhase7State(initial.value.phase7.policy_id);
    const validation = validateActivationExecutionPolicy(input, {
      phase7: phase7.found.manifest,
      handoff: phase7.handoff,
      phase6: phase7.found.phase6.manifest,
      phase5: phase7.found.phase6.phase5.manifest,
      g7: phase7.found.phase6.phase5.g7.manifest,
      g6: phase7.found.phase6.phase5.g7.g6.manifest,
    });
    if (!validation.ok || !validation.value) {
      throw new ActivationExecutionError('invalid_activation_execution_policy', validation.issues.join('; '), 400);
    }
    const policy = validation.value;
    this.assertActive(policy);
    this.assertIdentity(
      policy.identities.release_authority,
      policy.identities.release_credential_sha256,
      policy.approved_by,
      releaseCredential,
      'activation_release_authority',
    );
    await this.assertCurrentPhase7({ record: null, manifest: policy, phase7 });
    return this.repository.recordPolicy({ manifest: policy, phase7 });
  }

  async preview(input: {
    policyId: string;
    previewKey: string;
    actor: string;
    executorCredential: string;
  }) {
    const found = await this.repository.findPolicy(input.policyId);
    this.assertExecutor(found.manifest, input.actor, input.executorCredential);
    const previewKey = actionIdempotencyKey(input.previewKey);
    const existing = await this.repository.findPreviewIfExists(found.record.id, found.manifest);
    if (existing) {
      if (existing.record.preview_key !== previewKey) {
        throw new ActivationExecutionError('activation_preview_conflict', 'policy already has a different preview');
      }
      return existing.record;
    }
    const adapter = await this.assertCurrentPhase7(found);
    const requestedAt = actionIso(this.now());
    const preview = await adapter.preview({ policy: found.manifest, previewKey, requestedAt });
    return this.repository.recordPreview({
      policy: found.record,
      manifest: found.manifest,
      phase7: found.phase7,
      previewKey,
      preview,
      requestedBy: input.actor,
      recordedAt: requestedAt,
    });
  }

  async release(input: {
    policyId: string;
    releaseKey: string;
    reasonCode: string;
    releaseActor: string;
    releaseCredential: string;
    observerActor: string;
    observerCredential: string;
  }) {
    const found = await this.repository.findPolicy(input.policyId);
    this.assertReleaseAuthority(found.manifest, input.releaseActor, input.releaseCredential);
    this.assertObserver(found.manifest, input.observerActor, input.observerCredential);
    const releaseKey = actionIdempotencyKey(input.releaseKey);
    const existing = await this.repository.findReleaseIfExists(found.record.id);
    if (existing) {
      if (existing.release_key !== releaseKey || existing.reason_code !== input.reasonCode) {
        throw new ActivationExecutionError('activation_release_conflict', 'policy already has a different release');
      }
      return existing;
    }
    await this.assertCurrentPhase7(found);
    const preview = await this.repository.findPreview(found.record.id, found.manifest);
    const previewEvidence = preview.preview;
    const releasedAt = actionIso(this.now());
    if (Date.parse(previewEvidence.expires_at) <= Date.parse(releasedAt)) {
      throw new ActivationExecutionError('activation_preview_expired', 'zero-mutation preview has expired');
    }
    const expiresAt = new Date(Math.min(
      Date.parse(releasedAt) + found.manifest.limits.release_validity_minutes * 60_000,
      Date.parse(previewEvidence.expires_at),
      Date.parse(found.manifest.valid_until),
    )).toISOString();
    if (Date.parse(expiresAt) <= Date.parse(releasedAt)) {
      throw new ActivationExecutionError('activation_release_window_closed', 'activation release has no valid execution window');
    }
    return this.repository.recordRelease({
      policy: found.record,
      phase7: found.phase7,
      preview: preview.record,
      releaseKey,
      releasedBy: input.releaseActor,
      observedBy: input.observerActor,
      reasonCode: input.reasonCode,
      releasedAt,
      expiresAt,
    });
  }

  async activate(input: {
    policyId: string;
    activationKey: string;
    actor: string;
    executorCredential: string;
  }) {
    const found = await this.repository.findPolicy(input.policyId);
    this.assertExecutor(found.manifest, input.actor, input.executorCredential);
    const activationKey = actionIdempotencyKey(input.activationKey);
    const existingClaim = await this.repository.findClaimIfExists(found.record.id);
    if (existingClaim) {
      if (existingClaim.activation_key !== activationKey) {
        throw new ActivationExecutionError('activation_already_claimed', 'policy already consumed its single activation claim');
      }
      const existingOutcome = await this.repository.findOutcomeIfExists(found.record.id, found.manifest);
      if (existingOutcome) return { state: 'terminal' as const, claim: existingClaim, outcome: existingOutcome.record };
      if (Date.parse(existingClaim.lease_expires_at) <= this.now().getTime()) {
        throw new ActivationExecutionError(
          'activation_reconciliation_required',
          'claim lease expired without an outcome; reconcile to unknown and do not invoke the adapter again',
        );
      }
      return { state: 'in_progress' as const, claim: existingClaim, outcome: null };
    }

    const adapter = await this.assertCurrentPhase7(found);
    const preview = await this.repository.findPreview(found.record.id, found.manifest);
    const release = await this.repository.findReleaseIfExists(found.record.id);
    if (!release) throw new ActivationExecutionError('activation_not_released', 'activation requires a dual-credential release');
    const claimedAt = actionIso(this.now());
    const previewEvidence = preview.preview;
    if (Date.parse(previewEvidence.expires_at) <= Date.parse(claimedAt)) {
      throw new ActivationExecutionError('activation_preview_expired', 'zero-mutation preview has expired');
    }
    if (Date.parse(release.expires_at) <= Date.parse(claimedAt)) {
      throw new ActivationExecutionError('activation_release_expired', 'dual-credential activation release has expired');
    }
    const claimed = await this.repository.recordClaim({
      policy: found.record,
      phase7: found.phase7,
      release,
      preview: preview.record,
      activationKey,
      claimedBy: input.actor,
      claimedAt,
      leaseExpiresAt: new Date(
        Date.parse(claimedAt) + found.manifest.limits.claim_lease_seconds * 1_000,
      ).toISOString(),
    });
    const claim = claimed.record;
    if (!claimed.created) {
      const concurrentOutcome = await this.repository.findOutcomeIfExists(found.record.id, found.manifest);
      if (concurrentOutcome) {
        return { state: 'terminal' as const, claim, outcome: concurrentOutcome.record };
      }
      return { state: 'in_progress' as const, claim, outcome: null };
    }

    let result: ActivationAdapterResult;
    try {
      result = validateActivationAdapterResult(await adapter.activate({
        policy: found.manifest,
        preview: preview.preview,
        activationIdempotencyKey: activationKey,
        requestedAt: claimedAt,
      }), found.manifest);
      if (result.activation_idempotency_key !== activationKey) {
        throw new ActivationExecutionError('activation_result_key_mismatch', 'adapter returned a different activation key');
      }
      this.assertCompletionTime(result.completed_at, claimedAt, actionIso(this.now()), 'activation');
    } catch {
      result = this.unknownActivation(found.manifest, activationKey, actionIso(this.now()), 'activation_adapter_call_unknown');
    }
    const outcome = await this.repository.recordOutcome({
      policy: found.record,
      manifest: found.manifest,
      claim,
      result,
      actor: input.actor,
      recordedAt: actionIso(this.now()),
    });
    return { state: 'terminal' as const, claim, outcome };
  }

  async reconcileExpiredClaim(input: {
    policyId: string;
    actor: string;
    observerCredential: string;
  }) {
    const found = await this.repository.findPolicy(input.policyId);
    this.assertObserver(found.manifest, input.actor, input.observerCredential);
    const claim = await this.repository.findClaimIfExists(found.record.id);
    if (!claim) throw new ActivationExecutionError('activation_claim_missing', 'activation claim does not exist', 404);
    const existing = await this.repository.findOutcomeIfExists(found.record.id, found.manifest);
    if (existing) return existing.record;
    const at = actionIso(this.now());
    if (Date.parse(claim.lease_expires_at) > Date.parse(at)) {
      throw new ActivationExecutionError('activation_claim_still_active', 'activation claim lease has not expired');
    }
    return this.repository.recordOutcome({
      policy: found.record,
      manifest: found.manifest,
      claim,
      result: this.unknownActivation(
        found.manifest,
        claim.activation_key,
        at,
        'activation_claim_lease_expired',
      ),
      actor: input.actor,
      recordedAt: at,
    });
  }

  async observe(input: {
    policyId: string;
    observationKey: string;
    actor: string;
    observerCredential: string;
  }) {
    const found = await this.repository.findPolicy(input.policyId);
    this.assertObserver(found.manifest, input.actor, input.observerCredential);
    const outcome = await this.repository.findOutcomeIfExists(found.record.id, found.manifest);
    if (!outcome || outcome.result.outcome !== 'succeeded' || !outcome.result.provider_receipt_fingerprint) {
      throw new ActivationExecutionError('activation_not_observable', 'only a successful activation can be observed');
    }
    const observationKey = actionIdempotencyKey(input.observationKey);
    const existing = await this.repository.findObservationIfExists(found.record.id, found.manifest, outcome.result);
    if (existing) {
      if (existing.record.observation_key !== observationKey) {
        throw new ActivationExecutionError('activation_observation_conflict', 'activation already has a different observation');
      }
      return existing.record;
    }
    const adapter = this.resolveAdapter(found.manifest);
    const requestedAt = actionIso(this.now());
    const earliestAt = Date.parse(outcome.result.completed_at)
      + found.manifest.canary.observation_minutes * 60_000;
    if (Date.parse(requestedAt) < earliestAt) {
      throw new ActivationExecutionError('activation_observation_too_early', 'canary observation window is not complete');
    }
    const deadline = Date.parse(outcome.result.completed_at)
      + found.manifest.limits.observation_deadline_minutes * 60_000;
    let observation: ActivationAdapterObservation;
    if (Date.parse(requestedAt) > deadline) {
      observation = this.unknownObservation(
        found.manifest,
        outcome.result,
        requestedAt,
        'activation_observation_deadline_missed',
      );
    } else {
      try {
        observation = validateActivationAdapterObservation(await adapter.observe({
          policy: found.manifest,
          activation: outcome.result,
          observationKey,
          requestedAt,
        }), found.manifest, outcome.result);
        this.assertCompletionTime(observation.observed_at, outcome.result.completed_at, actionIso(this.now()), 'observation');
      } catch {
        observation = this.unknownObservation(
          found.manifest,
          outcome.result,
          actionIso(this.now()),
          'activation_observation_call_unknown',
        );
      }
    }
    return this.repository.recordObservation({
      policy: found.record,
      manifest: found.manifest,
      outcome: outcome.record,
      activation: outcome.result,
      observationKey,
      observation,
      observedBy: input.actor,
      recordedAt: actionIso(this.now()),
    });
  }

  async rollback(input: {
    policyId: string;
    rollbackKey: string;
    reasonCode: string;
    authorityActor: string;
    authorityCredential: string;
    rollbackActor: string;
    rollbackCredential: string;
  }) {
    const found = await this.repository.findPolicy(input.policyId);
    this.assertReleaseAuthority(found.manifest, input.authorityActor, input.authorityCredential);
    this.assertRollbackOperator(found.manifest, input.rollbackActor, input.rollbackCredential);
    const outcome = await this.repository.findOutcomeIfExists(found.record.id, found.manifest);
    if (!outcome || outcome.result.outcome !== 'succeeded' || !outcome.result.provider_receipt_fingerprint) {
      throw new ActivationExecutionError('activation_not_rollbackable', 'only a successful activation can be rolled back');
    }
    const rollbackKey = actionIdempotencyKey(input.rollbackKey);
    const existing = await this.repository.findRollbackIfExists(found.record.id, found.manifest, outcome.result);
    if (existing) {
      if (existing.record.rollback_key !== rollbackKey || existing.record.reason_code !== input.reasonCode) {
        throw new ActivationExecutionError('activation_rollback_conflict', 'activation already has a different rollback');
      }
      return existing.record;
    }
    const adapter = this.resolveAdapter(found.manifest);
    const requestedAt = actionIso(this.now());
    const deadline = Date.parse(outcome.result.completed_at)
      + found.manifest.limits.rollback_window_minutes * 60_000;
    if (Date.parse(requestedAt) > deadline) {
      throw new ActivationExecutionError('activation_rollback_window_expired', 'manual rollback window has expired');
    }
    let rollback: ActivationAdapterRollback;
    try {
      rollback = validateActivationAdapterRollback(await adapter.rollback({
        policy: found.manifest,
        activation: outcome.result,
        rollbackKey,
        requestedAt,
      }), found.manifest, outcome.result);
      if (rollback.rollback_idempotency_key !== rollbackKey) {
        throw new ActivationExecutionError('activation_rollback_key_mismatch', 'adapter returned a different rollback key');
      }
      this.assertCompletionTime(rollback.completed_at, requestedAt, actionIso(this.now()), 'rollback');
    } catch {
      rollback = this.unknownRollback(
        found.manifest,
        outcome.result,
        rollbackKey,
        actionIso(this.now()),
        'activation_rollback_call_unknown',
      );
    }
    return this.repository.recordRollback({
      policy: found.record,
      manifest: found.manifest,
      outcome: outcome.record,
      activation: outcome.result,
      rollbackKey,
      rollback,
      authorizedBy: input.authorityActor,
      operatedBy: input.rollbackActor,
      reasonCode: input.reasonCode,
      recordedAt: actionIso(this.now()),
    });
  }

  async readiness(policyId: string) {
    const found = await this.repository.findPolicy(policyId);
    await this.assertCurrentPhase7(found);
    const preview = await this.repository.findPreviewIfExists(found.record.id, found.manifest);
    const release = await this.repository.findReleaseIfExists(found.record.id);
    const claim = await this.repository.findClaimIfExists(found.record.id);
    const outcome = await this.repository.findOutcomeIfExists(found.record.id, found.manifest);
    return {
      policy: found.record,
      phase7_handoff: found.phase7.handoff,
      adapter_registered: true,
      preview_recorded: Boolean(preview),
      release_recorded: Boolean(release),
      claim_recorded: Boolean(claim),
      outcome: outcome?.record.outcome ?? null,
      ready_for_controlled_activation: !claim,
    };
  }

  async status(policyId: string) {
    const found = await this.repository.findPolicy(policyId);
    const preview = await this.repository.findPreviewIfExists(found.record.id, found.manifest);
    const release = await this.repository.findReleaseIfExists(found.record.id);
    const claim = await this.repository.findClaimIfExists(found.record.id);
    const outcome = await this.repository.findOutcomeIfExists(found.record.id, found.manifest);
    const observation = outcome?.result.outcome === 'succeeded'
      ? await this.repository.findObservationIfExists(found.record.id, found.manifest, outcome.result)
      : null;
    const rollback = outcome?.result.outcome === 'succeeded'
      ? await this.repository.findRollbackIfExists(found.record.id, found.manifest, outcome.result)
      : null;
    const activationStatus = rollback?.record.outcome === 'succeeded'
      ? 'rolled_back'
      : rollback
        ? `rollback_${rollback.record.outcome}`
        : observation?.record.verdict === 'healthy'
          ? 'activated_healthy'
          : observation
            ? `observation_${observation.record.verdict}`
            : outcome
              ? `activation_${outcome.record.outcome}`
              : claim
                ? 'activation_in_progress'
                : release
                  ? 'released'
                  : preview
                    ? 'previewed'
                    : 'kill_switch_engaged';
    return {
      policy: found.record,
      kill_switch: await this.repository.latestKillSwitch(found.record.id),
      preview: preview?.record ?? null,
      release,
      claim,
      outcome: outcome?.record ?? null,
      observation: observation?.record ?? null,
      rollback: rollback?.record ?? null,
      incidents: await this.repository.listIncidents(found.record.id),
      events: await this.repository.listEvents(found.record.id),
      activation_status: activationStatus,
    };
  }

  private async assertCurrentPhase7(found: {
    record: FoundPolicy['record'] | null;
    manifest: ActivationExecutionPolicyManifest;
    phase7: FoundPolicy['phase7'];
  }) {
    this.assertActive(found.manifest);
    if (found.phase7.recall) throw new ActivationExecutionError('phase7_handoff_recalled', 'Phase 7 handoff has been recalled');
    if (found.phase7.handoff.activation_status !== 'not_executed' || !found.phase7.handoff.external_execution_required) {
      throw new ActivationExecutionError('phase7_handoff_not_executable', 'Phase 7 handoff is not an unexecuted external handoff');
    }
    await this.phase7.readiness(found.manifest.phase7.policy_id);
    return this.resolveAdapter(found.manifest);
  }

  private resolveAdapter(policy: ActivationExecutionPolicyManifest) {
    const adapter = this.registry.resolve(policy);
    validateActivationAdapterDescriptor(adapter.descriptor, policy);
    return adapter;
  }

  private assertActive(policy: ActivationExecutionPolicyManifest): void {
    if (!activationExecutionPolicyIsActive(policy, actionIso(this.now()))) {
      throw new ActivationExecutionError('activation_execution_policy_not_active', 'activation-execution policy is not active');
    }
  }

  private assertReleaseAuthority(policy: ActivationExecutionPolicyManifest, actor: string, credential: string): void {
    this.assertIdentity(policy.identities.release_authority, policy.identities.release_credential_sha256, actor, credential, 'activation_release_authority');
  }

  private assertExecutor(policy: ActivationExecutionPolicyManifest, actor: string, credential: string): void {
    this.assertIdentity(policy.identities.executor, policy.identities.executor_credential_sha256, actor, credential, 'activation_executor');
  }

  private assertObserver(policy: ActivationExecutionPolicyManifest, actor: string, credential: string): void {
    this.assertIdentity(policy.identities.safety_observer, policy.identities.observer_credential_sha256, actor, credential, 'activation_observer');
  }

  private assertRollbackOperator(policy: ActivationExecutionPolicyManifest, actor: string, credential: string): void {
    this.assertIdentity(policy.identities.rollback_operator, policy.identities.rollback_credential_sha256, actor, credential, 'activation_rollback_operator');
  }

  private assertIdentity(
    expectedActor: string,
    expectedCredential: string,
    actor: string,
    credential: string,
    codePrefix: string,
  ): void {
    if (actor !== expectedActor) throw new ActivationExecutionError(`${codePrefix}_actor_rejected`, 'actor does not match policy', 403);
    if (!activationExecutionCredentialMatches(credential, expectedCredential)) {
      throw new ActivationExecutionError(`${codePrefix}_credential_rejected`, 'credential does not match policy', 403);
    }
  }

  private assertCompletionTime(completedAt: string, notBefore: string, notAfter: string, kind: string): void {
    const completed = Date.parse(completedAt);
    if (completed < Date.parse(notBefore) || completed > Date.parse(notAfter)) {
      throw new ActivationExecutionError(`invalid_${kind}_time`, `${kind} evidence timestamp is outside the request window`);
    }
  }

  private unknownActivation(
    policy: ActivationExecutionPolicyManifest,
    activationKey: string,
    completedAt: string,
    resultCode: string,
  ): ActivationAdapterResult {
    return {
      schema_version: PHASE8_RESULT_SCHEMA,
      policy_id: policy.policy_id,
      handoff_fingerprint: policy.phase7.handoff_fingerprint,
      target_fingerprint: policy.target.target_fingerprint,
      activation_idempotency_key: activationKey,
      outcome: 'unknown',
      mutation_count: null,
      provider_receipt_fingerprint: null,
      external_state_fingerprint: null,
      result_code: resultCode,
      completed_at: completedAt,
    };
  }

  private unknownObservation(
    policy: ActivationExecutionPolicyManifest,
    activation: ActivationAdapterResult,
    observedAt: string,
    resultCode: string,
  ): ActivationAdapterObservation {
    return {
      schema_version: PHASE8_OBSERVATION_SCHEMA,
      policy_id: policy.policy_id,
      target_fingerprint: policy.target.target_fingerprint,
      provider_receipt_fingerprint: activation.provider_receipt_fingerprint!,
      verdict: 'unknown',
      metric_fingerprint: null,
      external_state_fingerprint: null,
      result_code: resultCode,
      observed_at: observedAt,
    };
  }

  private unknownRollback(
    policy: ActivationExecutionPolicyManifest,
    activation: ActivationAdapterResult,
    rollbackKey: string,
    completedAt: string,
    resultCode: string,
  ): ActivationAdapterRollback {
    return {
      schema_version: PHASE8_ROLLBACK_SCHEMA,
      policy_id: policy.policy_id,
      target_fingerprint: policy.target.target_fingerprint,
      activation_receipt_fingerprint: activation.provider_receipt_fingerprint!,
      rollback_idempotency_key: rollbackKey,
      outcome: 'unknown',
      mutation_count: null,
      rollback_receipt_fingerprint: null,
      restored_state_fingerprint: null,
      result_code: resultCode,
      completed_at: completedAt,
    };
  }
}
