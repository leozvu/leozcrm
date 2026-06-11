/**
 * Output contract for the Recommendation System v0 (Milestone #4).
 *
 * Recommendations are the first "AI Brain" behaviour: they turn the brief's
 * read-only funnel analysis into prioritised, categorised advice. They are
 * derived entirely from existing KPI/brief data (no new queries, no schema
 * change) and are **advisory only** — the contract encodes this with a literal
 * `advisory_only: true` field that the type system pins to `true`. Nothing in
 * this layer executes, schedules, or mutates anything.
 */

/** Coarse area a recommendation addresses, aligned to the funnel. */
export type RecommendationCategory =
  | 'acquisition'
  | 'conversion'
  | 'attribution'
  | 'spend'
  | 'retention';

/** Relative urgency. Reports are sorted high → medium → low. */
export type RecommendationPriority = 'high' | 'medium' | 'low';

/** A single advisory recommendation. */
export interface Recommendation {
  /** Stable machine code (shared with the brief action it derives from). */
  code: string;
  title: string;
  rationale: string;
  category: RecommendationCategory;
  priority: RecommendationPriority;
  /** Funnel stage key when the recommendation targets one stage. */
  related_stage?: string;
  /** Always `true`. This layer never triggers automated action. */
  advisory_only: true;
}

/** The advisory recommendation report for one client at a point in time. */
export interface RecommendationReport {
  client_id: string;
  /** Calendar day the underlying analysis covers, `YYYY-MM-DD` (UTC). */
  as_of: string;
  /** When the report was generated, ISO-8601. */
  generated_at: string;
  /** Always `true` — the whole report is advisory. */
  advisory_only: true;
  /** Prioritised recommendations (high → low). Empty only for an empty client. */
  recommendations: Recommendation[];
}
