import express, { NextFunction, Request, Response } from 'express';
import { createClientsRouter, clientsRouter } from './routes/clients';
import { createCampaignsRouter, campaignsRouter } from './routes/campaigns';
import { createLeadsRouter, leadsRouter } from './routes/leads';
import { createFunnelStagesRouter, funnelStagesRouter } from './routes/funnelStages';
import { createMetricsRouter, metricsRouter } from './routes/metrics';
import { createBriefRouter, briefRouter } from './routes/brief';
import { createRecommendationsRouter, recommendationsRouter } from './routes/recommendations';
import { createDashboardRouter, dashboardRouter } from './routes/dashboard';
import { createTasksRouter, tasksRouter } from './routes/tasks';
import { createOnboardingRouter } from './routes/onboarding';
import { createReadinessRouter } from './routes/health';
import { integrationsRouter } from './routes/integrations';
import { createEmailPublishRouter } from './routes/emailPublish';
import { EmailPublishService, buildEmailPublisherFromEnv } from '../integrations/email/emailPublishService';
import { MetricsRepository } from '../repositories/metricsRepository';
import { ClientRepository } from '../repositories/clientRepository';
import { CampaignRepository } from '../repositories/campaignRepository';
import { LeadRepository } from '../repositories/leadRepository';
import { FunnelStageRepository } from '../repositories/funnelStageRepository';
import { TaskRepository } from '../repositories/taskRepository';
import { BriefService } from '../services/briefService';
import { RecommendationService } from '../services/recommendationService';
import { DashboardService } from '../services/dashboardService';
import { TaskService } from '../services/taskService';
import { OnboardingService, onboardingService } from '../services/onboardingService';
import { ValidationError } from '../errors';
import { authenticate, resolveAuthConfig, AuthConfig } from './auth';
import { db, type Knex } from '../db/knex';

export interface CreateAppOptions {
  /**
   * Optional Knex connection for the read-only KPI / brief / recommendation
   * layers. When provided, those routes are bound to repositories on this
   * connection — used by the HTTP route tests to point the endpoints at a
   * seeded in-memory database. Omitted in production, where the routes use the
   * process-wide singletons.
   */
  knex?: Knex;
  /**
   * Authentication config (signing secret + optional admin key). Defaults to the
   * environment (`AUTH_SECRET` / `ADMIN_API_KEY`). With neither configured the
   * app fails closed — every protected request is 401 — rather than allowing all.
   */
  auth?: AuthConfig;
  /**
   * Email publisher (Resend, M8A). Defaults to one built from the environment
   * (`RESEND_API_KEY` / `EMAIL_*`). Tests inject one with a sandbox transport and
   * deterministic clock so no real email is sent.
   */
  emailPublisher?: EmailPublishService;
}

/** Detect raw DB constraint violations (SQLite + Postgres) as a 500 backstop. */
function isConstraintViolation(err: any): boolean {
  const code = typeof err?.code === 'string' ? err.code : '';
  return code.startsWith('SQLITE_CONSTRAINT') || /^23\d{3}$/.test(code); // pg 23xxx
}

/**
 * Express app wiring the four CRUD resources. Kept framework-light and
 * stateless — auth, validation middleware, and rate limiting are deliberately
 * out of scope for this data-layer foundation (see Codex review list).
 */
export function createApp(options: CreateAppOptions = {}) {
  const app = express();
  app.use(express.json());

  // Public probes (no auth) — for load balancers / uptime monitors:
  //   /health  liveness  — the process is up.
  //   /ready   readiness — DB reachable AND funnel stages seeded (M10).
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/ready', createReadinessRouter({ knex: options.knex ?? db }));

  // Auth + tenant isolation (M7). Mounted before every data route so there is no
  // unauthenticated bypass path; each route then enforces its own client scope.
  const authCfg = resolveAuthConfig(options.auth);
  app.use(authenticate(authCfg));

  // Integration registry (Milestone #6). Read-only adapter metadata. Mounted
  // before the email publish route so the more specific path wins, and still
  // behind auth (above).
  //
  // Live email publishing (Milestone #8A): an explicitly-invoked, tenant-scoped,
  // guardrailed POST surface. Social/AI media remain metadata-only placeholders —
  // there is no publish surface for them.
  const emailPublisher = options.emailPublisher ?? buildEmailPublisherFromEnv();
  app.use('/integrations/email', createEmailPublishRouter({ publisher: emailPublisher }));
  app.use('/integrations', integrationsRouter);

  // All DB-backed routes. When a connection is injected (route tests), every
  // router is bound to repositories/services on it; otherwise the process-wide
  // singletons are used. The chain is built once: brief reads the KPI repo,
  // recommendations read the brief, and the dashboard composes all of them plus
  // the lead/stage repositories into a single read-only HTML surface.
  if (options.knex) {
    const metrics = new MetricsRepository(options.knex);
    const clients = new ClientRepository(options.knex);
    const leads = new LeadRepository(options.knex);
    const stages = new FunnelStageRepository(options.knex);
    const campaigns = new CampaignRepository(options.knex);
    const brief = new BriefService(metrics);
    const recommendations = new RecommendationService(brief);
    const dashboard = new DashboardService({ metrics, brief, recommendations, leads, stages, clients });
    const tasks = new TaskService(new TaskRepository(options.knex));
    const onboarding = new OnboardingService(clients, stages);
    app.use('/funnel-stages', createFunnelStagesRouter({ stages }));
    app.use('/clients', createClientsRouter({ clients }));
    app.use('/campaigns', createCampaignsRouter({ campaigns }));
    app.use('/leads', createLeadsRouter({ leads }));
    app.use('/metrics', createMetricsRouter({ metrics, clients }));
    app.use('/brief', createBriefRouter({ brief, clients }));
    app.use('/recommendations', createRecommendationsRouter({ recommendations, clients }));
    app.use('/dashboard', createDashboardRouter({ dashboard, clients }));
    app.use('/tasks', createTasksRouter({ tasks }));
    app.use('/onboarding', createOnboardingRouter({ onboarding, secret: authCfg.secret }));
  } else {
    app.use('/funnel-stages', funnelStagesRouter);
    app.use('/clients', clientsRouter);
    app.use('/campaigns', campaignsRouter);
    app.use('/leads', leadsRouter);
    app.use('/metrics', metricsRouter);
    app.use('/brief', briefRouter);
    app.use('/recommendations', recommendationsRouter);
    app.use('/dashboard', dashboardRouter);
    app.use('/tasks', tasksRouter);
    app.use('/onboarding', createOnboardingRouter({ onboarding: onboardingService, secret: authCfg.secret }));
  }

  // Centralized error handler. Bad input (unknown/conflicting references) is a
  // client error, not a server fault — so it must never become a 500.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ValidationError) {
      return res.status(err.status).json({ error: err.message, code: err.code });
    }
    // Backstop: any DB constraint violation that slipped past validation.
    if (isConstraintViolation(err)) {
      return res.status(409).json({ error: 'constraint violation', code: 'constraint_violation' });
    }
    console.error(err);
    res.status(500).json({ error: 'internal error', detail: err.message });
  });

  return app;
}
