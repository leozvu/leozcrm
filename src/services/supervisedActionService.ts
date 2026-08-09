import {
  G6ActionPolicyManifest,
  canonicalSafeActionPayload,
  validateG6ActionPolicy,
} from '../domain/g6Policy';
import {
  ActionApprovalDecision,
  ActionPreviewKind,
  SupervisedActionAdapter,
  SupervisedActionApproval,
  SupervisedActionAttempt,
  SupervisedActionError,
  SupervisedActionPolicyRecord,
  SupervisedActionPreview,
  SupervisedActionProposal,
  actionActor,
  actionCode,
  actionCurrency,
  actionEvidenceRefs,
  actionFingerprint,
  actionIdempotencyKey,
  actionIso,
  actionMoney,
  assertAdapterMatchesPolicy,
  attemptIsLeaseExpired,
  credentialMatches,
  policyIsActive,
  validateExecutionEvidence,
  validatePreviewEvidence,
} from '../domain/supervisedAction';
import { ActionAdapterRegistry } from '../integrations/actions/actionAdapterRegistry';
import { SupervisedActionRepository } from '../repositories/supervisedActionRepository';

export function supervisedTargetFingerprint(input: {
  projectId: string;
  tenantKey: string;
  endpointUrl: string;
  credentialFingerprint: string;
}): string {
  return actionFingerprint({
    system: 'egoric',
    project_id: input.projectId,
    tenant_key: input.tenantKey,
    command_endpoint_url: input.endpointUrl,
    command_credential_sha256: input.credentialFingerprint,
  });
}

export function supervisedRequestFingerprint(input: {
  commandKey: string;
  commandVersion: string;
  targetProjectId: string;
  targetTenantKey: string;
  targetEndpointUrl: string;
  targetCredentialFingerprint: string;
  payload: unknown;
  idempotencyKey: string;
}): string {
  return actionFingerprint({
    kind: 'execute',
    command_key: input.commandKey,
    command_version: input.commandVersion,
    target_project_id: input.targetProjectId,
    target_tenant_key: input.targetTenantKey,
    command_endpoint_url: input.targetEndpointUrl,
    command_credential_sha256: input.targetCredentialFingerprint,
    payload: JSON.parse(validatedPayloadJson(input.payload)),
    idempotency_key: input.idempotencyKey,
  });
}

export function supervisedRollbackRequestFingerprint(input: {
  commandKey: string;
  commandVersion: string;
  targetProjectId: string;
  targetTenantKey: string;
  targetEndpointUrl: string;
  targetCredentialFingerprint: string;
  proposalFingerprint: string;
  executionResultFingerprint: string;
  idempotencyKey: string;
}): string {
  return actionFingerprint({
    kind: 'rollback',
    command_key: input.commandKey,
    command_version: input.commandVersion,
    target_project_id: input.targetProjectId,
    target_tenant_key: input.targetTenantKey,
    command_endpoint_url: input.targetEndpointUrl,
    command_credential_sha256: input.targetCredentialFingerprint,
    proposal_fingerprint: input.proposalFingerprint,
    execution_result_fingerprint: input.executionResultFingerprint,
    idempotency_key: input.idempotencyKey,
  });
}

type RepositoryPort = Pick<
  SupervisedActionRepository,
  | 'findG5Decision'
  | 'findLatestG5Decision'
  | 'recordPolicy'
  | 'findPolicyByPolicyId'
  | 'recordProposal'
  | 'findProposal'
  | 'recordPreview'
  | 'findPreview'
  | 'recordApproval'
  | 'findApproval'
  | 'claimAttempt'
  | 'completeAttempt'
  | 'findAttempt'
  | 'listEvents'
>;

interface ActionContext {
  policyRecord: SupervisedActionPolicyRecord;
  policy: G6ActionPolicyManifest;
  proposal: SupervisedActionProposal;
  adapter: SupervisedActionAdapter;
}

export class SupervisedActionService {
  constructor(
    private readonly repository: RepositoryPort,
    private readonly adapters: ActionAdapterRegistry,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async acceptPolicy(input: unknown): Promise<SupervisedActionPolicyRecord> {
    const initial = validateG6ActionPolicy(input);
    if (!initial.ok || !initial.value) {
      throw new SupervisedActionError('invalid_action_policy', initial.issues.join('; '));
    }
    const g5 = await this.repository.findG5Decision(initial.value.g5_release.decision_id);
    if (!g5) throw new SupervisedActionError('missing_g5_go', 'referenced G5 decision does not exist');
    const validation = validateG6ActionPolicy(input, g5);
    if (!validation.ok || !validation.value) {
      throw new SupervisedActionError('invalid_action_policy', validation.issues.join('; '));
    }
    await this.assertCurrentG5(validation.value);
    const adapter = this.resolveAdapter(validation.value);
    assertAdapterMatchesPolicy(adapter, validation.value);
    return (await this.repository.recordPolicy(validation.value, g5)).record;
  }

  async propose(input: {
    policyId: string;
    payload: unknown;
    reasonCode: string;
    expectedImpactCode: string;
    evidenceRefs: string[];
    estimatedCostMinor: number;
    currency: string;
    idempotencyKey: string;
    requestedBy: string;
    expiresAt: string;
  }): Promise<SupervisedActionProposal> {
    const { record, manifest } = await this.repository.findPolicyByPolicyId(input.policyId);
    const at = this.now();
    await this.assertNewActionPrerequisites(manifest, at);
    const adapter = this.resolveAdapter(manifest);
    const payloadJson = validatedPayloadJson(input.payload);
    this.validateAdapterPayload(adapter, input.payload);
    const estimatedCost = actionMoney(
      input.estimatedCostMinor,
      'invalid_estimated_cost',
      manifest.limits.max_cost_minor,
    );
    const currency = actionCurrency(input.currency);
    if (currency !== manifest.limits.currency) {
      throw new SupervisedActionError('proposal_currency_mismatch', 'proposal currency does not match policy');
    }
    const expiresAt = actionIso(input.expiresAt, 'invalid_proposal_expiry');
    if (
      Date.parse(expiresAt) <= Date.parse(at)
      || Date.parse(expiresAt) > Date.parse(manifest.valid_until)
      || Date.parse(expiresAt) - Date.parse(at) > 24 * 60 * 60 * 1_000
    ) throw new SupervisedActionError('invalid_proposal_expiry', 'proposal expiry is outside the allowed window');
    const core = {
      tenant_id: manifest.tenant_id,
      source_connection_id: manifest.source_connection_id,
      policy_record_id: record.id,
      g5_release_decision_id: manifest.g5_release.decision_id,
      policy_id: manifest.policy_id,
      policy_fingerprint: record.policy_fingerprint,
      command_key: manifest.command.key,
      command_version: manifest.command.version,
      adapter_id: manifest.command.adapter_id,
      payload_json: payloadJson,
      payload_fingerprint: actionFingerprint(payloadJson),
      reason_code: actionCode(input.reasonCode, 'invalid_action_reason'),
      expected_impact_code: actionCode(input.expectedImpactCode, 'invalid_expected_impact'),
      evidence_refs_json: actionEvidenceRefs(input.evidenceRefs),
      estimated_cost_minor: estimatedCost,
      currency,
      idempotency_key: actionIdempotencyKey(input.idempotencyKey),
      requested_by: actionActor(input.requestedBy, 'invalid_requester'),
      requested_at: at,
      expires_at: expiresAt,
    };
    return this.repository.recordProposal({
      ...core,
      proposal_fingerprint: actionFingerprint(core),
    });
  }

  async preview(input: {
    proposalId: string;
    operator: string;
    operatorCredential: string;
  }): Promise<SupervisedActionPreview> {
    const context = await this.loadContext(input.proposalId);
    const at = this.now();
    await this.assertNewActionPrerequisites(context.policy, at);
    this.assertProposalUsable(context, at);
    this.assertOperator(context.policy, input.operator, input.operatorCredential);
    if (await this.repository.findAttempt(context.proposal.id, 'execute')) {
      throw new SupervisedActionError('action_already_attempted', 'proposal already has an execution attempt');
    }
    const payload = parsePayload(context.proposal.payload_json);
    this.validateAdapterPayload(context.adapter, payload);
    const evidence = validatePreviewEvidence(await context.adapter.preview({
      payload,
      targetProjectId: context.policy.target.project_id,
      targetTenantKey: context.policy.target.tenant_key,
      targetEndpointUrl: context.policy.target.command_endpoint_url,
      targetCredentialFingerprint: context.policy.target.command_credential_sha256,
      idempotencyKey: context.proposal.idempotency_key,
    }), context.policy);
    this.assertExecutePreviewFingerprints(context, evidence.request_fingerprint, evidence.target_fingerprint);
    const expiresAt = new Date(Math.min(
      Date.parse(context.proposal.expires_at),
      Date.parse(at) + context.policy.limits.approval_ttl_minutes * 60_000,
    )).toISOString();
    const core = {
      tenant_id: context.proposal.tenant_id,
      proposal_id: context.proposal.id,
      kind: 'execute' as const,
      subject_execution_id: null,
      policy_fingerprint: context.proposal.policy_fingerprint,
      proposal_fingerprint: context.proposal.proposal_fingerprint,
      adapter_id: context.adapter.descriptor.adapter_id,
      adapter_version: context.adapter.descriptor.adapter_version,
      ...evidence,
      previewed_at: at,
      expires_at: expiresAt,
    };
    return this.repository.recordPreview({ ...core, preview_fingerprint: actionFingerprint(core) }, input.operator);
  }

  async decide(input: {
    proposalId: string;
    kind: ActionPreviewKind;
    decision: ActionApprovalDecision;
    approver: string;
    approvalCredential: string;
    reasonCode: string;
    nonce: string;
    maxCostMinor: number;
  }): Promise<SupervisedActionApproval> {
    const context = await this.loadContext(input.proposalId);
    const at = this.now();
    if (input.kind === 'execute') {
      await this.assertNewActionPrerequisites(context.policy, at);
      this.assertProposalUsable(context, at);
    } else {
      await this.assertRollbackPrerequisites(context, at);
    }
    this.assertApprover(context.policy, input.approver, input.approvalCredential);
    const preview = await this.repository.findPreview(context.proposal.id, input.kind);
    this.assertPreviewBinding(context, preview);
    if (Date.parse(at) >= Date.parse(preview.expires_at)) {
      throw new SupervisedActionError('action_preview_expired', 'action preview has expired');
    }
    if (input.decision !== 'approved' && input.decision !== 'rejected') {
      throw new SupervisedActionError('invalid_approval_decision', 'approval decision is invalid');
    }
    const maxCost = actionMoney(
      input.maxCostMinor,
      'invalid_approval_cost',
      context.policy.limits.max_cost_minor,
    );
    if (maxCost < preview.estimated_cost_minor) {
      throw new SupervisedActionError('approval_cost_below_preview', 'approval ceiling is below preview cost');
    }
    const expiresAt = new Date(Math.min(
      Date.parse(preview.expires_at),
      Date.parse(at) + context.policy.limits.approval_ttl_minutes * 60_000,
    )).toISOString();
    const core = {
      tenant_id: context.proposal.tenant_id,
      proposal_id: context.proposal.id,
      preview_id: preview.id,
      kind: input.kind,
      decision: input.decision,
      policy_fingerprint: context.proposal.policy_fingerprint,
      proposal_fingerprint: context.proposal.proposal_fingerprint,
      preview_fingerprint: preview.preview_fingerprint,
      approver: input.approver,
      reason_code: actionCode(input.reasonCode, 'invalid_approval_reason'),
      nonce: actionIdempotencyKey(input.nonce),
      max_cost_minor: maxCost,
      currency: context.policy.limits.currency,
      decided_at: at,
      expires_at: expiresAt,
    };
    return this.repository.recordApproval({ ...core, approval_fingerprint: actionFingerprint(core) });
  }

  async execute(input: {
    proposalId: string;
    operator: string;
    operatorCredential: string;
  }): Promise<{ attempt: SupervisedActionAttempt; replayed: boolean }> {
    const context = await this.loadContext(input.proposalId);
    const at = this.now();
    await this.assertNewActionPrerequisites(context.policy, at);
    this.assertProposalUsable(context, at);
    this.assertOperator(context.policy, input.operator, input.operatorCredential);
    const preview = await this.repository.findPreview(context.proposal.id, 'execute');
    const approval = await this.repository.findApproval(preview.id);
    this.assertApprovalUsable(context, preview, approval, at);
    this.assertExecutePreviewFingerprints(context, preview.request_fingerprint, preview.target_fingerprint);
    return this.runAttempt({
      context,
      kind: 'execute',
      preview,
      approval,
      subjectExecution: null,
      idempotencyKey: context.proposal.idempotency_key,
      operator: input.operator,
      startedAt: at,
      emergencyRollback: false,
    });
  }

  async previewRollback(input: {
    proposalId: string;
    operator: string;
    operatorCredential: string;
  }): Promise<SupervisedActionPreview> {
    const context = await this.loadContext(input.proposalId);
    const at = this.now();
    const execution = await this.assertRollbackPrerequisites(context, at);
    this.assertOperator(context.policy, input.operator, input.operatorCredential);
    if (await this.repository.findAttempt(context.proposal.id, 'rollback')) {
      throw new SupervisedActionError('rollback_already_attempted', 'proposal already has a rollback attempt');
    }
    const idempotencyKey = rollbackIdempotencyKey(context.proposal.id);
    const evidence = validatePreviewEvidence(await context.adapter.previewRollback({
      proposal: context.proposal,
      execution,
      targetProjectId: context.policy.target.project_id,
      targetTenantKey: context.policy.target.tenant_key,
      targetEndpointUrl: context.policy.target.command_endpoint_url,
      targetCredentialFingerprint: context.policy.target.command_credential_sha256,
      idempotencyKey,
    }), context.policy);
    this.assertRollbackPreviewFingerprints(
      context,
      execution,
      idempotencyKey,
      evidence.request_fingerprint,
      evidence.target_fingerprint,
    );
    const rollbackDeadline = Date.parse(execution.finished_at!) + 24 * 60 * 60 * 1_000;
    const expiresAt = new Date(Math.min(
      rollbackDeadline,
      Date.parse(at) + context.policy.limits.approval_ttl_minutes * 60_000,
    )).toISOString();
    const core = {
      tenant_id: context.proposal.tenant_id,
      proposal_id: context.proposal.id,
      kind: 'rollback' as const,
      subject_execution_id: execution.id,
      policy_fingerprint: context.proposal.policy_fingerprint,
      proposal_fingerprint: context.proposal.proposal_fingerprint,
      adapter_id: context.adapter.descriptor.adapter_id,
      adapter_version: context.adapter.descriptor.adapter_version,
      ...evidence,
      previewed_at: at,
      expires_at: expiresAt,
    };
    return this.repository.recordPreview({ ...core, preview_fingerprint: actionFingerprint(core) }, input.operator);
  }

  async rollback(input: {
    proposalId: string;
    operator: string;
    operatorCredential: string;
  }): Promise<{ attempt: SupervisedActionAttempt; replayed: boolean }> {
    const context = await this.loadContext(input.proposalId);
    const at = this.now();
    const execution = await this.assertRollbackPrerequisites(context, at);
    this.assertOperator(context.policy, input.operator, input.operatorCredential);
    const preview = await this.repository.findPreview(context.proposal.id, 'rollback');
    const approval = await this.repository.findApproval(preview.id);
    this.assertApprovalUsable(context, preview, approval, at);
    const idempotencyKey = rollbackIdempotencyKey(context.proposal.id);
    this.assertRollbackPreviewFingerprints(
      context,
      execution,
      idempotencyKey,
      preview.request_fingerprint,
      preview.target_fingerprint,
    );
    return this.runAttempt({
      context,
      kind: 'rollback',
      preview,
      approval,
      subjectExecution: execution,
      idempotencyKey,
      operator: input.operator,
      startedAt: at,
      emergencyRollback: true,
    });
  }

  async status(proposalId: string): Promise<{
    proposal: SupervisedActionProposal;
    events: Awaited<ReturnType<RepositoryPort['listEvents']>>;
    execution: SupervisedActionAttempt | null;
    rollback: SupervisedActionAttempt | null;
  }> {
    const proposal = await this.repository.findProposal(proposalId);
    return {
      proposal,
      events: await this.repository.listEvents(proposalId),
      execution: await this.repository.findAttempt(proposalId, 'execute') ?? null,
      rollback: await this.repository.findAttempt(proposalId, 'rollback') ?? null,
    };
  }

  async reconcileExpiredAttempt(input: {
    proposalId: string;
    kind: ActionPreviewKind;
    operator: string;
    operatorCredential: string;
  }): Promise<SupervisedActionAttempt> {
    const proposal = await this.repository.findProposal(input.proposalId);
    const { record, manifest } = await this.repository.findPolicyByPolicyId(proposal.policy_id);
    if (
      proposal.policy_record_id !== record.id
      || proposal.policy_fingerprint !== record.policy_fingerprint
      || proposal.tenant_id !== manifest.tenant_id
    ) throw new SupervisedActionError('proposal_policy_mismatch', 'proposal does not match its policy');
    this.assertOperator(manifest, input.operator, input.operatorCredential);
    const attempt = await this.repository.findAttempt(proposal.id, input.kind);
    if (!attempt) throw new SupervisedActionError('missing_action_attempt', 'action attempt does not exist');
    if (attempt.status !== 'in_progress') return attempt;
    const at = this.now();
    if (!attemptIsLeaseExpired(attempt, at)) {
      throw new SupervisedActionError('action_execution_busy', 'execution lease has not expired');
    }
    const code = input.kind === 'execute' ? 'execution_lease_expired' : 'rollback_lease_expired';
    return this.repository.completeAttempt(attempt.id, {
      status: 'reconciliation_required',
      finished_at: at,
      external_request_id: null,
      result_fingerprint: actionFingerprint({ code, attempt_id: attempt.id }),
      result_code: code,
      actual_cost_minor: null,
      external_mutation_count: null,
      latency_ms: Math.max(0, Date.parse(at) - Date.parse(attempt.started_at)),
    });
  }

  private async loadContext(proposalId: string): Promise<ActionContext> {
    const proposal = await this.repository.findProposal(proposalId);
    const { record, manifest } = await this.repository.findPolicyByPolicyId(proposal.policy_id);
    if (
      proposal.policy_record_id !== record.id
      || proposal.policy_fingerprint !== record.policy_fingerprint
      || proposal.g5_release_decision_id !== manifest.g5_release.decision_id
      || proposal.tenant_id !== manifest.tenant_id
      || proposal.source_connection_id !== manifest.source_connection_id
      || proposal.command_key !== manifest.command.key
      || proposal.command_version !== manifest.command.version
      || proposal.adapter_id !== manifest.command.adapter_id
    ) throw new SupervisedActionError('proposal_policy_mismatch', 'proposal does not match its policy');
    return { policyRecord: record, policy: manifest, proposal, adapter: this.resolveAdapter(manifest) };
  }

  private async assertCurrentG5(policy: G6ActionPolicyManifest): Promise<void> {
    const g5 = await this.repository.findG5Decision(policy.g5_release.decision_id);
    if (!g5) throw new SupervisedActionError('missing_g5_go', 'referenced G5 decision does not exist');
    const validation = validateG6ActionPolicy(policy, g5);
    if (!validation.ok) {
      throw new SupervisedActionError('g5_policy_mismatch', validation.issues.join('; '));
    }
    const latest = await this.repository.findLatestG5Decision(policy.tenant_id, policy.source_connection_id);
    if (!latest || latest.id !== g5.id || latest.decision !== 'go') {
      throw new SupervisedActionError('g5_not_current_go', 'G5 go is absent, superseded, extended, or revoked');
    }
  }

  private async assertNewActionPrerequisites(policy: G6ActionPolicyManifest, at: string): Promise<void> {
    if (!policyIsActive(policy, at)) {
      throw new SupervisedActionError('action_policy_inactive', 'action policy is not active');
    }
    await this.assertCurrentG5(policy);
    assertAdapterMatchesPolicy(this.resolveAdapter(policy), policy);
  }

  private async assertRollbackPrerequisites(
    context: ActionContext,
    at: string,
  ): Promise<SupervisedActionAttempt> {
    const g5 = await this.repository.findG5Decision(context.policy.g5_release.decision_id);
    if (!g5 || !validateG6ActionPolicy(context.policy, g5).ok) {
      throw new SupervisedActionError('rollback_policy_mismatch', 'rollback policy lost its original G5 binding');
    }
    assertAdapterMatchesPolicy(context.adapter, context.policy);
    const execution = await this.repository.findAttempt(context.proposal.id, 'execute');
    if (!execution || execution.status !== 'succeeded' || !execution.finished_at || !execution.result_fingerprint) {
      throw new SupervisedActionError('rollback_not_available', 'only a successful execution can be rolled back');
    }
    if (Date.parse(at) >= Date.parse(execution.finished_at) + 24 * 60 * 60 * 1_000) {
      throw new SupervisedActionError('rollback_window_expired', '24-hour rollback safety window has expired');
    }
    return execution;
  }

  private assertProposalUsable(context: ActionContext, at: string): void {
    if (Date.parse(at) >= Date.parse(context.proposal.expires_at)) {
      throw new SupervisedActionError('action_proposal_expired', 'action proposal has expired');
    }
    const payload = parsePayload(context.proposal.payload_json);
    const canonical = validatedPayloadJson(payload);
    if (
      canonical !== context.proposal.payload_json
      || actionFingerprint(canonical) !== context.proposal.payload_fingerprint
    ) throw new SupervisedActionError('action_payload_tampered', 'action payload fingerprint is invalid');
  }

  private assertPreviewBinding(context: ActionContext, preview: SupervisedActionPreview): void {
    if (
      preview.tenant_id !== context.proposal.tenant_id
      || preview.proposal_id !== context.proposal.id
      || preview.policy_fingerprint !== context.proposal.policy_fingerprint
      || preview.proposal_fingerprint !== context.proposal.proposal_fingerprint
      || preview.adapter_id !== context.adapter.descriptor.adapter_id
    ) throw new SupervisedActionError('preview_binding_mismatch', 'preview does not match proposal and policy');
  }

  private assertApprovalUsable(
    context: ActionContext,
    preview: SupervisedActionPreview,
    approval: SupervisedActionApproval,
    at: string,
  ): void {
    this.assertPreviewBinding(context, preview);
    if (
      approval.decision !== 'approved'
      || approval.kind !== preview.kind
      || approval.tenant_id !== context.proposal.tenant_id
      || approval.proposal_id !== context.proposal.id
      || approval.preview_id !== preview.id
      || approval.policy_fingerprint !== context.proposal.policy_fingerprint
      || approval.proposal_fingerprint !== context.proposal.proposal_fingerprint
      || approval.preview_fingerprint !== preview.preview_fingerprint
      || approval.currency !== context.policy.limits.currency
      || approval.max_cost_minor < preview.estimated_cost_minor
    ) throw new SupervisedActionError('approval_binding_mismatch', 'approval does not exactly authorize the preview');
    if (Date.parse(at) >= Date.parse(approval.expires_at)) {
      throw new SupervisedActionError('action_approval_expired', 'action approval has expired');
    }
  }

  private assertExecutePreviewFingerprints(
    context: ActionContext,
    requestFingerprint: string,
    targetFingerprint: string,
  ): void {
    const payload = parsePayload(context.proposal.payload_json);
    const expectedRequest = supervisedRequestFingerprint({
      commandKey: context.policy.command.key,
      commandVersion: context.policy.command.version,
      targetProjectId: context.policy.target.project_id,
      targetTenantKey: context.policy.target.tenant_key,
      targetEndpointUrl: context.policy.target.command_endpoint_url,
      targetCredentialFingerprint: context.policy.target.command_credential_sha256,
      payload,
      idempotencyKey: context.proposal.idempotency_key,
    });
    const expectedTarget = supervisedTargetFingerprint({
      projectId: context.policy.target.project_id,
      tenantKey: context.policy.target.tenant_key,
      endpointUrl: context.policy.target.command_endpoint_url,
      credentialFingerprint: context.policy.target.command_credential_sha256,
    });
    if (requestFingerprint !== expectedRequest || targetFingerprint !== expectedTarget) {
      throw new SupervisedActionError('preview_fingerprint_mismatch', 'dry-run does not match exact request target');
    }
  }

  private assertRollbackPreviewFingerprints(
    context: ActionContext,
    execution: SupervisedActionAttempt,
    idempotencyKey: string,
    requestFingerprint: string,
    targetFingerprint: string,
  ): void {
    const expectedRequest = supervisedRollbackRequestFingerprint({
      commandKey: context.policy.command.key,
      commandVersion: context.policy.command.version,
      targetProjectId: context.policy.target.project_id,
      targetTenantKey: context.policy.target.tenant_key,
      targetEndpointUrl: context.policy.target.command_endpoint_url,
      targetCredentialFingerprint: context.policy.target.command_credential_sha256,
      proposalFingerprint: context.proposal.proposal_fingerprint,
      executionResultFingerprint: execution.result_fingerprint!,
      idempotencyKey,
    });
    const expectedTarget = supervisedTargetFingerprint({
      projectId: context.policy.target.project_id,
      tenantKey: context.policy.target.tenant_key,
      endpointUrl: context.policy.target.command_endpoint_url,
      credentialFingerprint: context.policy.target.command_credential_sha256,
    });
    if (requestFingerprint !== expectedRequest || targetFingerprint !== expectedTarget) {
      throw new SupervisedActionError('rollback_preview_mismatch', 'rollback dry-run does not match execution target');
    }
  }

  private assertApprover(policy: G6ActionPolicyManifest, approver: string, credential: string): void {
    if (
      approver !== policy.identities.approver
      || !credentialMatches(credential, policy.identities.approval_credential_sha256)
    ) throw new SupervisedActionError('approval_auth_failed', 'approver identity or credential is invalid');
  }

  private assertOperator(policy: G6ActionPolicyManifest, operator: string, credential: string): void {
    if (
      operator !== policy.identities.operator
      || !credentialMatches(credential, policy.identities.operator_credential_sha256)
    ) throw new SupervisedActionError('operator_auth_failed', 'operator identity or credential is invalid');
  }

  private resolveAdapter(policy: G6ActionPolicyManifest): SupervisedActionAdapter {
    return this.adapters.resolve({
      environment: policy.environment,
      commandKey: policy.command.key,
      commandVersion: policy.command.version,
      adapterId: policy.command.adapter_id,
    });
  }

  private validateAdapterPayload(adapter: SupervisedActionAdapter, payload: unknown): void {
    try {
      adapter.validatePayload(payload);
    } catch {
      throw new SupervisedActionError(
        'action_payload_schema_invalid',
        'action payload does not match the command-specific schema',
      );
    }
  }

  private async runAttempt(input: {
    context: ActionContext;
    kind: ActionPreviewKind;
    preview: SupervisedActionPreview;
    approval: SupervisedActionApproval;
    subjectExecution: SupervisedActionAttempt | null;
    idempotencyKey: string;
    operator: string;
    startedAt: string;
    emergencyRollback: boolean;
  }): Promise<{ attempt: SupervisedActionAttempt; replayed: boolean }> {
    const leaseExpiresAt = new Date(
      Date.parse(input.startedAt) + input.context.policy.limits.execution_lease_seconds * 1_000,
    ).toISOString();
    const claimed = await this.repository.claimAttempt({
      tenant_id: input.context.proposal.tenant_id,
      proposal_id: input.context.proposal.id,
      preview_id: input.preview.id,
      approval_id: input.approval.id,
      kind: input.kind,
      subject_execution_id: input.subjectExecution?.id ?? null,
      idempotency_key: input.idempotencyKey,
      request_fingerprint: input.preview.request_fingerprint,
      operator: input.operator,
      reserved_cost_minor: input.preview.estimated_cost_minor,
      started_at: input.startedAt,
      lease_expires_at: leaseExpiresAt,
      currency: input.context.policy.limits.currency,
    }, {
      maxPerHour: input.context.policy.limits.max_executions_per_hour,
      maxPerDay: input.context.policy.limits.max_executions_per_day,
      maxCostMinor: input.context.policy.limits.max_cost_minor,
      emergencyRollback: input.emergencyRollback,
    });
    if (claimed.replayed) {
      if (claimed.attempt.status === 'in_progress') {
        const replayAt = this.now();
        if (!attemptIsLeaseExpired(claimed.attempt, replayAt)) {
          throw new SupervisedActionError('action_execution_busy', 'an execution claim is still active');
        }
        const reconciled = await this.repository.completeAttempt(claimed.attempt.id, {
          status: 'reconciliation_required',
          finished_at: replayAt,
          external_request_id: null,
          result_fingerprint: actionFingerprint({
            code: 'execution_lease_expired',
            attempt_id: claimed.attempt.id,
          }),
          result_code: 'execution_lease_expired',
          actual_cost_minor: null,
          external_mutation_count: null,
          latency_ms: Math.max(0, Date.parse(replayAt) - Date.parse(claimed.attempt.started_at)),
        });
        return { attempt: reconciled, replayed: true };
      }
      return claimed;
    }

    const callStarted = Date.parse(input.startedAt);
    try {
      const raw = input.kind === 'execute'
        ? await input.context.adapter.execute({
          payload: parsePayload(input.context.proposal.payload_json),
          targetProjectId: input.context.policy.target.project_id,
          targetTenantKey: input.context.policy.target.tenant_key,
          targetEndpointUrl: input.context.policy.target.command_endpoint_url,
          targetCredentialFingerprint: input.context.policy.target.command_credential_sha256,
          idempotencyKey: input.idempotencyKey,
          preview: input.preview,
        })
        : await input.context.adapter.rollback({
          proposal: input.context.proposal,
          execution: input.subjectExecution!,
          targetProjectId: input.context.policy.target.project_id,
          targetTenantKey: input.context.policy.target.tenant_key,
          targetEndpointUrl: input.context.policy.target.command_endpoint_url,
          targetCredentialFingerprint: input.context.policy.target.command_credential_sha256,
          idempotencyKey: input.idempotencyKey,
          preview: input.preview,
        });
      const result = validateExecutionEvidence(raw, input.context.policy);
      if (result.actual_cost_minor > input.approval.max_cost_minor) {
        throw new SupervisedActionError('approval_cost_exceeded', 'actual cost exceeds approval ceiling');
      }
      const finishedAt = this.now();
      const attempt = await this.repository.completeAttempt(claimed.attempt.id, {
        status: result.outcome,
        finished_at: finishedAt,
        external_request_id: result.external_request_id,
        result_fingerprint: result.result_fingerprint,
        result_code: result.result_code,
        actual_cost_minor: result.actual_cost_minor,
        external_mutation_count: result.external_mutation_count,
        latency_ms: Math.max(0, Date.parse(finishedAt) - callStarted),
      });
      return { attempt, replayed: false };
    } catch (error) {
      const finishedAt = this.now();
      const safeCode = error instanceof SupervisedActionError
        ? actionCode(error.code, 'unsafe_adapter_error')
        : 'adapter_outcome_unknown';
      const attempt = await this.repository.completeAttempt(claimed.attempt.id, {
        status: 'reconciliation_required',
        finished_at: finishedAt,
        external_request_id: null,
        result_fingerprint: actionFingerprint({ code: safeCode, attempt_id: claimed.attempt.id }),
        result_code: safeCode,
        actual_cost_minor: null,
        external_mutation_count: null,
        latency_ms: Math.max(0, Date.parse(finishedAt) - callStarted),
      });
      return { attempt, replayed: false };
    }
  }

  private now(): string {
    return actionIso(this.clock());
  }
}

function parsePayload(payloadJson: string): unknown {
  try {
    return JSON.parse(payloadJson);
  } catch {
    throw new SupervisedActionError('corrupt_action_payload', 'stored action payload is invalid JSON');
  }
}

function validatedPayloadJson(payload: unknown): string {
  try {
    return canonicalSafeActionPayload(payload);
  } catch {
    throw new SupervisedActionError(
      'unsafe_action_payload',
      'action payload contains an unsupported, sensitive, or oversized value',
    );
  }
}

function rollbackIdempotencyKey(proposalId: string): string {
  return actionIdempotencyKey(`rollback:${proposalId}`);
}
