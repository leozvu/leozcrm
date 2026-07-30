import {
  AutonomyAttemptRecord,
  AutonomyEnvelopeState,
  AutonomyEvaluationRecord,
  BoundedAutonomyError,
  BoundedAutonomyPolicyRecord,
  G7PolicySimulationRecord,
  KillSwitchEventRecord,
  autonomyCredentialMatches,
  autonomyFingerprint,
  evaluateAutonomyEnvelope,
  g7PolicyIsActive,
  simulateG7Policy,
} from '../domain/boundedAutonomy';
import {
  G7BoundedAutonomyPolicyManifest,
  validateG7Policy,
} from '../domain/g7Policy';
import {
  SupervisedActionAdapter,
  actionActor,
  actionCode,
  actionCurrency,
  actionEvidenceRefs,
  actionFingerprint,
  actionIdempotencyKey,
  actionIso,
  assertAdapterMatchesPolicy,
  policyIsActive,
  validateExecutionEvidence,
  validatePreviewEvidence,
} from '../domain/supervisedAction';
import { canonicalSafeActionPayload } from '../domain/g6Policy';
import { ActionAdapterRegistry } from '../integrations/actions/actionAdapterRegistry';
import {
  BoundedAutonomyRepository,
  EvaluationInsert,
} from '../repositories/boundedAutonomyRepository';
import {
  supervisedRequestFingerprint,
  supervisedTargetFingerprint,
} from './supervisedActionService';

export function autonomyRecoveryRequestFingerprint(input: {
  commandKey: string;
  commandVersion: string;
  targetProjectId: string;
  targetTenantKey: string;
  targetEndpointUrl: string;
  targetCredentialFingerprint: string;
  originalRequestFingerprint: string;
  originalResultFingerprint: string;
  originalExternalRequestId: string;
  originalIdempotencyKey: string;
  recoveryIdempotencyKey: string;
}): string {
  return autonomyFingerprint({
    kind: 'human_recovery',
    command_key: input.commandKey,
    command_version: input.commandVersion,
    target_project_id: input.targetProjectId,
    target_tenant_key: input.targetTenantKey,
    command_endpoint_url: input.targetEndpointUrl,
    command_credential_sha256: input.targetCredentialFingerprint,
    original_request_fingerprint: input.originalRequestFingerprint,
    original_result_fingerprint: input.originalResultFingerprint,
    original_external_request_id: input.originalExternalRequestId,
    original_idempotency_key: input.originalIdempotencyKey,
    recovery_idempotency_key: input.recoveryIdempotencyKey,
  });
}

interface PolicyContext {
  record: BoundedAutonomyPolicyRecord;
  manifest: G7BoundedAutonomyPolicyManifest;
  g6: Awaited<ReturnType<BoundedAutonomyRepository['findG6Policy']>>;
  simulation: G7PolicySimulationRecord;
  adapter: SupervisedActionAdapter;
}

export interface AutonomyCycleInput {
  policyId: string;
  payload: unknown;
  reasonCode: string;
  evidenceRefs: unknown;
  idempotencyKey: string;
  executor: string;
  executorCredential: string;
}

export interface AutonomyCycleResult {
  evaluation: AutonomyEvaluationRecord;
  attempt?: AutonomyAttemptRecord;
  replayed: boolean;
}

export class BoundedAutonomyService {
  constructor(
    private readonly repository: BoundedAutonomyRepository,
    private readonly adapters: ActionAdapterRegistry,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async simulatePolicy(input: unknown, simulatedBy: string) {
    const initial = validateG7Policy(input);
    if (!initial.ok || !initial.value) {
      throw new BoundedAutonomyError('invalid_g7_policy', initial.issues.join('; '), 400);
    }
    const g6 = await this.repository.findG6Policy(initial.value.g6_policy.policy_id);
    const validation = validateG7Policy(input, g6.manifest);
    if (!validation.ok || !validation.value || !validation.fingerprint) {
      throw new BoundedAutonomyError('invalid_g7_policy', validation.issues.join('; '), 400);
    }
    const simulatedAt = actionIso(this.now());
    const result = simulateG7Policy(validation.value, g6.manifest, simulatedAt);
    const record = await this.repository.recordSimulation({
      manifest: validation.value,
      g6PolicyRecordId: g6.record.id,
      result,
      simulatedBy,
    });
    return { record, result };
  }

  async acceptPolicy(input: unknown, releaseCredential: string): Promise<BoundedAutonomyPolicyRecord> {
    const initial = validateG7Policy(input);
    if (!initial.ok || !initial.value) {
      throw new BoundedAutonomyError('invalid_g7_policy', initial.issues.join('; '), 400);
    }
    const g6 = await this.repository.findG6Policy(initial.value.g6_policy.policy_id);
    const validation = validateG7Policy(input, g6.manifest);
    if (!validation.ok || !validation.value || !validation.fingerprint) {
      throw new BoundedAutonomyError('invalid_g7_policy', validation.issues.join('; '), 400);
    }
    const policy = validation.value;
    if (!autonomyCredentialMatches(releaseCredential, policy.identities.release_credential_sha256)) {
      throw new BoundedAutonomyError('release_credential_rejected', 'release credential does not match', 403);
    }
    const at = actionIso(this.now());
    if (!g7PolicyIsActive(policy, at)) throw new BoundedAutonomyError('g7_not_active', 'bounded-autonomy policy is not active');
    const adapter = this.resolveAdapter(policy, g6.manifest);
    void adapter;
    const g5 = await this.repository.findLatestG5Decision(policy.tenant_id, policy.source_connection_id);
    if (!g5 || g5.id !== g6.manifest.g5_release.decision_id || g5.decision !== 'go') {
      throw new BoundedAutonomyError('g5_not_current_go', 'latest G5 decision is not the bound go');
    }
    if (!policyIsActive(g6.manifest, at)) throw new BoundedAutonomyError('g6_not_active', 'bound G6 policy is not active');
    const history = await this.repository.supervisedHistory(g6.record.id, policy.history.window_days, at);
    this.assertHistory(policy, history);
    const simulation = await this.repository.findSimulation(validation.fingerprint);
    if (!simulation.passed || simulation.g6_policy_fingerprint !== g6.record.policy_fingerprint) {
      throw new BoundedAutonomyError('simulation_not_passed', 'exact G7 policy simulation has not passed');
    }
    return this.repository.recordPolicy({ manifest: policy, g6, g5, simulation });
  }

  async releaseKillSwitch(input: {
    policyId: string;
    actor: string;
    releaseCredential: string;
    killSwitchCredential: string;
    reasonCode: string;
  }): Promise<KillSwitchEventRecord> {
    const context = await this.context(input.policyId);
    this.assertReleaseIdentity(context.manifest, input.actor, input.releaseCredential, input.killSwitchCredential);
    const state = await this.runtimeState(context);
    const decision = evaluateAutonomyEnvelope(context.manifest, {
      ...state,
      kill_switch_released: true,
      executions_last_hour: 0,
      executions_last_day: 0,
      cost_last_day: 0,
      cooldown_elapsed_seconds: null,
      candidate_cost_minor: 0,
      preview_mutation_count: 0,
    });
    if (decision.decision !== 'allow') {
      throw new BoundedAutonomyError(decision.code, `kill switch release blocked: ${decision.code}`);
    }
    const evidence = autonomyFingerprint({
      policy_fingerprint: context.record.policy_fingerprint,
      simulation_fingerprint: context.simulation.simulation_fingerprint,
      runtime_state: state,
      reason_code: actionCode(input.reasonCode, 'invalid_kill_switch_reason'),
      released_at: actionIso(this.now()),
    });
    return this.repository.transitionKillSwitch({
      policy: context.record,
      state: 'released',
      actor: input.actor,
      reasonCode: input.reasonCode,
      evidenceFingerprint: evidence,
      occurredAt: actionIso(this.now()),
    });
  }

  async engageKillSwitch(input: {
    policyId: string;
    actor: string;
    killSwitchCredential: string;
    reasonCode: string;
  }): Promise<KillSwitchEventRecord> {
    const found = await this.repository.findPolicy(input.policyId);
    if (input.actor !== found.manifest.identities.kill_switch_operator) {
      throw new BoundedAutonomyError('kill_switch_actor_rejected', 'kill-switch actor does not match policy', 403);
    }
    if (!autonomyCredentialMatches(
      input.killSwitchCredential,
      found.manifest.identities.kill_switch_credential_sha256,
    )) throw new BoundedAutonomyError('kill_switch_credential_rejected', 'kill-switch credential does not match', 403);
    const at = actionIso(this.now());
    return this.repository.transitionKillSwitch({
      policy: found.record,
      state: 'engaged',
      actor: input.actor,
      reasonCode: input.reasonCode,
      evidenceFingerprint: autonomyFingerprint({
        policy_fingerprint: found.record.policy_fingerprint,
        reason_code: actionCode(input.reasonCode, 'invalid_kill_switch_reason'),
        engaged_at: at,
      }),
      occurredAt: at,
    });
  }

  async resolveIncident(input: {
    policyId: string;
    incidentId: string;
    actor: string;
    releaseCredential: string;
    killSwitchCredential: string;
    reasonCode: string;
    evidenceRefs: unknown;
  }) {
    const found = await this.repository.findPolicy(input.policyId);
    this.assertReleaseIdentity(found.manifest, input.actor, input.releaseCredential, input.killSwitchCredential);
    const evidenceRefsJson = actionEvidenceRefs(input.evidenceRefs);
    return this.repository.resolveIncident({
      policy: found.record,
      incidentId: input.incidentId,
      actor: input.actor,
      reasonCode: input.reasonCode,
      evidenceFingerprint: autonomyFingerprint({
        incident_id: input.incidentId,
        reason_code: actionCode(input.reasonCode, 'invalid_incident_reason'),
        evidence_refs: JSON.parse(evidenceRefsJson),
        resolved_at: actionIso(this.now()),
      }),
      occurredAt: actionIso(this.now()),
    });
  }

  async runCandidate(input: AutonomyCycleInput): Promise<AutonomyCycleResult> {
    const context = await this.context(input.policyId);
    this.assertExecutor(context.manifest, input.executor, input.executorCredential);
    const payloadJson = canonicalSafeActionPayload(input.payload);
    const payload = JSON.parse(payloadJson) as unknown;
    const reasonCode = actionCode(input.reasonCode, 'invalid_autonomy_reason');
    const evidenceRefsJson = actionEvidenceRefs(input.evidenceRefs);
    const idempotencyKey = actionIdempotencyKey(input.idempotencyKey);
    const requestFingerprint = supervisedRequestFingerprint({
      commandKey: context.g6.manifest.command.key,
      commandVersion: context.g6.manifest.command.version,
      targetProjectId: context.g6.manifest.target.project_id,
      targetTenantKey: context.g6.manifest.target.tenant_key,
      targetEndpointUrl: context.g6.manifest.target.command_endpoint_url,
      targetCredentialFingerprint: context.g6.manifest.target.command_credential_sha256,
      payload,
      idempotencyKey,
    });
    const targetFingerprint = supervisedTargetFingerprint({
      projectId: context.g6.manifest.target.project_id,
      tenantKey: context.g6.manifest.target.tenant_key,
      endpointUrl: context.g6.manifest.target.command_endpoint_url,
      credentialFingerprint: context.g6.manifest.target.command_credential_sha256,
    });
    const payloadFingerprint = actionFingerprint(payloadJson);
    const existing = await this.repository.findEvaluation(context.record.id, idempotencyKey);
    if (existing) {
      if (
        existing.payload_fingerprint !== payloadFingerprint
        || existing.reason_code !== reasonCode
        || existing.evidence_refs_json !== evidenceRefsJson
        || existing.request_fingerprint !== requestFingerprint
        || existing.target_fingerprint !== targetFingerprint
      ) throw new BoundedAutonomyError('autonomy_idempotency_conflict', 'idempotency key has different candidate evidence');
      return {
        evaluation: existing,
        attempt: await this.repository.findAttemptByEvaluation(existing.id),
        replayed: true,
      };
    }

    const at = actionIso(this.now());
    const runtime = await this.runtimeState(context);
    const preflight = evaluateAutonomyEnvelope(context.manifest, {
      ...runtime,
      candidate_cost_minor: 0,
      preview_mutation_count: 0,
    });
    if (preflight.decision === 'deny') {
      const evaluation = await this.recordEvaluation({
        context, payloadJson, payloadFingerprint, reasonCode, evidenceRefsJson,
        idempotencyKey, requestFingerprint, targetFingerprint, at,
        decision: 'deny', decisionCode: preflight.code,
      }, input.executor);
      return { evaluation, replayed: false };
    }

    try {
      context.adapter.validatePayload(payload);
    } catch {
      const evaluation = await this.recordEvaluation({
        context, payloadJson, payloadFingerprint, reasonCode, evidenceRefsJson,
        idempotencyKey, requestFingerprint, targetFingerprint, at,
        decision: 'deny', decisionCode: 'payload_schema_rejected',
      }, input.executor);
      return { evaluation, replayed: false };
    }

    let preview;
    try {
      preview = validatePreviewEvidence(await context.adapter.preview({
        payload,
        targetProjectId: context.g6.manifest.target.project_id,
        targetTenantKey: context.g6.manifest.target.tenant_key,
        targetEndpointUrl: context.g6.manifest.target.command_endpoint_url,
        targetCredentialFingerprint: context.g6.manifest.target.command_credential_sha256,
        idempotencyKey,
      }), context.g6.manifest);
      if (preview.request_fingerprint !== requestFingerprint || preview.target_fingerprint !== targetFingerprint) {
        throw new BoundedAutonomyError('dry_run_binding_mismatch', 'dry-run evidence does not bind the exact request and target');
      }
    } catch {
      const code = 'dry_run_failed';
      const evaluation = await this.recordEvaluation({
        context, payloadJson, payloadFingerprint, reasonCode, evidenceRefsJson,
        idempotencyKey, requestFingerprint, targetFingerprint, at,
        decision: 'deny', decisionCode: code,
      }, input.executor);
      await this.repository.openControlIncident({
        policy: context.record,
        actor: 'leozops_control_plane',
        reasonCode: code,
        evidenceFingerprint: evaluation.evaluation_fingerprint,
        occurredAt: at,
      });
      return { evaluation, replayed: false };
    }

    const envelope = evaluateAutonomyEnvelope(context.manifest, {
      ...runtime,
      candidate_cost_minor: preview.estimated_cost_minor,
      preview_mutation_count: preview.external_mutation_count,
    });
    const previewFingerprint = autonomyFingerprint({
      adapter_id: context.g6.manifest.command.adapter_id,
      adapter_version: context.adapter.descriptor.adapter_version,
      ...preview,
    });
    const evaluation = await this.recordEvaluation({
      context, payloadJson, payloadFingerprint, reasonCode, evidenceRefsJson,
      idempotencyKey, requestFingerprint, targetFingerprint, at,
      preview: { ...preview, previewFingerprint },
      decision: envelope.decision,
      decisionCode: envelope.code,
    }, input.executor);
    if (evaluation.decision === 'deny') return { evaluation, replayed: false };

    const claimed = await this.repository.claimAttempt({
      tenant_id: context.record.tenant_id,
      policy_record_id: context.record.id,
      evaluation_id: evaluation.id,
      idempotency_key: idempotencyKey,
      request_fingerprint: requestFingerprint,
      executor: input.executor,
      reserved_cost_minor: preview.estimated_cost_minor,
      currency: preview.currency,
      started_at: at,
      lease_expires_at: new Date(Date.parse(at) + context.manifest.limits.execution_lease_seconds * 1_000).toISOString(),
    }, {
      g5ReleaseDecisionId: context.record.g5_release_decision_id,
      g6PolicyRecordId: context.g6.record.id,
      g6PolicyFingerprint: context.g6.record.policy_fingerprint,
      simulationId: context.simulation.id,
      historyWindowDays: context.manifest.history.window_days,
      minSuccessfulExecutions: context.manifest.history.min_successful_executions,
      maxSourceAgeMinutes: context.manifest.limits.max_source_age_minutes,
      maxPerHour: context.manifest.limits.max_executions_per_hour,
      maxPerDay: context.manifest.limits.max_executions_per_day,
      maxCostPerDay: context.manifest.limits.max_cost_minor_per_day,
      cooldownSeconds: context.manifest.limits.cooldown_seconds,
    });
    if (claimed.replayed) return { evaluation, attempt: claimed.attempt, replayed: true };

    try {
      const result = validateExecutionEvidence(await context.adapter.execute({
        payload,
        targetProjectId: context.g6.manifest.target.project_id,
        targetTenantKey: context.g6.manifest.target.tenant_key,
        targetEndpointUrl: context.g6.manifest.target.command_endpoint_url,
        targetCredentialFingerprint: context.g6.manifest.target.command_credential_sha256,
        idempotencyKey,
        preview,
      }), context.g6.manifest);
      if (
        result.actual_cost_minor > preview.estimated_cost_minor
        || result.actual_cost_minor > context.manifest.limits.max_cost_minor_per_action
        || result.external_mutation_count > context.manifest.limits.mutation_count_max
      ) throw new BoundedAutonomyError('execution_exceeded_preview', 'execution evidence exceeded the preview envelope');
      const completion = {
        status: result.outcome === 'succeeded' ? 'succeeded' as const : 'failed' as const,
        finished_at: actionIso(this.now()),
        external_request_id: result.external_request_id,
        result_fingerprint: result.result_fingerprint,
        result_code: result.result_code,
        actual_cost_minor: result.actual_cost_minor,
        external_mutation_count: result.external_mutation_count,
        latency_ms: 0,
      };
      if (completion.status === 'succeeded') {
        return { evaluation, attempt: await this.repository.completeAttempt(claimed.attempt.id, completion), replayed: false };
      }
      const halted = await this.repository.haltAttemptWithIncident({
        attemptId: claimed.attempt.id,
        completion,
        actor: 'leozops_control_plane',
        incidentReasonCode: 'autonomy_execution_failed',
        evidenceFingerprint: result.result_fingerprint,
      });
      return { evaluation, attempt: halted.attempt, replayed: false };
    } catch {
      const fingerprint = autonomyFingerprint({
        attempt_id: claimed.attempt.id,
        request_fingerprint: requestFingerprint,
        outcome: 'unknown_or_invalid',
      });
      const halted = await this.repository.haltAttemptWithIncident({
        attemptId: claimed.attempt.id,
        completion: {
          status: 'reconciliation_required',
          finished_at: actionIso(this.now()),
          external_request_id: null,
          result_fingerprint: fingerprint,
          result_code: 'unknown_or_invalid_adapter_outcome',
          actual_cost_minor: null,
          external_mutation_count: null,
          latency_ms: 0,
        },
        actor: 'leozops_control_plane',
        incidentReasonCode: 'unknown_or_invalid_adapter_outcome',
        evidenceFingerprint: fingerprint,
      });
      return { evaluation, attempt: halted.attempt, replayed: false };
    }
  }

  async reconcileExpiredAttempt(input: {
    policyId: string;
    evaluationId: string;
    actor: string;
    executorCredential: string;
  }): Promise<AutonomyAttemptRecord> {
    const context = await this.repository.findPolicy(input.policyId);
    this.assertExecutor(context.manifest, input.actor, input.executorCredential);
    const attempt = await this.repository.findAttemptByEvaluation(input.evaluationId);
    if (!attempt || attempt.policy_record_id !== context.record.id) {
      throw new BoundedAutonomyError('missing_autonomy_attempt', 'autonomy attempt does not exist');
    }
    if (attempt.status !== 'in_progress') return attempt;
    const at = actionIso(this.now());
    if (Date.parse(at) < Date.parse(attempt.lease_expires_at)) {
      throw new BoundedAutonomyError('autonomy_attempt_still_live', 'attempt lease has not expired');
    }
    const fingerprint = autonomyFingerprint({ attempt_id: attempt.id, lease_expires_at: attempt.lease_expires_at, reconciled_at: at });
    const halted = await this.repository.haltAttemptWithIncident({
      attemptId: attempt.id,
      completion: {
        status: 'reconciliation_required',
        finished_at: at,
        external_request_id: null,
        result_fingerprint: fingerprint,
        result_code: 'expired_autonomy_lease',
        actual_cost_minor: null,
        external_mutation_count: null,
        latency_ms: Math.max(0, Date.parse(at) - Date.parse(attempt.started_at)),
      },
      actor: input.actor,
      incidentReasonCode: 'expired_autonomy_lease',
      evidenceFingerprint: fingerprint,
    });
    return halted.attempt;
  }

  async previewRecovery(input: {
    policyId: string;
    subjectAttemptId: string;
    actor: string;
    executorCredential: string;
  }) {
    const context = await this.context(input.policyId);
    this.assertExecutor(context.manifest, input.actor, input.executorCredential);
    const kill = await this.repository.latestKillSwitch(context.record.id);
    if (kill.state !== 'engaged') {
      throw new BoundedAutonomyError('kill_switch_must_be_engaged', 'engage the kill switch before recovery');
    }
    const subject = await this.repository.findAttemptById(input.subjectAttemptId);
    this.assertRecoverySubject(context, subject);
    try {
      return await this.repository.findRecoveryPreview(subject.id);
    } catch (error) {
      if (!(error instanceof BoundedAutonomyError) || error.code !== 'missing_recovery_preview') throw error;
    }
    const recoveryIdempotencyKey = this.recoveryIdempotencyKey(subject.id);
    const recoverySubject = this.recoverySubject(subject);
    const expectedRequest = autonomyRecoveryRequestFingerprint({
      commandKey: context.g6.manifest.command.key,
      commandVersion: context.g6.manifest.command.version,
      targetProjectId: context.g6.manifest.target.project_id,
      targetTenantKey: context.g6.manifest.target.tenant_key,
      targetEndpointUrl: context.g6.manifest.target.command_endpoint_url,
      targetCredentialFingerprint: context.g6.manifest.target.command_credential_sha256,
      originalRequestFingerprint: recoverySubject.original_request_fingerprint,
      originalResultFingerprint: recoverySubject.original_result_fingerprint,
      originalExternalRequestId: recoverySubject.original_external_request_id,
      originalIdempotencyKey: recoverySubject.original_idempotency_key,
      recoveryIdempotencyKey,
    });
    const expectedTarget = supervisedTargetFingerprint({
      projectId: context.g6.manifest.target.project_id,
      tenantKey: context.g6.manifest.target.tenant_key,
      endpointUrl: context.g6.manifest.target.command_endpoint_url,
      credentialFingerprint: context.g6.manifest.target.command_credential_sha256,
    });
    const evidence = validatePreviewEvidence(await context.adapter.previewRecovery!({
      subject: recoverySubject,
      targetProjectId: context.g6.manifest.target.project_id,
      targetTenantKey: context.g6.manifest.target.tenant_key,
      targetEndpointUrl: context.g6.manifest.target.command_endpoint_url,
      targetCredentialFingerprint: context.g6.manifest.target.command_credential_sha256,
      idempotencyKey: recoveryIdempotencyKey,
    }), context.g6.manifest);
    if (evidence.request_fingerprint !== expectedRequest || evidence.target_fingerprint !== expectedTarget) {
      throw new BoundedAutonomyError('recovery_preview_binding_mismatch', 'recovery preview does not bind the exact subject and target');
    }
    const at = actionIso(this.now());
    const deadline = Date.parse(subject.finished_at!) + 24 * 3_600_000;
    if (Date.parse(at) >= deadline) throw new BoundedAutonomyError('recovery_window_expired', '24-hour recovery window expired');
    const expiresAt = new Date(Math.min(
      deadline,
      Date.parse(at) + context.g6.manifest.limits.approval_ttl_minutes * 60_000,
    )).toISOString();
    const core = {
      tenant_id: context.record.tenant_id,
      policy_record_id: context.record.id,
      subject_attempt_id: subject.id,
      adapter_id: context.adapter.descriptor.adapter_id,
      adapter_version: context.adapter.descriptor.adapter_version,
      ...evidence,
      previewed_by: input.actor,
      previewed_at: at,
      expires_at: expiresAt,
    };
    return this.repository.recordRecoveryPreview({ ...core, preview_fingerprint: autonomyFingerprint(core) });
  }

  async decideRecovery(input: {
    policyId: string;
    subjectAttemptId: string;
    decision: 'approved' | 'rejected';
    actor: string;
    releaseCredential: string;
    killSwitchCredential: string;
    reasonCode: string;
    nonce: string;
    maxCostMinor: number;
  }) {
    const context = await this.context(input.policyId);
    this.assertReleaseIdentity(context.manifest, input.actor, input.releaseCredential, input.killSwitchCredential);
    const kill = await this.repository.latestKillSwitch(context.record.id);
    if (kill.state !== 'engaged') throw new BoundedAutonomyError('kill_switch_must_be_engaged', 'engage the kill switch before recovery approval');
    const subject = await this.repository.findAttemptById(input.subjectAttemptId);
    this.assertRecoverySubject(context, subject);
    const preview = await this.repository.findRecoveryPreview(subject.id);
    const at = actionIso(this.now());
    if (input.decision !== 'approved' && input.decision !== 'rejected') {
      throw new BoundedAutonomyError('invalid_recovery_decision', 'recovery decision must be approved or rejected', 400);
    }
    if (Date.parse(at) >= Date.parse(preview.expires_at)) throw new BoundedAutonomyError('recovery_preview_expired', 'recovery preview expired');
    if (!Number.isInteger(input.maxCostMinor) || input.maxCostMinor < preview.estimated_cost_minor || input.maxCostMinor > context.g6.manifest.limits.max_cost_minor) {
      throw new BoundedAutonomyError('recovery_cost_not_approved', 'recovery cost ceiling is invalid');
    }
    const deadline = Date.parse(subject.finished_at!) + 24 * 3_600_000;
    const expiresAt = new Date(Math.min(
      deadline,
      Date.parse(at) + context.g6.manifest.limits.approval_ttl_minutes * 60_000,
      Date.parse(preview.expires_at),
    )).toISOString();
    const core = {
      tenant_id: context.record.tenant_id,
      policy_record_id: context.record.id,
      subject_attempt_id: subject.id,
      preview_id: preview.id,
      decision: input.decision,
      policy_fingerprint: context.record.policy_fingerprint,
      preview_fingerprint: preview.preview_fingerprint,
      approver: input.actor,
      reason_code: actionCode(input.reasonCode, 'invalid_recovery_reason'),
      nonce: actionIdempotencyKey(input.nonce),
      max_cost_minor: input.maxCostMinor,
      currency: actionCurrency(preview.currency),
      decided_at: at,
      expires_at: expiresAt,
    };
    return this.repository.recordRecoveryApproval({ ...core, approval_fingerprint: autonomyFingerprint(core) });
  }

  async recover(input: {
    policyId: string;
    subjectAttemptId: string;
    actor: string;
    executorCredential: string;
  }): Promise<{ attempt: AutonomyAttemptRecord; replayed: boolean }> {
    const context = await this.context(input.policyId);
    this.assertExecutor(context.manifest, input.actor, input.executorCredential);
    const kill = await this.repository.latestKillSwitch(context.record.id);
    if (kill.state !== 'engaged') throw new BoundedAutonomyError('kill_switch_must_be_engaged', 'engage the kill switch before recovery');
    const subject = await this.repository.findAttemptById(input.subjectAttemptId);
    this.assertRecoverySubject(context, subject);
    const existing = await this.repository.findRecoveryAttempt(subject.id);
    if (existing) return { attempt: existing, replayed: true };
    const preview = await this.repository.findRecoveryPreview(subject.id);
    const approval = await this.repository.findRecoveryApproval(preview.id);
    const at = actionIso(this.now());
    if (
      approval.decision !== 'approved'
      || approval.policy_fingerprint !== context.record.policy_fingerprint
      || approval.preview_fingerprint !== preview.preview_fingerprint
      || Date.parse(at) >= Date.parse(approval.expires_at)
    ) throw new BoundedAutonomyError('recovery_not_approved', 'exact recovery is not approved or has expired');
    const claimed = await this.repository.claimRecoveryAttempt({
      tenant_id: context.record.tenant_id,
      policy_record_id: context.record.id,
      subject_attempt_id: subject.id,
      recovery_approval_id: approval.id,
      idempotency_key: this.recoveryIdempotencyKey(subject.id),
      request_fingerprint: preview.request_fingerprint,
      executor: input.actor,
      reserved_cost_minor: preview.estimated_cost_minor,
      currency: preview.currency,
      started_at: at,
      lease_expires_at: new Date(Date.parse(at) + context.manifest.limits.execution_lease_seconds * 1_000).toISOString(),
    });
    if (claimed.replayed) return claimed;
    try {
      const result = validateExecutionEvidence(await context.adapter.recover!({
        subject: this.recoverySubject(subject),
        targetProjectId: context.g6.manifest.target.project_id,
        targetTenantKey: context.g6.manifest.target.tenant_key,
        targetEndpointUrl: context.g6.manifest.target.command_endpoint_url,
        targetCredentialFingerprint: context.g6.manifest.target.command_credential_sha256,
        idempotencyKey: this.recoveryIdempotencyKey(subject.id),
        preview,
      }), context.g6.manifest);
      if (result.actual_cost_minor > preview.estimated_cost_minor || result.actual_cost_minor > approval.max_cost_minor) {
        throw new BoundedAutonomyError('recovery_exceeded_preview', 'recovery exceeded the approved cost');
      }
      const completion = {
        status: result.outcome === 'succeeded' ? 'succeeded' as const : 'failed' as const,
        finished_at: actionIso(this.now()),
        external_request_id: result.external_request_id,
        result_fingerprint: result.result_fingerprint,
        result_code: result.result_code,
        actual_cost_minor: result.actual_cost_minor,
        external_mutation_count: result.external_mutation_count,
        latency_ms: 0,
      };
      if (completion.status === 'succeeded') {
        return { attempt: await this.repository.completeAttempt(claimed.attempt.id, completion), replayed: false };
      }
      const halted = await this.repository.haltAttemptWithIncident({
        attemptId: claimed.attempt.id,
        completion,
        actor: 'leozops_control_plane',
        incidentReasonCode: 'human_recovery_failed',
        evidenceFingerprint: result.result_fingerprint,
      });
      return { attempt: halted.attempt, replayed: false };
    } catch {
      const fingerprint = autonomyFingerprint({
        recovery_attempt_id: claimed.attempt.id,
        request_fingerprint: preview.request_fingerprint,
        outcome: 'unknown_or_invalid',
      });
      const halted = await this.repository.haltAttemptWithIncident({
        attemptId: claimed.attempt.id,
        completion: {
          status: 'reconciliation_required',
          finished_at: actionIso(this.now()),
          external_request_id: null,
          result_fingerprint: fingerprint,
          result_code: 'unknown_or_invalid_recovery_outcome',
          actual_cost_minor: null,
          external_mutation_count: null,
          latency_ms: 0,
        },
        actor: 'leozops_control_plane',
        incidentReasonCode: 'unknown_or_invalid_recovery_outcome',
        evidenceFingerprint: fingerprint,
      });
      return { attempt: halted.attempt, replayed: false };
    }
  }

  async reconcileExpiredRecovery(input: {
    policyId: string;
    subjectAttemptId: string;
    actor: string;
    executorCredential: string;
  }): Promise<AutonomyAttemptRecord> {
    const context = await this.repository.findPolicy(input.policyId);
    this.assertExecutor(context.manifest, input.actor, input.executorCredential);
    const attempt = await this.repository.findRecoveryAttempt(input.subjectAttemptId);
    if (!attempt || attempt.policy_record_id !== context.record.id) {
      throw new BoundedAutonomyError('missing_autonomy_attempt', 'recovery attempt does not exist');
    }
    if (attempt.status !== 'in_progress') return attempt;
    const at = actionIso(this.now());
    if (Date.parse(at) < Date.parse(attempt.lease_expires_at)) {
      throw new BoundedAutonomyError('autonomy_attempt_still_live', 'recovery attempt lease has not expired');
    }
    const fingerprint = autonomyFingerprint({
      recovery_attempt_id: attempt.id,
      lease_expires_at: attempt.lease_expires_at,
      reconciled_at: at,
    });
    const halted = await this.repository.haltAttemptWithIncident({
      attemptId: attempt.id,
      completion: {
        status: 'reconciliation_required',
        finished_at: at,
        external_request_id: null,
        result_fingerprint: fingerprint,
        result_code: 'expired_recovery_lease',
        actual_cost_minor: null,
        external_mutation_count: null,
        latency_ms: Math.max(0, Date.parse(at) - Date.parse(attempt.started_at)),
      },
      actor: input.actor,
      incidentReasonCode: 'expired_recovery_lease',
      evidenceFingerprint: fingerprint,
    });
    return halted.attempt;
  }

  async status(policyId: string) {
    const found = await this.repository.findPolicy(policyId);
    const at = actionIso(this.now());
    return {
      policy: found.record,
      simulation: found.simulation,
      kill_switch: await this.repository.latestKillSwitch(found.record.id),
      open_incidents: await this.repository.listOpenIncidents(found.record.id),
      supervised_history: await this.repository.supervisedHistory(
        found.g6.record.id,
        found.manifest.history.window_days,
        at,
      ),
      usage: await this.repository.usage(found.record.id, at),
      events: await this.repository.listEvents(found.record.id),
    };
  }

  private async context(policyId: string): Promise<PolicyContext> {
    const found = await this.repository.findPolicy(policyId);
    const adapter = this.resolveAdapter(found.manifest, found.g6.manifest);
    return { ...found, adapter };
  }

  private resolveAdapter(policy: G7BoundedAutonomyPolicyManifest, g6: PolicyContext['g6']['manifest']) {
    const adapter = this.adapters.resolve({
      environment: policy.environment,
      commandKey: policy.g6_policy.command_key,
      commandVersion: policy.g6_policy.command_version,
      adapterId: policy.g6_policy.adapter_id,
    });
    assertAdapterMatchesPolicy(adapter, g6);
    if (typeof adapter.previewRecovery !== 'function' || typeof adapter.recover !== 'function') {
      throw new BoundedAutonomyError('recovery_adapter_not_registered', 'adapter lacks the human recovery contract');
    }
    return adapter;
  }

  private async runtimeState(context: PolicyContext): Promise<AutonomyEnvelopeState> {
    const at = actionIso(this.now());
    const [g5, history, receivedAt, killSwitch, openIncidentCount, usage] = await Promise.all([
      this.repository.findLatestG5Decision(context.record.tenant_id, context.record.source_connection_id),
      this.repository.supervisedHistory(context.g6.record.id, context.manifest.history.window_days, at),
      this.repository.latestSourceReceivedAt(context.record.tenant_id, context.record.source_connection_id),
      this.repository.latestKillSwitch(context.record.id),
      this.repository.countOpenIncidents(context.record.id),
      this.repository.usage(context.record.id, at),
    ]);
    const sourceDelta = receivedAt === null ? null : Date.parse(at) - Date.parse(receivedAt);
    const sourceAge = sourceDelta === null || sourceDelta < 0 ? null : sourceDelta / 60_000;
    return {
      g5_current_go: Boolean(g5 && g5.id === context.record.g5_release_decision_id && g5.decision === 'go'),
      g6_active: policyIsActive(context.g6.manifest, at),
      g7_active: g7PolicyIsActive(context.manifest, at),
      history_qualified: this.historyQualified(context.manifest, history),
      simulation_passed: Boolean(context.simulation.passed),
      adapter_registered: true,
      source_age_minutes: sourceAge,
      kill_switch_released: killSwitch.state === 'released',
      open_incident_count: openIncidentCount,
      executions_last_hour: usage.executionsLastHour,
      executions_last_day: usage.executionsLastDay,
      cost_last_day: usage.costLastDay,
      cooldown_elapsed_seconds: usage.lastStartedAt === null
        ? null
        : Math.max(0, (Date.parse(at) - Date.parse(usage.lastStartedAt)) / 1_000),
      candidate_cost_minor: 0,
      preview_mutation_count: 0,
    };
  }

  private assertHistory(
    policy: G7BoundedAutonomyPolicyManifest,
    history: Awaited<ReturnType<BoundedAutonomyRepository['supervisedHistory']>>,
  ): void {
    if (!this.historyQualified(policy, history)) {
      throw new BoundedAutonomyError('supervised_history_not_qualified', 'supervised history does not qualify');
    }
  }

  private historyQualified(
    policy: G7BoundedAutonomyPolicyManifest,
    history: Awaited<ReturnType<BoundedAutonomyRepository['supervisedHistory']>>,
  ): boolean {
    return history.successful_executions >= policy.history.min_successful_executions
      && history.non_successful_executions <= policy.history.max_non_successful_executions
      && history.successful_rollbacks >= 1;
  }

  private assertReleaseIdentity(
    policy: G7BoundedAutonomyPolicyManifest,
    actor: string,
    releaseCredential: string,
    killSwitchCredential: string,
  ): void {
    if (actor !== policy.identities.release_authority) {
      throw new BoundedAutonomyError('release_actor_rejected', 'release actor does not match policy', 403);
    }
    if (!autonomyCredentialMatches(releaseCredential, policy.identities.release_credential_sha256)) {
      throw new BoundedAutonomyError('release_credential_rejected', 'release credential does not match', 403);
    }
    if (!autonomyCredentialMatches(killSwitchCredential, policy.identities.kill_switch_credential_sha256)) {
      throw new BoundedAutonomyError('kill_switch_credential_rejected', 'kill-switch credential does not match', 403);
    }
  }

  private assertExecutor(policy: G7BoundedAutonomyPolicyManifest, actor: string, credential: string): void {
    if (actor !== policy.identities.executor) {
      throw new BoundedAutonomyError('executor_actor_rejected', 'executor does not match policy', 403);
    }
    if (!autonomyCredentialMatches(credential, policy.identities.executor_credential_sha256)) {
      throw new BoundedAutonomyError('executor_credential_rejected', 'executor credential does not match', 403);
    }
  }

  private assertRecoverySubject(context: PolicyContext, subject: AutonomyAttemptRecord): void {
    if (
      subject.policy_record_id !== context.record.id
      || subject.kind !== 'execute'
      || subject.status !== 'succeeded'
      || subject.finished_at === null
      || subject.result_fingerprint === null
      || subject.external_request_id === null
    ) throw new BoundedAutonomyError('recovery_subject_invalid', 'recovery subject is not a successful bounded execution');
    if (Date.parse(actionIso(this.now())) >= Date.parse(subject.finished_at) + 24 * 3_600_000) {
      throw new BoundedAutonomyError('recovery_window_expired', '24-hour recovery window expired');
    }
  }

  private recoverySubject(subject: AutonomyAttemptRecord) {
    return {
      original_request_fingerprint: subject.request_fingerprint,
      original_result_fingerprint: subject.result_fingerprint!,
      original_external_request_id: subject.external_request_id!,
      original_idempotency_key: subject.idempotency_key,
    };
  }

  private recoveryIdempotencyKey(subjectAttemptId: string): string {
    return `recovery:${subjectAttemptId}`;
  }

  private async recordEvaluation(input: {
    context: PolicyContext;
    payloadJson: string;
    payloadFingerprint: string;
    reasonCode: string;
    evidenceRefsJson: string;
    idempotencyKey: string;
    requestFingerprint: string;
    targetFingerprint: string;
    at: string;
    preview?: {
      previewFingerprint: string;
      effect_fingerprint: string;
      summary_code: string;
      rollback_strategy_code: string;
      estimated_cost_minor: number;
      currency: string;
      external_mutation_count: 0;
    };
    decision: 'allow' | 'deny';
    decisionCode: string;
  }, actor: string): Promise<AutonomyEvaluationRecord> {
    const core: Omit<EvaluationInsert, 'evaluation_fingerprint'> = {
      tenant_id: input.context.record.tenant_id,
      source_connection_id: input.context.record.source_connection_id,
      policy_record_id: input.context.record.id,
      idempotency_key: input.idempotencyKey,
      payload_json: input.payloadJson,
      payload_fingerprint: input.payloadFingerprint,
      reason_code: input.reasonCode,
      evidence_refs_json: input.evidenceRefsJson,
      request_fingerprint: input.requestFingerprint,
      target_fingerprint: input.targetFingerprint,
      preview_fingerprint: input.preview?.previewFingerprint ?? null,
      effect_fingerprint: input.preview?.effect_fingerprint ?? null,
      summary_code: input.preview?.summary_code ?? null,
      rollback_strategy_code: input.preview?.rollback_strategy_code ?? null,
      estimated_cost_minor: input.preview?.estimated_cost_minor ?? 0,
      currency: input.preview?.currency ?? input.context.manifest.limits.currency,
      preview_mutation_count: input.preview?.external_mutation_count ?? null,
      decision: input.decision,
      decision_code: actionCode(input.decisionCode, 'invalid_autonomy_decision_code'),
      evaluated_at: actionIso(input.at),
    };
    return this.repository.recordEvaluation({ ...core, evaluation_fingerprint: autonomyFingerprint(core) }, actionActor(actor, 'invalid_executor'));
  }
}
