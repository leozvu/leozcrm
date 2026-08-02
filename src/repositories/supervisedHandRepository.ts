import type { Knex } from '../db/knex';
import { db } from '../db/knex';
import { BUSINESS_MEMORY_TABLES, SourceConnection } from '../domain/businessMemory';
import { G6_TABLES, SupervisedActionError, actionCode, actionHash, actionIso, actionUuid } from '../domain/supervisedAction';
import { REPOSITORYREALMS_TASK_CREATE_COMMAND } from '../domain/supervisedHand';
import { PHASE2_TABLES, Phase2ReleaseDecisionRecord } from '../domain/shadowTrust';
import { SupervisedActionRepository } from './supervisedActionRepository';

interface ProposalRow {
  id: string;
  tenant_id: string;
  policy_id: string;
  command_key: string;
  reason_code: string;
  expected_impact_code: string;
  requested_at: string;
  expires_at: string;
  proposal_fingerprint: string;
}

interface PreviewRow {
  id: string;
  tenant_id: string;
  proposal_id: string;
  kind: 'execute' | 'rollback';
  summary_code: string;
  rollback_strategy_code: string;
  previewed_at: string;
  expires_at: string;
  preview_fingerprint: string;
}

interface ApprovalRow {
  id: string;
  tenant_id: string;
  proposal_id: string;
  preview_id: string;
  kind: 'execute' | 'rollback';
  decision: 'approved' | 'rejected';
  reason_code: string;
  decided_at: string;
  expires_at: string;
  approval_fingerprint: string;
}

interface AttemptRow {
  id: string;
  tenant_id: string;
  proposal_id: string;
  kind: 'execute' | 'rollback';
  status: 'in_progress' | 'succeeded' | 'failed' | 'reconciliation_required';
  started_at: string;
  finished_at: string | null;
  external_request_id: string | null;
  result_fingerprint: string | null;
  result_code: string | null;
  external_mutation_count: number | null;
}

interface EventCountRow {
  proposal_id: string;
  count: number | string;
}

function proposal(row: ProposalRow): ProposalRow {
  actionUuid(row.id, 'corrupt_supervised_hand_proposal');
  actionUuid(row.tenant_id, 'corrupt_supervised_hand_proposal');
  if (!/^G6-[A-Za-z0-9._-]{4,64}$/.test(row.policy_id)) {
    throw new SupervisedActionError('corrupt_supervised_hand_proposal', 'proposal policy id is invalid');
  }
  actionCode(row.command_key, 'corrupt_supervised_hand_proposal');
  actionCode(row.reason_code, 'corrupt_supervised_hand_proposal');
  actionCode(row.expected_impact_code, 'corrupt_supervised_hand_proposal');
  actionIso(row.requested_at, 'corrupt_supervised_hand_proposal');
  actionIso(row.expires_at, 'corrupt_supervised_hand_proposal');
  actionHash(row.proposal_fingerprint, 'corrupt_supervised_hand_proposal');
  return row;
}

function preview(row: PreviewRow): PreviewRow {
  actionUuid(row.id, 'corrupt_supervised_hand_preview');
  actionUuid(row.tenant_id, 'corrupt_supervised_hand_preview');
  actionUuid(row.proposal_id, 'corrupt_supervised_hand_preview');
  if (row.kind !== 'execute' && row.kind !== 'rollback') throw new SupervisedActionError('corrupt_supervised_hand_preview', 'preview kind is invalid');
  actionCode(row.summary_code, 'corrupt_supervised_hand_preview');
  actionCode(row.rollback_strategy_code, 'corrupt_supervised_hand_preview');
  actionIso(row.previewed_at, 'corrupt_supervised_hand_preview');
  actionIso(row.expires_at, 'corrupt_supervised_hand_preview');
  actionHash(row.preview_fingerprint, 'corrupt_supervised_hand_preview');
  return row;
}

function approval(row: ApprovalRow): ApprovalRow {
  actionUuid(row.id, 'corrupt_supervised_hand_approval');
  actionUuid(row.tenant_id, 'corrupt_supervised_hand_approval');
  actionUuid(row.proposal_id, 'corrupt_supervised_hand_approval');
  actionUuid(row.preview_id, 'corrupt_supervised_hand_approval');
  if (row.kind !== 'execute' && row.kind !== 'rollback') throw new SupervisedActionError('corrupt_supervised_hand_approval', 'approval kind is invalid');
  if (row.decision !== 'approved' && row.decision !== 'rejected') throw new SupervisedActionError('corrupt_supervised_hand_approval', 'approval decision is invalid');
  actionCode(row.reason_code, 'corrupt_supervised_hand_approval');
  actionIso(row.decided_at, 'corrupt_supervised_hand_approval');
  actionIso(row.expires_at, 'corrupt_supervised_hand_approval');
  actionHash(row.approval_fingerprint, 'corrupt_supervised_hand_approval');
  return row;
}

function attempt(row: AttemptRow): AttemptRow {
  actionUuid(row.id, 'corrupt_supervised_hand_attempt');
  actionUuid(row.tenant_id, 'corrupt_supervised_hand_attempt');
  actionUuid(row.proposal_id, 'corrupt_supervised_hand_attempt');
  if (row.kind !== 'execute' && row.kind !== 'rollback') throw new SupervisedActionError('corrupt_supervised_hand_attempt', 'attempt kind is invalid');
  if (!['in_progress', 'succeeded', 'failed', 'reconciliation_required'].includes(row.status)) {
    throw new SupervisedActionError('corrupt_supervised_hand_attempt', 'attempt status is invalid');
  }
  actionIso(row.started_at, 'corrupt_supervised_hand_attempt');
  if (row.finished_at !== null) actionIso(row.finished_at, 'corrupt_supervised_hand_attempt');
  if (row.external_request_id !== null) actionCode(row.external_request_id, 'corrupt_supervised_hand_attempt');
  if (row.result_code !== null) actionCode(row.result_code, 'corrupt_supervised_hand_attempt');
  if (row.result_fingerprint !== null) actionHash(row.result_fingerprint, 'corrupt_supervised_hand_attempt');
  if (row.external_mutation_count !== null && (!Number.isInteger(row.external_mutation_count) || row.external_mutation_count < 0)) {
    throw new SupervisedActionError('corrupt_supervised_hand_attempt', 'attempt mutation count is invalid');
  }
  return row;
}

export interface SupervisedHandEvidence {
  connection: SourceConnection | null;
  latest_g5: Phase2ReleaseDecisionRecord | null;
  latest_policy: Awaited<ReturnType<SupervisedActionRepository['findPolicyByPolicyId']>> | null;
  proposals: ProposalRow[];
  previews: PreviewRow[];
  approvals: ApprovalRow[];
  attempts: AttemptRow[];
  event_counts: Map<string, number>;
}

export class SupervisedHandRepository {
  private readonly supervised: SupervisedActionRepository;

  constructor(private readonly knex: Knex = db) {
    this.supervised = new SupervisedActionRepository(knex);
  }

  async tenantEvidence(tenantId: string): Promise<SupervisedHandEvidence> {
    actionUuid(tenantId, 'invalid_supervised_hand_tenant');
    const connection = await this.knex<SourceConnection>(BUSINESS_MEMORY_TABLES.sourceConnections)
      .where({ tenant_id: tenantId })
      .orderBy('updated_at', 'desc')
      .orderBy('id', 'asc')
      .first() ?? null;
    const latestG5 = connection
      ? await this.knex<Phase2ReleaseDecisionRecord>(PHASE2_TABLES.releaseDecisions)
        .where({ tenant_id: tenantId, source_connection_id: connection.id })
        .orderBy('decided_at', 'desc')
        .orderBy('id', 'desc')
        .first() ?? null
      : null;
    const [policyRow, proposalRows] = await Promise.all([
      this.knex<{ policy_id: string }>(G6_TABLES.policies)
        .select('policy_id')
        .where({ tenant_id: tenantId, command_key: REPOSITORYREALMS_TASK_CREATE_COMMAND })
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .first(),
      this.knex<ProposalRow>(G6_TABLES.proposals)
        .select('id', 'tenant_id', 'policy_id', 'command_key', 'reason_code', 'expected_impact_code', 'requested_at', 'expires_at', 'proposal_fingerprint')
        .where({ tenant_id: tenantId, command_key: REPOSITORYREALMS_TASK_CREATE_COMMAND })
        .orderBy('requested_at', 'desc')
        .orderBy('id', 'desc'),
    ]);
    const latestPolicy = policyRow ? await this.supervised.findPolicyByPolicyId(policyRow.policy_id) : null;
    const proposalIds = proposalRows.map((row) => row.id);
    const [previewRows, approvalRows, attemptRows, countRows] = await Promise.all([
      this.knex<PreviewRow>(G6_TABLES.previews)
        .select('id', 'tenant_id', 'proposal_id', 'kind', 'summary_code', 'rollback_strategy_code', 'previewed_at', 'expires_at', 'preview_fingerprint')
        .where({ tenant_id: tenantId })
        .whereIn('proposal_id', proposalIds),
      this.knex<ApprovalRow>(G6_TABLES.approvals)
        .select('id', 'tenant_id', 'proposal_id', 'preview_id', 'kind', 'decision', 'reason_code', 'decided_at', 'expires_at', 'approval_fingerprint')
        .where({ tenant_id: tenantId })
        .whereIn('proposal_id', proposalIds),
      this.knex<AttemptRow>(G6_TABLES.attempts)
        .select('id', 'tenant_id', 'proposal_id', 'kind', 'status', 'started_at', 'finished_at', 'external_request_id', 'result_fingerprint', 'result_code', 'external_mutation_count')
        .where({ tenant_id: tenantId })
        .whereIn('proposal_id', proposalIds),
      this.knex<EventCountRow>(G6_TABLES.events)
        .select('proposal_id')
        .count<{ proposal_id: string; count: number | string }[]>({ count: '*' })
        .where({ tenant_id: tenantId })
        .whereIn('proposal_id', proposalIds)
        .groupBy('proposal_id'),
    ]);
    return {
      connection,
      latest_g5: latestG5,
      latest_policy: latestPolicy,
      proposals: proposalRows.map(proposal),
      previews: previewRows.map(preview),
      approvals: approvalRows.map(approval),
      attempts: attemptRows.map(attempt),
      event_counts: new Map(countRows.map((row) => [row.proposal_id, Number(row.count)])),
    };
  }
}
