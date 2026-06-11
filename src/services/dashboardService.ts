import { MetricsRepository, metricsRepository } from '../repositories/metricsRepository';
import { LeadRepository, leadRepository } from '../repositories/leadRepository';
import { FunnelStageRepository, funnelStageRepository } from '../repositories/funnelStageRepository';
import { ClientRepository, clientRepository } from '../repositories/clientRepository';
import { BriefService, briefService } from './briefService';
import { RecommendationService, recommendationService } from './recommendationService';
import { isValidIsoDate } from '../domain/date';
import { ValidationError } from '../errors';
import { DashboardView, DashboardLeadView } from '../domain/dashboard';

/**
 * Executive Dashboard v0 assembler (Milestone #5).
 *
 * This service composes the **existing** read-only layers into one client-scoped
 * view model: the KPI funnel and lead-volume trend (`MetricsRepository`), the CEO
 * brief (`BriefService`), the advisory recommendations (`RecommendationService`),
 * and the client's leads (`LeadRepository`) joined to their funnel stage names
 * (`FunnelStageRepository`). These are the same components that back the
 * `/metrics/funnel`, `/metrics/trends`, `/brief`, `/recommendations`, and
 * `/leads` endpoints, so the dashboard consumes exactly the live API data — it
 * does not add new queries, schema, writes, or business rules.
 *
 * Like the other services it is dependency-injected with singleton defaults,
 * deterministic for a fixed `asOf`, consumes/returns typed domain shapes, and
 * never touches `knex` directly. It carries no fallback values: an empty client
 * yields an honestly empty view (`has_data: false`, empty leads/recommendations)
 * for the renderer to surface as an explicit no-data state.
 */

export interface DashboardServiceDeps {
  metrics?: MetricsRepository;
  brief?: BriefService;
  recommendations?: RecommendationService;
  leads?: LeadRepository;
  stages?: FunnelStageRepository;
  clients?: ClientRepository;
}

export interface DashboardOptions {
  /** Calendar day the analysis covers, `YYYY-MM-DD` (UTC). Required for determinism. */
  asOf: string;
  /** Generation timestamp (ISO-8601). Defaults to the start of `asOf`. */
  now?: string;
}

export class DashboardService {
  private readonly metrics: MetricsRepository;
  private readonly brief: BriefService;
  private readonly recommendations: RecommendationService;
  private readonly leads: LeadRepository;
  private readonly stages: FunnelStageRepository;
  private readonly clients: ClientRepository;

  constructor(deps: DashboardServiceDeps = {}) {
    this.metrics = deps.metrics ?? metricsRepository;
    this.brief = deps.brief ?? briefService;
    this.recommendations = deps.recommendations ?? recommendationService;
    this.leads = deps.leads ?? leadRepository;
    this.stages = deps.stages ?? funnelStageRepository;
    this.clients = deps.clients ?? clientRepository;
  }

  /**
   * Assemble the dashboard view for one client. Returns `null` when the client
   * does not exist, so the route can render an explicit not-found state.
   */
  async build(clientId: string, options: DashboardOptions): Promise<DashboardView | null> {
    const { asOf } = options;
    // Guard the date once up front (the brief/recommendation services guard it
    // too; this keeps the failure a clean 400 before any reads).
    if (!isValidIsoDate(asOf)) {
      throw new ValidationError(400, 'asOf must be a valid YYYY-MM-DD date', 'invalid_as_of');
    }

    const client = await this.clients.findById(clientId);
    if (!client) return null;

    const now = options.now ?? `${asOf}T00:00:00.000Z`;

    // Read the same live data the API endpoints serve, in parallel.
    const [funnel, trends, brief, recommendations, leads, stages] = await Promise.all([
      this.metrics.funnelByClient(clientId),
      this.metrics.leadTrends(clientId),
      this.brief.generate(clientId, { asOf, now }),
      this.recommendations.generate(clientId, { asOf, now }),
      this.leads.listByClient(clientId),
      this.stages.listOrdered(),
    ]);

    // Join each lead to its funnel stage name. The FK guarantees the stage
    // exists; if a row were ever orphaned we surface `null` (an explicit
    // "unknown stage" for the renderer) rather than inventing a label.
    const stageById = new Map(stages.map((s) => [s.id, s]));
    const leadViews: DashboardLeadView[] = leads.map((l) => {
      const stage = stageById.get(l.funnel_stage_id);
      return {
        id: l.id,
        name: l.name,
        email: l.email,
        source: l.source,
        status: l.status,
        stage_key: stage?.key ?? null,
        stage_name: stage?.name ?? null,
        created_at: l.created_at,
      };
    });

    return {
      client: { id: client.id, name: client.name, email: client.email },
      as_of: asOf,
      generated_at: now,
      has_data: funnel.total_leads > 0,
      funnel,
      trends,
      brief,
      recommendations,
      leads: leadViews,
    };
  }
}

/** Default service bound to the process-wide singletons. */
export const dashboardService = new DashboardService();
