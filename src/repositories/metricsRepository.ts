import { db, Knex } from '../db/knex';
import { FunnelStage, TABLES } from '../domain/types';
import {
  CampaignAttributionMetrics,
  CampaignAttributionRow,
  ChannelVolumeMetrics,
  ConversionMetrics,
  FunnelMetrics,
  FunnelStageMetric,
  LeadTrendMetrics,
  SourceVolumeMetrics,
  TrendPoint,
} from '../domain/metrics';

/**
 * Read-only KPI aggregations over the CRM tables (Milestone #2).
 *
 * This is the metrics seam the dashboard and CEO Brief Agent read from. It is
 * deliberately query-only — it never writes — and every method is scoped to a
 * single client so per-client funnel metrics stay isolated.
 *
 * Like the CRUD repositories it accepts an injected Knex instance, so it can be
 * driven against an in-memory DB in tests. All queries use portable Knex /
 * standard-SQL only (no dialect-specific date functions), matching the
 * SQLite-dev / Postgres-prod contract in docs/DATA_MODEL.md.
 */
export class MetricsRepository {
  constructor(private readonly knex: Knex = db) {}

  /** Round a fraction to 4 dp; 0 when the denominator is empty. */
  private rate(numerator: number, denominator: number): number {
    if (denominator <= 0) return 0;
    return Math.round((numerator / denominator) * 10000) / 10000;
  }

  /**
   * Funnel snapshot + conversion rates for one client.
   *
   * `count` is leads currently at a stage; `reached` is the cumulative number
   * at-or-beyond it (a lead at a later stage necessarily passed the earlier
   * ones). Step conversion is reached(stage)/reached(previous). Headline
   * conversion is derived from lead status (won / lost / open).
   */
  async funnelByClient(clientId: string): Promise<FunnelMetrics> {
    const stages: FunnelStage[] = await this.knex(TABLES.funnelStages)
      .select('*')
      .orderBy('position', 'asc');

    const stageRows = await this.knex(TABLES.leads)
      .where({ client_id: clientId })
      .select('funnel_stage_id')
      .count({ count: '*' })
      .groupBy('funnel_stage_id');
    const countByStage = new Map<string, number>(
      stageRows.map((r: any) => [r.funnel_stage_id, Number(r.count)]),
    );

    // Cumulative "reached" — walk the funnel backwards summing later stages.
    const reachedByIndex: number[] = new Array(stages.length).fill(0);
    let cumulative = 0;
    for (let i = stages.length - 1; i >= 0; i--) {
      cumulative += countByStage.get(stages[i].id) ?? 0;
      reachedByIndex[i] = cumulative;
    }

    const stageMetrics: FunnelStageMetric[] = stages.map((stage, i) => ({
      stage_id: stage.id,
      key: stage.key,
      name: stage.name,
      position: stage.position,
      count: countByStage.get(stage.id) ?? 0,
      reached: reachedByIndex[i],
      conversion_from_previous:
        i === 0 ? null : this.rate(reachedByIndex[i], reachedByIndex[i - 1]),
    }));

    const conversion = await this.conversionByClient(clientId);

    return {
      client_id: clientId,
      total_leads: conversion.total_leads,
      stages: stageMetrics,
      conversion,
    };
  }

  /** Lead outcome breakdown (open/won/lost) and the headline conversion rates. */
  private async conversionByClient(clientId: string): Promise<ConversionMetrics> {
    const rows = await this.knex(TABLES.leads)
      .where({ client_id: clientId })
      .select('status')
      .count({ count: '*' })
      .groupBy('status');
    const byStatus = new Map<string, number>(
      rows.map((r: any) => [r.status, Number(r.count)]),
    );

    const open = byStatus.get('open') ?? 0;
    const won = byStatus.get('won') ?? 0;
    const lost = byStatus.get('lost') ?? 0;
    const total = open + won + lost;
    const closed = won + lost;

    return {
      total_leads: total,
      open,
      won,
      lost,
      win_rate: closed > 0 ? this.rate(won, closed) : null,
      overall_conversion_rate: this.rate(won, total),
    };
  }

  /** Lead volume grouped by free-text source label. */
  async volumeBySource(clientId: string): Promise<SourceVolumeMetrics> {
    const rows = await this.knex(TABLES.leads)
      .where({ client_id: clientId })
      .select('source')
      .count({ count: '*' })
      .groupBy('source')
      .orderBy('count', 'desc');

    const by_source = rows.map((r: any) => ({
      source: (r.source ?? null) as string | null,
      count: Number(r.count),
    }));
    const total_leads = by_source.reduce((sum, b) => sum + b.count, 0);
    return { client_id: clientId, total_leads, by_source };
  }

  /**
   * Lead volume grouped by campaign channel. Leads with no campaign are
   * bucketed under `"unattributed"` so the totals always reconcile.
   */
  async volumeByChannel(clientId: string): Promise<ChannelVolumeMetrics> {
    const rows = await this.knex(`${TABLES.leads} as l`)
      .leftJoin(`${TABLES.campaigns} as c`, 'l.campaign_id', 'c.id')
      .where('l.client_id', clientId)
      .select('c.channel as channel')
      .count({ count: 'l.id' })
      .groupBy('c.channel');

    const by_channel = rows
      .map((r: any) => ({
        channel: (r.channel ?? 'unattributed') as string,
        count: Number(r.count),
      }))
      .sort((a, b) => b.count - a.count);
    const total_leads = by_channel.reduce((sum, b) => sum + b.count, 0);
    return { client_id: clientId, total_leads, by_channel };
  }

  /**
   * Per-campaign attribution for one client: how many leads each campaign drove
   * and how many of those converted (`status = 'won'`), plus the count of leads
   * the client owns that are attributed to no campaign.
   */
  async campaignAttribution(clientId: string): Promise<CampaignAttributionMetrics> {
    const rows = await this.knex(`${TABLES.campaigns} as c`)
      .leftJoin(`${TABLES.leads} as l`, 'l.campaign_id', 'c.id')
      .where('c.client_id', clientId)
      .groupBy('c.id', 'c.name', 'c.channel', 'c.status', 'c.budget_cents', 'c.created_at')
      .orderBy('c.created_at', 'desc')
      .select(
        'c.id as campaign_id',
        'c.name as name',
        'c.channel as channel',
        'c.status as status',
        'c.budget_cents as budget_cents',
        this.knex.raw('COUNT(l.id) as lead_count'),
        this.knex.raw("SUM(CASE WHEN l.status = 'won' THEN 1 ELSE 0 END) as won_count"),
      );

    const campaigns: CampaignAttributionRow[] = rows.map((r: any) => ({
      campaign_id: r.campaign_id,
      name: r.name,
      channel: r.channel,
      status: r.status,
      budget_cents: r.budget_cents === null || r.budget_cents === undefined ? null : Number(r.budget_cents),
      lead_count: Number(r.lead_count),
      won_count: Number(r.won_count ?? 0),
    }));

    const [unattributed] = await this.knex(TABLES.leads)
      .where({ client_id: clientId })
      .whereNull('campaign_id')
      .count({ count: '*' });
    const unattributed_leads = Number((unattributed as any)?.count ?? 0);

    return { client_id: clientId, campaigns, unattributed_leads };
  }

  /**
   * Lead-creation volume per calendar day (UTC), oldest first.
   *
   * Day bucketing is done in app code rather than with a SQL date function so
   * the query stays dialect-portable: `created_at` is read back as an ISO
   * string (SQLite) or a Date (Postgres), and both normalize cleanly through
   * the Date constructor.
   */
  async leadTrends(clientId: string): Promise<LeadTrendMetrics> {
    const rows = await this.knex(TABLES.leads)
      .where({ client_id: clientId })
      .select('created_at');

    const byDay = new Map<string, number>();
    for (const r of rows as Array<{ created_at: string | Date }>) {
      const day = new Date(r.created_at).toISOString().slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }

    const by_day: TrendPoint[] = [...byDay.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const total_leads = by_day.reduce((sum, p) => sum + p.count, 0);
    return { client_id: clientId, total_leads, by_day };
  }
}

export const metricsRepository = new MetricsRepository();
