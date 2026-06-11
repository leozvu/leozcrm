/**
 * Typed result shapes for the read-only KPI layer (Milestone #2).
 *
 * These are the contract the KPI HTTP routes return and the CEO Brief Agent
 * will consume. Every metric is scoped to a single client. Nothing here mutates
 * data — this layer only reads the four CRM tables and aggregates them into the
 * funnel KPIs described in PRODUCT.md.
 *
 * Rates are fractions in the range 0..1 (multiply by 100 for a percentage),
 * rounded to 4 decimal places. A rate is `null` only when it is undefined
 * (e.g. a win rate with zero closed leads) — never NaN.
 */

/** One funnel stage with its live counts and progression toward it. */
export interface FunnelStageMetric {
  stage_id: string;
  key: string;
  name: string;
  position: number;
  /** Leads currently sitting AT this stage. */
  count: number;
  /** Leads at OR beyond this stage (cumulative — they passed through here). */
  reached: number;
  /**
   * reached(this) / reached(previous stage): the step conversion rate into this
   * stage. `null` for the first stage (nothing precedes it).
   */
  conversion_from_previous: number | null;
}

/** Lead outcome breakdown and the headline conversion rates. */
export interface ConversionMetrics {
  total_leads: number;
  open: number;
  won: number;
  lost: number;
  /** won / (won + lost). `null` when no leads have closed yet. */
  win_rate: number | null;
  /** won / total_leads. `0` when the client has no leads. */
  overall_conversion_rate: number;
}

/** Funnel snapshot + conversion rates for one client. */
export interface FunnelMetrics {
  client_id: string;
  total_leads: number;
  stages: FunnelStageMetric[];
  conversion: ConversionMetrics;
}

export interface SourceVolumeBucket {
  /** Free-text origin label, or `null` for leads with no recorded source. */
  source: string | null;
  count: number;
}

export interface SourceVolumeMetrics {
  client_id: string;
  total_leads: number;
  by_source: SourceVolumeBucket[];
}

export interface ChannelVolumeBucket {
  /** Campaign channel, or `"unattributed"` for leads with no campaign. */
  channel: string;
  count: number;
}

export interface ChannelVolumeMetrics {
  client_id: string;
  total_leads: number;
  by_channel: ChannelVolumeBucket[];
}

/** Per-campaign attribution: how many leads each campaign drove, and how many won. */
export interface CampaignAttributionRow {
  campaign_id: string;
  name: string;
  channel: string;
  status: string;
  budget_cents: number | null;
  lead_count: number;
  won_count: number;
}

export interface CampaignAttributionMetrics {
  client_id: string;
  campaigns: CampaignAttributionRow[];
  /** Leads belonging to the client but attributed to no campaign. */
  unattributed_leads: number;
}

/** A single day's lead-creation volume. */
export interface TrendPoint {
  /** Calendar day in UTC, `YYYY-MM-DD`. */
  date: string;
  count: number;
}

/** Lead-creation volume over time for one client (oldest day first). */
export interface LeadTrendMetrics {
  client_id: string;
  total_leads: number;
  by_day: TrendPoint[];
}
