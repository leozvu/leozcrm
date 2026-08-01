import type { Knex } from '../db/knex';

export interface OperationalSnapshot {
  schema_version: 'leozops_phase12_operational_snapshot_v1';
  generated_at: string;
  window_started_at: string;
  source: {
    connections: number;
    fresh: number;
    stale: number;
    never_confirmed: number;
    poll_succeeded: number;
    poll_failed: number;
    poll_skipped: number;
    latency_avg_ms: number;
    latency_p95_ms: number;
    reconciled: number;
    reconciliation_failed: number;
  };
  advisor: { runs: number; failed: number; cost_microunits: number; latency_avg_ms: number };
  delivery: { delivered: number; failed: number; unknown: number };
  observer: { completed: number; failed: number };
  incidents: { opened: number };
  recovery: { latest_backup_status: string; latest_restore_status: string };
}

function iso(value: unknown): number {
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function percentile(values: number[], ratio: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

export class OperationalHealthRepository {
  constructor(private readonly knex: Knex, private readonly clock: () => Date = () => new Date()) {}

  async snapshot(windowHours = 24, maxFreshnessSeconds = 900): Promise<OperationalSnapshot> {
    const now = this.clock();
    const since = new Date(now.getTime() - windowHours * 3_600_000).toISOString();
    const [connections, polls, reconciliations, advisorRows, deliveries, observer, activationIncidents, autonomyIncidents, recovery] = await Promise.all([
      this.knex('source_connections').select('last_success_at'),
      this.knex('source_poll_runs').select('outcome', 'latency_ms').where('started_at', '>=', since),
      this.knex('source_reconciliations').select('status').where('checked_at', '>=', since),
      this.knex('advisor_runs as r')
        .leftJoin('advisor_run_results as x', function join() {
          this.on('r.id', '=', 'x.run_id').andOn('r.tenant_id', '=', 'x.tenant_id');
        })
        .select('r.started_at', 'x.completed_at', 'x.status', 'x.cost_microunits')
        .where('r.started_at', '>=', since),
      this.knex('proactive_delivery_results').select('status').where('completed_at', '>=', since),
      this.knex('live_observer_events').select('event_type').where('occurred_at', '>=', since),
      this.knex('activation_execution_incidents').select('id').where('opened_at', '>=', since),
      this.knex('bounded_autonomy_incident_events').select('kind').where('occurred_at', '>=', since),
      Promise.all([
        this.knex('live_recovery_drills').select('kind', 'status').where({ kind: 'backup' }).orderBy('completed_at', 'desc').first(),
        this.knex('live_recovery_drills').select('kind', 'status').where({ kind: 'restore' }).orderBy('completed_at', 'desc').first(),
      ]),
    ]);
    const freshnessCutoff = now.getTime() - maxFreshnessSeconds * 1000;
    const never = connections.filter((row) => !row.last_success_at).length;
    const fresh = connections.filter((row) => row.last_success_at && iso(row.last_success_at) >= freshnessCutoff).length;
    const latencies = polls.map((row) => Number(row.latency_ms)).filter((value) => Number.isFinite(value) && value >= 0);
    const advisorLatencies = advisorRows
      .map((row) => iso(row.completed_at) - iso(row.started_at))
      .filter((value) => value >= 0 && Number.isFinite(value));
    const [latestBackup, latestRestore] = recovery;
    return {
      schema_version: 'leozops_phase12_operational_snapshot_v1',
      generated_at: now.toISOString(),
      window_started_at: since,
      source: {
        connections: connections.length,
        fresh,
        stale: connections.length - fresh - never,
        never_confirmed: never,
        poll_succeeded: polls.filter((row) => ['accepted', 'not_modified'].includes(String(row.outcome))).length,
        poll_failed: polls.filter((row) => row.outcome === 'failed').length,
        poll_skipped: polls.filter((row) => row.outcome === 'skipped').length,
        latency_avg_ms: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
        latency_p95_ms: percentile(latencies, 0.95),
        reconciled: reconciliations.filter((row) => row.status === 'passed').length,
        reconciliation_failed: reconciliations.filter((row) => row.status !== 'passed').length,
      },
      advisor: {
        runs: advisorRows.length,
        failed: advisorRows.filter((row) => row.status === 'failed').length,
        cost_microunits: advisorRows.reduce((sum, row) => sum + Number(row.cost_microunits ?? 0), 0),
        latency_avg_ms: advisorLatencies.length
          ? Math.round(advisorLatencies.reduce((a, b) => a + b, 0) / advisorLatencies.length)
          : 0,
      },
      delivery: {
        delivered: deliveries.filter((row) => row.status === 'delivered').length,
        failed: deliveries.filter((row) => row.status === 'failed').length,
        unknown: deliveries.filter((row) => row.status === 'unknown').length,
      },
      observer: {
        completed: observer.filter((row) => row.event_type === 'cycle_completed').length,
        failed: observer.filter((row) => row.event_type === 'cycle_failed').length,
      },
      incidents: {
        opened: activationIncidents.length + autonomyIncidents.filter((row) => row.kind === 'opened').length,
      },
      recovery: {
        latest_backup_status: latestBackup?.status ?? 'not_run',
        latest_restore_status: latestRestore?.status ?? 'not_run',
      },
    };
  }
}
