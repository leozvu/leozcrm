import express, { NextFunction, Request, Response } from 'express';
import type { Knex } from '../db/knex';
import { db } from '../db/knex';
import { BusinessMemoryError, BusinessMemoryRepository } from '../repositories/businessMemoryRepository';
import { EgoricBriefError, EgoricBriefService } from '../services/egoricBriefService';
import {
  authenticateIntegrationRead,
  IntegrationReadAuthConfig,
  resolveIntegrationReadAuthConfig,
} from './integrationReadAuth';
import { createEgoricBriefRouter } from './routes/egoricBrief';

export interface EgoricReadonlyAppOptions {
  knex?: Knex;
  integrationReadAuth?: IntegrationReadAuthConfig;
}

/** G3 runtime: health plus one authenticated tenant brief route, nothing else. */
export function createEgoricReadonlyApp(options: EgoricReadonlyAppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.get('/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true, profile: 'egoric-readonly' });
  });

  const repository = new BusinessMemoryRepository(options.knex ?? db);
  const brief = new EgoricBriefService(repository);
  const auth = resolveIntegrationReadAuthConfig(options.integrationReadAuth);
  app.use('/v1', authenticateIntegrationRead(auth));
  app.use('/v1/tenants', createEgoricBriefRouter(brief));

  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof EgoricBriefError && error.status < 500) {
      res.status(error.status).json({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof BusinessMemoryError) {
      console.error('[egoric-readonly] business memory request failed', { code: error.code });
    } else {
      console.error('[egoric-readonly] request failed', { code: 'internal_error' });
    }
    res.status(500).json({ error: 'internal error', code: 'internal_error' });
  });

  return app;
}
