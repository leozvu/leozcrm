import { randomUUID } from 'node:crypto';
import type { Knex } from '../db/knex';
import {
  JARVIS_DATA_REQUEST_SCHEMA,
  JARVIS_EVALUATION_SCHEMA,
  JARVIS_RETENTION_POLICY,
  JARVIS_V1_TABLES,
  JarvisDataRequestKind,
  JarvisDataRequestRecord,
  JarvisV1Error,
  jarvisV1Hash,
} from '../domain/jarvisV1';

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function percentile(values: number[], ratio: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function rate(numerator: number, denominator: number): number | null {
  return denominator ? Number((numerator / denominator).toFixed(4)) : null;
}

function postgres(knex: Knex): boolean { return String(knex.client.config.client).includes('pg'); }

function normalizeDataRequest(row: JarvisDataRequestRecord): JarvisDataRequestRecord {
  if (row.schema_version !== JARVIS_DATA_REQUEST_SCHEMA
    || !['export', 'delete'].includes(row.kind)
    || row.scope !== 'tenant_leozops_data'
    || row.requested_by !== 'founder'
    || !['ready_for_export', 'blocked_pending_retention_policy'].includes(row.status)) {
    throw new JarvisV1Error('corrupt_data_request', 'stored data request is invalid', 500);
  }
  const { request_fingerprint: fingerprint, created_at: _created, ...core } = row;
  if (row.created_at !== row.requested_at || jarvisV1Hash(core) !== fingerprint) {
    throw new JarvisV1Error('corrupt_data_request', 'stored data request fingerprint is invalid', 500);
  }
  return row;
}

export class JarvisV1Repository {
  constructor(
    private readonly knex: Knex,
    private readonly clock: () => Date = () => new Date(),
    private readonly uuid: () => string = randomUUID,
  ) {}

  async evaluation(tenantId: string, days = 30) {
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      throw new JarvisV1Error('invalid_evaluation_window', 'evaluation window must be 1 to 90 whole days');
    }
    const generatedAt = this.clock().toISOString();
    const from = new Date(this.clock().getTime() - days * 86_400_000).toISOString();
    const [advisor, citations, feedback, alerts, alertOutcomes, plans, decisions, planOutcomes, attempts, activationIncidents, autonomyIncidentEvents] = await Promise.all([
      this.knex('advisor_runs as r')
        .leftJoin('advisor_run_results as x', function join() {
          this.on('r.id', '=', 'x.run_id').andOn('r.tenant_id', '=', 'x.tenant_id');
        })
        .select('r.id', 'r.started_at', 'x.status', 'x.completed_at', 'x.cost_microunits')
        .where('r.tenant_id', tenantId).andWhere('r.started_at', '>=', from),
      this.knex('advisor_citations').select('run_id').where({ tenant_id: tenantId }).andWhere('created_at', '>=', from),
      this.knex('advisor_feedback').select('run_id', 'rating').where({ tenant_id: tenantId }).andWhere('created_at', '>=', from),
      this.knex('proactive_alerts').select('id').where({ tenant_id: tenantId }).andWhere('created_at', '>=', from),
      this.knex('proactive_alert_events').select('alert_id', 'event_type').where({ tenant_id: tenantId })
        .whereIn('event_type', ['rated_useful', 'rated_false_positive']).andWhere('created_at', '>=', from),
      this.knex('planner_plan_versions').select('id').where({ tenant_id: tenantId }).andWhere('created_at', '>=', from),
      this.knex('planner_plan_decisions').select('decision').where({ tenant_id: tenantId }).andWhere('created_at', '>=', from),
      this.knex('planner_plan_outcomes').select('outcome').where({ tenant_id: tenantId }).andWhere('created_at', '>=', from),
      this.knex('supervised_action_attempts').select('status', 'kind', 'external_mutation_count', 'latency_ms')
        .where({ tenant_id: tenantId }).andWhere('started_at', '>=', from),
      this.knex('activation_execution_incidents').select('id').where({ tenant_id: tenantId }).andWhere('opened_at', '>=', from),
      this.knex('bounded_autonomy_incident_events').select('incident_id', 'kind', 'occurred_at')
        .where({ tenant_id: tenantId }).andWhere('occurred_at', '>=', from).orderBy('occurred_at', 'asc'),
    ]);
    const citedRuns = new Set(citations.map((row) => String(row.run_id)));
    const completed = advisor.filter((row) => row.status === 'completed');
    const advisorLatencies = advisor.map((row) => Date.parse(String(row.completed_at)) - Date.parse(String(row.started_at)))
      .filter((value) => Number.isFinite(value) && value >= 0);
    const useful = feedback.filter((row) => row.rating === 'useful').length;
    const alertUseful = alertOutcomes.filter((row) => row.event_type === 'rated_useful').length;
    const falsePositive = alertOutcomes.filter((row) => row.event_type === 'rated_false_positive').length;
    const acceptedPlans = decisions.filter((row) => row.decision === 'accepted').length;
    const actionLatencies = attempts.map((row) => Number(row.latency_ms)).filter((value) => Number.isFinite(value) && value >= 0);
    const autonomyLatest = new Map<string, string>();
    autonomyIncidentEvents.forEach((row) => autonomyLatest.set(String(row.incident_id), String(row.kind)));
    const openAutonomy = [...autonomyLatest.values()].filter((kind) => kind === 'opened').length;
    const unexplained = attempts.filter((row) => row.status === 'reconciliation_required').length;
    const evaluation = {
      schema_version: JARVIS_EVALUATION_SCHEMA,
      generated_at: generatedAt,
      window: { days, from, to: generatedAt },
      answers: {
        runs: advisor.length,
        completed: completed.length,
        failed: advisor.filter((row) => row.status === 'failed').length,
        reviewed: feedback.length,
        useful,
        useful_rate: rate(useful, feedback.length),
        citation_covered_runs: completed.filter((row) => citedRuns.has(String(row.id))).length,
        citation_coverage_rate: rate(completed.filter((row) => citedRuns.has(String(row.id))).length, completed.length),
        latency_avg_ms: advisorLatencies.length ? Math.round(advisorLatencies.reduce((sum, value) => sum + value, 0) / advisorLatencies.length) : 0,
        latency_p95_ms: percentile(advisorLatencies, 0.95),
        cost_microunits: advisor.reduce((sum, row) => sum + Number(row.cost_microunits ?? 0), 0),
      },
      alerts: {
        created: alerts.length,
        reviewed: alertOutcomes.length,
        useful: alertUseful,
        false_positive: falsePositive,
        false_positive_rate: rate(falsePositive, alertOutcomes.length),
        average_per_day: Number((alerts.length / days).toFixed(4)),
      },
      plans: {
        created: plans.length,
        decisions: decisions.length,
        accepted: acceptedPlans,
        acceptance_rate: rate(acceptedPlans, decisions.length),
        useful_outcomes: planOutcomes.filter((row) => row.outcome === 'useful').length,
        outcome_reviews: planOutcomes.length,
      },
      actions: {
        attempts: attempts.length,
        succeeded: attempts.filter((row) => row.status === 'succeeded').length,
        failed: attempts.filter((row) => row.status === 'failed').length,
        reconciliation_required: unexplained,
        external_mutations: attempts.reduce((sum, row) => sum + Number(row.external_mutation_count ?? 0), 0),
        latency_p95_ms: percentile(actionLatencies, 0.95),
      },
      safety: {
        open_incidents: activationIncidents.length + openAutonomy,
        unexplained_action_outcomes: unexplained,
        candidate_status: activationIncidents.length + openAutonomy + unexplained === 0 ? 'no_recorded_blocker' : 'blocked',
        limitation: 'Repository metrics do not prove live incident closure, privacy acceptance, or production SLO acceptance.',
      },
    };
    return { ...evaluation, evaluation_hash: jarvisV1Hash(evaluation) };
  }

  async createDataRequest(input: {
    tenantId: string;
    kind: JarvisDataRequestKind;
    confirmationHash: string;
    idempotencyKey: string;
  }): Promise<{ record: JarvisDataRequestRecord; replayed: boolean }> {
    if (!SAFE_KEY.test(input.idempotencyKey)) throw new JarvisV1Error('invalid_idempotency_key', 'Idempotency-Key is invalid');
    const requestHash = jarvisV1Hash({ kind: input.kind, scope: 'tenant_leozops_data', confirmation_hash: input.confirmationHash });
    return this.knex.transaction(async (trx) => {
      if (postgres(this.knex)) await trx('tenants').where({ id: input.tenantId }).forUpdate().first();
      const replay = await trx<JarvisDataRequestRecord>(JARVIS_V1_TABLES.dataRequests)
        .where({ tenant_id: input.tenantId, idempotency_key: input.idempotencyKey }).first();
      if (replay) {
        const record = normalizeDataRequest(replay);
        if (record.request_hash !== requestHash) throw new JarvisV1Error('data_request_idempotency_conflict', 'Idempotency-Key binds a different data request', 409);
        return { record, replayed: true };
      }
      const requestedAt = this.clock().toISOString();
      const core = {
        id: this.uuid(), tenant_id: input.tenantId, schema_version: JARVIS_DATA_REQUEST_SCHEMA,
        kind: input.kind, scope: 'tenant_leozops_data' as const, idempotency_key: input.idempotencyKey,
        request_hash: requestHash, confirmation_hash: input.confirmationHash,
        status: input.kind === 'export' ? 'ready_for_export' as const : 'blocked_pending_retention_policy' as const,
        requested_by: 'founder' as const, requested_at: requestedAt,
      };
      const record: JarvisDataRequestRecord = {
        ...core, request_fingerprint: jarvisV1Hash(core), created_at: requestedAt,
      };
      await trx(JARVIS_V1_TABLES.dataRequests).insert(record);
      return { record, replayed: false };
    });
  }

  async listDataRequests(tenantId: string): Promise<JarvisDataRequestRecord[]> {
    return (await this.knex<JarvisDataRequestRecord>(JARVIS_V1_TABLES.dataRequests)
      .where({ tenant_id: tenantId }).orderBy('requested_at', 'desc')).map(normalizeDataRequest);
  }

  async exportRequest(tenantId: string, requestId: string): Promise<JarvisDataRequestRecord> {
    const row = await this.knex<JarvisDataRequestRecord>(JARVIS_V1_TABLES.dataRequests)
      .where({ tenant_id: tenantId, id: requestId }).first();
    if (!row) throw new JarvisV1Error('data_request_not_found', 'data request was not found', 404);
    const record = normalizeDataRequest(row);
    if (record.kind !== 'export' || record.status !== 'ready_for_export') {
      throw new JarvisV1Error('export_not_authorized', 'data request does not authorize export', 409);
    }
    return record;
  }

  async inventory(tenantId: string): Promise<Record<string, number>> {
    const tables: Record<string, string[]> = {
      business_memory: ['source_connections', 'source_snapshots', 'intelligence_runs'],
      advisor: ['advisor_conversations', 'advisor_messages', 'advisor_runs', 'advisor_citations', 'advisor_feedback'],
      alerts: ['proactive_alerts', 'proactive_alert_events', 'proactive_delivery_results'],
      planner: ['planner_goal_versions', 'planner_plan_versions', 'planner_plan_decisions', 'planner_plan_outcomes'],
      supervised_actions: ['supervised_action_proposals', 'supervised_action_attempts', 'supervised_action_events'],
      bounded_autonomy: ['bounded_autonomy_attempts', 'bounded_autonomy_events', 'bounded_autonomy_incident_events'],
      ambient: ['jarvis_preference_revisions', JARVIS_V1_TABLES.dataRequests],
    };
    const result: Record<string, number> = {};
    for (const [group, names] of Object.entries(tables)) {
      const counts = await Promise.all(names.map(async (table) => {
        const row = await this.knex(table).where({ tenant_id: tenantId }).count<{ count: number | string }[]>({ count: '*' });
        return Number(row[0]?.count ?? 0);
      }));
      result[group] = counts.reduce((sum, count) => sum + count, 0);
    }
    return result;
  }

  retentionPolicy() { return JARVIS_RETENTION_POLICY; }
}
