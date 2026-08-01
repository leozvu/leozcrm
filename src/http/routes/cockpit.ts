import { Request, Response, Router } from 'express';
import { CockpitService } from '../../services/cockpitService';
import { asyncHandler } from '../asyncHandler';
import { enforceTenantReadScope } from '../integrationReadAuth';

export function createCockpitApiRouter(cockpit: CockpitService): Router {
  const router = Router();
  router.get('/:tenantKey/cockpit', asyncHandler(async (req: Request, res: Response) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    const rawAsOf = req.query.asOf;
    if (rawAsOf !== undefined && typeof rawAsOf !== 'string') {
      res.status(400).json({ error: 'asOf must be a single date or timestamp', code: 'invalid_as_of' });
      return;
    }
    const snapshot = await cockpit.snapshot(tenantKey, rawAsOf);
    res.setHeader('Cache-Control', 'private, no-cache');
    res.json(snapshot);
  }));
  return router;
}
