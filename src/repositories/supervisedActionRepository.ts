import { v4 as uuidv4 } from 'uuid';
import { canonicalStringify } from '../domain/businessMemory';
import {
  G6ActionPolicyManifest,
  g6PolicyFingerprint,
  validateG6ActionPolicy,
} from '../domain/g6Policy';
import type { Phase2ReleaseDecisionRecord } from '../domain/shadowTrust';
import { PHASE2_TABLES } from '../domain/shadowTrust';
import {
  ActionApprovalDecision,
  ActionAttemptStatus,
  ActionEventType,
  ActionPreviewKind,
  G6_TABLES,
  SupervisedActionApproval,
  SupervisedActionAttempt,
  SupervisedActionError,
  SupervisedActionEvent,
  SupervisedActionPolicyRecord,
  SupervisedActionPreview,
  SupervisedActionProposal,
  actionActor,
  actionCode,
  actionCurrency,
  actionEvidenceRefs,
  actionFingerprint,
  actionHash,
  actionIdempotencyKey,
  actionIso,
  actionMoney,
  actionUuid,
} from '../domain/supervisedAction';
import { db, Knex } from '../db/knex';

type PolicyInsert = Omit<SupervisedActionPolicyRecord, 'id' | 'created_at'>;
type ProposalInsert = Omit<SupervisedActionProposal, 'id' | 'created_at'>;
type PreviewInsert = Omit<SupervisedActionPreview, 'id' | 'created_at'>;
type ApprovalInsert = Omit<SupervisedActionApproval, 'id' | 'created_at'>;
type AttemptInsert = Omit<
  SupervisedActionAttempt,
  | 'id'
  | 'status'
  | 'finished_at'
  | 'external_request_id'
  | 'result_fingerprint'
  | 'result_code'
  | 'actual_cost_minor'
  | 'external_mutation_count'
  | 'latency_ms'
  | 'created_at'
>;

interface EventInput {
  tenant_id: string;
  proposal_id: string;
  event_type: ActionEventType;
  actor: string;
  evidence_fingerprint: string;
  reason_code: string;
  occurred_at: string;
}

interface AttemptCompletion {
  status: Exclude<ActionAttemptStatus, 'in_progress'>;
  finished_at: string;
  external_request_id: string | null;
  result_fingerprint: string;
  result_code: string;
  actual_cost_minor: number | null;
  external_mutation_count: number | null;
  latency_ms: number;
}

const EVENT_TYPES: readonly ActionEventType[] = [
  'proposed',
  'execute_previewed',
  'execute_approved',
  'execute_rejected',
  'execution_started',
  'execution_succeeded',
  'execution_failed',
  'rollback_previewed',
  'rollback_approved',
  'rollback_rejected',
  'rollback_started',
  'rollback_succeeded',
  'rollback_failed',
];

function parseJson(value: string, code: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new SupervisedActionError(code, 'stored JSON is invalid');
  }
}

function normalizePolicy(row: SupervisedActionPolicyRecord | undefined): {
  record: SupervisedActionPolicyRecord;
  manifest: G6ActionPolicyManifest;
} {
  if (!row) throw new SupervisedActionError('missing_action_policy', 'action policy does not exist');
  const validation = validateG6ActionPolicy(parseJson(row.manifest_json, 'corrupt_action_policy'));
  if (!validation.ok || !validation.value || !validation.fingerprint) {
    throw new SupervisedActionError('corrupt_action_policy', 'stored action policy failed validation');
  }
  const record = {
    ...row,
    valid_from: actionIso(row.valid_from, 'corrupt_action_policy'),
    valid_until: actionIso(row.valid_until, 'corrupt_action_policy'),
    created_at: actionIso(row.created_at, 'corrupt_action_policy'),
  };
  actionUuid(record.id, 'corrupt_action_policy');
  if (
    record.tenant_id !== validation.value.tenant_id
    || record.source_connection_id !== validation.value.source_connection_id
    || record.g5_release_decision_id !== validation.value.g5_release.decision_id
    || record.policy_id !== validation.value.policy_id
    || record.environment !== validation.value.environment
    || record.command_key !== validation.value.command.key
    || record.command_version !== validation.value.command.version
    || record.adapter_id !== validation.value.command.adapter_id
    || record.risk_tier !== validation.value.command.risk_tier
    || record.target_project_id !== validation.value.target.project_id
    || record.target_tenant_key !== validation.value.target.tenant_key
    || record.target_endpoint_url !== validation.value.target.command_endpoint_url
    || record.target_credential_sha256 !== validation.value.target.command_credential_sha256
    || record.valid_from !== actionIso(validation.value.valid_from)
    || record.valid_until !== actionIso(validation.value.valid_until)
    || record.policy_fingerprint !== validation.fingerprint
    || record.manifest_json !== canonicalStringify(validation.value)
  ) throw new SupervisedActionError('corrupt_action_policy', 'policy columns do not match manifest');
  return { record, manifest: validation.value };
}

function normalizeProposal(row: SupervisedActionProposal | undefined): SupervisedActionProposal {
  if (!row) throw new SupervisedActionError('missing_action_proposal', 'action proposal does not exist');
  const normalized = {
    ...row,
    requested_at: actionIso(row.requested_at, 'corrupt_action_proposal'),
    expires_at: actionIso(row.expires_at, 'corrupt_action_proposal'),
    created_at: actionIso(row.created_at, 'corrupt_action_proposal'),
  };
  actionUuid(normalized.id, 'corrupt_action_proposal');
  actionUuid(normalized.tenant_id, 'corrupt_action_proposal');
  actionUuid(normalized.source_connection_id, 'corrupt_action_proposal');
  actionUuid(normalized.policy_record_id, 'corrupt_action_proposal');
  actionUuid(normalized.g5_release_decision_id, 'corrupt_action_proposal');
  actionHash(normalized.policy_fingerprint, 'corrupt_action_proposal');
  actionHash(normalized.payload_fingerprint, 'corrupt_action_proposal');
  actionHash(normalized.proposal_fingerprint, 'corrupt_action_proposal');
  actionCode(normalized.reason_code, 'corrupt_action_proposal');
  actionCode(normalized.expected_impact_code, 'corrupt_action_proposal');
  actionEvidenceRefs(parseJson(normalized.evidence_refs_json, 'corrupt_action_proposal'));
  actionMoney(normalized.estimated_cost_minor, 'corrupt_action_proposal');
  actionCurrency(normalized.currency);
  actionIdempotencyKey(normalized.idempotency_key);
  actionActor(normalized.requested_by, 'corrupt_action_proposal');
  const {
    id: _id,
    proposal_fingerprint: _fingerprint,
    created_at: _created,
    ...core
  } = normalized;
  if (
    normalized.payload_fingerprint !== actionFingerprint(normalized.payload_json)
    || normalized.proposal_fingerprint !== actionFingerprint(core)
    || Date.parse(normalized.expires_at) <= Date.parse(normalized.requested_at)
  ) throw new SupervisedActionError('corrupt_action_proposal', 'proposal fingerprint or lifetime is invalid');
  return normalized;
}

function normalizePreview(row: SupervisedActionPreview | undefined): SupervisedActionPreview {
  if (!row) throw new SupervisedActionError('missing_action_preview', 'action preview does not exist');
  const normalized = {
    ...row,
    external_mutation_count: Number(row.external_mutation_count) as 0,
    previewed_at: actionIso(row.previewed_at, 'corrupt_action_preview'),
    expires_at: actionIso(row.expires_at, 'corrupt_action_preview'),
    created_at: actionIso(row.created_at, 'corrupt_action_preview'),
  };
  actionUuid(normalized.id, 'corrupt_action_preview');
  actionUuid(normalized.tenant_id, 'corrupt_action_preview');
  actionUuid(normalized.proposal_id, 'corrupt_action_preview');
  if (normalized.kind !== 'execute' && normalized.kind !== 'rollback') {
    throw new SupervisedActionError('corrupt_action_preview', 'preview kind is invalid');
  }
  if (normalized.kind === 'execute' && normalized.subject_execution_id !== null) {
    throw new SupervisedActionError('corrupt_action_preview', 'execute preview cannot bind an execution');
  }
  if (normalized.kind === 'rollback') actionUuid(normalized.subject_execution_id, 'corrupt_action_preview');
  for (const hash of [
    normalized.policy_fingerprint,
    normalized.proposal_fingerprint,
    normalized.request_fingerprint,
    normalized.target_fingerprint,
    normalized.effect_fingerprint,
    normalized.preview_fingerprint,
  ]) actionHash(hash, 'corrupt_action_preview');
  actionCode(normalized.summary_code, 'corrupt_action_preview');
  actionCode(normalized.rollback_strategy_code, 'corrupt_action_preview');
  actionMoney(normalized.estimated_cost_minor, 'corrupt_action_preview');
  actionCurrency(normalized.currency);
  const {
    id: _id,
    preview_fingerprint: _fingerprint,
    created_at: _created,
    ...core
  } = normalized;
  if (
    normalized.external_mutation_count !== 0
    || normalized.preview_fingerprint !== actionFingerprint(core)
    || Date.parse(normalized.expires_at) <= Date.parse(normalized.previewed_at)
  ) throw new SupervisedActionError('corrupt_action_preview', 'preview evidence is invalid');
  return normalized;
}

function normalizeApproval(row: SupervisedActionApproval | undefined): SupervisedActionApproval {
  if (!row) throw new SupervisedActionError('missing_action_approval', 'action approval does not exist');
  const normalized = {
    ...row,
    decided_at: actionIso(row.decided_at, 'corrupt_action_approval'),
    expires_at: actionIso(row.expires_at, 'corrupt_action_approval'),
    created_at: actionIso(row.created_at, 'corrupt_action_approval'),
  };
  actionUuid(normalized.id, 'corrupt_action_approval');
  actionUuid(normalized.tenant_id, 'corrupt_action_approval');
  actionUuid(normalized.proposal_id, 'corrupt_action_approval');
  actionUuid(normalized.preview_id, 'corrupt_action_approval');
  if (normalized.kind !== 'execute' && normalized.kind !== 'rollback') {
    throw new SupervisedActionError('corrupt_action_approval', 'approval kind is invalid');
  }
  if (normalized.decision !== 'approved' && normalized.decision !== 'rejected') {
    throw new SupervisedActionError('corrupt_action_approval', 'approval decision is invalid');
  }
  for (const hash of [
    normalized.policy_fingerprint,
    normalized.proposal_fingerprint,
    normalized.preview_fingerprint,
    normalized.approval_fingerprint,
  ]) actionHash(hash, 'corrupt_action_approval');
  actionActor(normalized.approver, 'corrupt_action_approval');
  actionCode(normalized.reason_code, 'corrupt_action_approval');
  actionIdempotencyKey(normalized.nonce);
  actionMoney(normalized.max_cost_minor, 'corrupt_action_approval');
  actionCurrency(normalized.currency);
  const {
    id: _id,
    approval_fingerprint: _fingerprint,
    created_at: _created,
    ...core
  } = normalized;
  if (
    normalized.approval_fingerprint !== actionFingerprint(core)
    || Date.parse(normalized.expires_at) <= Date.parse(normalized.decided_at)
  ) throw new SupervisedActionError('corrupt_action_approval', 'approval evidence is invalid');
  return normalized;
}

function normalizeAttempt(row: SupervisedActionAttempt | undefined): SupervisedActionAttempt {
  if (!row) throw new SupervisedActionError('missing_action_attempt', 'action attempt does not exist');
  const normalized = {
    ...row,
    started_at: actionIso(row.started_at, 'corrupt_action_attempt'),
    lease_expires_at: actionIso(row.lease_expires_at, 'corrupt_action_attempt'),
    finished_at: row.finished_at === null ? null : actionIso(row.finished_at, 'corrupt_action_attempt'),
    created_at: actionIso(row.created_at, 'corrupt_action_attempt'),
  };
  actionUuid(normalized.id, 'corrupt_action_attempt');
  actionUuid(normalized.tenant_id, 'corrupt_action_attempt');
  actionUuid(normalized.proposal_id, 'corrupt_action_attempt');
  actionUuid(normalized.preview_id, 'corrupt_action_attempt');
  actionUuid(normalized.approval_id, 'corrupt_action_attempt');
  if (normalized.kind !== 'execute' && normalized.kind !== 'rollback') {
    throw new SupervisedActionError('corrupt_action_attempt', 'attempt kind is invalid');
  }
  if (normalized.kind === 'execute' && normalized.subject_execution_id !== null) {
    throw new SupervisedActionError('corrupt_action_attempt', 'execute attempt cannot bind an execution');
  }
  if (normalized.kind === 'rollback') actionUuid(normalized.subject_execution_id, 'corrupt_action_attempt');
  if (!['in_progress', 'succeeded', 'failed', 'reconciliation_required'].includes(normalized.status)) {
    throw new SupervisedActionError('corrupt_action_attempt', 'attempt status is invalid');
  }
  actionIdempotencyKey(normalized.idempotency_key);
  actionHash(normalized.request_fingerprint, 'corrupt_action_attempt');
  actionActor(normalized.operator, 'corrupt_action_attempt');
  actionMoney(normalized.reserved_cost_minor, 'corrupt_action_attempt');
  actionCurrency(normalized.currency);
  if (Date.parse(normalized.lease_expires_at) <= Date.parse(normalized.started_at)) {
    throw new SupervisedActionError('corrupt_action_attempt', 'attempt lease is invalid');
  }
  if (normalized.status === 'in_progress') {
    if (
      normalized.finished_at !== null
      || normalized.result_fingerprint !== null
      || normalized.result_code !== null
      || normalized.latency_ms !== null
    ) throw new SupervisedActionError('corrupt_action_attempt', 'in-progress attempt has terminal evidence');
  } else {
    if (
      normalized.finished_at === null
      || normalized.result_fingerprint === null
      || normalized.result_code === null
      || normalized.latency_ms === null
      || !Number.isInteger(normalized.latency_ms)
      || normalized.latency_ms < 0
    ) throw new SupervisedActionError('corrupt_action_attempt', 'terminal attempt lacks evidence');
    actionHash(normalized.result_fingerprint, 'corrupt_action_attempt');
    actionCode(normalized.result_code, 'corrupt_action_attempt');
    if (normalized.external_request_id !== null) {
      actionCode(normalized.external_request_id, 'corrupt_action_attempt');
    }
    if (normalized.actual_cost_minor !== null) actionMoney(normalized.actual_cost_minor, 'corrupt_action_attempt');
    if (
      normalized.external_mutation_count !== null
      && (!Number.isInteger(normalized.external_mutation_count) || normalized.external_mutation_count < 0)
    ) throw new SupervisedActionError('corrupt_action_attempt', 'attempt mutation count is invalid');
  }
  return normalized;
}

function normalizeEvent(row: SupervisedActionEvent | undefined): SupervisedActionEvent {
  if (!row) throw new SupervisedActionError('missing_action_event', 'action event does not exist');
  const normalized = {
    ...row,
    occurred_at: actionIso(row.occurred_at, 'corrupt_action_event'),
    created_at: actionIso(row.created_at, 'corrupt_action_event'),
  };
  actionUuid(normalized.id, 'corrupt_action_event');
  actionUuid(normalized.tenant_id, 'corrupt_action_event');
  actionUuid(normalized.proposal_id, 'corrupt_action_event');
  if (!Number.isInteger(normalized.sequence) || normalized.sequence < 1) {
    throw new SupervisedActionError('corrupt_action_event', 'event sequence is invalid');
  }
  if (!EVENT_TYPES.includes(normalized.event_type)) {
    throw new SupervisedActionError('corrupt_action_event', 'event type is invalid');
  }
  actionActor(normalized.actor, 'corrupt_action_event');
  actionHash(normalized.evidence_fingerprint, 'corrupt_action_event');
  actionCode(normalized.reason_code, 'corrupt_action_event');
  actionHash(normalized.event_key, 'corrupt_action_event');
  const {
    id: _id,
    event_key: _eventKey,
    created_at: _created,
    ...core
  } = normalized;
  if (normalized.event_key !== actionFingerprint(core)) {
    throw new SupervisedActionError('corrupt_action_event', 'event fingerprint is invalid');
  }
  return normalized;
}

export class SupervisedActionRepository {
  constructor(
    private readonly knex: Knex = db,
    private readonly uuid: () => string = uuidv4,
  ) {}

  async findG5Decision(id: string): Promise<Phase2ReleaseDecisionRecord | undefined> {
    return this.knex<Phase2ReleaseDecisionRecord>(PHASE2_TABLES.releaseDecisions).where({ id }).first();
  }

  async findLatestG5Decision(
    tenantId: string,
    sourceConnectionId: string,
  ): Promise<Phase2ReleaseDecisionRecord | undefined> {
    return this.knex<Phase2ReleaseDecisionRecord>(PHASE2_TABLES.releaseDecisions)
      .where({ tenant_id: tenantId, source_connection_id: sourceConnectionId })
      .orderBy('decided_at', 'desc')
      .orderBy('id', 'desc')
      .first();
  }

  async recordPolicy(
    manifest: G6ActionPolicyManifest,
    g5Decision: Phase2ReleaseDecisionRecord,
  ): Promise<{ record: SupervisedActionPolicyRecord; manifest: G6ActionPolicyManifest }> {
    const validation = validateG6ActionPolicy(manifest, g5Decision);
    if (!validation.ok || !validation.value || !validation.fingerprint) {
      throw new SupervisedActionError('invalid_action_policy', validation.issues.join('; '));
    }
    const input: PolicyInsert = {
      tenant_id: manifest.tenant_id,
      source_connection_id: manifest.source_connection_id,
      g5_release_decision_id: manifest.g5_release.decision_id,
      policy_id: manifest.policy_id,
      environment: manifest.environment,
      command_key: manifest.command.key,
      command_version: manifest.command.version,
      adapter_id: manifest.command.adapter_id,
      risk_tier: manifest.command.risk_tier,
      target_project_id: manifest.target.project_id,
      target_tenant_key: manifest.target.tenant_key,
      target_endpoint_url: manifest.target.command_endpoint_url,
      target_credential_sha256: manifest.target.command_credential_sha256,
      valid_from: actionIso(manifest.valid_from),
      valid_until: actionIso(manifest.valid_until),
      policy_fingerprint: validation.fingerprint,
      manifest_json: canonicalStringify(validation.value),
    };
    const existing = await this.knex<SupervisedActionPolicyRecord>(G6_TABLES.policies)
      .where({ policy_id: input.policy_id })
      .first();
    if (existing) {
      const normalized = normalizePolicy(existing);
      if (normalized.record.policy_fingerprint !== input.policy_fingerprint) {
        throw new SupervisedActionError('action_policy_conflict', 'policy ID already has different evidence');
      }
      return normalized;
    }
    await this.knex(G6_TABLES.policies).insert({
      id: this.uuid(),
      ...input,
      created_at: actionIso(manifest.approved_at),
    });
    return normalizePolicy(await this.knex<SupervisedActionPolicyRecord>(G6_TABLES.policies)
      .where({ policy_id: input.policy_id })
      .first());
  }

  async findPolicyByPolicyId(policyId: string): Promise<{
    record: SupervisedActionPolicyRecord;
    manifest: G6ActionPolicyManifest;
  }> {
    return normalizePolicy(await this.knex<SupervisedActionPolicyRecord>(G6_TABLES.policies)
      .where({ policy_id: policyId })
      .first());
  }

  async recordProposal(input: ProposalInsert): Promise<SupervisedActionProposal> {
    return this.knex.transaction(async (trx) => {
      const candidate = normalizeProposal({ id: this.uuid(), ...input, created_at: input.requested_at });
      const existing = await trx<SupervisedActionProposal>(G6_TABLES.proposals).where({
        tenant_id: input.tenant_id,
        command_key: input.command_key,
        idempotency_key: input.idempotency_key,
      }).first();
      if (existing) {
        const normalized = normalizeProposal(existing);
        if (normalized.proposal_fingerprint !== candidate.proposal_fingerprint) {
          throw new SupervisedActionError(
            'action_proposal_conflict',
            'idempotency key already has a different proposal',
          );
        }
        return normalized;
      }
      await trx(G6_TABLES.proposals).insert(candidate);
      await this.appendEvent(trx, {
        tenant_id: candidate.tenant_id,
        proposal_id: candidate.id,
        event_type: 'proposed',
        actor: candidate.requested_by,
        evidence_fingerprint: candidate.proposal_fingerprint,
        reason_code: candidate.reason_code,
        occurred_at: candidate.requested_at,
      });
      return candidate;
    });
  }

  async findProposal(id: string): Promise<SupervisedActionProposal> {
    return normalizeProposal(await this.knex<SupervisedActionProposal>(G6_TABLES.proposals)
      .where({ id })
      .first());
  }

  async recordPreview(input: PreviewInsert, actor: string): Promise<SupervisedActionPreview> {
    return this.knex.transaction(async (trx) => {
      const candidate = normalizePreview({ id: this.uuid(), ...input, created_at: input.previewed_at });
      const existing = await trx<SupervisedActionPreview>(G6_TABLES.previews).where({
        proposal_id: input.proposal_id,
        kind: input.kind,
      }).first();
      if (existing) {
        const normalized = normalizePreview(existing);
        if (normalized.preview_fingerprint !== candidate.preview_fingerprint) {
          throw new SupervisedActionError('action_preview_conflict', 'preview kind already has different evidence');
        }
        return normalized;
      }
      await trx(G6_TABLES.previews).insert(candidate);
      await this.appendEvent(trx, {
        tenant_id: candidate.tenant_id,
        proposal_id: candidate.proposal_id,
        event_type: candidate.kind === 'execute' ? 'execute_previewed' : 'rollback_previewed',
        actor,
        evidence_fingerprint: candidate.preview_fingerprint,
        reason_code: candidate.summary_code,
        occurred_at: candidate.previewed_at,
      });
      return candidate;
    });
  }

  async findPreview(proposalId: string, kind: ActionPreviewKind): Promise<SupervisedActionPreview> {
    return normalizePreview(await this.knex<SupervisedActionPreview>(G6_TABLES.previews)
      .where({ proposal_id: proposalId, kind })
      .first());
  }

  async recordApproval(input: ApprovalInsert): Promise<SupervisedActionApproval> {
    return this.knex.transaction(async (trx) => {
      const candidate = normalizeApproval({ id: this.uuid(), ...input, created_at: input.decided_at });
      const existing = await trx<SupervisedActionApproval>(G6_TABLES.approvals)
        .where({ preview_id: input.preview_id })
        .first();
      if (existing) {
        const normalized = normalizeApproval(existing);
        if (normalized.approval_fingerprint !== candidate.approval_fingerprint) {
          throw new SupervisedActionError('action_approval_conflict', 'preview already has a different decision');
        }
        return normalized;
      }
      await trx(G6_TABLES.approvals).insert(candidate);
      await this.appendEvent(trx, {
        tenant_id: candidate.tenant_id,
        proposal_id: candidate.proposal_id,
        event_type: this.approvalEvent(candidate.kind, candidate.decision),
        actor: candidate.approver,
        evidence_fingerprint: candidate.approval_fingerprint,
        reason_code: candidate.reason_code,
        occurred_at: candidate.decided_at,
      });
      return candidate;
    });
  }

  async findApproval(previewId: string): Promise<SupervisedActionApproval> {
    return normalizeApproval(await this.knex<SupervisedActionApproval>(G6_TABLES.approvals)
      .where({ preview_id: previewId })
      .first());
  }

  async claimAttempt(input: AttemptInsert, limits: {
    maxPerHour: number;
    maxPerDay: number;
    maxCostMinor: number;
    emergencyRollback?: boolean;
  }): Promise<{ attempt: SupervisedActionAttempt; replayed: boolean }> {
    return this.knex.transaction(async (trx) => {
      const existing = await trx<SupervisedActionAttempt>(G6_TABLES.attempts).where({
        proposal_id: input.proposal_id,
        kind: input.kind,
      }).first();
      if (existing) return { attempt: normalizeAttempt(existing), replayed: true };

      const policyId = await trx(G6_TABLES.proposals)
        .select('policy_record_id')
        .where({ id: input.proposal_id })
        .first();
      if (!policyId) throw new SupervisedActionError('missing_action_proposal', 'proposal does not exist');
      let policyLock = trx(G6_TABLES.policies).where({ id: policyId.policy_record_id });
      const client = String(trx.client.config.client);
      if (client === 'pg' || client.includes('postgres')) policyLock = policyLock.forUpdate();
      await policyLock.first();

      const started = Date.parse(actionIso(input.started_at));
      const hourStart = new Date(started - 60 * 60 * 1_000).toISOString();
      const dayStart = new Date(started - 24 * 60 * 60 * 1_000).toISOString();
      const [hourRows, dayRows] = await Promise.all([
        trx<SupervisedActionAttempt>(G6_TABLES.attempts)
          .where({ tenant_id: input.tenant_id })
          .andWhere('started_at', '>=', hourStart),
        trx<SupervisedActionAttempt>(G6_TABLES.attempts)
          .where({ tenant_id: input.tenant_id })
          .andWhere('started_at', '>=', dayStart),
      ]);
      if (!limits.emergencyRollback && hourRows.length >= limits.maxPerHour) {
        throw new SupervisedActionError('hourly_action_limit_exceeded', 'hourly action limit is exhausted');
      }
      if (!limits.emergencyRollback && dayRows.length >= limits.maxPerDay) {
        throw new SupervisedActionError('daily_action_limit_exceeded', 'daily action limit is exhausted');
      }
      const reserved = dayRows.reduce(
        (sum, row) => sum + Number(row.actual_cost_minor ?? row.reserved_cost_minor),
        0,
      );
      if (!limits.emergencyRollback && reserved + input.reserved_cost_minor > limits.maxCostMinor) {
        throw new SupervisedActionError('daily_action_budget_exceeded', 'daily action budget is exhausted');
      }

      const candidate = normalizeAttempt({
        id: this.uuid(),
        ...input,
        status: 'in_progress',
        finished_at: null,
        external_request_id: null,
        result_fingerprint: null,
        result_code: null,
        actual_cost_minor: null,
        external_mutation_count: null,
        latency_ms: null,
        created_at: input.started_at,
      });
      await trx(G6_TABLES.attempts).insert(candidate);
      await this.appendEvent(trx, {
        tenant_id: candidate.tenant_id,
        proposal_id: candidate.proposal_id,
        event_type: candidate.kind === 'execute' ? 'execution_started' : 'rollback_started',
        actor: candidate.operator,
        evidence_fingerprint: candidate.request_fingerprint,
        reason_code: candidate.kind === 'execute' ? 'operator_invoked' : 'rollback_invoked',
        occurred_at: candidate.started_at,
      });
      return { attempt: candidate, replayed: false };
    });
  }

  async completeAttempt(
    attemptId: string,
    completion: AttemptCompletion,
  ): Promise<SupervisedActionAttempt> {
    return this.knex.transaction(async (trx) => {
      const current = normalizeAttempt(await trx<SupervisedActionAttempt>(G6_TABLES.attempts)
        .where({ id: attemptId })
        .first());
      if (current.status !== 'in_progress') return current;
      const update = {
        ...completion,
        finished_at: actionIso(completion.finished_at),
        result_fingerprint: actionHash(completion.result_fingerprint, 'invalid_result_fingerprint'),
        result_code: actionCode(completion.result_code, 'invalid_result_code'),
        actual_cost_minor: completion.actual_cost_minor === null
          ? null
          : actionMoney(completion.actual_cost_minor, 'invalid_actual_cost'),
        latency_ms: actionMoney(completion.latency_ms, 'invalid_latency', Number.MAX_SAFE_INTEGER),
      };
      if (completion.external_request_id !== null) {
        actionCode(completion.external_request_id, 'invalid_external_request_id');
      }
      if (
        completion.external_mutation_count !== null
        && (!Number.isInteger(completion.external_mutation_count) || completion.external_mutation_count < 0)
      ) throw new SupervisedActionError('invalid_mutation_count', 'mutation count is invalid');
      const changed = await trx(G6_TABLES.attempts).where({ id: attemptId, status: 'in_progress' }).update(update);
      if (changed !== 1) {
        throw new SupervisedActionError('attempt_completion_conflict', 'attempt terminal transition conflicted');
      }
      const stored = normalizeAttempt(await trx<SupervisedActionAttempt>(G6_TABLES.attempts)
        .where({ id: attemptId })
        .first());
      if (stored.status === 'in_progress') {
        throw new SupervisedActionError('attempt_completion_conflict', 'attempt remained in progress');
      }
      await this.appendEvent(trx, {
        tenant_id: stored.tenant_id,
        proposal_id: stored.proposal_id,
        event_type: this.attemptEvent(stored.kind, stored.status),
        actor: stored.operator,
        evidence_fingerprint: stored.result_fingerprint!,
        reason_code: stored.result_code!,
        occurred_at: stored.finished_at!,
      });
      return stored;
    });
  }

  async findAttempt(proposalId: string, kind: ActionPreviewKind): Promise<SupervisedActionAttempt | undefined> {
    const row = await this.knex<SupervisedActionAttempt>(G6_TABLES.attempts)
      .where({ proposal_id: proposalId, kind })
      .first();
    return row ? normalizeAttempt(row) : undefined;
  }

  async listEvents(proposalId: string): Promise<SupervisedActionEvent[]> {
    const rows = await this.knex<SupervisedActionEvent>(G6_TABLES.events)
      .where({ proposal_id: proposalId })
      .orderBy('sequence', 'asc');
    return rows.map(normalizeEvent);
  }

  private async appendEvent(trx: Knex.Transaction, input: EventInput): Promise<SupervisedActionEvent> {
    let proposalLock = trx(G6_TABLES.proposals).where({ id: input.proposal_id });
    const client = String(trx.client.config.client);
    if (client === 'pg' || client.includes('postgres')) proposalLock = proposalLock.forUpdate();
    const proposal = await proposalLock.first();
    if (!proposal) throw new SupervisedActionError('missing_action_proposal', 'proposal does not exist');
    const maxRow = await trx(G6_TABLES.events)
      .where({ proposal_id: input.proposal_id })
      .max<{ max: number | null }[]>({ max: 'sequence' });
    const sequence = Number(maxRow[0]?.max ?? 0) + 1;
    const core = {
      tenant_id: actionUuid(input.tenant_id, 'invalid_event_tenant'),
      proposal_id: actionUuid(input.proposal_id, 'invalid_event_proposal'),
      sequence,
      event_type: input.event_type,
      actor: actionActor(input.actor, 'invalid_event_actor'),
      evidence_fingerprint: actionHash(input.evidence_fingerprint, 'invalid_event_evidence'),
      reason_code: actionCode(input.reason_code, 'invalid_event_reason'),
      occurred_at: actionIso(input.occurred_at),
    };
    const event = normalizeEvent({
      id: this.uuid(),
      ...core,
      event_key: actionFingerprint(core),
      created_at: core.occurred_at,
    });
    await trx(G6_TABLES.events).insert(event);
    return event;
  }

  private approvalEvent(kind: ActionPreviewKind, decision: ActionApprovalDecision): ActionEventType {
    if (kind === 'execute') return decision === 'approved' ? 'execute_approved' : 'execute_rejected';
    return decision === 'approved' ? 'rollback_approved' : 'rollback_rejected';
  }

  private attemptEvent(
    kind: ActionPreviewKind,
    status: Exclude<ActionAttemptStatus, 'in_progress'>,
  ): ActionEventType {
    if (kind === 'execute') return status === 'succeeded' ? 'execution_succeeded' : 'execution_failed';
    return status === 'succeeded' ? 'rollback_succeeded' : 'rollback_failed';
  }
}
