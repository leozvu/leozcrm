import qualificationInput from '../../config/phase14.repositoryrealms-task-create.audit.json';
import { BusinessMemoryRepository } from '../repositories/businessMemoryRepository';
import { SupervisedHandRepository } from '../repositories/supervisedHandRepository';
import { actionIso } from '../domain/supervisedAction';
import { validateSupervisedHandQualification } from '../domain/supervisedHand';

export class SupervisedHandError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) {
    super(message);
    this.name = 'SupervisedHandError';
  }
}

export class SupervisedHandService {
  constructor(
    private readonly memory: BusinessMemoryRepository,
    private readonly repository: SupervisedHandRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async state(tenantKey: string) {
    const tenant = await this.memory.findTenantByKey(tenantKey);
    if (!tenant) throw new SupervisedHandError('unknown_tenant', 'tenant does not exist', 404);
    const now = actionIso(this.clock());
    const qualification = validateSupervisedHandQualification(qualificationInput);
    const evidence = await this.repository.tenantEvidence(tenant.id);
    const sourceBlockers = qualification.blockers;
    const connectionActive = evidence.connection?.status === 'active';
    const g5Accepted = connectionActive && evidence.latest_g5?.decision === 'go';
    const policy = evidence.latest_policy?.record;
    const g6PolicyAccepted = Boolean(
      policy
      && evidence.connection
      && evidence.latest_g5
      && policy.tenant_id === tenant.id
      && policy.source_connection_id === evidence.connection.id
      && policy.g5_release_decision_id === evidence.latest_g5.id
      && Date.parse(now) >= Date.parse(policy.valid_from)
      && Date.parse(now) < Date.parse(policy.valid_until),
    );
    const gateBlockers = [
      ...(connectionActive ? [] : ['active_source_connection_missing']),
      ...(g5Accepted ? [] : ['live_g5_go_missing']),
      ...(g6PolicyAccepted ? [] : ['command_specific_g6_policy_missing_or_inactive']),
    ];
    const previewsByProposal = new Map(evidence.previews.map((item) => [`${item.proposal_id}:${item.kind}`, item]));
    const approvalsByPreview = new Map(evidence.approvals.map((item) => [item.preview_id, item]));
    const attemptsByProposal = new Map(evidence.attempts.map((item) => [`${item.proposal_id}:${item.kind}`, item]));
    const records = evidence.proposals.map((proposal) => {
      const executePreview = previewsByProposal.get(`${proposal.id}:execute`);
      const executeApproval = executePreview ? approvalsByPreview.get(executePreview.id) : undefined;
      const execution = attemptsByProposal.get(`${proposal.id}:execute`);
      const rollbackPreview = previewsByProposal.get(`${proposal.id}:rollback`);
      const rollbackApproval = rollbackPreview ? approvalsByPreview.get(rollbackPreview.id) : undefined;
      const rollback = attemptsByProposal.get(`${proposal.id}:rollback`);
      return {
        proposal_id: proposal.id,
        policy_id: proposal.policy_id,
        command_key: proposal.command_key,
        reason_code: proposal.reason_code,
        expected_impact_code: proposal.expected_impact_code,
        requested_at: proposal.requested_at,
        expires_at: proposal.expires_at,
        proposal_state: Date.parse(now) >= Date.parse(proposal.expires_at) ? 'expired' : 'open',
        preview: executePreview ? {
          state: Date.parse(now) >= Date.parse(executePreview.expires_at) ? 'expired' : 'recorded',
          summary_code: executePreview.summary_code,
          rollback_strategy_code: executePreview.rollback_strategy_code,
          previewed_at: executePreview.previewed_at,
          expires_at: executePreview.expires_at,
        } : { state: 'not_recorded' },
        approval: executeApproval ? {
          state: executeApproval.decision,
          reason_code: executeApproval.reason_code,
          decided_at: executeApproval.decided_at,
          expires_at: executeApproval.expires_at,
        } : { state: 'not_recorded' },
        execution: execution ? {
          state: execution.status,
          started_at: execution.started_at,
          finished_at: execution.finished_at,
          receipt_id: execution.external_request_id,
          result_code: execution.result_code,
          result_fingerprint: execution.result_fingerprint,
          external_mutation_count: execution.external_mutation_count,
        } : { state: 'not_started' },
        rollback: rollback ? {
          state: rollback.status,
          started_at: rollback.started_at,
          finished_at: rollback.finished_at,
          receipt_id: rollback.external_request_id,
          result_code: rollback.result_code,
          result_fingerprint: rollback.result_fingerprint,
        } : rollbackApproval ? {
          state: rollbackApproval.decision,
          decided_at: rollbackApproval.decided_at,
        } : rollbackPreview ? {
          state: Date.parse(now) >= Date.parse(rollbackPreview.expires_at) ? 'preview_expired' : 'preview_recorded',
          previewed_at: rollbackPreview.previewed_at,
        } : { state: 'not_started' },
        incident_state: execution?.status === 'reconciliation_required' || rollback?.status === 'reconciliation_required'
          ? 'manual_reconciliation_required'
          : 'none',
        event_count: evidence.event_counts.get(proposal.id) ?? 0,
      };
    });
    return {
      schema_version: 'leozops_supervised_hand_state_v1',
      tenant: { key: tenant.tenant_key, display_name: tenant.display_name },
      evaluated_at: now,
      status: [...sourceBlockers, ...gateBlockers].length === 0 ? 'ready' : 'blocked',
      authority: 'no_http_execution_authority',
      source_contract: {
        repository: qualification.value.repository,
        source_ref: qualification.value.source_ref,
        source_commit: qualification.value.source_commit,
        source_state: qualification.value.source_state,
        source_patch_fingerprint: qualification.value.source_patch_fingerprint,
        command_key: qualification.value.command_key,
        action: qualification.value.action,
        scope: qualification.value.scope,
        endpoint_path: qualification.value.endpoint_path,
        receipt_path: qualification.value.receipt_path,
        payload_profile: qualification.value.payload_profile,
        fingerprint: qualification.fingerprint,
        verdict: qualification.value.verdict,
        capabilities: qualification.value.capabilities,
      },
      gates: {
        source_connection: evidence.connection ? evidence.connection.status : 'missing',
        g5: evidence.latest_g5?.decision ?? 'missing',
        g6_policy: g6PolicyAccepted ? 'accepted' : 'missing_or_inactive',
        adapter_registry: 'empty',
      },
      blockers: [...sourceBlockers, ...gateBlockers],
      summary: {
        proposals: records.length,
        awaiting_approval: records.filter((item) => item.preview.state === 'recorded' && item.approval.state === 'not_recorded').length,
        succeeded: records.filter((item) => item.execution.state === 'succeeded').length,
        incidents: records.filter((item) => item.incident_state !== 'none').length,
      },
      records,
    };
  }
}
