import { Request, Router } from 'express';
import { asyncHandler } from '../asyncHandler';
import { TaskService, taskService } from '../../services/taskService';
import { enforceClientScope, scopeAllows } from '../auth';

/**
 * Task routes (Milestone #9), tenant-scoped and behind the global auth
 * middleware — same patterns as the leads/campaigns routes:
 *   - explicit client id (list filter / create body) → 403 on mismatch,
 *   - resource lookups → 404 on cross-tenant (existence not leaked).
 *
 * Status changes go through a dedicated transition endpoint so they are
 * lifecycle-validated and audited; PATCH only edits non-status fields.
 *
 *   GET    /tasks                list (auto-scoped to the caller's client)
 *   GET    /tasks/:id            one task
 *   POST   /tasks                create
 *   PATCH  /tasks/:id            edit non-status fields
 *   POST   /tasks/:id/status     transition status ({ status, note? })
 *   GET    /tasks/:id/events     status-change audit trail (read-only)
 *   DELETE /tasks/:id            delete
 *
 * Built by a factory so the service can be injected for tests; the default binds
 * to the process-wide singleton.
 */
export interface TasksRouterDeps {
  tasks: TaskService;
}

/** The audit actor for the authenticated caller: 'admin' or the tenant id. */
function actorOf(req: Request): string | null {
  if (!req.auth) return null;
  return req.auth.admin ? 'admin' : req.auth.clientId;
}

export function createTasksRouter(deps: TasksRouterDeps = { tasks: taskService }): Router {
  const { tasks } = deps;
  const router = Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const auth = req.auth!;
      const requested = typeof req.query.clientId === 'string' ? req.query.clientId : undefined;
      if (auth.admin) {
        if (!requested) {
          return res.status(400).json({ error: 'clientId query parameter is required', code: 'client_required' });
        }
        return res.json(await tasks.listByClient(requested));
      }
      // Client-scoped: only ever its own tasks.
      if (requested && requested !== auth.clientId) {
        return res.status(403).json({ error: 'forbidden: client scope mismatch', code: 'forbidden_tenant' });
      }
      res.json(await tasks.listByClient(auth.clientId!));
    }),
  );

  router.get(
    '/:id',
    asyncHandler(async (req, res) => {
      const task = await tasks.getById(req.params.id);
      if (!task || !scopeAllows(req, task.client_id)) {
        return res.status(404).json({ error: 'task not found' });
      }
      res.json(task);
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const { clientId, title } = req.body ?? {};
      if (!clientId || !title) {
        return res.status(400).json({ error: 'clientId and title are required', code: 'invalid_task' });
      }
      if (!enforceClientScope(req, res, clientId)) return;
      const { description, status, priority, assignee, source_recommendation_code, due_at } = req.body ?? {};
      const task = await tasks.create(
        clientId,
        { title, description, status, priority, assignee, source_recommendation_code, due_at },
        actorOf(req),
      );
      res.status(201).json(task);
    }),
  );

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      const existing = await tasks.getById(req.params.id);
      if (!existing || !scopeAllows(req, existing.client_id)) {
        return res.status(404).json({ error: 'task not found' });
      }
      // Status is changed only via the transition endpoint (so it is lifecycle-
      // validated and audited) — reject it here explicitly.
      if ((req.body ?? {}).status !== undefined) {
        return res.status(400).json({ error: 'use the status-transition endpoint to change status', code: 'status_change_not_allowed' });
      }
      const { title, description, priority, assignee, source_recommendation_code, due_at } = req.body ?? {};
      const updated = await tasks.updateFields(req.params.id, {
        title, description, priority, assignee, source_recommendation_code, due_at,
      });
      if (!updated) return res.status(404).json({ error: 'task not found' });
      res.json(updated);
    }),
  );

  router.post(
    '/:id/status',
    asyncHandler(async (req, res) => {
      const existing = await tasks.getById(req.params.id);
      if (!existing || !scopeAllows(req, existing.client_id)) {
        return res.status(404).json({ error: 'task not found' });
      }
      const { status, note } = req.body ?? {};
      if (!status) {
        return res.status(400).json({ error: 'status is required', code: 'invalid_status' });
      }
      const updated = await tasks.transition(existing, status, { actor: actorOf(req), note });
      res.json(updated);
    }),
  );

  router.get(
    '/:id/events',
    asyncHandler(async (req, res) => {
      const existing = await tasks.getById(req.params.id);
      if (!existing || !scopeAllows(req, existing.client_id)) {
        return res.status(404).json({ error: 'task not found' });
      }
      res.json(await tasks.statusEvents(req.params.id));
    }),
  );

  router.delete(
    '/:id',
    asyncHandler(async (req, res) => {
      const existing = await tasks.getById(req.params.id);
      if (!existing || !scopeAllows(req, existing.client_id)) {
        return res.status(404).json({ error: 'task not found' });
      }
      const ok = await tasks.remove(req.params.id);
      if (!ok) return res.status(404).json({ error: 'task not found' });
      res.status(204).send();
    }),
  );

  return router;
}

/** Default router bound to the process-wide singleton service. */
export const tasksRouter = createTasksRouter();
