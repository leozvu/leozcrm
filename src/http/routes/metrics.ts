import { Request, Response, Router } from 'express';
import { asyncHandler } from '../asyncHandler';
import { MetricsRepository, metricsRepository } from '../../repositories/metricsRepository';
import { ClientRepository, clientRepository } from '../../repositories/clientRepository';
import { enforceClientScope } from '../auth';

/**
 * Read-only KPI endpoints (Milestone #2). Every metric is scoped to a single
 * client via a required `?clientId=` query parameter — mirroring the existing
 * `?clientId=` filter on the leads/campaigns list routes. These are pure reads;
 * nothing here mutates CRM data.
 *
 *   GET /metrics/funnel?clientId=    funnel stage counts + conversion rates
 *   GET /metrics/sources?clientId=   lead volume by source
 *   GET /metrics/channels?clientId=  lead volume by campaign channel
 *   GET /metrics/campaigns?clientId= per-campaign attribution
 *   GET /metrics/trends?clientId=    lead-creation volume over time
 *
 * The router is built by a factory so its repositories can be injected — the
 * default binds to the process-wide singletons, while tests pass repositories
 * bound to a seeded in-memory connection (see createApp's `knex` option).
 */
export interface MetricsRouterDeps {
  metrics: MetricsRepository;
  clients: ClientRepository;
}

export function createMetricsRouter(
  deps: MetricsRouterDeps = { metrics: metricsRepository, clients: clientRepository },
): Router {
  const { metrics, clients } = deps;
  const router = Router();

  /**
   * Resolve the required client scope. Returns the validated, trimmed client id,
   * or writes the error response and returns null:
   *   - 400 when `clientId` is missing/blank
   *   - 404 when the client does not exist
   */
  async function resolveClientId(req: Request, res: Response): Promise<string | null> {
    const raw = req.query.clientId;
    if (typeof raw !== 'string' || raw.trim() === '') {
      res.status(400).json({ error: 'clientId query parameter is required' });
      return null;
    }
    // Trim once and use the trimmed value for both the lookup and the result so
    // a whitespace-padded but otherwise valid id resolves instead of 404-ing.
    const clientId = raw.trim();
    // Enforce tenant scope before existence so a caller cannot probe other
    // clients' existence (403 on mismatch, before any 404).
    if (!enforceClientScope(req, res, clientId)) return null;
    const client = await clients.findById(clientId);
    if (!client) {
      res.status(404).json({ error: 'client not found' });
      return null;
    }
    return clientId;
  }

  router.get(
    '/funnel',
    asyncHandler(async (req, res) => {
      const clientId = await resolveClientId(req, res);
      if (!clientId) return;
      res.json(await metrics.funnelByClient(clientId));
    }),
  );

  router.get(
    '/sources',
    asyncHandler(async (req, res) => {
      const clientId = await resolveClientId(req, res);
      if (!clientId) return;
      res.json(await metrics.volumeBySource(clientId));
    }),
  );

  router.get(
    '/channels',
    asyncHandler(async (req, res) => {
      const clientId = await resolveClientId(req, res);
      if (!clientId) return;
      res.json(await metrics.volumeByChannel(clientId));
    }),
  );

  router.get(
    '/campaigns',
    asyncHandler(async (req, res) => {
      const clientId = await resolveClientId(req, res);
      if (!clientId) return;
      res.json(await metrics.campaignAttribution(clientId));
    }),
  );

  router.get(
    '/trends',
    asyncHandler(async (req, res) => {
      const clientId = await resolveClientId(req, res);
      if (!clientId) return;
      res.json(await metrics.leadTrends(clientId));
    }),
  );

  return router;
}

/** Default router bound to the process-wide singleton repositories. */
export const metricsRouter = createMetricsRouter();
