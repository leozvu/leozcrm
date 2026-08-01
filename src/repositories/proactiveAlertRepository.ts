import { v4 as uuidv4 } from 'uuid';
import type { Knex } from '../db/knex';
import { db } from '../db/knex';
import {
  PROACTIVE_TABLES,
  ProactiveAlertError,
  ProactiveAlertEventRecord,
  ProactiveAlertRecord,
  ProactiveAlertState,
  ProactiveAlertOutcome,
  ProactiveAlertView,
  ProactiveCycleRecord,
  ProactiveDeliveryAttemptRecord,
  ProactiveDeliveryResultRecord,
  ProactiveDeliveryView,
  ProactiveOutboxRecord,
  ProactiveRuleEvaluationRecord,
  proactiveHash,
} from '../domain/proactiveAlerts';

type CycleInsert = Omit<ProactiveCycleRecord, 'id' | 'created_at'>;
type EvaluationInsert = Omit<ProactiveRuleEvaluationRecord, 'id' | 'created_at'>;
type AlertInsert = Omit<ProactiveAlertRecord, 'id' | 'created_at'>;
type AlertEventInsert = Omit<ProactiveAlertEventRecord, 'id' | 'created_at'>;
type OutboxInsert = Omit<ProactiveOutboxRecord, 'id' | 'created_at'>;
type AttemptInsert = Omit<ProactiveDeliveryAttemptRecord, 'id' | 'created_at'>;
type ResultInsert = Omit<ProactiveDeliveryResultRecord, 'id' | 'created_at'>;

function iso(value: unknown, code: string): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new ProactiveAlertError(code, 'stored proactive timestamp is invalid');
  return date.toISOString();
}

function normalizeTimestamps<T extends Record<string, unknown>>(row: T, keys: readonly string[]): T {
  const output = { ...row };
  for (const key of keys) output[key as keyof T] = iso(output[key], 'corrupt_proactive_timestamp') as T[keyof T];
  return output;
}

function parsePayload(value: string, expectedHash: string, code: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ProactiveAlertError(code, 'stored proactive evidence is invalid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || proactiveHash(parsed) !== expectedHash) {
    throw new ProactiveAlertError(code, 'stored proactive evidence hash is invalid');
  }
  return parsed as Record<string, unknown>;
}

export class ProactiveAlertRepository {
  constructor(
    private readonly knex: Knex = db,
    private readonly clock: () => Date = () => new Date(),
    private readonly uuid: () => string = uuidv4,
  ) {}

  private now(): string {
    return this.clock().toISOString();
  }

  async withTransaction<T>(work: (repository: ProactiveAlertRepository) => Promise<T>): Promise<T> {
    return this.knex.transaction((trx) => work(new ProactiveAlertRepository(trx, this.clock, this.uuid)));
  }

  async createCycle(input: CycleInsert): Promise<{ cycle: ProactiveCycleRecord; created: boolean }> {
    const id = this.uuid();
    const createdAt = this.now();
    await this.knex(PROACTIVE_TABLES.cycles).insert({ id, ...input, created_at: createdAt })
      .onConflict(['tenant_id', 'idempotency_key']).ignore();
    const raw = await this.knex<ProactiveCycleRecord>(PROACTIVE_TABLES.cycles)
      .where({ tenant_id: input.tenant_id, idempotency_key: input.idempotency_key }).first();
    if (!raw) throw new ProactiveAlertError('cycle_persistence_failed', 'proactive cycle could not be stored');
    const cycle = normalizeTimestamps(raw as unknown as Record<string, unknown>, [
      'evaluated_at', 'source_generated_at', 'source_received_at', 'created_at',
    ]) as unknown as ProactiveCycleRecord;
    if (cycle.request_hash !== input.request_hash || cycle.policy_version !== input.policy_version) {
      throw new ProactiveAlertError('cycle_idempotency_conflict', 'cycle idempotency key has different input');
    }
    return { cycle, created: cycle.id === id };
  }

  async getCycle(tenantId: string, cycleId: string): Promise<ProactiveCycleRecord | undefined> {
    const raw = await this.knex<ProactiveCycleRecord>(PROACTIVE_TABLES.cycles)
      .where({ tenant_id: tenantId, id: cycleId }).first();
    return raw
      ? normalizeTimestamps(raw as unknown as Record<string, unknown>, [
          'evaluated_at', 'source_generated_at', 'source_received_at', 'created_at',
        ]) as unknown as ProactiveCycleRecord
      : undefined;
  }

  async addEvaluation(input: EvaluationInsert): Promise<ProactiveRuleEvaluationRecord> {
    const row = { id: this.uuid(), ...input, created_at: this.now() };
    await this.knex(PROACTIVE_TABLES.evaluations).insert(row);
    return normalizeTimestamps(row as unknown as Record<string, unknown>, ['created_at']) as unknown as ProactiveRuleEvaluationRecord;
  }

  async listCycleEvaluations(tenantId: string, cycleId: string): Promise<ProactiveRuleEvaluationRecord[]> {
    const rows = await this.knex<ProactiveRuleEvaluationRecord>(PROACTIVE_TABLES.evaluations)
      .where({ tenant_id: tenantId, cycle_id: cycleId }).orderBy('rule_id', 'asc');
    return rows.map((raw) => {
      const row = normalizeTimestamps(raw as unknown as Record<string, unknown>, ['created_at']) as unknown as ProactiveRuleEvaluationRecord;
      parsePayload(row.evidence_json, row.evidence_hash, 'corrupt_rule_evaluation');
      return row;
    });
  }

  async latestEvaluation(tenantId: string, ruleId: string): Promise<ProactiveRuleEvaluationRecord | undefined> {
    const raw = await this.knex<ProactiveRuleEvaluationRecord>(PROACTIVE_TABLES.evaluations)
      .where({ tenant_id: tenantId, rule_id: ruleId })
      .orderBy('created_at', 'desc').orderBy('id', 'desc').first();
    if (!raw) return undefined;
    const row = normalizeTimestamps(raw as unknown as Record<string, unknown>, ['created_at']) as unknown as ProactiveRuleEvaluationRecord;
    parsePayload(row.evidence_json, row.evidence_hash, 'corrupt_rule_evaluation');
    return row;
  }

  async createAlert(input: AlertInsert): Promise<{ alert: ProactiveAlertRecord; created: boolean }> {
    const id = this.uuid();
    const createdAt = this.now();
    await this.knex(PROACTIVE_TABLES.alerts).insert({ id, ...input, created_at: createdAt })
      .onConflict(['tenant_id', 'alert_key']).ignore();
    const raw = await this.knex<ProactiveAlertRecord>(PROACTIVE_TABLES.alerts)
      .where({ tenant_id: input.tenant_id, alert_key: input.alert_key }).first();
    if (!raw) throw new ProactiveAlertError('alert_persistence_failed', 'proactive alert could not be stored');
    const alert = normalizeTimestamps(raw as unknown as Record<string, unknown>, ['created_at']) as unknown as ProactiveAlertRecord;
    parsePayload(alert.evidence_json, alert.evidence_hash, 'corrupt_proactive_alert');
    if (alert.evidence_hash !== input.evidence_hash || alert.rule_id !== input.rule_id) {
      throw new ProactiveAlertError('alert_identity_conflict', 'alert key has different evidence');
    }
    return { alert, created: alert.id === id };
  }

  async findAlert(tenantId: string, alertId: string): Promise<ProactiveAlertRecord | undefined> {
    const raw = await this.knex<ProactiveAlertRecord>(PROACTIVE_TABLES.alerts)
      .where({ tenant_id: tenantId, id: alertId }).first();
    if (!raw) return undefined;
    const alert = normalizeTimestamps(raw as unknown as Record<string, unknown>, ['created_at']) as unknown as ProactiveAlertRecord;
    parsePayload(alert.evidence_json, alert.evidence_hash, 'corrupt_proactive_alert');
    return alert;
  }

  async latestAlertForRule(tenantId: string, ruleId: string): Promise<ProactiveAlertRecord | undefined> {
    const raw = await this.knex<ProactiveAlertRecord>(PROACTIVE_TABLES.alerts)
      .where({ tenant_id: tenantId, rule_id: ruleId })
      .orderBy('created_at', 'desc').orderBy('id', 'desc').first();
    if (!raw) return undefined;
    const alert = normalizeTimestamps(raw as unknown as Record<string, unknown>, ['created_at']) as unknown as ProactiveAlertRecord;
    parsePayload(alert.evidence_json, alert.evidence_hash, 'corrupt_proactive_alert');
    return alert;
  }

  async listCycleAlerts(tenantId: string, cycleId: string): Promise<ProactiveAlertRecord[]> {
    const rows = await this.knex<ProactiveAlertRecord>(PROACTIVE_TABLES.alerts)
      .where({ tenant_id: tenantId, cycle_id: cycleId }).orderBy('created_at', 'asc').orderBy('id', 'asc');
    return rows.map((raw) => {
      const alert = normalizeTimestamps(raw as unknown as Record<string, unknown>, ['created_at']) as unknown as ProactiveAlertRecord;
      parsePayload(alert.evidence_json, alert.evidence_hash, 'corrupt_proactive_alert');
      return alert;
    });
  }

  async appendAlertEvent(input: AlertEventInsert): Promise<{ event: ProactiveAlertEventRecord; created: boolean }> {
    const id = this.uuid();
    const createdAt = this.now();
    await this.knex(PROACTIVE_TABLES.alertEvents).insert({ id, ...input, created_at: createdAt })
      .onConflict(['tenant_id', 'event_key']).ignore();
    const raw = await this.knex<ProactiveAlertEventRecord>(PROACTIVE_TABLES.alertEvents)
      .where({ tenant_id: input.tenant_id, event_key: input.event_key }).first();
    if (!raw) throw new ProactiveAlertError('alert_event_persistence_failed', 'alert event could not be stored');
    const event = normalizeTimestamps(raw as unknown as Record<string, unknown>, [
      ...(raw.snoozed_until ? ['snoozed_until'] : []), 'created_at',
    ]) as unknown as ProactiveAlertEventRecord;
    if (event.alert_id !== input.alert_id || event.event_type !== input.event_type || event.evidence_hash !== input.evidence_hash) {
      throw new ProactiveAlertError('alert_event_idempotency_conflict', 'alert event key has different input');
    }
    return { event, created: event.id === id };
  }

  async listAlertEvents(tenantId: string, alertId: string): Promise<ProactiveAlertEventRecord[]> {
    const rows = await this.knex<ProactiveAlertEventRecord>(PROACTIVE_TABLES.alertEvents)
      .where({ tenant_id: tenantId, alert_id: alertId })
      .orderBy('created_at', 'asc').orderBy('id', 'asc');
    return rows.map((raw) => normalizeTimestamps(raw as unknown as Record<string, unknown>, [
      ...(raw.snoozed_until ? ['snoozed_until'] : []), 'created_at',
    ]) as unknown as ProactiveAlertEventRecord);
  }

  private state(events: ProactiveAlertEventRecord[], now: string): {
    state: ProactiveAlertState;
    snoozedUntil: string | null;
    latest: ProactiveAlertEventRecord | null;
    outcome: ProactiveAlertOutcome | null;
  } {
    const latest = events.at(-1) ?? null;
    const rating = [...events].reverse().find((event) =>
      event.event_type === 'rated_useful' || event.event_type === 'rated_false_positive');
    const outcome = rating?.event_type === 'rated_useful'
      ? 'useful'
      : rating?.event_type === 'rated_false_positive' ? 'false_positive' : null;
    if (events.some((event) => event.event_type === 'resolved')) return { state: 'resolved', snoozedUntil: null, latest, outcome };
    const snooze = [...events].reverse().find((event) =>
      event.event_type === 'snoozed' && event.snoozed_until !== null && Date.parse(event.snoozed_until) > Date.parse(now));
    if (snooze) return { state: 'snoozed', snoozedUntil: snooze.snoozed_until, latest, outcome };
    if (events.some((event) => event.event_type === 'acknowledged')) return { state: 'acknowledged', snoozedUntil: null, latest, outcome };
    return { state: 'open', snoozedUntil: null, latest, outcome };
  }

  async alertView(tenantId: string, alertId: string, at = this.now()): Promise<ProactiveAlertView | undefined> {
    const alert = await this.findAlert(tenantId, alertId);
    if (!alert) return undefined;
    const state = this.state(await this.listAlertEvents(tenantId, alertId), at);
    return { alert, state: state.state, snoozed_until: state.snoozedUntil, latest_event: state.latest, outcome: state.outcome };
  }

  async listAlertViews(tenantId: string, at = this.now()): Promise<ProactiveAlertView[]> {
    const rows = await this.knex<ProactiveAlertRecord>(PROACTIVE_TABLES.alerts)
      .where({ tenant_id: tenantId }).orderBy('created_at', 'desc').orderBy('id', 'desc');
    const output: ProactiveAlertView[] = [];
    for (const raw of rows) {
      const view = await this.alertView(tenantId, raw.id, at);
      if (view) output.push(view);
    }
    return output;
  }

  async createOutbox(input: OutboxInsert): Promise<{ outbox: ProactiveOutboxRecord; created: boolean }> {
    const id = this.uuid();
    const createdAt = this.now();
    await this.knex(PROACTIVE_TABLES.outbox).insert({ id, ...input, created_at: createdAt })
      .onConflict(['tenant_id', 'logical_key']).ignore();
    const raw = await this.knex<ProactiveOutboxRecord>(PROACTIVE_TABLES.outbox)
      .where({ tenant_id: input.tenant_id, logical_key: input.logical_key }).first();
    if (!raw) throw new ProactiveAlertError('outbox_persistence_failed', 'delivery intent could not be stored');
    const outbox = normalizeTimestamps(raw as unknown as Record<string, unknown>, ['available_at', 'created_at']) as unknown as ProactiveOutboxRecord;
    parsePayload(outbox.payload_json, outbox.evidence_hash, 'corrupt_delivery_outbox');
    if (outbox.evidence_hash !== input.evidence_hash || outbox.delivery_kind !== input.delivery_kind) {
      throw new ProactiveAlertError('outbox_identity_conflict', 'logical notification key has different evidence');
    }
    return { outbox, created: outbox.id === id };
  }

  async findOutbox(tenantId: string, outboxId: string): Promise<ProactiveOutboxRecord | undefined> {
    const raw = await this.knex<ProactiveOutboxRecord>(PROACTIVE_TABLES.outbox)
      .where({ tenant_id: tenantId, id: outboxId }).first();
    if (!raw) return undefined;
    const outbox = normalizeTimestamps(raw as unknown as Record<string, unknown>, ['available_at', 'created_at']) as unknown as ProactiveOutboxRecord;
    parsePayload(outbox.payload_json, outbox.evidence_hash, 'corrupt_delivery_outbox');
    return outbox;
  }

  async listCycleOutbox(tenantId: string, cycleId: string): Promise<ProactiveOutboxRecord[]> {
    const rows = await this.knex<ProactiveOutboxRecord>(PROACTIVE_TABLES.outbox)
      .where({ tenant_id: tenantId, cycle_id: cycleId }).orderBy('created_at', 'asc').orderBy('id', 'asc');
    return rows.map((raw) => {
      const outbox = normalizeTimestamps(raw as unknown as Record<string, unknown>, ['available_at', 'created_at']) as unknown as ProactiveOutboxRecord;
      parsePayload(outbox.payload_json, outbox.evidence_hash, 'corrupt_delivery_outbox');
      return outbox;
    });
  }

  async startDeliveryAttempt(input: AttemptInsert): Promise<{ attempt: ProactiveDeliveryAttemptRecord; created: boolean }> {
    return this.knex.transaction(async (trx) => {
      const outboxQuery = trx<ProactiveOutboxRecord>(PROACTIVE_TABLES.outbox)
        .where({ tenant_id: input.tenant_id, id: input.outbox_id });
      if (!String(trx.client.config.client).includes('sqlite')) outboxQuery.forUpdate();
      if (!await outboxQuery.first()) throw new ProactiveAlertError('delivery_not_found', 'delivery intent was not found', 404);

      const existingRaw = await trx<ProactiveDeliveryAttemptRecord>(PROACTIVE_TABLES.deliveryAttempts)
        .where({ tenant_id: input.tenant_id, attempt_key: input.attempt_key }).first();
      if (existingRaw) {
        const existing = normalizeTimestamps(existingRaw as unknown as Record<string, unknown>, [
          'started_at', 'created_at',
        ]) as unknown as ProactiveDeliveryAttemptRecord;
        if (existing.outbox_id !== input.outbox_id || existing.adapter_key !== input.adapter_key || existing.adapter_version !== input.adapter_version) {
          throw new ProactiveAlertError('delivery_attempt_idempotency_conflict', 'delivery attempt key has different input');
        }
        return { attempt: existing, created: false };
      }

      const priorAttempts = await trx<ProactiveDeliveryAttemptRecord>(PROACTIVE_TABLES.deliveryAttempts)
        .where({ tenant_id: input.tenant_id, outbox_id: input.outbox_id });
      for (const prior of priorAttempts) {
        const result = await trx<ProactiveDeliveryResultRecord>(PROACTIVE_TABLES.deliveryResults)
          .where({ tenant_id: input.tenant_id, attempt_id: prior.id }).first();
        if (!result || result.status === 'unknown') {
          throw new ProactiveAlertError('delivery_outcome_unknown', 'another delivery attempt has no definitive result');
        }
        if (result.status === 'delivered') {
          throw new ProactiveAlertError('delivery_already_delivered', 'logical notification is already delivered');
        }
      }

      const id = this.uuid();
      const createdAt = this.now();
      const row = { id, ...input, created_at: createdAt };
      await trx(PROACTIVE_TABLES.deliveryAttempts).insert(row);
      const attempt = normalizeTimestamps(row as unknown as Record<string, unknown>, [
        'started_at', 'created_at',
      ]) as unknown as ProactiveDeliveryAttemptRecord;
      return { attempt, created: true };
    });
  }

  async recordDeliveryResult(input: ResultInsert): Promise<{ result: ProactiveDeliveryResultRecord; created: boolean }> {
    const id = this.uuid();
    const createdAt = this.now();
    await this.knex(PROACTIVE_TABLES.deliveryResults).insert({ id, ...input, created_at: createdAt })
      .onConflict(['tenant_id', 'attempt_id']).ignore();
    const raw = await this.knex<ProactiveDeliveryResultRecord>(PROACTIVE_TABLES.deliveryResults)
      .where({ tenant_id: input.tenant_id, attempt_id: input.attempt_id }).first();
    if (!raw) throw new ProactiveAlertError('delivery_result_persistence_failed', 'delivery result could not be stored');
    const result = normalizeTimestamps(raw as unknown as Record<string, unknown>, ['completed_at', 'created_at']) as unknown as ProactiveDeliveryResultRecord;
    if (result.evidence_hash !== input.evidence_hash || result.status !== input.status) {
      throw new ProactiveAlertError('delivery_result_identity_conflict', 'delivery result has different evidence');
    }
    return { result, created: result.id === id };
  }

  async resultForAttempt(tenantId: string, attemptId: string): Promise<ProactiveDeliveryResultRecord | undefined> {
    const raw = await this.knex<ProactiveDeliveryResultRecord>(PROACTIVE_TABLES.deliveryResults)
      .where({ tenant_id: tenantId, attempt_id: attemptId }).first();
    return raw
      ? normalizeTimestamps(raw as unknown as Record<string, unknown>, ['completed_at', 'created_at']) as unknown as ProactiveDeliveryResultRecord
      : undefined;
  }

  async attemptsForOutbox(tenantId: string, outboxId: string): Promise<ProactiveDeliveryAttemptRecord[]> {
    const rows = await this.knex<ProactiveDeliveryAttemptRecord>(PROACTIVE_TABLES.deliveryAttempts)
      .where({ tenant_id: tenantId, outbox_id: outboxId }).orderBy('created_at', 'asc').orderBy('id', 'asc');
    return rows.map((raw) => normalizeTimestamps(raw as unknown as Record<string, unknown>, ['started_at', 'created_at']) as unknown as ProactiveDeliveryAttemptRecord);
  }

  async deliveryView(tenantId: string, outboxId: string): Promise<ProactiveDeliveryView | undefined> {
    const outbox = await this.findOutbox(tenantId, outboxId);
    if (!outbox) return undefined;
    const attempts = await this.attemptsForOutbox(tenantId, outboxId);
    const pairs: Array<{ attempt: ProactiveDeliveryAttemptRecord; result: ProactiveDeliveryResultRecord | null }> = [];
    for (const attempt of attempts) {
      pairs.push({ attempt, result: await this.resultForAttempt(tenantId, attempt.id) ?? null });
    }
    const delivered = pairs.find((pair) => pair.result?.status === 'delivered');
    const unknown = pairs.find((pair) => pair.result === null || pair.result.status === 'unknown');
    const selected = delivered ?? unknown ?? pairs.at(-1);
    const latestAttempt = selected?.attempt ?? null;
    const latestResult = selected?.result ?? null;
    return {
      outbox,
      status: !latestAttempt ? 'queued' : delivered ? 'delivered' : unknown ? 'unknown' : latestResult?.status ?? 'unknown',
      latest_attempt: latestAttempt,
      latest_result: latestResult,
    };
  }

  async listDeliveryViews(tenantId: string): Promise<ProactiveDeliveryView[]> {
    const rows = await this.knex<ProactiveOutboxRecord>(PROACTIVE_TABLES.outbox)
      .where({ tenant_id: tenantId }).orderBy('created_at', 'desc').orderBy('id', 'desc');
    const output: ProactiveDeliveryView[] = [];
    for (const row of rows) {
      const view = await this.deliveryView(tenantId, row.id);
      if (view) output.push(view);
    }
    return output;
  }
}
