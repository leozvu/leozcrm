import { Request, Response, Router } from 'express';
import { asyncHandler } from '../asyncHandler';
import { enforceTenantReadScope } from '../integrationReadAuth';
import { EgoricBriefService } from '../../services/egoricBriefService';

export function createEgoricBriefRouter(brief: EgoricBriefService): Router {
  const router = Router();

  router.get('/:tenantKey/brief', asyncHandler(async (req: Request, res: Response) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    const rawAsOf = req.query.asOf;
    if (rawAsOf !== undefined && typeof rawAsOf !== 'string') {
      res.status(400).json({ error: 'asOf must be a single date or timestamp', code: 'invalid_as_of' });
      return;
    }
    const output = await brief.generate(tenantKey, rawAsOf);
    res.setHeader('Cache-Control', 'private, no-cache');
    res.json(output);
  }));

  return router;
}
