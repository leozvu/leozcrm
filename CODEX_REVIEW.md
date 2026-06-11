# Codex QA Review: CRM Data-Layer Readiness

Review target: current CRM data-layer foundation only.

## Verdict: PASS

The CRM data-layer foundation is ready for the next internal layer of work. The previous blockers around bad foreign-key errors and cross-client campaign attribution have been addressed in the current repo state.

Local verification:

- `npm run typecheck` passed.
- `npm test` passed after rerunning with permission for Node's test runner to spawn its worker process: 11/11 contract tests passed.
- `npm run db:reset` passed: rollback -> migrate -> seed.
- `npm run migrate:status` shows `20260609120000_init_crm_schema.ts` applied and no pending migrations.

## Remaining Blockers

None for the CRM data-layer foundation.

The data contract now has schema, rollback, seed verification, repositories, HTTP routes, package scripts, and automated tests covering the critical integrity paths.

## Critical Fixes

None remaining for this milestone.

Completed critical items:

1. **Bad foreign-key errors no longer need to surface as 500s.**  
   `ValidationError` carries explicit client-error status codes, repositories validate expected bad references before insert/update, and the Express error handler has a DB-constraint backstop that returns `409` instead of `500`.

2. **`lead.client_id` / `campaign.client_id` consistency is enforced.**  
   The migration adds unique `(campaigns.client_id, campaigns.id)` plus composite FK `leads(client_id, campaign_id) -> campaigns(client_id, id)`. The repository also rejects cross-client attribution with `409 campaign_client_mismatch`.

3. **The contract is tested.**  
   `src/__tests__/contract.test.ts` verifies bad FK validation, repository-level mismatch rejection, DB-level composite-FK rejection, nullable `campaign_id`, campaign deletion nulling leads, funnel counts, and rollback.

## High-Priority Fixes

1. **Harden repository update semantics for owner reassignment.**  
   The API routes currently do not expose `lead.client_id` or `campaign.client_id` changes, which is good. But the generic repository update path still makes those fields technically writable if called directly from future service code. Before building agent/service workflows that mutate ownership, either explicitly disallow owner reassignment in repositories or add full validation for `client_id` changes.

2. **Add HTTP-level tests for validation status codes.**  
   Current tests prove repository and DB behavior. Add route tests for `POST /campaigns`, `POST /leads`, and `POST /leads/:id/move` so the API contract explicitly locks in `400` for unknown references and `409` for cross-client attribution.

3. **Run a Postgres smoke test before production deployment.**  
   The migration is written with Knex's portable schema builder and passes SQLite verification, but the composite FK plus `ON DELETE SET NULL` behavior should be smoke-tested against Postgres before real production data.

## What Can Wait

- DB-level `CHECK` constraints for `status`, `channel`, and `score` ranges. TypeScript conventions are acceptable for the internal data-layer milestone.
- Stage transition rules and transition history. The current `funnel_stage_id` plus `entered_stage_at` model is enough for a first dashboard; add `lead_stage_events` when velocity/conversion analytics are needed.
- Auth, access control, rate limiting, pagination hardening, and richer request validation. These are necessary before external users or autonomous agents can mutate production data, but they are outside this CRM data-layer foundation.
- Full dashboard, AI brain, integrations, and agent workforce behavior. The CRM foundation can support those next, but they should remain separate QA scopes.
