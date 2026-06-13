# Codex QA Review: Milestone #9 Task Engine

Review target: current Milestone #9 implementation from `CHECKLIST.md`.

## Verdict: PASS

Verified locally:

- `npm run typecheck` passed.
- `npm test` passed: 149/149 tests.
- `npm run db:smoke:pg` was invoked and skipped because no PostgreSQL connection is configured (`DATABASE_URL` or `PGHOST`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`).

Evidence reviewed:

- Task schema and audit trail tables exist in `src/db/migrations/20260611120000_create_tasks.ts`.
- Task CRUD and lifecycle enforcement are implemented through `src/http/routes/tasks.ts`, `src/services/taskService.ts`, and `src/repositories/taskRepository.ts`.
- Prior malformed-input concern is addressed by UUID-shape validation before client lookup in `src/repositories/taskRepository.ts:83`-`src/repositories/taskRepository.ts:90` and audit-note validation before status writes in `src/repositories/taskRepository.ts:164`-`src/repositories/taskRepository.ts:168`.
- Prior audit-order concern is addressed by `seq` in `src/db/migrations/20260611120000_create_tasks.ts:48`-`src/db/migrations/20260611120000_create_tasks.ts:58`, initial event `seq: 1` in `src/repositories/taskRepository.ts:117`-`src/repositories/taskRepository.ts:129`, transition append sequencing in `src/repositories/taskRepository.ts:171`-`src/repositories/taskRepository.ts:190`, and `listStatusEvents` ordering by `seq` in `src/repositories/taskRepository.ts:202`-`src/repositories/taskRepository.ts:205`.
- Route coverage now includes cross-tenant PATCH/status mutation rejection in `src/__tests__/tasksRoutes.test.ts:165`-`src/__tests__/tasksRoutes.test.ts:178`.
- PostgreSQL smoke coverage path now includes task migration, lifecycle transition, monotonic audit sequence, and rollback checks in `src/db/pgSmoke.ts:43`-`src/db/pgSmoke.ts:86`.

## Critical Issues

None.

## High-Priority Issues

None.

## Nice-to-Have Improvements

1. Run `npm run db:smoke:pg` against a real PostgreSQL database before the deployment gate. The smoke path is present, but local verification skipped because PostgreSQL connection environment variables are not configured.

2. Add a route contract test for malformed admin list filters, e.g. `GET /tasks?clientId=not-a-uuid`. Current evidence: `src/http/routes/tasks.ts:44`-`src/http/routes/tasks.ts:50` accepts any string query value for admin list, and `src/repositories/taskRepository.ts:42`-`src/repositories/taskRepository.ts:43` queries it directly. This does not currently cause a 500 or tenant leak, but a 400 would be more consistent with task-create validation.
