import { Router } from 'express';
import { SupervisedHandService } from '../../services/supervisedHandService';
import { enforceTenantReadScope } from '../integrationReadAuth';

export function createSupervisedHandRouter(service: SupervisedHandService): Router {
  const router = Router();
  router.get('/:tenantKey/supervised-hand', async (req, res, next) => {
    try {
      const tenantKey = req.params.tenantKey;
      if (!enforceTenantReadScope(req, res, tenantKey)) return;
      res.setHeader('Cache-Control', 'no-store');
      res.json(await service.state(tenantKey));
    } catch (error) {
      next(error);
    }
  });
  return router;
}
