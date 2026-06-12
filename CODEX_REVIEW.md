# Codex QA Review: Milestone #9 Task Engine

Review target: current Milestone #9 implementation from `CHECKLIST.md`.

## Verdict: FAIL

Verified locally:

- `npm run typecheck` passed.
- `npm test` passed: 142/142 tests.

## Critical Issues

None.

## High-Priority Issues

1. **Malformed task input is not fully rejected at the HTTP/repository boundary before DB access.**  
   Evidence: `src/http/routes/tasks.ts:73`-`src/http/routes/tasks.ts:77` only checks that `clientId` and `title` are truthy before calling `enforceClientScope`; for an admin caller, `enforceClientScope` allows any `clientId` value. `src/repositories/taskRepository.ts:81`-`src/repositories/taskRepository.ts:87` then checks only that `client_id` is truthy before passing it into `getRow(TABLES.clients, data.client_id)`, with no `typeof` or UUID-shape validation. That leaves malformed non-string `clientId` values to reach the DB layer instead of returning a clean task validation error. The status route has the same pattern for audit notes: `src/http/routes/tasks.ts:116`-`src/http/routes/tasks.ts:120` forwards `note` directly, and `src/repositories/taskRepository.ts:162`-`src/repositories/taskRepository.ts:170` inserts `meta.note` without type/length validation.

2. **Status audit trail ordering is not guaranteed when events share the same timestamp.**  
   Evidence: the migration defines only a UUID primary key and `created_at` timestamp for `task_status_events` at `src/db/migrations/20260611120000_create_tasks.ts:38`-`src/db/migrations/20260611120000_create_tasks.ts:48`; there is no monotonic sequence, revision number, or composite order key. `TaskRepository.listStatusEvents` orders only by `created_at` at `src/repositories/taskRepository.ts:176`-`src/repositories/taskRepository.ts:179`. Because timestamps are generated in app code via `BaseRepository.now()` at `src/repositories/baseRepository.ts:21`-`src/repositories/baseRepository.ts:22`, rapid create/transition events can share the same millisecond, making audit order dependent on database tie-breaking rather than an explicit rule.

## Nice-to-Have Improvements

1. Add route tests for cross-tenant `PATCH /tasks/:id` and `POST /tasks/:id/status`, matching the read/events/delete isolation tests.

2. Add a PostgreSQL smoke path that includes the new task migration and task repository lifecycle, so M9 parity is proven outside SQLite.
