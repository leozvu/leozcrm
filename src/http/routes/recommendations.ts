import { Request, Response, Router } from 'express';
import { asyncHandler } from '../asyncHandler';
import { RecommendationService, recommendationService } from '../../services/recommendationService';
import { ClientRepository, clientRepository } from '../../repositories/clientRepository';
import { isValidIsoDate } from '../../domain/date';
import { enforceClientScope } from '../auth';

/**
 * Advisory recommendation endpoint (Milestone #4). Scoped to a single client via
 * a required `?clientId=` — same contract as the `/brief` and `/metrics/*`
 * routes. Read-only and advisory-only: it returns prioritised guidance derived
 * from the brief/KPI layer and never mutates or triggers anything.
 *
 *   GET /recommendations?clientId=                advisory report for today
 *   GET /recommendations?clientId=&asOf=YYYY-MM-DD  report for a specific day
 *
 * Built by a factory so its service/repository can be injected — the default
 * binds to the process-wide singletons, while tests pass instances bound to a
 * seeded in-memory connection (see createApp's `knex` option).
 */
export interface RecommendationsRouterDeps {
  recommendations: RecommendationService;
  clients: ClientRepository;
}

/** Today's date as `YYYY-MM-DD` (UTC) — the default analysis window. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function createRecommendationsRouter(
  deps: RecommendationsRouterDeps = {
    recommendations: recommendationService,
    clients: clientRepository,
  },
): Router {
  const { recommendations, clients } = deps;
  const router = Router();

  /** Resolve the required, trimmed client scope (400 missing/blank, 404 unknown). */
  async function resolveClientId(req: Request, res: Response): Promise<string | null> {
    const raw = req.query.clientId;
    if (typeof raw !== 'string' || raw.trim() === '') {
      res.status(400).json({ error: 'clientId query parameter is required' });
      return null;
    }
    const clientId = raw.trim();
    if (!enforceClientScope(req, res, clientId)) return null;
    const client = await clients.findById(clientId);
    if (!client) {
      res.status(404).json({ error: 'client not found' });
      return null;
    }
    return clientId;
  }

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const clientId = await resolveClientId(req, res);
      if (!clientId) return;

      const asOfRaw = req.query.asOf;
      let asOf: string;
      if (asOfRaw === undefined) {
        asOf = todayUtc();
      } else if (isValidIsoDate(asOfRaw)) {
        asOf = asOfRaw;
      } else {
        return res.status(400).json({ error: 'asOf must be a valid YYYY-MM-DD date' });
      }

      const report = await recommendations.generate(clientId, { asOf, now: new Date().toISOString() });
      res.json(report);
    }),
  );

  return router;
}

/** Default router bound to the process-wide singletons. */
export const recommendationsRouter = createRecommendationsRouter();
