/**
 * The canonical LeozOps growth funnel.
 *
 *   Traffic -> Attention -> Lead -> Qualification -> Nurture ->
 *   Conversion -> Activation -> Upsell -> Retention
 *
 * This is the single source of truth for the funnel. The `funnel_stages`
 * table is seeded from this list, and lead movement is tracked by pointing
 * a lead at one of these stages (see Lead.funnel_stage_id).
 *
 * Stages are intentionally data (a seeded table) rather than a hard-coded
 * enum so the funnel can be extended or re-ordered later without a code
 * deploy — only a seed/migration change.
 */

export interface FunnelStageDefinition {
  /** Stable machine key. Never change once shipped — leads reference it. */
  key: string;
  /** Human-readable label. */
  name: string;
  /** 1-based order in the funnel. */
  position: number;
  /** What this stage means operationally. */
  description: string;
}

export const FUNNEL_STAGES: readonly FunnelStageDefinition[] = [
  { key: 'traffic',       name: 'Traffic',       position: 1, description: 'Raw reach. Impressions, visits, and clicks from campaigns before any identity is known.' },
  { key: 'attention',     name: 'Attention',     position: 2, description: 'Engaged interest. The contact interacted (watched, scrolled, replied) but is not yet captured.' },
  { key: 'lead',          name: 'Lead',          position: 3, description: 'Captured contact. We now hold an identifier (email/phone) and own the relationship.' },
  { key: 'qualification', name: 'Qualification', position: 4, description: 'Fit + intent assessment. The lead is scored against ICP and buying signals.' },
  { key: 'nurture',       name: 'Nurture',       position: 5, description: 'Warming sequence. Educational / trust-building touches for not-yet-ready leads.' },
  { key: 'conversion',    name: 'Conversion',    position: 6, description: 'The buy. Lead becomes a paying customer for the first time.' },
  { key: 'activation',    name: 'Activation',    position: 7, description: 'First value realized. Customer reaches the "aha" / successful first use.' },
  { key: 'upsell',        name: 'Upsell',        position: 8, description: 'Expansion. Cross-sell / upgrade to higher-value offers.' },
  { key: 'retention',     name: 'Retention',     position: 9, description: 'Ongoing loyalty. Renewals, repeat purchase, and churn prevention.' },
] as const;

export type FunnelStageKey = (typeof FUNNEL_STAGES)[number]['key'];

/** First stage a brand-new, anonymous lead enters. */
export const DEFAULT_ENTRY_STAGE: FunnelStageKey = 'traffic';
