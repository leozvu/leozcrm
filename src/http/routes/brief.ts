import { Request, Response, Router } from 'express';
import { asyncHandler } from '../asyncHandler';
import { BriefService, briefService, renderBriefText } from '../../services/briefService';
import { ClientRepository, clientRepository } from '../../repositories/clientRepository';

/**
 * Daily CEO Brief endpoint (Milestone #3). Scoped to a single client via a
 * required `?clientId=` — same contract as the `/metrics/*` routes. Read-only:
 * it assembles a brief from the KPI layer and never mutates CRM data.
 *
 *   GET /brief?clientId=            today's brief as JSON
 *   GET /brief?clientId=&asOf=YYYY-MM-DD   brief for a specific day
 *   GET /brief?clientId=&format=text       brief rendered as plain text
 *
 * Built by a factory so its service/repository can be injected — the default
 * binds to the process-wide singletons, while tests pass instances bound to a
 * seeded in-memory connection (see createApp's `knex` option).
 */
export interface BriefRouterDeps {
  brief: BriefService;
  clients: ClientRepository;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date as `YYYY-MM-DD` (UTC) — the default brief window. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

export function createBriefRouter(
  deps: BriefRouterDeps = { brief: briefService, clients: clientRepository },
): Router {
  const { brief, clients } = deps;
  const router = Router();

  /** Resolve the required, trimmed client scope (400 missing/blank, 404 unknown). */
  async function resolveClientId(req: Request, res: Response): Promise<string | null> {
    const raw = req.query.clientId;
    if (typeof raw !== 'string' || raw.trim() === '') {
      res.status(400).json({ error: 'clientId query parameter is required' });
      return null;
    }
    const clientId = raw.trim();
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
      } else if (typeof asOfRaw === 'string' && ISO_DATE.test(asOfRaw)) {
        asOf = asOfRaw;
      } else {
        return res.status(400).json({ error: 'asOf must be a YYYY-MM-DD date' });
      }

      const result = await brief.generate(clientId, { asOf, now: new Date().toISOString() });

      if (req.query.format === 'text') {
        return res.type('text/plain').send(renderBriefText(result));
      }
      res.json(result);
    }),
  );

  return router;
}

/** Default router bound to the process-wide singletons. */
export const briefRouter = createBriefRouter();
