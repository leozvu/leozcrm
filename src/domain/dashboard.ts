/**
 * Output contract for the Executive Dashboard v0 (Milestone #5).
 *
 * The dashboard is a **read-only** surface: it assembles, for one client at a
 * point in time, the data that the existing live API endpoints already serve —
 * the KPI funnel (`/metrics/funnel`), the CEO brief (`/brief`), the advisory
 * recommendations (`/recommendations`), and the client's leads (`/leads`) — into
 * a single view model. It adds no new data sources, performs no writes, and
 * triggers nothing. Given the same CRM state and `as_of` it produces the same
 * view.
 *
 * This layer intentionally carries no fallback/placeholder values: every field
 * is taken verbatim from the API shapes above. Emptiness (a client with no
 * leads, no anomalies, or no recommendations) is represented honestly so the
 * renderer can show an explicit no-data state rather than fabricated content.
 */

import { FunnelMetrics, LeadTrendMetrics } from './metrics';
import { CeoBrief } from './brief';
import { RecommendationReport } from './recommendation';
import { LeadStatus } from './types';

/** One lead as the dashboard's lead-list view reports it. */
export interface DashboardLeadView {
  id: string;
  name: string | null;
  email: string | null;
  source: string | null;
  status: LeadStatus;
  /** Current funnel stage key, joined from `funnel_stages`. */
  stage_key: string | null;
  /** Current funnel stage label, joined from `funnel_stages`. */
  stage_name: string | null;
  created_at: string;
}

/** The assembled executive dashboard view for one client at a point in time. */
export interface DashboardView {
  /** The client this dashboard is scoped to. */
  client: { id: string; name: string; email: string };
  /** Calendar day the brief/recommendation analysis covers, `YYYY-MM-DD` (UTC). */
  as_of: string;
  /** When the view was assembled, ISO-8601. */
  generated_at: string;
  /**
   * `false` when the client has zero leads. Drives the top-level no-data state;
   * individual sections still check their own emptiness (no anomalies, no
   * recommendations, no leads).
   */
  has_data: boolean;
  /** KPI funnel snapshot — identical to `/metrics/funnel`. */
  funnel: FunnelMetrics;
  /** Lead-creation volume over time (oldest day first) — identical to `/metrics/trends`. */
  trends: LeadTrendMetrics;
  /** CEO brief — identical to `/brief`. */
  brief: CeoBrief;
  /** Advisory recommendations — identical to `/recommendations`. */
  recommendations: RecommendationReport;
  /** The client's leads with their current funnel stage — from `/leads`. */
  leads: DashboardLeadView[];
}
