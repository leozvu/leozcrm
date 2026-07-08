# M10 Deployment Gate — Evidence Log

Chronological record of the deployment-gate verifications. See
`docs/PILOT_RUNBOOK.md` for the procedures and `ROADMAP.md` for gate status.

---

## Blocker 1 — PostgreSQL smoke (real managed instance)

```
Date (UTC):        2026-06 (see CHECKLIST.md §14 for the original record)
Postgres target:   Supabase managed PostgreSQL via Session Pooler (sslmode=require)
Command:           npm run db:smoke:pg (DATABASE_URL set inline, credentials redacted)
Result:            PASS
Key output:        "seeded 9 funnel stages, 9 present."
                   "task lifecycle + monotonic audit seq verified."
                   "Postgres migrate/seed/rollback smoke PASSED."
```

Status: **PASS** (re-confirmed 2026-07-08, below, including the new
`20260708120000_unique_client_email` migration).

## Blocker 2 — Full pilot flow on production mode + real PostgreSQL

Executed 2026-07-08 with the repeatable verifier (`npm run verify:pilot`,
added per Codex review nice-to-have #1). Environment: PostgreSQL 16.13
(dedicated instance), app booted with `NODE_ENV=production`, `DATABASE_URL`,
`AUTH_SECRET`, `ADMIN_API_KEY` — the exact production code path (pg driver,
production knexfile branch, prod seed mode, fail-loud auth).

```
Postgres smoke:  npm run db:smoke:pg → PASS
                 "seeded 9 funnel stages, 9 present."
                 "task lifecycle + monotonic audit seq verified."
                 "Postgres migrate/seed/rollback smoke PASSED."

Bring-up:        npm run migrate → 3 migrations applied (incl. unique_client_email)
                 npm run seed    → "Production environment — skipping demo data"
                                   "Funnel stages verified: 9/9 canonical stages present."

--- Pilot verification evidence -------------------------------
Date (UTC):      2026-07-08T16:47:02.729Z
Base URL:        http://127.0.0.1:3789   (production-mode instance, real PG 16)
Pilot client_id: 675692c8-350f-40d3-b33a-af22b4305fe0
/ready result:   {"ok":true,"checks":{"db":"ok","funnel_stages":9,"funnel_ready":true}}
Steps:           15 passed, 0 failed
  [PASS] GET /health — HTTP 200
  [PASS] GET /ready — HTTP 200 {"db":"ok","funnel_stages":9,"funnel_ready":true}
  [PASS] POST /onboarding (admin) — HTTP 201 client_id=675692c8-350f-40d3-b33a-af22b4305fe0
  [PASS] GET /clients/:id (tenant token) — HTTP 200
  [PASS] GET /funnel-stages — HTTP 200, 9 stages
  [PASS] POST /campaigns — HTTP 201
  [PASS] POST /leads — HTTP 201
  [PASS] POST /leads/:id/move — HTTP 200
  [PASS] POST /tasks — HTTP 201
  [PASS] POST /tasks/:id/status — HTTP 200
  [PASS] GET /tasks/:id/events (audit trail) — HTTP 200, 2 events
  [PASS] GET /metrics/funnel — HTTP 200
  [PASS] GET /brief — HTTP 200
  [PASS] GET /recommendations — HTTP 200 advisory_only=true
  [PASS] GET /integrations — HTTP 200
----------------------------------------------------------------
LIVE PILOT VERIFICATION PASSED.
```

Structured request logging captured one JSON line per request during the run
(method, path, status, duration, tenant attribution — `null` for public
probes, `admin` for onboarding, the client id for tenant calls).

### Honest scope statement

This run proves the **entire production code path against a real PostgreSQL
16 instance**: production knexfile branch + pg driver, production seed mode
(no demo data), fail-loud auth, migrations up AND rolled back, and the full
launch-criterion tenant flow over real HTTP. What it does not prove is a
*public* hosting environment (DNS/TLS/managed uptime) — the instance ran in
the development container.

**Remaining to close the gate** (ops, not code — one command each):

```bash
AUTH_SECRET=… ADMIN_API_KEY=… docker compose up -d       # or any Node host
npm run verify:pilot -- --base-url https://<public-url> --admin-key $ADMIN_API_KEY
```

Paste the verifier's evidence block below when executed on the public host:

```
(pending public-host run)
```
