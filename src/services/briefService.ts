import { MetricsRepository, metricsRepository } from '../repositories/metricsRepository';
import {
  FunnelMetrics,
  LeadTrendMetrics,
  CampaignAttributionMetrics,
} from '../domain/metrics';
import {
  BriefAction,
  BriefAnomaly,
  BriefDelta,
  BriefFunnelStage,
  BriefHeadline,
  CeoBrief,
} from '../domain/brief';
import { isValidIsoDate } from '../domain/date';
import { ValidationError } from '../errors';

/**
 * Daily CEO Brief engine (Milestone #3).
 *
 * This is the first service-layer component: it sits between the HTTP route and
 * the data layer, orchestrating the read-only KPI repository into an executive
 * brief. It consumes ONLY the existing KPI methods (no new queries, no schema
 * change) and is pure/deterministic — given the same CRM state and `asOf` it
 * always returns the same brief.
 *
 * Following the established conventions: dependency-injected repository with a
 * singleton default, typed inputs/outputs, and no direct `knex` use.
 */

/** Thresholds for anomaly detection. Centralized so the rules are auditable. */
const RULES = {
  /** Acquisition delta window, in days. */
  WINDOW_DAYS: 7,
  /** A step conversion at/under this is a funnel bottleneck (needs upstream volume). */
  BOTTLENECK_MAX_CONVERSION: 0.5,
  /** Minimum leads that must have reached the upstream stage to call a bottleneck. */
  BOTTLENECK_MIN_UPSTREAM: 1,
  /** Flag attribution when more than this share of leads have no campaign. */
  UNATTRIBUTED_MAX_SHARE: 0.5,
  /** Only judge win rate once at least this many leads have closed. */
  WIN_RATE_MIN_CLOSED: 5,
  /** A win rate under this (with enough closed leads) is flagged. */
  WIN_RATE_MIN: 0.3,
} as const;

export interface BriefOptions {
  /** Calendar day the brief covers, `YYYY-MM-DD` (UTC). Required for determinism. */
  asOf: string;
  /**
   * Generation timestamp (ISO-8601) recorded on the brief. Defaults to the
   * start of `asOf` so the engine stays pure when no clock is supplied; the HTTP
   * route passes the real wall-clock time.
   */
  now?: string;
}

export class BriefService {
  constructor(private readonly metrics: MetricsRepository = metricsRepository) {}

  /** Add `delta` days to a `YYYY-MM-DD` date, returning `YYYY-MM-DD` (UTC). */
  private addDays(date: string, delta: number): string {
    const d = new Date(`${date}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + delta);
    return d.toISOString().slice(0, 10);
  }

  async generate(clientId: string, options: BriefOptions): Promise<CeoBrief> {
    const { asOf } = options;
    // Guard before any date math: a date-shaped but invalid asOf (e.g.
    // "2026-99-99") would otherwise make addDays throw and surface as a 500.
    if (!isValidIsoDate(asOf)) {
      throw new ValidationError(400, 'asOf must be a valid YYYY-MM-DD date', 'invalid_as_of');
    }
    const generated_at = options.now ?? `${asOf}T00:00:00.000Z`;

    // Consume the KPI layer. funnel/trends/campaigns cover every brief section.
    const [funnel, trends, campaigns] = await Promise.all([
      this.metrics.funnelByClient(clientId),
      this.metrics.leadTrends(clientId),
      this.metrics.campaignAttribution(clientId),
    ]);

    const headline = this.buildHeadline(funnel);
    const funnelStages = this.buildFunnel(funnel);
    const delta = this.buildDelta(trends, asOf);
    const anomalies = this.detectAnomalies(funnel, campaigns, delta);
    const recommended_actions = this.recommendActions(anomalies, funnel, campaigns);

    return {
      client_id: clientId,
      as_of: asOf,
      generated_at,
      headline,
      funnel: funnelStages,
      delta,
      anomalies,
      recommended_actions,
    };
  }

  private buildHeadline(funnel: FunnelMetrics): BriefHeadline {
    const c = funnel.conversion;
    return {
      total_leads: c.total_leads,
      open: c.open,
      won: c.won,
      lost: c.lost,
      win_rate: c.win_rate,
      overall_conversion_rate: c.overall_conversion_rate,
    };
  }

  private buildFunnel(funnel: FunnelMetrics): BriefFunnelStage[] {
    return funnel.stages.map((s) => ({
      key: s.key,
      name: s.name,
      position: s.position,
      count: s.count,
      reached: s.reached,
      conversion_from_previous: s.conversion_from_previous,
    }));
  }

  private buildDelta(trends: LeadTrendMetrics, asOf: string): BriefDelta {
    const window = RULES.WINDOW_DAYS;
    const recentStart = this.addDays(asOf, -(window - 1));
    const previousStart = this.addDays(asOf, -(2 * window - 1));
    const previousEnd = this.addDays(asOf, -window);

    // YYYY-MM-DD compares correctly with lexicographic string comparison.
    const sumInRange = (start: string, end: string) =>
      trends.by_day
        .filter((p) => p.date >= start && p.date <= end)
        .reduce((sum, p) => sum + p.count, 0);

    const recent_leads = sumInRange(recentStart, asOf);
    const previous_leads = sumInRange(previousStart, previousEnd);
    const change = recent_leads - previous_leads;
    const direction = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';

    return { window_days: window, recent_leads, previous_leads, change, direction };
  }

  /**
   * Deterministic rule set over the KPI outputs. Order is fixed so the brief is
   * stable: acquisition → funnel bottleneck → campaign spend → attribution →
   * win rate.
   */
  private detectAnomalies(
    funnel: FunnelMetrics,
    campaigns: CampaignAttributionMetrics,
    delta: BriefDelta,
  ): BriefAnomaly[] {
    const anomalies: BriefAnomaly[] = [];

    // 1. Acquisition momentum (only meaningful against a prior baseline).
    if (delta.previous_leads > 0 && delta.recent_leads === 0) {
      anomalies.push({
        code: 'acquisition_stalled',
        severity: 'critical',
        message: `No new leads in the last ${delta.window_days} days, down from ${delta.previous_leads} in the prior period.`,
      });
    } else if (delta.previous_leads > 0 && delta.change < 0) {
      anomalies.push({
        code: 'acquisition_down',
        severity: 'warning',
        message: `New leads fell to ${delta.recent_leads} over the last ${delta.window_days} days, down from ${delta.previous_leads} in the prior period.`,
      });
    }

    // 2. Worst funnel bottleneck — the largest step drop that has upstream volume.
    const bottleneck = this.worstBottleneck(funnel);
    if (bottleneck) {
      const pct = Math.round((bottleneck.conversion_from_previous ?? 0) * 100);
      anomalies.push({
        code: 'funnel_bottleneck',
        severity: 'warning',
        message: `Leads stall entering "${bottleneck.name}": only ${pct}% of the prior stage's leads reach it.`,
      });
    }

    // 3. Campaigns spending without converting.
    for (const c of campaigns.campaigns) {
      const budget = c.budget_cents ?? 0;
      if (budget > 0 && c.lead_count > 0 && c.won_count === 0) {
        anomalies.push({
          code: 'spend_no_conversion',
          severity: 'warning',
          message: `Campaign "${c.name}" has ${c.lead_count} leads and budget but no conversions yet.`,
        });
      }
    }

    // 4. Attribution gap — too many leads with no campaign.
    const total = funnel.conversion.total_leads;
    if (total > 0 && campaigns.unattributed_leads / total > RULES.UNATTRIBUTED_MAX_SHARE) {
      anomalies.push({
        code: 'attribution_gap',
        severity: 'info',
        message: `${campaigns.unattributed_leads} of ${total} leads are not attributed to any campaign.`,
      });
    }

    // 5. Low win rate, once enough leads have closed to be meaningful.
    const { won, lost, win_rate } = funnel.conversion;
    if (won + lost >= RULES.WIN_RATE_MIN_CLOSED && win_rate !== null && win_rate < RULES.WIN_RATE_MIN) {
      anomalies.push({
        code: 'low_win_rate',
        severity: 'warning',
        message: `Win rate is ${Math.round(win_rate * 100)}% across ${won + lost} closed leads.`,
      });
    }

    return anomalies;
  }

  /** The stage with the lowest step conversion that still has upstream leads. */
  private worstBottleneck(funnel: FunnelMetrics): BriefFunnelStage | null {
    let worst: { stage: BriefFunnelStage; conv: number } | null = null;
    for (let i = 1; i < funnel.stages.length; i++) {
      const stage = funnel.stages[i];
      const upstreamReached = funnel.stages[i - 1].reached;
      const conv = stage.conversion_from_previous;
      if (
        conv === null ||
        upstreamReached < RULES.BOTTLENECK_MIN_UPSTREAM ||
        conv > RULES.BOTTLENECK_MAX_CONVERSION
      ) {
        continue;
      }
      if (!worst || conv < worst.conv) {
        worst = { stage, conv };
      }
    }
    return worst?.stage ?? null;
  }

  /**
   * Map detected anomalies to advisory actions. One action per category (deduped
   * by code) so the list stays focused; a healthy funnel gets a single
   * "maintain momentum" action.
   */
  private recommendActions(
    anomalies: BriefAnomaly[],
    funnel: FunnelMetrics,
    campaigns: CampaignAttributionMetrics,
  ): BriefAction[] {
    const actions: BriefAction[] = [];
    const seen = new Set<string>();
    const add = (action: BriefAction) => {
      if (seen.has(action.code)) return;
      seen.add(action.code);
      actions.push(action);
    };

    for (const a of anomalies) {
      switch (a.code) {
        case 'acquisition_stalled':
        case 'acquisition_down':
          add({
            code: 'rebuild_top_of_funnel',
            title: 'Rebuild top-of-funnel lead volume',
            rationale: 'New-lead acquisition is below the prior period; refresh traffic and capture before downstream stages dry up.',
            related_stage: 'traffic',
          });
          break;
        case 'funnel_bottleneck': {
          const stage = this.worstBottleneck(funnel);
          add({
            code: 'unblock_funnel_stage',
            title: stage ? `Unblock the ${stage.name} stage` : 'Unblock the worst funnel stage',
            rationale: 'A disproportionate share of leads is lost at this step; review messaging and follow-up to improve progression.',
            related_stage: stage?.key,
          });
          break;
        }
        case 'spend_no_conversion': {
          const offenders = campaigns.campaigns
            .filter((c) => (c.budget_cents ?? 0) > 0 && c.lead_count > 0 && c.won_count === 0)
            .map((c) => c.name);
          add({
            code: 'review_campaign_spend',
            title: 'Review underperforming campaign spend',
            rationale: `Campaign(s) ${offenders.join(', ')} are spending without conversions; reassess targeting or pause.`,
          });
          break;
        }
        case 'attribution_gap':
          add({
            code: 'improve_attribution',
            title: 'Close the lead attribution gap',
            rationale: 'A large share of leads has no campaign; tighten source/campaign tagging so spend decisions are trustworthy.',
          });
          break;
        case 'low_win_rate':
          add({
            code: 'improve_win_rate',
            title: 'Investigate the low win rate',
            rationale: 'Closed leads are converting poorly; review qualification and the conversion-stage handoff.',
            related_stage: 'conversion',
          });
          break;
      }
    }

    if (actions.length === 0) {
      add({
        code: 'maintain_momentum',
        title: 'Maintain current funnel momentum',
        rationale: 'No anomalies detected; keep current acquisition and conversion motion and re-check tomorrow.',
      });
    }

    return actions;
  }
}

/** Default service bound to the process-wide KPI repository singleton. */
export const briefService = new BriefService();

/**
 * Render a brief as plain text for the "JSON/text" output contract — a readable
 * summary for email/terminal delivery. Pure function of the brief.
 */
export function renderBriefText(brief: CeoBrief): string {
  const pct = (r: number | null) => (r === null ? 'n/a' : `${Math.round(r * 100)}%`);
  const lines: string[] = [];

  lines.push(`DAILY CEO BRIEF — ${brief.as_of}`);
  lines.push(`Client: ${brief.client_id}`);
  lines.push('');

  const h = brief.headline;
  lines.push('HEADLINE');
  lines.push(`  Leads: ${h.total_leads} total — ${h.open} open, ${h.won} won, ${h.lost} lost`);
  lines.push(`  Win rate: ${pct(h.win_rate)} · Overall conversion: ${pct(h.overall_conversion_rate)}`);
  lines.push('');

  const d = brief.delta;
  const arrow = d.direction === 'up' ? '▲' : d.direction === 'down' ? '▼' : '—';
  lines.push('ACQUISITION');
  lines.push(`  Last ${d.window_days}d: ${d.recent_leads} new leads ${arrow} (prev ${d.previous_leads}, change ${d.change >= 0 ? '+' : ''}${d.change})`);
  lines.push('');

  lines.push('FUNNEL');
  for (const s of brief.funnel) {
    lines.push(`  ${String(s.position).padStart(2)}. ${s.name.padEnd(14)} at:${String(s.count).padStart(3)}  reached:${String(s.reached).padStart(3)}`);
  }
  lines.push('');

  lines.push('ANOMALIES');
  if (brief.anomalies.length === 0) {
    lines.push('  None.');
  } else {
    for (const a of brief.anomalies) {
      lines.push(`  [${a.severity.toUpperCase()}] ${a.message}`);
    }
  }
  lines.push('');

  lines.push('RECOMMENDED ACTIONS');
  for (const a of brief.recommended_actions) {
    lines.push(`  • ${a.title}`);
    lines.push(`    ${a.rationale}`);
  }

  return lines.join('\n');
}
