# Codex QA Review: Milestone #10 MVP Launch & Client Onboarding

Review target: current Milestone #10 implementation from `CHECKLIST.md`.

## Verdict: FAIL

Verified locally:

- `npm run typecheck` passed.
- `npm test` passed: 159/159 tests.
- `npm run db:smoke:pg` was invoked and skipped because no PostgreSQL connection is configured (`DATABASE_URL` or `PGHOST`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`).

Code-level evidence reviewed:

- Admin onboarding route is implemented in `src/http/routes/onboarding.ts`.
- Tenant provisioning logic is implemented in `src/services/onboardingService.ts`.
- Public readiness route is implemented in `src/http/routes/health.ts` and mounted before auth in `src/http/app.ts`.
- Pilot/support runbook exists at `docs/PILOT_RUNBOOK.md`.
- Onboarding and readiness route tests are included in `package.json` and pass.

## Critical Issues

None.

## High-Priority Issues

1. **FAIL: M10 requires a live pilot tenant verified on a deployed system, but the available changes only prove local/in-memory onboarding.**  
   Evidence: `CHECKLIST.md:182` requires the "First live pilot client or internal tenant created and verified on the deployed system", and `CHECKLIST.md:188` requires the pilot tenant to create campaigns, leads, tasks, and receive briefs/recommendations "on the live instance". `ROADMAP.md:81` also states that M10 gates on a live deployment with PostgreSQL and the current stack validated in a real hosting environment. The current verification tests boot a local ephemeral app against the injected test database at `src/__tests__/onboardingRoutes.test.ts:23`-`src/__tests__/onboardingRoutes.test.ts:31`; they do not exercise a deployed base URL. The runbook still presents manual placeholder verification commands at `docs/PILOT_RUNBOOK.md:83`-`docs/PILOT_RUNBOOK.md:89`, and states at `docs/PILOT_RUNBOOK.md:92`-`docs/PILOT_RUNBOOK.md:93` that those live-instance checks are what meet the M10 launch criterion. No repo artifact records a live `BASE_URL`, pilot `client_id`, `/ready` result, or live campaign/lead/task/brief/recommendation verification.

2. **FAIL: The PostgreSQL deployment gate was not executed against a real PostgreSQL instance.**  
   Evidence: `docs/PILOT_RUNBOOK.md:30`-`docs/PILOT_RUNBOOK.md:31` says `npm run db:smoke:pg` is the deployment gate and must pass against the real PostgreSQL instance before exposing the service. The smoke script is explicitly env-gated and skips without PostgreSQL configuration at `src/db/pgSmoke.ts:35`-`src/db/pgSmoke.ts:39`. Local verification hit that skip path, so the current review cannot confirm the production database lifecycle for M10.

## Nice-to-Have Improvements

1. Add a repeatable pilot verification script that accepts `BASE_URL`, admin credentials, and a pilot payload, then performs the full M10 live-instance flow: `/ready`, onboarding, tenant-token auth, campaign create, lead create, task create/transition, brief read, and recommendations read.

2. Tighten `/ready` to validate the canonical funnel stage keys/positions, not only the count. Current code marks readiness true when `present === FUNNEL_STAGES.length` at `src/http/routes/health.ts:34`-`src/http/routes/health.ts:38`, so a drifted table with nine noncanonical rows could pass readiness.

3. Consider normalizing client emails and adding a database-level uniqueness guard before broader onboarding. Current schema indexes email but does not make it unique at `src/db/migrations/20260609120000_init_crm_schema.ts:32`-`src/db/migrations/20260609120000_init_crm_schema.ts:39`; onboarding performs an application-level exact-match duplicate check at `src/services/onboardingService.ts:58`-`src/services/onboardingService.ts:60`.
