import { v4 as uuidv4 } from 'uuid';
import { canonicalStringify } from '../domain/businessMemory';
import {
  AutonomyAttemptRecord,
  AutonomyAttemptStatus,
  AutonomyEvaluationRecord,
  AutonomyEventRecord,
  AutonomyEventType,
  AutonomyIncidentEventRecord,
  AutonomyRecoveryApprovalRecord,
  AutonomyRecoveryPreviewRecord,
  BoundedAutonomyError,
  BoundedAutonomyPolicyRecord,
  G7PolicySimulationRecord,
  G7SimulationResult,
  G7_TABLES,
  KillSwitchEventRecord,
  KillSwitchState,
  SupervisedHistoryEvidence,
  autonomyFingerprint,
  simulateG7Policy,
} from '../domain/boundedAutonomy';
import type { G6ActionPolicyManifest } from '../domain/g6Policy';
import { validateG6ActionPolicy } from '../domain/g6Policy';
import {
  G7BoundedAutonomyPolicyManifest,
  validateG7Policy,
} from '../domain/g7Policy';
import type { Phase2ReleaseDecisionRecord } from '../domain/shadowTrust';
import { PHASE2_TABLES } from '../domain/shadowTrust';
import {
  G6_TABLES,
  SupervisedActionPolicyRecord,
  actionActor,
  actionCode,
  actionCurrency,
  actionEvidenceRefs,
  actionHash,
  actionIdempotencyKey,
  actionIso,
  actionMoney,
  actionUuid,
} from '../domain/supervisedAction';
import { db, Knex } from '../db/knex';

export interface AutonomyUsageState {
  executionsLastHour: number;
  executionsLastDay: number;
  costLastDay: number;
  lastStartedAt: string | null;
}

export interface EvaluationInsert extends Omit<AutonomyEvaluationRecord, 'id' | 'created_at'> {}

export interface AttemptInsert extends Omit<
  AutonomyAttemptRecord,
  | 'id'
  | 'kind'
  | 'subject_attempt_id'
  | 'recovery_approval_id'
  | 'status'
  | 'finished_at'
  | 'external_request_id'
  | 'result_fingerprint'
  | 'result_code'
  | 'actual_cost_minor'
  | 'external_mutation_count'
  | 'latency_ms'
  | 'created_at'
> {}

export interface AttemptCompletion {
  status: Exclude<AutonomyAttemptStatus, 'in_progress'>;
  finished_at: string;
  external_request_id: string | null;
  result_fingerprint: string;
  result_code: string;
  actual_cost_minor: number | null;
  external_mutation_count: number | null;
  latency_ms: number;
}

export interface AtomicClaimGuards {
  g5ReleaseDecisionId: string;
  g6PolicyRecordId: string;
  g6PolicyFingerprint: string;
  simulationId: string;
  historyWindowDays: number;
  minSuccessfulExecutions: number;
  maxSourceAgeMinutes: number;
  maxPerHour: number;
  maxPerDay: number;
  maxCostPerDay: number;
  cooldownSeconds: number;
}

const EVENT_TYPES: readonly AutonomyEventType[] = [
  'policy_accepted', 'kill_switch_engaged', 'kill_switch_released',
  'evaluation_allowed', 'evaluation_denied', 'execution_started',
  'execution_succeeded', 'execution_failed', 'execution_reconciliation_required',
  'recovery_previewed', 'recovery_approved', 'recovery_rejected',
  'recovery_started', 'recovery_succeeded', 'recovery_failed',
  'recovery_reconciliation_required',
  'incident_opened', 'incident_resolved',
];

function parseJson(value: string, code: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new BoundedAutonomyError(code, 'stored JSON is invalid');
  }
}

function bool(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function normalizedG6(row: SupervisedActionPolicyRecord | undefined): {
  record: SupervisedActionPolicyRecord;
  manifest: G6ActionPolicyManifest;
} {
  if (!row) throw new BoundedAutonomyError('missing_g6_policy', 'bound G6 policy does not exist');
  const validation = validateG6ActionPolicy(parseJson(row.manifest_json, 'corrupt_g6_policy'));
  if (!validation.ok || !validation.value || !validation.fingerprint) {
    throw new BoundedAutonomyError('corrupt_g6_policy', 'stored G6 policy is invalid');
  }
  const record = {
    ...row,
    valid_from: actionIso(row.valid_from, 'corrupt_g6_policy'),
    valid_until: actionIso(row.valid_until, 'corrupt_g6_policy'),
    created_at: actionIso(row.created_at, 'corrupt_g6_policy'),
  };
  if (
    record.policy_id !== validation.value.policy_id
    || record.policy_fingerprint !== validation.fingerprint
    || record.manifest_json !== canonicalStringify(validation.value)
  ) throw new BoundedAutonomyError('corrupt_g6_policy', 'stored G6 policy columns drifted');
  return { record, manifest: validation.value };
}

function normalizedSimulation(row: G7PolicySimulationRecord | undefined): G7PolicySimulationRecord {
  if (!row) throw new BoundedAutonomyError('missing_g7_simulation', 'G7 policy simulation does not exist');
  const result = {
    ...row,
    passed: bool(row.passed),
    simulated_at: actionIso(row.simulated_at, 'corrupt_g7_simulation'),
    created_at: actionIso(row.created_at, 'corrupt_g7_simulation'),
  };
  actionUuid(result.id, 'corrupt_g7_simulation');
  actionUuid(result.tenant_id, 'corrupt_g7_simulation');
  actionUuid(result.source_connection_id, 'corrupt_g7_simulation');
  actionUuid(result.g6_policy_record_id, 'corrupt_g7_simulation');
  actionHash(result.policy_fingerprint, 'corrupt_g7_simulation');
  actionHash(result.g6_policy_fingerprint, 'corrupt_g7_simulation');
  actionHash(result.simulation_fingerprint, 'corrupt_g7_simulation');
  actionActor(result.simulated_by, 'corrupt_g7_simulation');
  const outcomes = parseJson(result.outcomes_json, 'corrupt_g7_simulation');
  const core = {
    scenario_set_version: result.scenario_set_version,
    policy_fingerprint: result.policy_fingerprint,
    g6_policy_fingerprint: result.g6_policy_fingerprint,
    simulated_at: result.simulated_at,
    outcomes,
    passed: result.passed,
  };
  if (
    result.scenario_set_version !== 'g7-core-v1'
    || !Array.isArray(outcomes)
    || outcomes.length !== Number(result.scenario_count)
    || outcomes.length !== 13
    || !result.passed
    || result.simulation_fingerprint !== autonomyFingerprint(core)
  ) {
    throw new BoundedAutonomyError('corrupt_g7_simulation', 'simulation outcome evidence is invalid');
  }
  return result;
}

function normalizedPolicy(
  row: BoundedAutonomyPolicyRecord | undefined,
  g6?: G6ActionPolicyManifest,
): { record: BoundedAutonomyPolicyRecord; manifest: G7BoundedAutonomyPolicyManifest } {
  if (!row) throw new BoundedAutonomyError('missing_g7_policy', 'bounded-autonomy policy does not exist');
  const validation = validateG7Policy(parseJson(row.manifest_json, 'corrupt_g7_policy'), g6);
  if (!validation.ok || !validation.value || !validation.fingerprint) {
    throw new BoundedAutonomyError('corrupt_g7_policy', 'stored bounded-autonomy policy is invalid');
  }
  const record = {
    ...row,
    valid_from: actionIso(row.valid_from, 'corrupt_g7_policy'),
    valid_until: actionIso(row.valid_until, 'corrupt_g7_policy'),
    accepted_at: actionIso(row.accepted_at, 'corrupt_g7_policy'),
    created_at: actionIso(row.created_at, 'corrupt_g7_policy'),
  };
  actionUuid(record.id, 'corrupt_g7_policy');
  if (
    record.tenant_id !== validation.value.tenant_id
    || record.source_connection_id !== validation.value.source_connection_id
    || record.policy_id !== validation.value.policy_id
    || record.environment !== validation.value.environment
    || record.command_key !== validation.value.g6_policy.command_key
    || record.command_version !== validation.value.g6_policy.command_version
    || record.adapter_id !== validation.value.g6_policy.adapter_id
    || record.target_fingerprint !== validation.value.g6_policy.target_fingerprint
    || record.valid_from !== actionIso(validation.value.valid_from)
    || record.valid_until !== actionIso(validation.value.valid_until)
    || record.policy_fingerprint !== validation.fingerprint
    || record.manifest_json !== canonicalStringify(validation.value)
  ) throw new BoundedAutonomyError('corrupt_g7_policy', 'policy columns do not match the manifest');
  return { record, manifest: validation.value };
}

function normalizedKillSwitch(row: KillSwitchEventRecord | undefined): KillSwitchEventRecord {
  if (!row) throw new BoundedAutonomyError('missing_kill_switch_state', 'kill-switch state does not exist');
  const result = {
    ...row,
    sequence: Number(row.sequence),
    occurred_at: actionIso(row.occurred_at, 'corrupt_kill_switch_event'),
    created_at: actionIso(row.created_at, 'corrupt_kill_switch_event'),
  };
  actionUuid(result.id, 'corrupt_kill_switch_event');
  actionUuid(result.policy_record_id, 'corrupt_kill_switch_event');
  if (!Number.isInteger(result.sequence) || result.sequence < 1) throw new BoundedAutonomyError('corrupt_kill_switch_event', 'kill-switch sequence is invalid');
  if (result.state !== 'engaged' && result.state !== 'released') throw new BoundedAutonomyError('corrupt_kill_switch_event', 'kill-switch state is invalid');
  actionActor(result.actor, 'corrupt_kill_switch_event');
  actionCode(result.reason_code, 'corrupt_kill_switch_event');
  actionHash(result.evidence_fingerprint, 'corrupt_kill_switch_event');
  actionHash(result.event_fingerprint, 'corrupt_kill_switch_event');
  const { id: _id, event_fingerprint: _event, created_at: _created, ...core } = result;
  if (result.event_fingerprint !== autonomyFingerprint(core)) throw new BoundedAutonomyError('corrupt_kill_switch_event', 'kill-switch fingerprint is invalid');
  return result;
}

function normalizedEvaluation(row: AutonomyEvaluationRecord | undefined): AutonomyEvaluationRecord {
  if (!row) throw new BoundedAutonomyError('missing_autonomy_evaluation', 'autonomy evaluation does not exist');
  const result = {
    ...row,
    estimated_cost_minor: Number(row.estimated_cost_minor),
    preview_mutation_count: row.preview_mutation_count === null ? null : Number(row.preview_mutation_count),
    evaluated_at: actionIso(row.evaluated_at, 'corrupt_autonomy_evaluation'),
    created_at: actionIso(row.created_at, 'corrupt_autonomy_evaluation'),
  };
  actionUuid(result.id, 'corrupt_autonomy_evaluation');
  actionIdempotencyKey(result.idempotency_key);
  actionHash(result.payload_fingerprint, 'corrupt_autonomy_evaluation');
  actionHash(result.request_fingerprint, 'corrupt_autonomy_evaluation');
  actionHash(result.target_fingerprint, 'corrupt_autonomy_evaluation');
  actionHash(result.evaluation_fingerprint, 'corrupt_autonomy_evaluation');
  if (result.preview_fingerprint !== null) actionHash(result.preview_fingerprint, 'corrupt_autonomy_evaluation');
  if (result.effect_fingerprint !== null) actionHash(result.effect_fingerprint, 'corrupt_autonomy_evaluation');
  actionCode(result.reason_code, 'corrupt_autonomy_evaluation');
  actionEvidenceRefs(parseJson(result.evidence_refs_json, 'corrupt_autonomy_evaluation'));
  actionMoney(result.estimated_cost_minor, 'corrupt_autonomy_evaluation');
  actionCurrency(result.currency);
  if (result.decision !== 'allow' && result.decision !== 'deny') throw new BoundedAutonomyError('corrupt_autonomy_evaluation', 'evaluation decision is invalid');
  actionCode(result.decision_code, 'corrupt_autonomy_evaluation');
  const { id: _id, evaluation_fingerprint: _fingerprint, created_at: _created, ...core } = result;
  if (result.evaluation_fingerprint !== autonomyFingerprint(core)) throw new BoundedAutonomyError('corrupt_autonomy_evaluation', 'evaluation fingerprint is invalid');
  return result;
}

function normalizedAttempt(row: AutonomyAttemptRecord | undefined): AutonomyAttemptRecord {
  if (!row) throw new BoundedAutonomyError('missing_autonomy_attempt', 'autonomy attempt does not exist');
  const result = {
    ...row,
    reserved_cost_minor: Number(row.reserved_cost_minor),
    actual_cost_minor: row.actual_cost_minor === null ? null : Number(row.actual_cost_minor),
    external_mutation_count: row.external_mutation_count === null ? null : Number(row.external_mutation_count),
    latency_ms: row.latency_ms === null ? null : Number(row.latency_ms),
    started_at: actionIso(row.started_at, 'corrupt_autonomy_attempt'),
    lease_expires_at: actionIso(row.lease_expires_at, 'corrupt_autonomy_attempt'),
    finished_at: row.finished_at === null ? null : actionIso(row.finished_at, 'corrupt_autonomy_attempt'),
    created_at: actionIso(row.created_at, 'corrupt_autonomy_attempt'),
  };
  actionUuid(result.id, 'corrupt_autonomy_attempt');
  if (result.kind !== 'execute' && result.kind !== 'recovery') {
    throw new BoundedAutonomyError('corrupt_autonomy_attempt', 'attempt kind is invalid');
  }
  if (result.kind === 'execute') {
    actionUuid(result.evaluation_id, 'corrupt_autonomy_attempt');
    if (result.subject_attempt_id !== null || result.recovery_approval_id !== null) {
      throw new BoundedAutonomyError('corrupt_autonomy_attempt', 'execute attempt has recovery bindings');
    }
  } else {
    if (result.evaluation_id !== null) throw new BoundedAutonomyError('corrupt_autonomy_attempt', 'recovery attempt has an evaluation binding');
    actionUuid(result.subject_attempt_id, 'corrupt_autonomy_attempt');
    actionUuid(result.recovery_approval_id, 'corrupt_autonomy_attempt');
  }
  actionIdempotencyKey(result.idempotency_key);
  actionHash(result.request_fingerprint, 'corrupt_autonomy_attempt');
  actionActor(result.executor, 'corrupt_autonomy_attempt');
  actionMoney(result.reserved_cost_minor, 'corrupt_autonomy_attempt');
  actionCurrency(result.currency);
  if (!['in_progress', 'succeeded', 'failed', 'reconciliation_required'].includes(result.status)) {
    throw new BoundedAutonomyError('corrupt_autonomy_attempt', 'attempt status is invalid');
  }
  if (Date.parse(result.lease_expires_at) <= Date.parse(result.started_at)) throw new BoundedAutonomyError('corrupt_autonomy_attempt', 'attempt lease is invalid');
  if (result.status === 'in_progress') {
    if (result.finished_at !== null || result.result_fingerprint !== null || result.result_code !== null || result.latency_ms !== null) {
      throw new BoundedAutonomyError('corrupt_autonomy_attempt', 'in-progress attempt has terminal evidence');
    }
  } else {
    if (result.finished_at === null || result.result_fingerprint === null || result.result_code === null || result.latency_ms === null) {
      throw new BoundedAutonomyError('corrupt_autonomy_attempt', 'terminal attempt lacks evidence');
    }
    actionHash(result.result_fingerprint, 'corrupt_autonomy_attempt');
    actionCode(result.result_code, 'corrupt_autonomy_attempt');
  }
  return result;
}

function normalizedRecoveryPreview(
  row: AutonomyRecoveryPreviewRecord | undefined,
): AutonomyRecoveryPreviewRecord {
  if (!row) throw new BoundedAutonomyError('missing_recovery_preview', 'recovery preview does not exist');
  const result = {
    ...row,
    estimated_cost_minor: Number(row.estimated_cost_minor),
    external_mutation_count: Number(row.external_mutation_count) as 0,
    previewed_at: actionIso(row.previewed_at, 'corrupt_recovery_preview'),
    expires_at: actionIso(row.expires_at, 'corrupt_recovery_preview'),
    created_at: actionIso(row.created_at, 'corrupt_recovery_preview'),
  };
  actionUuid(result.id, 'corrupt_recovery_preview');
  actionUuid(result.tenant_id, 'corrupt_recovery_preview');
  actionUuid(result.policy_record_id, 'corrupt_recovery_preview');
  actionUuid(result.subject_attempt_id, 'corrupt_recovery_preview');
  actionCode(result.adapter_id, 'corrupt_recovery_preview');
  for (const value of [
    result.request_fingerprint,
    result.target_fingerprint,
    result.effect_fingerprint,
    result.preview_fingerprint,
  ]) actionHash(value, 'corrupt_recovery_preview');
  actionCode(result.adapter_version, 'corrupt_recovery_preview');
  actionCode(result.summary_code, 'corrupt_recovery_preview');
  actionCode(result.rollback_strategy_code, 'corrupt_recovery_preview');
  actionActor(result.previewed_by, 'corrupt_recovery_preview');
  actionMoney(result.estimated_cost_minor, 'corrupt_recovery_preview');
  actionCurrency(result.currency);
  const { id: _id, preview_fingerprint: _fingerprint, created_at: _created, ...core } = result;
  if (
    result.external_mutation_count !== 0
    || Date.parse(result.expires_at) <= Date.parse(result.previewed_at)
    || result.preview_fingerprint !== autonomyFingerprint(core)
  ) throw new BoundedAutonomyError('corrupt_recovery_preview', 'recovery preview evidence is invalid');
  return result;
}

function normalizedRecoveryApproval(
  row: AutonomyRecoveryApprovalRecord | undefined,
): AutonomyRecoveryApprovalRecord {
  if (!row) throw new BoundedAutonomyError('missing_recovery_approval', 'recovery approval does not exist');
  const result = {
    ...row,
    max_cost_minor: Number(row.max_cost_minor),
    decided_at: actionIso(row.decided_at, 'corrupt_recovery_approval'),
    expires_at: actionIso(row.expires_at, 'corrupt_recovery_approval'),
    created_at: actionIso(row.created_at, 'corrupt_recovery_approval'),
  };
  actionUuid(result.id, 'corrupt_recovery_approval');
  actionUuid(result.tenant_id, 'corrupt_recovery_approval');
  actionUuid(result.policy_record_id, 'corrupt_recovery_approval');
  actionUuid(result.subject_attempt_id, 'corrupt_recovery_approval');
  actionUuid(result.preview_id, 'corrupt_recovery_approval');
  if (result.decision !== 'approved' && result.decision !== 'rejected') {
    throw new BoundedAutonomyError('corrupt_recovery_approval', 'recovery decision is invalid');
  }
  actionHash(result.policy_fingerprint, 'corrupt_recovery_approval');
  actionHash(result.preview_fingerprint, 'corrupt_recovery_approval');
  actionHash(result.approval_fingerprint, 'corrupt_recovery_approval');
  actionActor(result.approver, 'corrupt_recovery_approval');
  actionCode(result.reason_code, 'corrupt_recovery_approval');
  actionIdempotencyKey(result.nonce);
  actionMoney(result.max_cost_minor, 'corrupt_recovery_approval');
  actionCurrency(result.currency);
  const { id: _id, approval_fingerprint: _fingerprint, created_at: _created, ...core } = result;
  if (
    Date.parse(result.expires_at) <= Date.parse(result.decided_at)
    || result.approval_fingerprint !== autonomyFingerprint(core)
  ) throw new BoundedAutonomyError('corrupt_recovery_approval', 'recovery approval evidence is invalid');
  return result;
}

function normalizedIncident(row: AutonomyIncidentEventRecord | undefined): AutonomyIncidentEventRecord {
  if (!row) throw new BoundedAutonomyError('missing_autonomy_incident', 'incident event does not exist');
  const result = {
    ...row,
    sequence: Number(row.sequence),
    occurred_at: actionIso(row.occurred_at, 'corrupt_autonomy_incident'),
    created_at: actionIso(row.created_at, 'corrupt_autonomy_incident'),
  };
  if ((result.kind === 'opened' && result.sequence !== 1) || (result.kind === 'resolved' && result.sequence !== 2)) {
    throw new BoundedAutonomyError('corrupt_autonomy_incident', 'incident state sequence is invalid');
  }
  actionUuid(result.incident_id, 'corrupt_autonomy_incident');
  if (result.attempt_id !== null) actionUuid(result.attempt_id, 'corrupt_autonomy_incident');
  actionActor(result.actor, 'corrupt_autonomy_incident');
  actionCode(result.reason_code, 'corrupt_autonomy_incident');
  actionHash(result.evidence_fingerprint, 'corrupt_autonomy_incident');
  actionHash(result.event_fingerprint, 'corrupt_autonomy_incident');
  const { id: _id, event_fingerprint: _fingerprint, created_at: _created, ...core } = result;
  if (result.event_fingerprint !== autonomyFingerprint(core)) throw new BoundedAutonomyError('corrupt_autonomy_incident', 'incident fingerprint is invalid');
  return result;
}

function normalizedEvent(row: AutonomyEventRecord | undefined): AutonomyEventRecord {
  if (!row) throw new BoundedAutonomyError('missing_autonomy_event', 'autonomy event does not exist');
  const result = {
    ...row,
    sequence: Number(row.sequence),
    occurred_at: actionIso(row.occurred_at, 'corrupt_autonomy_event'),
    created_at: actionIso(row.created_at, 'corrupt_autonomy_event'),
  };
  actionUuid(result.id, 'corrupt_autonomy_event');
  actionUuid(result.tenant_id, 'corrupt_autonomy_event');
  actionUuid(result.policy_record_id, 'corrupt_autonomy_event');
  if (!Number.isInteger(result.sequence) || result.sequence < 1) {
    throw new BoundedAutonomyError('corrupt_autonomy_event', 'event sequence is invalid');
  }
  if (!EVENT_TYPES.includes(result.event_type)) throw new BoundedAutonomyError('corrupt_autonomy_event', 'event type is invalid');
  actionActor(result.actor, 'corrupt_autonomy_event');
  actionCode(result.reason_code, 'corrupt_autonomy_event');
  actionHash(result.evidence_fingerprint, 'corrupt_autonomy_event');
  actionHash(result.event_fingerprint, 'corrupt_autonomy_event');
  const { id: _id, event_fingerprint: _fingerprint, created_at: _created, ...core } = result;
  if (result.event_fingerprint !== autonomyFingerprint(core)) throw new BoundedAutonomyError('corrupt_autonomy_event', 'event fingerprint is invalid');
  return result;
}

export class BoundedAutonomyRepository {
  constructor(private readonly knex: Knex = db, private readonly uuid: () => string = uuidv4) {}

  async findG6Policy(policyId: string) {
    return normalizedG6(await this.knex<SupervisedActionPolicyRecord>(G6_TABLES.policies).where({ policy_id: policyId }).first());
  }

  async findLatestG5Decision(tenantId: string, sourceConnectionId: string): Promise<Phase2ReleaseDecisionRecord | undefined> {
    return this.knex<Phase2ReleaseDecisionRecord>(PHASE2_TABLES.releaseDecisions)
      .where({ tenant_id: tenantId, source_connection_id: sourceConnectionId })
      .orderBy('decided_at', 'desc').orderBy('id', 'desc').first();
  }

  async latestSourceReceivedAt(tenantId: string, sourceConnectionId: string): Promise<string | null> {
    const row = await this.knex('source_snapshots').select('received_at')
      .where({ tenant_id: tenantId, source_connection_id: sourceConnectionId })
      .orderBy('received_at', 'desc').first();
    return row ? actionIso(row.received_at, 'corrupt_source_snapshot') : null;
  }

  async supervisedHistory(
    g6PolicyRecordId: string,
    windowDays: number,
    at: string,
  ): Promise<SupervisedHistoryEvidence> {
    const evaluatedAt = actionIso(at);
    const windowStartedAt = new Date(Date.parse(evaluatedAt) - windowDays * 86_400_000).toISOString();
    const rows = await this.knex(`${G6_TABLES.attempts} as a`)
      .join(`${G6_TABLES.proposals} as p`, 'p.id', 'a.proposal_id')
      .select('a.kind', 'a.status', 'a.started_at')
      .where('p.policy_record_id', g6PolicyRecordId)
      .andWhere('a.started_at', '>=', windowStartedAt)
      .andWhere('a.started_at', '<=', evaluatedAt);
    const successfulExecutions = rows.filter((row) => row.kind === 'execute' && row.status === 'succeeded').length;
    const nonSuccessfulExecutions = rows.filter((row) => row.kind === 'execute' && row.status !== 'succeeded').length;
    const successfulRollbacks = rows.filter((row) => row.kind === 'rollback' && row.status === 'succeeded').length;
    const core = {
      successful_executions: successfulExecutions,
      non_successful_executions: nonSuccessfulExecutions,
      successful_rollbacks: successfulRollbacks,
      window_started_at: windowStartedAt,
      evaluated_at: evaluatedAt,
    };
    return { ...core, evidence_fingerprint: autonomyFingerprint(core) };
  }

  async recordSimulation(input: {
    manifest: G7BoundedAutonomyPolicyManifest;
    g6PolicyRecordId: string;
    result: G7SimulationResult;
    simulatedBy: string;
  }): Promise<G7PolicySimulationRecord> {
    const simulatedBy = actionActor(input.simulatedBy, 'invalid_simulation_actor');
    if (!input.result.passed) throw new BoundedAutonomyError('g7_simulation_failed', 'G7 policy simulation did not pass');
    const candidate: G7PolicySimulationRecord = {
      id: this.uuid(),
      tenant_id: input.manifest.tenant_id,
      source_connection_id: input.manifest.source_connection_id,
      g6_policy_record_id: input.g6PolicyRecordId,
      policy_id: input.manifest.policy_id,
      policy_fingerprint: input.result.policy_fingerprint,
      g6_policy_fingerprint: input.result.g6_policy_fingerprint,
      scenario_set_version: input.result.scenario_set_version,
      scenario_count: input.result.outcomes.length,
      passed: true,
      outcomes_json: canonicalStringify(input.result.outcomes),
      simulation_fingerprint: input.result.simulation_fingerprint,
      simulated_by: simulatedBy,
      simulated_at: actionIso(input.result.simulated_at),
      created_at: actionIso(input.result.simulated_at),
    };
    const existing = await this.knex<G7PolicySimulationRecord>(G7_TABLES.simulations)
      .where({ policy_id: candidate.policy_id, policy_fingerprint: candidate.policy_fingerprint }).first();
    if (existing) {
      const normalized = normalizedSimulation(existing);
      if (normalized.simulation_fingerprint !== candidate.simulation_fingerprint) {
        throw new BoundedAutonomyError('g7_simulation_conflict', 'policy already has different simulation evidence');
      }
      return normalized;
    }
    await this.knex(G7_TABLES.simulations).insert(candidate);
    return normalizedSimulation(await this.knex<G7PolicySimulationRecord>(G7_TABLES.simulations).where({ id: candidate.id }).first());
  }

  async findSimulation(policyFingerprint: string): Promise<G7PolicySimulationRecord> {
    return normalizedSimulation(await this.knex<G7PolicySimulationRecord>(G7_TABLES.simulations)
      .where({ policy_fingerprint: policyFingerprint }).first());
  }

  async recordPolicy(input: {
    manifest: G7BoundedAutonomyPolicyManifest;
    g6: { record: SupervisedActionPolicyRecord; manifest: G6ActionPolicyManifest };
    g5: Phase2ReleaseDecisionRecord;
    simulation: G7PolicySimulationRecord;
  }): Promise<BoundedAutonomyPolicyRecord> {
    const validation = validateG7Policy(input.manifest, input.g6.manifest);
    if (!validation.ok || !validation.value || !validation.fingerprint) {
      throw new BoundedAutonomyError('invalid_g7_policy', validation.issues.join('; '));
    }
    const policyFingerprint = validation.fingerprint;
    const validatedManifest = validation.value;
    const expectedSimulation = simulateG7Policy(
      validatedManifest,
      input.g6.manifest,
      input.simulation.simulated_at,
    );
    if (
      !input.simulation.passed
      || input.simulation.policy_fingerprint !== policyFingerprint
      || input.simulation.g6_policy_fingerprint !== input.g6.record.policy_fingerprint
      || input.simulation.simulation_fingerprint !== expectedSimulation.simulation_fingerprint
    ) throw new BoundedAutonomyError('simulation_not_passed', 'exact recomputed G7 simulation did not pass');
    return this.knex.transaction(async (trx) => {
      const existing = await trx<BoundedAutonomyPolicyRecord>(G7_TABLES.policies)
        .where({ policy_id: input.manifest.policy_id }).first();
      if (existing) {
        const normalized = normalizedPolicy(existing, input.g6.manifest);
        if (normalized.record.policy_fingerprint !== policyFingerprint) {
          throw new BoundedAutonomyError('g7_policy_conflict', 'policy ID already has different evidence');
        }
        return normalized.record;
      }
      const record: BoundedAutonomyPolicyRecord = {
        id: this.uuid(),
        tenant_id: input.manifest.tenant_id,
        source_connection_id: input.manifest.source_connection_id,
        g5_release_decision_id: input.g5.id,
        g6_policy_record_id: input.g6.record.id,
        simulation_id: input.simulation.id,
        policy_id: input.manifest.policy_id,
        environment: input.manifest.environment,
        command_key: input.manifest.g6_policy.command_key,
        command_version: input.manifest.g6_policy.command_version,
        adapter_id: input.manifest.g6_policy.adapter_id,
        target_fingerprint: input.manifest.g6_policy.target_fingerprint,
        valid_from: actionIso(input.manifest.valid_from),
        valid_until: actionIso(input.manifest.valid_until),
        policy_fingerprint: policyFingerprint,
        manifest_json: canonicalStringify(validatedManifest),
        accepted_at: actionIso(input.manifest.approved_at),
        created_at: actionIso(input.manifest.approved_at),
      };
      await trx(G7_TABLES.policies).insert(record);
      await this.appendEvent(trx, record, 'policy_accepted', input.manifest.approved_by, record.policy_fingerprint, 'g7_policy_accepted', record.accepted_at);
      await this.appendKillSwitch(trx, record, 'engaged', input.manifest.approved_by, record.policy_fingerprint, 'policy_initial_fail_closed', record.accepted_at);
      return normalizedPolicy(await trx<BoundedAutonomyPolicyRecord>(G7_TABLES.policies).where({ id: record.id }).first(), input.g6.manifest).record;
    });
  }

  async findPolicy(policyId: string): Promise<{
    record: BoundedAutonomyPolicyRecord;
    manifest: G7BoundedAutonomyPolicyManifest;
    g6: { record: SupervisedActionPolicyRecord; manifest: G6ActionPolicyManifest };
    simulation: G7PolicySimulationRecord;
  }> {
    const row = await this.knex<BoundedAutonomyPolicyRecord>(G7_TABLES.policies).where({ policy_id: policyId }).first();
    if (!row) throw new BoundedAutonomyError('missing_g7_policy', 'bounded-autonomy policy does not exist');
    const g6 = normalizedG6(await this.knex<SupervisedActionPolicyRecord>(G6_TABLES.policies).where({ id: row.g6_policy_record_id }).first());
    const policy = normalizedPolicy(row, g6.manifest);
    const simulation = normalizedSimulation(await this.knex<G7PolicySimulationRecord>(G7_TABLES.simulations).where({ id: row.simulation_id }).first());
    if (simulation.policy_fingerprint !== policy.record.policy_fingerprint || simulation.g6_policy_fingerprint !== g6.record.policy_fingerprint) {
      throw new BoundedAutonomyError('corrupt_g7_policy', 'policy simulation binding is invalid');
    }
    const expectedSimulation = simulateG7Policy(policy.manifest, g6.manifest, simulation.simulated_at);
    if (simulation.simulation_fingerprint !== expectedSimulation.simulation_fingerprint) {
      throw new BoundedAutonomyError('corrupt_g7_policy', 'stored policy simulation does not recompute exactly');
    }
    if (
      policy.record.g6_policy_record_id !== g6.record.id
      || policy.record.g5_release_decision_id !== g6.manifest.g5_release.decision_id
      || policy.record.simulation_id !== simulation.id
    ) throw new BoundedAutonomyError('corrupt_g7_policy', 'policy prerequisite references are invalid');
    return { ...policy, g6, simulation };
  }

  async latestKillSwitch(policyRecordId: string): Promise<KillSwitchEventRecord> {
    return normalizedKillSwitch(await this.knex<KillSwitchEventRecord>(G7_TABLES.killSwitchEvents)
      .where({ policy_record_id: policyRecordId }).orderBy('sequence', 'desc').first());
  }

  async transitionKillSwitch(input: {
    policy: BoundedAutonomyPolicyRecord;
    state: KillSwitchState;
    actor: string;
    reasonCode: string;
    evidenceFingerprint: string;
    occurredAt: string;
  }): Promise<KillSwitchEventRecord> {
    return this.knex.transaction(async (trx) => {
      await this.lockPolicy(trx, input.policy.id);
      const latest = normalizedKillSwitch(await trx<KillSwitchEventRecord>(G7_TABLES.killSwitchEvents)
        .where({ policy_record_id: input.policy.id }).orderBy('sequence', 'desc').first());
      if (latest.state === input.state) return latest;
      if (input.state === 'released' && await this.countOpenIncidentsIn(trx, input.policy.id) > 0) {
        throw new BoundedAutonomyError('open_incident', 'kill switch cannot release while an incident is open');
      }
      if (input.state === 'released') {
        const inProgress = await trx(G7_TABLES.attempts)
          .where({ policy_record_id: input.policy.id, status: 'in_progress' })
          .count<{ count: string | number }[]>({ count: '*' });
        if (Number(inProgress[0]?.count ?? 0) > 0) {
          throw new BoundedAutonomyError('attempt_in_progress', 'kill switch cannot release while an attempt is in progress');
        }
      }
      return this.appendKillSwitch(
        trx,
        input.policy,
        input.state,
        input.actor,
        input.evidenceFingerprint,
        input.reasonCode,
        input.occurredAt,
      );
    });
  }

  async countOpenIncidents(policyRecordId: string): Promise<number> {
    return this.countOpenIncidentsIn(this.knex, policyRecordId);
  }

  async listOpenIncidents(policyRecordId: string): Promise<AutonomyIncidentEventRecord[]> {
    const rows = await this.knex<AutonomyIncidentEventRecord>(G7_TABLES.incidentEvents)
      .where({ policy_record_id: policyRecordId }).orderBy('occurred_at', 'asc');
    const latest = new Map<string, AutonomyIncidentEventRecord>();
    for (const row of rows) latest.set(row.incident_id, normalizedIncident(row));
    return [...latest.values()].filter((row) => row.kind === 'opened');
  }

  async listIncidentEvents(policyRecordId: string): Promise<AutonomyIncidentEventRecord[]> {
    const rows = await this.knex<AutonomyIncidentEventRecord>(G7_TABLES.incidentEvents)
      .where({ policy_record_id: policyRecordId })
      .orderBy('occurred_at', 'asc')
      .orderBy('sequence', 'asc');
    return rows.map(normalizedIncident);
  }

  async resolveIncident(input: {
    policy: BoundedAutonomyPolicyRecord;
    incidentId: string;
    actor: string;
    reasonCode: string;
    evidenceFingerprint: string;
    occurredAt: string;
  }): Promise<AutonomyIncidentEventRecord> {
    return this.knex.transaction(async (trx) => {
      await this.lockPolicy(trx, input.policy.id);
      const opened = normalizedIncident(await trx<AutonomyIncidentEventRecord>(G7_TABLES.incidentEvents)
        .where({ policy_record_id: input.policy.id, incident_id: input.incidentId })
        .orderBy('sequence', 'desc').first());
      if (opened.kind === 'resolved') return opened;
      const core = {
        tenant_id: input.policy.tenant_id,
        policy_record_id: input.policy.id,
        incident_id: actionUuid(input.incidentId, 'invalid_incident_id'),
        attempt_id: opened.attempt_id,
        sequence: 2,
        kind: 'resolved' as const,
        actor: actionActor(input.actor, 'invalid_incident_actor'),
        reason_code: actionCode(input.reasonCode, 'invalid_incident_reason'),
        evidence_fingerprint: actionHash(input.evidenceFingerprint, 'invalid_incident_evidence'),
        occurred_at: actionIso(input.occurredAt),
      };
      const event = normalizedIncident({ id: this.uuid(), ...core, event_fingerprint: autonomyFingerprint(core), created_at: core.occurred_at });
      await trx(G7_TABLES.incidentEvents).insert(event);
      await this.appendEvent(trx, input.policy, 'incident_resolved', core.actor, core.evidence_fingerprint, core.reason_code, core.occurred_at);
      return event;
    });
  }

  async openControlIncident(input: {
    policy: BoundedAutonomyPolicyRecord;
    attemptId?: string;
    actor: string;
    reasonCode: string;
    evidenceFingerprint: string;
    occurredAt: string;
  }): Promise<{ incident: AutonomyIncidentEventRecord; killSwitch: KillSwitchEventRecord }> {
    return this.knex.transaction(async (trx) => {
      await this.lockPolicy(trx, input.policy.id);
      const existing = await trx<AutonomyIncidentEventRecord>(G7_TABLES.incidentEvents)
        .where({
          policy_record_id: input.policy.id,
          kind: 'opened',
          evidence_fingerprint: input.evidenceFingerprint,
        }).first();
      let incident: AutonomyIncidentEventRecord;
      if (existing) {
        incident = normalizedIncident(existing);
      } else {
        const core = {
          tenant_id: input.policy.tenant_id,
          policy_record_id: input.policy.id,
          incident_id: this.uuid(),
          attempt_id: input.attemptId ? actionUuid(input.attemptId, 'invalid_incident_attempt') : null,
          sequence: 1,
          kind: 'opened' as const,
          actor: actionActor(input.actor, 'invalid_incident_actor'),
          reason_code: actionCode(input.reasonCode, 'invalid_incident_reason'),
          evidence_fingerprint: actionHash(input.evidenceFingerprint, 'invalid_incident_evidence'),
          occurred_at: actionIso(input.occurredAt),
        };
        incident = normalizedIncident({
          id: this.uuid(),
          ...core,
          event_fingerprint: autonomyFingerprint(core),
          created_at: core.occurred_at,
        });
        await trx(G7_TABLES.incidentEvents).insert(incident);
        await this.appendEvent(
          trx,
          input.policy,
          'incident_opened',
          core.actor,
          core.evidence_fingerprint,
          core.reason_code,
          core.occurred_at,
        );
      }
      const latest = normalizedKillSwitch(await trx<KillSwitchEventRecord>(G7_TABLES.killSwitchEvents)
        .where({ policy_record_id: input.policy.id }).orderBy('sequence', 'desc').first());
      const killSwitch = latest.state === 'engaged'
        ? latest
        : await this.appendKillSwitch(
          trx,
          input.policy,
          'engaged',
          input.actor,
          input.evidenceFingerprint,
          'incident_fail_closed',
          input.occurredAt,
        );
      return { incident, killSwitch };
    });
  }

  async usage(policyRecordId: string, at: string): Promise<AutonomyUsageState> {
    return this.usageIn(this.knex, policyRecordId, at);
  }

  async findEvaluation(policyRecordId: string, idempotencyKey: string): Promise<AutonomyEvaluationRecord | undefined> {
    const row = await this.knex<AutonomyEvaluationRecord>(G7_TABLES.evaluations)
      .where({ policy_record_id: policyRecordId, idempotency_key: idempotencyKey }).first();
    return row ? normalizedEvaluation(row) : undefined;
  }

  async recordEvaluation(input: EvaluationInsert, actor: string): Promise<AutonomyEvaluationRecord> {
    return this.knex.transaction(async (trx) => {
      await this.lockPolicy(trx, input.policy_record_id);
      const existing = await trx<AutonomyEvaluationRecord>(G7_TABLES.evaluations)
        .where({ policy_record_id: input.policy_record_id, idempotency_key: input.idempotency_key }).first();
      const candidate = normalizedEvaluation({ id: this.uuid(), ...input, created_at: input.evaluated_at });
      if (existing) {
        const normalized = normalizedEvaluation(existing);
        if (normalized.evaluation_fingerprint !== candidate.evaluation_fingerprint) {
          throw new BoundedAutonomyError('autonomy_evaluation_conflict', 'idempotency key has different evaluation evidence');
        }
        return normalized;
      }
      await trx(G7_TABLES.evaluations).insert(candidate);
      const policy = await trx<BoundedAutonomyPolicyRecord>(G7_TABLES.policies).where({ id: input.policy_record_id }).first();
      if (!policy) throw new BoundedAutonomyError('missing_g7_policy', 'bounded-autonomy policy does not exist');
      await this.appendEvent(
        trx,
        policy,
        candidate.decision === 'allow' ? 'evaluation_allowed' : 'evaluation_denied',
        actor,
        candidate.evaluation_fingerprint,
        candidate.decision_code,
        candidate.evaluated_at,
      );
      return candidate;
    });
  }

  async claimAttempt(
    input: AttemptInsert,
    guards: AtomicClaimGuards,
  ): Promise<{ attempt: AutonomyAttemptRecord; replayed: boolean }> {
    return this.knex.transaction(async (trx) => {
      await this.lockPolicy(trx, input.policy_record_id);
      const existing = await trx<AutonomyAttemptRecord>(G7_TABLES.attempts).where({ evaluation_id: input.evaluation_id }).first();
      if (existing) {
        const normalized = normalizedAttempt(existing);
        if (
          normalized.policy_record_id !== input.policy_record_id
          || normalized.idempotency_key !== input.idempotency_key
          || normalized.request_fingerprint !== input.request_fingerprint
          || normalized.executor !== input.executor
        ) throw new BoundedAutonomyError('autonomy_attempt_conflict', 'existing attempt does not bind the claim');
        return { attempt: normalized, replayed: true };
      }
      const policyRow = await trx<BoundedAutonomyPolicyRecord>(G7_TABLES.policies).where({ id: input.policy_record_id }).first();
      if (!policyRow) throw new BoundedAutonomyError('missing_g7_policy', 'bounded-autonomy policy does not exist');
      const evaluation = normalizedEvaluation(await trx<AutonomyEvaluationRecord>(G7_TABLES.evaluations).where({ id: input.evaluation_id }).first());
      if (
        evaluation.decision !== 'allow'
        || evaluation.policy_record_id !== input.policy_record_id
        || evaluation.tenant_id !== input.tenant_id
        || evaluation.idempotency_key !== input.idempotency_key
        || evaluation.request_fingerprint !== input.request_fingerprint
        || evaluation.estimated_cost_minor !== input.reserved_cost_minor
        || evaluation.currency !== input.currency
      ) throw new BoundedAutonomyError('evaluation_binding_mismatch', 'attempt does not bind the exact allowed evaluation');
      if (
        policyRow.tenant_id !== input.tenant_id
        || policyRow.g5_release_decision_id !== guards.g5ReleaseDecisionId
        || policyRow.g6_policy_record_id !== guards.g6PolicyRecordId
        || policyRow.simulation_id !== guards.simulationId
      ) throw new BoundedAutonomyError('policy_binding_mismatch', 'claim guards do not bind the stored policy');
      const at = actionIso(input.started_at);
      if (Date.parse(at) < Date.parse(policyRow.valid_from) || Date.parse(at) >= Date.parse(policyRow.valid_until)) {
        throw new BoundedAutonomyError('g7_not_active', 'bounded-autonomy policy is not active');
      }
      const latestG5 = await trx<Phase2ReleaseDecisionRecord>(PHASE2_TABLES.releaseDecisions)
        .where({ tenant_id: policyRow.tenant_id, source_connection_id: policyRow.source_connection_id })
        .orderBy('decided_at', 'desc').orderBy('id', 'desc').first();
      if (!latestG5 || latestG5.id !== guards.g5ReleaseDecisionId || latestG5.decision !== 'go') {
        throw new BoundedAutonomyError('g5_not_current_go', 'latest G5 decision is not the bound go');
      }
      const g6 = await trx<SupervisedActionPolicyRecord>(G6_TABLES.policies).where({ id: guards.g6PolicyRecordId }).first();
      if (!g6 || g6.policy_fingerprint !== guards.g6PolicyFingerprint || Date.parse(at) < Date.parse(g6.valid_from) || Date.parse(at) >= Date.parse(g6.valid_until)) {
        throw new BoundedAutonomyError('g6_not_active', 'bound G6 policy is absent, drifted, or inactive');
      }
      const simulation = await trx<G7PolicySimulationRecord>(G7_TABLES.simulations).where({ id: guards.simulationId }).first();
      if (!simulation || !bool(simulation.passed) || simulation.policy_fingerprint !== policyRow.policy_fingerprint) {
        throw new BoundedAutonomyError('simulation_not_passed', 'bound G7 simulation is invalid');
      }
      const kill = normalizedKillSwitch(await trx<KillSwitchEventRecord>(G7_TABLES.killSwitchEvents)
        .where({ policy_record_id: input.policy_record_id }).orderBy('sequence', 'desc').first());
      if (kill.state !== 'released') throw new BoundedAutonomyError('kill_switch_engaged', 'kill switch is engaged');
      if (await this.countOpenIncidentsIn(trx, input.policy_record_id) > 0) throw new BoundedAutonomyError('open_incident', 'an incident is open');
      const latestSnapshot = await trx('source_snapshots').select('received_at')
        .where({ tenant_id: policyRow.tenant_id, source_connection_id: policyRow.source_connection_id })
        .orderBy('received_at', 'desc').first();
      const snapshotAge = latestSnapshot ? Date.parse(at) - Date.parse(actionIso(latestSnapshot.received_at)) : Number.POSITIVE_INFINITY;
      if (!latestSnapshot || snapshotAge < 0 || snapshotAge > guards.maxSourceAgeMinutes * 60_000) {
        throw new BoundedAutonomyError('source_snapshot_stale', 'source snapshot is stale');
      }
      const history = await this.supervisedHistoryIn(trx, guards.g6PolicyRecordId, guards.historyWindowDays, at);
      if (history.successful_executions < guards.minSuccessfulExecutions || history.non_successful_executions !== 0 || history.successful_rollbacks < 1) {
        throw new BoundedAutonomyError('supervised_history_not_qualified', 'supervised history no longer qualifies');
      }
      const usage = await this.usageIn(trx, input.policy_record_id, at);
      if (usage.executionsLastHour >= guards.maxPerHour) throw new BoundedAutonomyError('hourly_limit_exhausted', 'hourly limit is exhausted');
      if (usage.executionsLastDay >= guards.maxPerDay) throw new BoundedAutonomyError('daily_limit_exhausted', 'daily limit is exhausted');
      if (usage.costLastDay + input.reserved_cost_minor > guards.maxCostPerDay) throw new BoundedAutonomyError('daily_cost_exceeds_limit', 'daily cost limit is exhausted');
      if (usage.lastStartedAt && Date.parse(at) - Date.parse(usage.lastStartedAt) < guards.cooldownSeconds * 1_000) {
        throw new BoundedAutonomyError('cooldown_active', 'autonomy cooldown is active');
      }
      const candidate = normalizedAttempt({
        id: this.uuid(), ...input, kind: 'execute', subject_attempt_id: null,
        recovery_approval_id: null, status: 'in_progress', finished_at: null,
        external_request_id: null, result_fingerprint: null, result_code: null,
        actual_cost_minor: null, external_mutation_count: null, latency_ms: null,
        created_at: at,
      });
      await trx(G7_TABLES.attempts).insert(candidate);
      await this.appendEvent(trx, policyRow, 'execution_started', candidate.executor, candidate.request_fingerprint, 'bounded_execution_started', at);
      return { attempt: candidate, replayed: false };
    });
  }

  async findAttemptById(attemptId: string): Promise<AutonomyAttemptRecord> {
    return normalizedAttempt(await this.knex<AutonomyAttemptRecord>(G7_TABLES.attempts).where({ id: attemptId }).first());
  }

  async recordRecoveryPreview(
    input: Omit<AutonomyRecoveryPreviewRecord, 'id' | 'created_at'>,
  ): Promise<AutonomyRecoveryPreviewRecord> {
    return this.knex.transaction(async (trx) => {
      await this.lockPolicy(trx, input.policy_record_id);
      const subject = normalizedAttempt(await trx<AutonomyAttemptRecord>(G7_TABLES.attempts)
        .where({ id: input.subject_attempt_id }).first());
      if (subject.policy_record_id !== input.policy_record_id || subject.kind !== 'execute' || subject.status !== 'succeeded') {
        throw new BoundedAutonomyError('recovery_subject_invalid', 'recovery subject is not a successful autonomous execution');
      }
      const candidate = normalizedRecoveryPreview({ id: this.uuid(), ...input, created_at: input.previewed_at });
      const existing = await trx<AutonomyRecoveryPreviewRecord>(G7_TABLES.recoveryPreviews)
        .where({ subject_attempt_id: input.subject_attempt_id }).first();
      if (existing) {
        const normalized = normalizedRecoveryPreview(existing);
        if (normalized.preview_fingerprint !== candidate.preview_fingerprint) {
          throw new BoundedAutonomyError('recovery_preview_conflict', 'subject already has different recovery preview evidence');
        }
        return normalized;
      }
      await trx(G7_TABLES.recoveryPreviews).insert(candidate);
      const policy = await trx<BoundedAutonomyPolicyRecord>(G7_TABLES.policies).where({ id: input.policy_record_id }).first();
      if (!policy) throw new BoundedAutonomyError('missing_g7_policy', 'bounded-autonomy policy does not exist');
      await this.appendEvent(trx, policy, 'recovery_previewed', candidate.previewed_by, candidate.preview_fingerprint, candidate.summary_code, candidate.previewed_at);
      return candidate;
    });
  }

  async findRecoveryPreview(subjectAttemptId: string): Promise<AutonomyRecoveryPreviewRecord> {
    return normalizedRecoveryPreview(await this.knex<AutonomyRecoveryPreviewRecord>(G7_TABLES.recoveryPreviews)
      .where({ subject_attempt_id: subjectAttemptId }).first());
  }

  async recordRecoveryApproval(
    input: Omit<AutonomyRecoveryApprovalRecord, 'id' | 'created_at'>,
  ): Promise<AutonomyRecoveryApprovalRecord> {
    return this.knex.transaction(async (trx) => {
      await this.lockPolicy(trx, input.policy_record_id);
      const preview = normalizedRecoveryPreview(await trx<AutonomyRecoveryPreviewRecord>(G7_TABLES.recoveryPreviews)
        .where({ id: input.preview_id }).first());
      if (
        preview.policy_record_id !== input.policy_record_id
        || preview.subject_attempt_id !== input.subject_attempt_id
        || preview.preview_fingerprint !== input.preview_fingerprint
      ) throw new BoundedAutonomyError('recovery_approval_binding_mismatch', 'recovery approval does not bind its preview');
      const candidate = normalizedRecoveryApproval({ id: this.uuid(), ...input, created_at: input.decided_at });
      const existing = await trx<AutonomyRecoveryApprovalRecord>(G7_TABLES.recoveryApprovals)
        .where({ preview_id: input.preview_id }).first();
      if (existing) {
        const normalized = normalizedRecoveryApproval(existing);
        if (normalized.approval_fingerprint !== candidate.approval_fingerprint) {
          throw new BoundedAutonomyError('recovery_approval_conflict', 'preview already has a different recovery decision');
        }
        return normalized;
      }
      await trx(G7_TABLES.recoveryApprovals).insert(candidate);
      const policy = await trx<BoundedAutonomyPolicyRecord>(G7_TABLES.policies).where({ id: input.policy_record_id }).first();
      if (!policy) throw new BoundedAutonomyError('missing_g7_policy', 'bounded-autonomy policy does not exist');
      await this.appendEvent(
        trx,
        policy,
        candidate.decision === 'approved' ? 'recovery_approved' : 'recovery_rejected',
        candidate.approver,
        candidate.approval_fingerprint,
        candidate.reason_code,
        candidate.decided_at,
      );
      return candidate;
    });
  }

  async findRecoveryApproval(previewId: string): Promise<AutonomyRecoveryApprovalRecord> {
    return normalizedRecoveryApproval(await this.knex<AutonomyRecoveryApprovalRecord>(G7_TABLES.recoveryApprovals)
      .where({ preview_id: previewId }).first());
  }

  async claimRecoveryAttempt(input: {
    tenant_id: string;
    policy_record_id: string;
    subject_attempt_id: string;
    recovery_approval_id: string;
    idempotency_key: string;
    request_fingerprint: string;
    executor: string;
    reserved_cost_minor: number;
    currency: string;
    started_at: string;
    lease_expires_at: string;
  }): Promise<{ attempt: AutonomyAttemptRecord; replayed: boolean }> {
    return this.knex.transaction(async (trx) => {
      await this.lockPolicy(trx, input.policy_record_id);
      const existing = await trx<AutonomyAttemptRecord>(G7_TABLES.attempts)
        .where({ subject_attempt_id: input.subject_attempt_id }).first();
      if (existing) {
        const normalized = normalizedAttempt(existing);
        if (
          normalized.policy_record_id !== input.policy_record_id
          || normalized.recovery_approval_id !== input.recovery_approval_id
          || normalized.idempotency_key !== input.idempotency_key
          || normalized.request_fingerprint !== input.request_fingerprint
          || normalized.executor !== input.executor
        ) throw new BoundedAutonomyError('recovery_attempt_conflict', 'existing recovery does not bind the claim');
        return { attempt: normalized, replayed: true };
      }
      const latestKill = normalizedKillSwitch(await trx<KillSwitchEventRecord>(G7_TABLES.killSwitchEvents)
        .where({ policy_record_id: input.policy_record_id }).orderBy('sequence', 'desc').first());
      if (latestKill.state !== 'engaged') {
        throw new BoundedAutonomyError('kill_switch_must_be_engaged', 'recovery requires an engaged kill switch');
      }
      const subject = normalizedAttempt(await trx<AutonomyAttemptRecord>(G7_TABLES.attempts)
        .where({ id: input.subject_attempt_id }).first());
      const approval = normalizedRecoveryApproval(await trx<AutonomyRecoveryApprovalRecord>(G7_TABLES.recoveryApprovals)
        .where({ id: input.recovery_approval_id }).first());
      const preview = normalizedRecoveryPreview(await trx<AutonomyRecoveryPreviewRecord>(G7_TABLES.recoveryPreviews)
        .where({ id: approval.preview_id }).first());
      const at = actionIso(input.started_at);
      if (
        input.tenant_id !== subject.tenant_id
        || subject.kind !== 'execute'
        || subject.status !== 'succeeded'
        || subject.policy_record_id !== input.policy_record_id
        || approval.policy_record_id !== input.policy_record_id
        || approval.subject_attempt_id !== subject.id
        || approval.decision !== 'approved'
        || approval.expires_at <= at
        || approval.max_cost_minor < input.reserved_cost_minor
        || approval.currency !== input.currency
        || preview.request_fingerprint !== input.request_fingerprint
        || preview.estimated_cost_minor !== input.reserved_cost_minor
        || Date.parse(at) >= Date.parse(subject.finished_at!) + 24 * 3_600_000
      ) throw new BoundedAutonomyError('recovery_authorization_invalid', 'recovery authorization is invalid or expired');
      const candidate = normalizedAttempt({
        id: this.uuid(),
        tenant_id: input.tenant_id,
        policy_record_id: input.policy_record_id,
        evaluation_id: null,
        kind: 'recovery',
        subject_attempt_id: input.subject_attempt_id,
        recovery_approval_id: input.recovery_approval_id,
        idempotency_key: input.idempotency_key,
        request_fingerprint: input.request_fingerprint,
        status: 'in_progress',
        executor: input.executor,
        reserved_cost_minor: input.reserved_cost_minor,
        currency: input.currency,
        started_at: at,
        lease_expires_at: actionIso(input.lease_expires_at),
        finished_at: null,
        external_request_id: null,
        result_fingerprint: null,
        result_code: null,
        actual_cost_minor: null,
        external_mutation_count: null,
        latency_ms: null,
        created_at: at,
      });
      await trx(G7_TABLES.attempts).insert(candidate);
      const policy = await trx<BoundedAutonomyPolicyRecord>(G7_TABLES.policies).where({ id: input.policy_record_id }).first();
      if (!policy) throw new BoundedAutonomyError('missing_g7_policy', 'bounded-autonomy policy does not exist');
      await this.appendEvent(trx, policy, 'recovery_started', candidate.executor, candidate.request_fingerprint, 'human_recovery_started', at);
      return { attempt: candidate, replayed: false };
    });
  }

  async findRecoveryAttempt(subjectAttemptId: string): Promise<AutonomyAttemptRecord | undefined> {
    const row = await this.knex<AutonomyAttemptRecord>(G7_TABLES.attempts)
      .where({ subject_attempt_id: subjectAttemptId, kind: 'recovery' }).first();
    return row ? normalizedAttempt(row) : undefined;
  }

  async completeAttempt(attemptId: string, completion: AttemptCompletion): Promise<AutonomyAttemptRecord> {
    return this.knex.transaction(async (trx) => {
      const current = normalizedAttempt(await trx<AutonomyAttemptRecord>(G7_TABLES.attempts).where({ id: attemptId }).first());
      if (current.status !== 'in_progress') return current;
      if (completion.status !== 'succeeded') {
        throw new BoundedAutonomyError('unsafe_attempt_completion', 'non-successful attempts must halt with incident evidence');
      }
      await this.lockPolicy(trx, current.policy_record_id);
      const stored = await this.transitionAttempt(trx, current, completion);
      const policy = await trx<BoundedAutonomyPolicyRecord>(G7_TABLES.policies).where({ id: current.policy_record_id }).first();
      if (!policy) throw new BoundedAutonomyError('missing_g7_policy', 'bounded-autonomy policy does not exist');
      await this.appendEvent(
        trx,
        policy,
        stored.kind === 'recovery' ? 'recovery_succeeded' : 'execution_succeeded',
        stored.executor,
        stored.result_fingerprint!,
        stored.result_code!,
        stored.finished_at!,
      );
      return stored;
    });
  }

  async haltAttemptWithIncident(input: {
    attemptId: string;
    completion: AttemptCompletion;
    actor: string;
    incidentReasonCode: string;
    evidenceFingerprint: string;
  }): Promise<{ attempt: AutonomyAttemptRecord; incident: AutonomyIncidentEventRecord; killSwitch: KillSwitchEventRecord }> {
    return this.knex.transaction(async (trx) => {
      const current = normalizedAttempt(await trx<AutonomyAttemptRecord>(G7_TABLES.attempts).where({ id: input.attemptId }).first());
      const policy = await trx<BoundedAutonomyPolicyRecord>(G7_TABLES.policies).where({ id: current.policy_record_id }).first();
      if (!policy) throw new BoundedAutonomyError('missing_g7_policy', 'bounded-autonomy policy does not exist');
      await this.lockPolicy(trx, policy.id);
      const stored = current.status === 'in_progress' ? await this.transitionAttempt(trx, current, input.completion) : current;
      const existingIncident = await trx<AutonomyIncidentEventRecord>(G7_TABLES.incidentEvents)
        .where({ attempt_id: current.id, kind: 'opened' }).first();
      let incident: AutonomyIncidentEventRecord;
      if (existingIncident) {
        incident = normalizedIncident(existingIncident);
      } else {
        const core = {
          tenant_id: policy.tenant_id,
          policy_record_id: policy.id,
          incident_id: this.uuid(),
          attempt_id: current.id,
          sequence: 1,
          kind: 'opened' as const,
          actor: actionActor(input.actor, 'invalid_incident_actor'),
          reason_code: actionCode(input.incidentReasonCode, 'invalid_incident_reason'),
          evidence_fingerprint: actionHash(input.evidenceFingerprint, 'invalid_incident_evidence'),
          occurred_at: actionIso(input.completion.finished_at),
        };
        incident = normalizedIncident({ id: this.uuid(), ...core, event_fingerprint: autonomyFingerprint(core), created_at: core.occurred_at });
        await trx(G7_TABLES.incidentEvents).insert(incident);
        await this.appendEvent(trx, policy, 'incident_opened', core.actor, core.evidence_fingerprint, core.reason_code, core.occurred_at);
      }
      const latestKill = normalizedKillSwitch(await trx<KillSwitchEventRecord>(G7_TABLES.killSwitchEvents)
        .where({ policy_record_id: policy.id }).orderBy('sequence', 'desc').first());
      const killSwitch = latestKill.state === 'engaged'
        ? latestKill
        : await this.appendKillSwitch(trx, policy, 'engaged', input.actor, input.evidenceFingerprint, 'incident_fail_closed', input.completion.finished_at);
      await this.appendEvent(
        trx,
        policy,
        stored.kind === 'recovery'
          ? (stored.status === 'reconciliation_required' ? 'recovery_reconciliation_required' : 'recovery_failed')
          : (stored.status === 'reconciliation_required' ? 'execution_reconciliation_required' : 'execution_failed'),
        stored.executor,
        stored.result_fingerprint!,
        stored.result_code!,
        stored.finished_at!,
      );
      return { attempt: stored, incident, killSwitch };
    });
  }

  async findAttemptByEvaluation(evaluationId: string): Promise<AutonomyAttemptRecord | undefined> {
    const row = await this.knex<AutonomyAttemptRecord>(G7_TABLES.attempts).where({ evaluation_id: evaluationId }).first();
    return row ? normalizedAttempt(row) : undefined;
  }

  async listEvents(policyRecordId: string): Promise<AutonomyEventRecord[]> {
    const rows = await this.knex<AutonomyEventRecord>(G7_TABLES.events).where({ policy_record_id: policyRecordId }).orderBy('sequence', 'asc');
    return rows.map(normalizedEvent);
  }

  private async transitionAttempt(
    trx: Knex.Transaction,
    current: AutonomyAttemptRecord,
    completion: AttemptCompletion,
  ): Promise<AutonomyAttemptRecord> {
    const update = {
      status: completion.status,
      finished_at: actionIso(completion.finished_at),
      external_request_id: completion.external_request_id,
      result_fingerprint: actionHash(completion.result_fingerprint, 'invalid_autonomy_result'),
      result_code: actionCode(completion.result_code, 'invalid_autonomy_result_code'),
      actual_cost_minor: completion.actual_cost_minor === null ? null : actionMoney(completion.actual_cost_minor, 'invalid_autonomy_cost'),
      external_mutation_count: completion.external_mutation_count,
      latency_ms: actionMoney(completion.latency_ms, 'invalid_autonomy_latency', Number.MAX_SAFE_INTEGER),
    };
    if (completion.external_request_id !== null) actionCode(completion.external_request_id, 'invalid_external_request_id');
    const changed = await trx(G7_TABLES.attempts).where({ id: current.id, status: 'in_progress' }).update(update);
    if (changed !== 1) throw new BoundedAutonomyError('autonomy_attempt_conflict', 'attempt terminal transition conflicted');
    return normalizedAttempt(await trx<AutonomyAttemptRecord>(G7_TABLES.attempts).where({ id: current.id }).first());
  }

  private async countOpenIncidentsIn(knex: Knex | Knex.Transaction, policyRecordId: string): Promise<number> {
    const rows = await knex<AutonomyIncidentEventRecord>(G7_TABLES.incidentEvents)
      .where({ policy_record_id: policyRecordId }).orderBy('sequence', 'asc');
    const latest = new Map<string, AutonomyIncidentEventRecord>();
    for (const row of rows) latest.set(row.incident_id, row);
    return [...latest.values()].filter((row) => row.kind === 'opened').length;
  }

  private async supervisedHistoryIn(
    knex: Knex | Knex.Transaction,
    g6PolicyRecordId: string,
    windowDays: number,
    at: string,
  ): Promise<SupervisedHistoryEvidence> {
    const evaluatedAt = actionIso(at);
    const windowStartedAt = new Date(Date.parse(evaluatedAt) - windowDays * 86_400_000).toISOString();
    const rows = await knex(`${G6_TABLES.attempts} as a`).join(`${G6_TABLES.proposals} as p`, 'p.id', 'a.proposal_id')
      .select('a.kind', 'a.status').where('p.policy_record_id', g6PolicyRecordId)
      .andWhere('a.started_at', '>=', windowStartedAt).andWhere('a.started_at', '<=', evaluatedAt);
    const core = {
      successful_executions: rows.filter((row) => row.kind === 'execute' && row.status === 'succeeded').length,
      non_successful_executions: rows.filter((row) => row.kind === 'execute' && row.status !== 'succeeded').length,
      successful_rollbacks: rows.filter((row) => row.kind === 'rollback' && row.status === 'succeeded').length,
      window_started_at: windowStartedAt,
      evaluated_at: evaluatedAt,
    };
    return { ...core, evidence_fingerprint: autonomyFingerprint(core) };
  }

  private async usageIn(knex: Knex | Knex.Transaction, policyRecordId: string, at: string): Promise<AutonomyUsageState> {
    const instant = Date.parse(actionIso(at));
    const hourStart = new Date(instant - 3_600_000).toISOString();
    const dayStart = new Date(instant - 86_400_000).toISOString();
    const rows = await knex<AutonomyAttemptRecord>(G7_TABLES.attempts)
      .where({ policy_record_id: policyRecordId, kind: 'execute' }).andWhere('started_at', '>=', dayStart)
      .andWhere('started_at', '<=', actionIso(at)).orderBy('started_at', 'desc');
    return {
      executionsLastHour: rows.filter((row) => Date.parse(actionIso(row.started_at)) >= Date.parse(hourStart)).length,
      executionsLastDay: rows.length,
      costLastDay: rows.reduce((sum, row) => sum + Number(row.actual_cost_minor ?? row.reserved_cost_minor), 0),
      lastStartedAt: rows.length ? actionIso(rows[0].started_at) : null,
    };
  }

  private async appendKillSwitch(
    trx: Knex.Transaction,
    policy: BoundedAutonomyPolicyRecord,
    state: KillSwitchState,
    actor: string,
    evidenceFingerprint: string,
    reasonCode: string,
    occurredAt: string,
  ): Promise<KillSwitchEventRecord> {
    const max = await trx(G7_TABLES.killSwitchEvents).where({ policy_record_id: policy.id })
      .max<{ max: number | null }[]>({ max: 'sequence' });
    const core = {
      tenant_id: policy.tenant_id,
      policy_record_id: policy.id,
      sequence: Number(max[0]?.max ?? 0) + 1,
      state,
      actor: actionActor(actor, 'invalid_kill_switch_actor'),
      reason_code: actionCode(reasonCode, 'invalid_kill_switch_reason'),
      evidence_fingerprint: actionHash(evidenceFingerprint, 'invalid_kill_switch_evidence'),
      occurred_at: actionIso(occurredAt),
    };
    const event = normalizedKillSwitch({ id: this.uuid(), ...core, event_fingerprint: autonomyFingerprint(core), created_at: core.occurred_at });
    await trx(G7_TABLES.killSwitchEvents).insert(event);
    await this.appendEvent(
      trx,
      policy,
      state === 'engaged' ? 'kill_switch_engaged' : 'kill_switch_released',
      core.actor,
      core.evidence_fingerprint,
      core.reason_code,
      core.occurred_at,
    );
    return event;
  }

  private async appendEvent(
    trx: Knex.Transaction,
    policy: BoundedAutonomyPolicyRecord,
    eventType: AutonomyEventType,
    actor: string,
    evidenceFingerprint: string,
    reasonCode: string,
    occurredAt: string,
  ): Promise<AutonomyEventRecord> {
    const max = await trx(G7_TABLES.events).where({ policy_record_id: policy.id })
      .max<{ max: number | null }[]>({ max: 'sequence' });
    const core = {
      tenant_id: policy.tenant_id,
      policy_record_id: policy.id,
      sequence: Number(max[0]?.max ?? 0) + 1,
      event_type: eventType,
      actor: actionActor(actor, 'invalid_autonomy_event_actor'),
      evidence_fingerprint: actionHash(evidenceFingerprint, 'invalid_autonomy_event_evidence'),
      reason_code: actionCode(reasonCode, 'invalid_autonomy_event_reason'),
      occurred_at: actionIso(occurredAt),
    };
    const event = normalizedEvent({ id: this.uuid(), ...core, event_fingerprint: autonomyFingerprint(core), created_at: core.occurred_at });
    await trx(G7_TABLES.events).insert(event);
    return event;
  }

  private async lockPolicy(trx: Knex.Transaction, policyRecordId: string): Promise<void> {
    let query = trx(G7_TABLES.policies).where({ id: policyRecordId });
    const client = String(trx.client.config.client);
    if (client === 'pg' || client.includes('postgres')) query = query.forUpdate();
    if (!await query.first()) throw new BoundedAutonomyError('missing_g7_policy', 'bounded-autonomy policy does not exist');
  }
}
