import { Router } from 'express';
import { asyncHandler } from '../asyncHandler';
import { DashboardService, dashboardService } from '../../services/dashboardService';
import { ClientRepository, clientRepository } from '../../repositories/clientRepository';
import { isValidIsoDate } from '../../domain/date';
import { renderDashboardHtml, renderClientPicker, renderNotFound } from '../dashboardView';

/**
 * Executive Dashboard v0 (Milestone #5). A single read-only HTML surface that
 * renders the live API data — KPI funnel, CEO brief, recommendations, and the
 * lead list — for one client. It serves HTML only; it mounts no mutation routes
 * and triggers nothing.
 *
 *   GET /dashboard                         client picker (choose a client)
 *   GET /dashboard?clientId=               that client's dashboard for today
 *   GET /dashboard?clientId=&asOf=YYYY-MM-DD  dashboard for a specific day
 *
 * Built by a factory so its service/repository can be injected — the default
 * binds to the process-wide singletons, while tests pass instances bound to a
 * seeded in-memory connection (see createApp's `knex` option).
 */
export interface DashboardRouterDeps {
  dashboard: DashboardService;
  clients: ClientRepository;
}

/** Today's date as `YYYY-MM-DD` (UTC) — the default analysis window. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function createDashboardRouter(
  deps: DashboardRouterDeps = { dashboard: dashboardService, clients: clientRepository },
): Router {
  const { dashboard, clients } = deps;
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const raw = req.query.clientId;

      // No client chosen → landing page that lists clients to pick from.
      if (raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
        const all = await clients.list();
        return res.type('html').send(renderClientPicker(all));
      }
      if (typeof raw !== 'string') {
        return res.status(400).type('html').send(renderNotFound('Invalid clientId.'));
      }
      const clientId = raw.trim();

      // Resolve the analysis date — default today, reject date-shaped-but-invalid.
      const asOfRaw = req.query.asOf;
      let asOf: string;
      if (asOfRaw === undefined) {
        asOf = todayUtc();
      } else if (isValidIsoDate(asOfRaw)) {
        asOf = asOfRaw;
      } else {
        return res
          .status(400)
          .type('html')
          .send(renderNotFound('asOf must be a valid YYYY-MM-DD date.'));
      }

      const view = await dashboard.build(clientId, { asOf, now: new Date().toISOString() });
      if (!view) {
        return res.status(404).type('html').send(renderNotFound('Client not found.'));
      }
      res.type('html').send(renderDashboardHtml(view));
    }),
  );

  return router;
}

/** Default router bound to the process-wide singletons. */
export const dashboardRouter = createDashboardRouter();
