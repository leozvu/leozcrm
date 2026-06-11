/**
 * Output contract for the Daily CEO Brief (Milestone #3).
 *
 * The brief is a deterministic, point-in-time executive summary of one client's
 * funnel, assembled purely from the read-only KPI layer (src/domain/metrics.ts).
 * It adds no new data sources and performs no writes — given the same CRM state
 * and the same `as_of` date it always produces the same brief.
 *
 * Sections mirror the milestone deliverable: a funnel snapshot, acquisition
 * deltas, anomalies, and recommended actions. Recommendations are **advisory
 * only** (per PRODUCT.md) — nothing here triggers an automated action.
 *
 * Rates carried through from the KPI layer keep its convention: a fraction in
 * 0..1 rounded to 4 dp, or `null` when undefined (never NaN).
 */

/** Headline lead-outcome numbers, taken verbatim from the KPI conversion block. */
export interface BriefHeadline {
  total_leads: number;
  open: number;
  won: number;
  lost: number;
  win_rate: number | null;
  overall_conversion_rate: number;
}

/** One funnel stage as the brief reports it (a projection of FunnelStageMetric). */
export interface BriefFunnelStage {
  key: string;
  name: string;
  position: number;
  /** Leads currently at this stage. */
  count: number;
  /** Leads at or beyond this stage. */
  reached: number;
  /** Step conversion into this stage; `null` for the first stage. */
  conversion_from_previous: number | null;
}

/**
 * Lead-acquisition momentum derived from `created_at` (the KPI trend series),
 * relative to `as_of`. We compare the most recent `window_days` to the window
 * immediately before it.
 *
 * NOTE: this is an *acquisition* delta, not a funnel-stage delta. Day-over-day
 * funnel deltas would need historical KPI snapshots, which the data layer does
 * not persist yet (see docs/DATA_MODEL.md). Acquisition volume is the honest,
 * deterministic delta available from current data.
 */
export interface BriefDelta {
  window_days: number;
  /** Leads created within the most recent window ending on `as_of`. */
  recent_leads: number;
  /** Leads created within the window immediately before that. */
  previous_leads: number;
  /** recent_leads - previous_leads. */
  change: number;
  direction: 'up' | 'down' | 'flat';
}

export type AnomalySeverity = 'info' | 'warning' | 'critical';

/** A flagged condition worth the CEO's attention, with a stable machine code. */
export interface BriefAnomaly {
  code: string;
  severity: AnomalySeverity;
  message: string;
}

/** An advisory next step. `related_stage` is a funnel stage key when relevant. */
export interface BriefAction {
  code: string;
  title: string;
  rationale: string;
  related_stage?: string;
}

/** The assembled daily CEO brief for one client. */
export interface CeoBrief {
  client_id: string;
  /** Calendar day the brief covers, `YYYY-MM-DD` (UTC). */
  as_of: string;
  /** When the brief was generated, ISO-8601. */
  generated_at: string;
  headline: BriefHeadline;
  funnel: BriefFunnelStage[];
  delta: BriefDelta;
  anomalies: BriefAnomaly[];
  recommended_actions: BriefAction[];
}
