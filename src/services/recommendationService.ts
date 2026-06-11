import { BriefService, briefService } from './briefService';
import { CeoBrief } from '../domain/brief';
import {
  Recommendation,
  RecommendationCategory,
  RecommendationPriority,
  RecommendationReport,
} from '../domain/recommendation';

/**
 * Recommendation System v0 (Milestone #4).
 *
 * The first "AI Brain" behaviour: it turns the Daily CEO Brief's read-only
 * funnel analysis into prioritised, categorised advice. It depends on
 * `BriefService` (which already derives anomalies and advisory actions from the
 * KPI layer) so the rule logic is not duplicated — this service adds the
 * recommendation dimensions (category, priority) and a stable contract.
 *
 * It is **advisory only**: read-only, no scheduling, no execution, and every
 * recommendation carries `advisory_only: true`. Like the other services it is
 * dependency-injected with a singleton default, deterministic for a fixed
 * `asOf`, and consumes/returns typed domain shapes with no direct `knex` use.
 */

/**
 * Mapping from a brief anomaly code to the recommendation it produces. The
 * `action_code` matches the brief's recommended-action code, so the human-facing
 * title/rationale/related_stage are reused verbatim (single source of wording).
 */
interface AnomalyRule {
  action_code: string;
  category: RecommendationCategory;
  priority: RecommendationPriority;
}

const ANOMALY_RULES: Record<string, AnomalyRule> = {
  acquisition_stalled: { action_code: 'rebuild_top_of_funnel', category: 'acquisition', priority: 'high' },
  acquisition_down: { action_code: 'rebuild_top_of_funnel', category: 'acquisition', priority: 'medium' },
  funnel_bottleneck: { action_code: 'unblock_funnel_stage', category: 'conversion', priority: 'high' },
  spend_no_conversion: { action_code: 'review_campaign_spend', category: 'spend', priority: 'medium' },
  attribution_gap: { action_code: 'improve_attribution', category: 'attribution', priority: 'low' },
  low_win_rate: { action_code: 'improve_win_rate', category: 'conversion', priority: 'high' },
};

/** When the funnel is healthy (no anomalies), recommend maintaining momentum. */
const BASELINE: { action_code: string; category: RecommendationCategory; priority: RecommendationPriority } = {
  action_code: 'maintain_momentum',
  category: 'retention',
  priority: 'low',
};

const PRIORITY_RANK: Record<RecommendationPriority, number> = { high: 0, medium: 1, low: 2 };

export interface RecommendationOptions {
  /** Calendar day the analysis covers, `YYYY-MM-DD` (UTC). Required for determinism. */
  asOf: string;
  /** Generation timestamp (ISO-8601). Defaults via the brief to the start of `asOf`. */
  now?: string;
}

export class RecommendationService {
  constructor(private readonly brief: BriefService = briefService) {}

  async generate(clientId: string, options: RecommendationOptions): Promise<RecommendationReport> {
    // Reuse the brief: it validates `asOf`, reads the KPI layer, and produces
    // the anomalies + advisory actions this service prioritises.
    const brief = await this.brief.generate(clientId, options);
    const recommendations = this.buildRecommendations(brief);

    return {
      client_id: brief.client_id,
      as_of: brief.as_of,
      generated_at: brief.generated_at,
      advisory_only: true,
      recommendations,
    };
  }

  private buildRecommendations(brief: CeoBrief): Recommendation[] {
    const actionsByCode = new Map(brief.recommended_actions.map((a) => [a.code, a]));
    const recommendations: Recommendation[] = [];
    const seen = new Set<string>();

    for (const anomaly of brief.anomalies) {
      const rule = ANOMALY_RULES[anomaly.code];
      if (!rule || seen.has(rule.action_code)) continue;
      const action = actionsByCode.get(rule.action_code);
      if (!action) continue; // brief always emits the mapped action, but stay safe
      seen.add(rule.action_code);

      // A critical anomaly always rises to high priority.
      const priority = anomaly.severity === 'critical' ? 'high' : rule.priority;

      recommendations.push({
        code: action.code,
        title: action.title,
        rationale: action.rationale,
        category: rule.category,
        priority,
        related_stage: action.related_stage,
        advisory_only: true,
      });
    }

    // Healthy funnel: fall back to the brief's maintain-momentum action.
    if (recommendations.length === 0) {
      const action = actionsByCode.get(BASELINE.action_code);
      if (action) {
        recommendations.push({
          code: action.code,
          title: action.title,
          rationale: action.rationale,
          category: BASELINE.category,
          priority: BASELINE.priority,
          related_stage: action.related_stage,
          advisory_only: true,
        });
      }
    }

    // Stable sort: high → medium → low, preserving discovery order within a tier.
    return recommendations
      .map((rec, index) => ({ rec, index }))
      .sort((a, b) => PRIORITY_RANK[a.rec.priority] - PRIORITY_RANK[b.rec.priority] || a.index - b.index)
      .map((entry) => entry.rec);
  }
}

/** Default service bound to the process-wide brief engine. */
export const recommendationService = new RecommendationService();
