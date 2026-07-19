# Egoric Integration — Execution Plan (v2, CEO-approved with modifications)

> **Status:** APPROVED PLAN. Implementation tasks NOT yet created — a separate
> CEO go signal is required before any implementation ticket is cut.
> Per GOVERNANCE.md, plan approval does not authorize production enablement,
> credential creation, or data mutation.

**Source contract:** `docs/EGORIC_INTEGRATION.md` (canonical)
**Decision record:** DECISIONS.md 2026-07-18 entries
**Prepared by:** Hermes (PM) — 2026-07-18 (v2)

**CEO modifications applied (2026-07-18):**
1. Calendar dates removed; every milestone exits on evidence gates only.
2. Deployment (production shadow) moved AFTER successful local integration.
3. Sprint 1 scope pinned to: Egoric snapshot → LeozOps ingestion → CEO Brief.
   Nothing else.
4. Sprint 2 must not start until Sprint 1 is formally accepted.
5. No implementation tasks are created until CEO approval of the task cut.

---

## 1. Goal

Ship the smallest safe pilot: Egoric exposes one feature-flagged, GET-only,
de-identified lead-snapshot endpoint; LeozOps (separately deployed, own DB,
own credentials) ingests it and produces one company-wide CEO Brief using
Egoric's native funnel (`new/contacted/proposal/negotiation` + `won/lost`).
Everything else (recommendations surface, metrics routes, polling cadence
hardening, production shadow) is Sprint 2+, gated on Sprint 1 acceptance.

## 2. Context and assumptions

- Egoric is the sole operational system of record; LeozOps is read-only
  intelligence. Supersedes the standalone M10 CRM launch path (paused).
- Two repositories: Egoric (export endpoint) and LeozOps (ingestion +
  brief). Separate commits/PRs, separate review and rollback boundaries.
- LeozOps stack unchanged: TypeScript strict, Express 4, Knex 3, SQLite
  dev / Postgres prod, node:test via tsx, repository → service → route
  layering. No new frameworks without a DECISIONS.md entry.
- Egoric leads have no Client FK → pilot is company-wide; per-client
  attribution labelled "unavailable".
- Non-negotiable boundaries (contract §2) apply to every task. Any
  conflict = stop, escalate to Leoz.

## 3. Sprint structure (evidence-gated, no dates)

### SPRINT 1 — Snapshot → Ingestion → CEO Brief (and nothing else)

Scope rule: if a task is not strictly required to produce a correct,
provenance-stamped CEO Brief from a real Egoric snapshot in a local/test
environment, it is NOT in Sprint 1.

**S1.A — Egoric snapshot endpoint (Egoric repo)**

Deliverables:
1. Pure contract/projector module for `egoric_sales_v1`: field allowlist
   (external_id, stage, source, estimated_value, created_at,
   expected_close_at, owner_assigned), canonical serialization, SHA-256
   content hash excluding `generated_at`. No Prisma entity changes.
2. `LEOZOPS_READ` service capability — not an employee role; absent from
   all generic resource permission lists.
3. Feature-flagged `GET /api/integrations/leozops/v1/lead-snapshot`
   recognizing only `LEOZOPS_READ`; other methods 405; unknown contract
   version fails closed.
4. ETag/304, `Cache-Control: private, no-cache`, correlation ID, rate
   limit, non-PII audit logs.

Evidence gate G1 (Codex QA, test instance only — ALL must pass):
- Existing Egoric tests remain green.
- Auth matrix: missing/bad key → 401; `LEOZOPS_READ` works only on the
  snapshot GET; 403 on all generic GET/POST/PUT/PATCH/DELETE APIs.
- Recursive PII-denial test proves prohibited fields absent.
- Deterministic hash: identical facts → identical snapshot_id/ETag;
  matching `If-None-Match` → 304.
- Method-denial: non-GET → 405.
- No production flag or key enabled.

**S1.B — LeozOps ingestion (this repo)**

Deliverables:
1. Migration `src/db/migrations/<ts>_create_integration_tables.ts`:
   `tenants`, `source_connections`, immutable `source_snapshots`
   (unique `(source_system, tenant_key, snapshot_id)`), idempotent
   `intelligence_runs` (unique `(tenant_key, snapshot_id, engine_version,
   as_of)`). Reversible; dialect-portable schema builder only.
2. `src/domain/tenant.ts`, `src/domain/snapshot.ts`, TABLES additions in
   `src/domain/types.ts`.
3. Native funnel `src/domain/egoricFunnel.ts` (`egoric_sales_v1`;
   `historical_transitions_available: false`). Never reuses the
   nine-stage funnel.
4. Source-neutral intelligence input interface + Egoric adapter
   `src/integrations/egoric/egoricSourceAdapter.ts` (injectable fetch
   transport, ETag-aware single fetch; GET only by construction).
5. Minimal fetch-and-store service: fetch snapshot → validate schema
   version (fail closed) → store immutably → idempotent on replay.
   (Scheduled 15-min polling loop, circuit breaker, and nightly
   reconciliation cadence are Sprint 2; Sprint 1 needs a correct
   on-demand/manually-triggered sync only.)

Evidence gate G2 (Codex QA — ALL must pass):
- `npm run typecheck` clean; all existing 159 LeozOps tests green.
- New tests green: contract parsing, schema-version fail-closed,
  idempotency (replaying the same snapshot → exactly one stored snapshot,
  one run), tenant scoping.
- No-write-egress test: network instrumentation proves LeozOps never
  sends POST/PUT/PATCH/DELETE to Egoric.

**S1.C — CEO Brief from snapshot (this repo)**

Deliverables:
1. Brief generation from a stored snapshot using the native Egoric funnel;
   deterministic for a fixed snapshot + `asOf`.
2. Every output carries `source_snapshot_id`, `formula_version`,
   `generated_at`, `data_freshness`, `funnel_definition`, and explicit
   limitations ("no historical conversion", "client attribution
   unavailable").
3. One read-only surface: `GET /v1/tenants/{tenantKey}/brief?asOf=…`.
   (Metrics and recommendations routes are Sprint 2.)
4. `INTEGRATION_MODE=egoric-readonly` profile: CRM mutations, onboarding,
   tasks, and email publishing NOT mounted; those routes → 404/405.

Evidence gate G3 (Codex QA — ALL must pass):
- Deterministic brief tests: same snapshot + asOf → identical brief;
  brief numbers exactly match stored snapshot facts.
- Native-funnel semantics: `lost` is an outcome, never a passed active
  stage; no historical-conversion claim appears in output.
- Profile-mode route-denial tests: CRM/task/onboarding/email routes
  return 404/405 in integration mode; brief route works.
- Full suite + typecheck green.

**S1.D — Local end-to-end integration (both repos, test instance)**

Deliverables:
1. LeozOps in `egoric-readonly` profile pulls a real snapshot from the
   Egoric TEST instance and produces a CEO Brief.
2. Count reconciliation: stage/source/total counts in the brief match
   Egoric test-instance data exactly.
3. Feature-flag off + key revocation demonstrably stop access.

Evidence gate G4 = **SPRINT 1 ACCEPTANCE** (CEO sign-off required):
- End-to-end evidence bundle recorded in-repo: snapshot_id, ETag/304
  behavior, reconciliation table, brief output, no-mutation proof,
  flag/revocation drill result.
- Codex documents PASS in CODEX_REVIEW.md.
- Leoz reviews the actual brief output and formally accepts Sprint 1.

**HARD STOP.** No Sprint 2 work of any kind until G4 acceptance is
recorded in DECISIONS.md.

### SPRINT 2 — Hardening + deployment (only after Sprint 1 accepted)

Indicative scope (to be re-planned and re-approved at G4):
- Scheduled 15-min ETag polling, retry/backoff/jitter, Retry-After,
  401/403 disable-and-alert, circuit breaker, nightly reconciliation.
- Metrics + recommendations read routes with full provenance.
- Structured connector health/audit metrics, alerting per contract §9,
  operational runbooks (key rotation, stale data, schema mismatch,
  rollback, snapshot replay).
- **Deployment comes here, after local integration success:** hosting
  target decision, LeozOps deployed with own Postgres + secrets,
  readiness/canary, then the ten-business-day production shadow
  (contract §11 acceptance criteria) and the release decision.

Evidence gates: all 12 Codex release gates (contract §15) before any
production key/flag; contract §11 pilot criteria for the shadow; CEO
recorded go/extend/revoke decision to close.

## 4. Files likely to change (LeozOps repo, Sprint 1)

- New: `src/domain/tenant.ts`, `src/domain/snapshot.ts`,
  `src/domain/egoricFunnel.ts`, `src/integrations/egoric/*`,
  `src/services/snapshotSyncService.ts` (minimal, on-demand),
  `src/repositories/snapshotRepository.ts` (+ tenant/source-connection/
  intelligence-run repos), `src/http/routes/tenantIntelligence.ts`
  (brief only), `src/db/migrations/<ts>_create_integration_tables.ts`,
  `src/__tests__/egoric*.test.ts`
- Modified: `src/domain/types.ts`, `src/http/app.ts`, `src/server.ts`
  (INTEGRATION_MODE), `package.json` (test list), `.env.example`
  (EGORIC_* vars), ROADMAP.md, CHECKLIST.md, DECISIONS.md,
  CODEX_REVIEW.md (at gates)
- Untouched: existing CRM/task/email/onboarding code (historical
  capability; excluded from the integration profile, not deleted)

## 5. Risks (top of register, unchanged)

1. Write-capable key → dedicated `LEOZOPS_READ` + denial tests (G1).
2. Shared DB access → independent LeozOps DB/credentials always.
3. Tenant/Client semantic corruption → new `tenant` + `source_connection`.
4. Fabricated funnel history → native funnel + explicit limitations (G3).
5. Production regression → deployment deferred to Sprint 2, behind G4 and
   the 12 release gates.

## 6. Open questions for Leoz

- Q1 — Standalone M10 blocker-2 disposition: reclassify as
  PAUSED/superseded in CHECKLIST/ROADMAP? (Postgres smoke PASS stands;
  hosting decision now needed in Sprint 2, not before.)
- Q2 — Egoric repo + test instance access for Claude Code at Sprint 1
  start.
- Q3 — Where does the CEO Brief get read during S1.D review (raw API
  response acceptable, or minimal rendering needed)?

## 7. Process state

- Plan v2: APPROVED by Leoz with the five modifications above.
- Implementation tasks: NOT created. Hermes will cut S1.A and S1.B/C
  tickets (separate repos, separate PRs) only on explicit CEO go.
