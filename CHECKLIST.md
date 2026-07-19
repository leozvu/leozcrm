LEOZOPS AI — PROJECT CHECKLIST
===============================

0. CURRENT APPROVED DIRECTION — LEOZOPS INTELLIGENCE INTEGRATION (DECISION-002)
----------------------------------------------------------------------------
Status: APPROVED (DECISION-002, DECISIONS.md 2026-07-18) / IMPLEMENTATION TASKS NOT YET CREATED
Canonical contract: docs/EGORIC_INTEGRATION.md
Execution plan: .hermes/plans/2026-07-18_egoric-integration-execution-plan.md

Egoric is the operational system of record. LeozOps is a read-only
intelligence platform. The historical milestones below (sections 1-15,
"Legacy Foundation") describe how the existing LeozOps codebase was built,
with completion evidence intact. They do not authorize deploying it as a
second operational CRM. Every future task references this section.

SPRINT 1 — Goal:
  Egoric Snapshot -> LeozOps Ingestion -> CEO Brief -> Local End-to-End Proof
  Nothing else. Evidence-gated, no calendar dates.

Evidence gates (ALL required before Sprint 2):
- G1: Egoric snapshot endpoint (test instance only) — LEOZOPS_READ
  capability, auth matrix, recursive PII denial, deterministic ETag/304,
  method denial. Codex PASS.
- G2: LeozOps ingestion — tenant/source_connection entities, immutable
  idempotent snapshot storage, schema fail-closed, no-write-egress proof.
  Codex PASS.
- G3: CEO Brief from snapshot — deterministic, Egoric-native funnel,
  provenance + limitations on every output, integration profile denies
  CRM/task/onboarding/email routes. Codex PASS.
- G4 (SPRINT 1 ACCEPTANCE): local end-to-end vs Egoric test instance —
  exact count reconciliation, zero-mutation proof, feature-flag +
  key-revocation drill. Codex PASS in CODEX_REVIEW.md; Leoz acceptance
  recorded in DECISIONS.md.

HARD STOP: Sprint 2 does not start until G4 acceptance is recorded.

SPRINT 2 — Goal (re-planned and re-approved at G4):
  Deployment -> Test Instance -> Production Shadow -> Read-only Pilot
- Polling cadence/retry/circuit/reconciliation, metrics + recommendations
  routes, alerting, runbooks.
- Hosting decision; independent LeozOps Postgres + secrets; readiness/canary.
- Ten-business-day read-only production shadow (contract §11), then CEO
  go/extend/revoke decision.
- All 12 Codex release gates (contract §15) before any production key/flag.

Forbidden throughout (contract §2):
- Direct/shared database access or production DB writes.
- Director or employee-role integration keys and generic Egoric CRUD APIs.
- Write-back, double entry, autonomous tasks, email, social publishing, or
  invoice actions.
- Treating current webhooks as a source of truth.
- Mapping Egoric Clients to LeozOps tenants or forcing Egoric stages into the
  LeozOps nine-stage funnel.

Claude Code must follow CLAUDE.md. Hermes must follow HERMES.md. Codex release
criteria are in docs/EGORIC_INTEGRATION.md.

================================================
LEGACY FOUNDATION (HISTORICAL — EVIDENCE INTACT)
================================================

1. WHAT WE ARE BUILDING
-----------------------
An AI Operating Partner for agencies and business owners.
Three core pieces: CRM + AI Brain + Agent Workforce.
One end-to-end growth funnel: Traffic -> Attention -> Lead -> Qualification -> Nurture -> Conversion -> Activation -> Upsell -> Retention.

2. WHAT THE MVP LOOP SHOULD BE
-------------------------------
- Store leads and campaign data in a working CRM.
- Track movement through the funnel stages.
- Give the CEO a daily brief and recommendations.
- Let the team act on the brief inside the same system.
- Measure whether actions move the funnel metrics.
- Repeat and improve recommendations weekly.

3. WHAT CLAUDE CODE SHOULD BUILD FIRST
--------------------------------------
- Custom CRM foundation (database + schema).
- Client and campaign models/tables.
- Lead tracking with stage changes.
- KPI dashboard using real CRM data.
- Daily CEO Brief Agent that reads the dashboard.
- Recommendation system based on funnel data.
- Placeholder integration stubs for social/email/AI tools (no real posting).

4. WHAT CODEX SHOULD REVIEW FIRST
---------------------------------
- The CRM data model and migrations.
- Lead stage transition logic and edge cases.
- CEO Brief Agent output accuracy.
- Dashboard metrics and calculation correctness.
- Integration stub architecture (safe to extend later).
- Security basics: auth, input validation, access control.

5. WHAT DECISION LEOZ MUST MAKE AS CEO
---------------------------------------
- Pick the first paying client or internal test account to pilot the CRM.
- Define which funnel stages matter most in the first 30 days.
- Decide what "good enough" looks like for the MVP launch date.
- Choose whether recommendations are advisory only or can trigger automated actions.
- Set the threshold for moving from placeholder integrations to real publishing.

6. MILESTONE #2: KPI READ LAYER — PASS
---------------------------------------
Goal: Build the read-only metrics API that converts live CRM data into funnel KPIs.
Why now: CRM foundation passed QA; this layer unblocks both the CEO Brief Agent and any future dashboard.
Deliverables:
- Repository query methods for funnel KPIs (stage counts, conversion rates, lead volumes by source/channel, campaign attribution, trends)
- Typed API routes returning those KPIs scoped to a single client
- One contract/integration test per route against known seed data
Success criteria:
- All new KPI route tests pass
- No schema changes required
- CEO Brief Agent can be implemented next by consuming these endpoints

7. MILESTONE #3: DAILY CEO BRIEF ENGINE V0 — PASS
--------------------------------------------------
Goal: Generate an accurate, deterministic daily CEO brief from live CRM KPIs.
Why now: KPI read layer is complete and QA-passed; the brief is the first AI/agent deliverable that turns data into executive action.
Deliverables:
- Brief domain model and output contract (JSON/text with funnel snapshot, deltas, anomalies, recommended actions)
- Agent/service that consumes the KPI endpoints and assembles the brief
- Deterministic tests proving brief output matches expected CRM state
Success criteria:
- Brief generation succeeds from seed data without schema changes
- Key funnel metrics in the brief exactly match KPI API output
- Anomaly detection and recommended actions are relevant and understandable
- All brief tests are green

8. MILESTONE #4: RECOMMENDATION SYSTEM V0 — PASS
--------------------------------------------------
Goal: Add advisory-only recommendations based on funnel KPIs and brief output.
Why now: The brief gives the CEO what happened; recommendations provide the first AI Brain behavior. This closes the MVP value loop before heavier UI/integration work.
Deliverables:
- Recommendation rules/heuristics based on funnel state
- Recommendation API endpoint with stable output contract
- Advisory-only enforcement in code
- Deterministic tests for rule mapping, empty cases, unknown client handling
Success criteria:
- Recommendations are derived from existing KPI/brief data; no schema changes
- Output contract is stable and advisory-only behavior is enforced
- Rules produce relevant recommendations against the seeded dataset
- All recommendation tests are green
- QA sign-off: PASS

9. MILESTONE #5: EXECUTIVE DASHBOARD & TEAM WORKSPACE — PASS
-------------------------------------------------------------
Goal: Provide a visual, single-pane surface for the CEO and team to monitor funnel health, daily briefs, and recommendations.
Why now: M2, M3, and M4 APIs are complete; a dashboard validates all prior API contracts visually before heavier integration and production exposure.
Deliverables:
- Dashboard UI shell consuming KPI, Brief, and Recommendation APIs
- Funnel visualization (stage counts, conversion trends)
- Lead list with stage movement views
- CEO Brief and Recommendation panels
Success criteria:
- Dashboard reflects live CRM state without schema changes
- CEO Brief and Recommendations render correctly from their APIs
- Suitable for internal pilot use before external exposure
- QA sign-off: PASS

10. MILESTONE #6: INTEGRATION ADAPTERS — PLACEHOLDER — PASS
------------------------------------------------------------
Goal: Establish safe, no-op connector architecture for social, email, and AI tools.
Why now: A defined integration surface is required before later milestones can legally publish or automate external actions.
Deliverables:
- Placeholder adapters for Facebook, TikTok, Instagram, email, and AI video/image stubs
- Explicit no-op behavior and clear documentation separating placeholder from production path
- Route/service tests proving adapters do not mutate external state
Success criteria:
- Adapters mount in the system but perform no external writes
- No dashboard, integration, or autonomous execution layer was added
- QA sign-off: PASS

11. MILESTONE #7: PRODUCTION HARDENING — PASS
---------------------------------------------
Goal: Add authorization, validation, and database safety required before external exposure.
Why now: M5 and M6 expose surfaces that must be protected before real users or agents interact with CRM data.
Deliverables:
- Auth + tenant access control
- HTTP route contract tests (bad IDs, cross-client, 500 prevention)
- Stricter request validation (email/UUID shapes, numeric bounds, enums)
- Repository update hardening (ownership reassignment rules)
- Postgres migrate/seed/rollback smoke path present and documented
Success criteria:
- Auth enforced on protected routes
- Tenant data is fully isolated
- Bad input never produces 500
- Ownership reassignment is blocked or fully validated
- QA sign-off: PASS (PostgreSQL verification deferred to deployment gate)

12. MILESTONE #8: REAL INTEGRATION PUBLISHING — IN PROGRESS
-----------------------------------------------------------
Goal: Replace placeholder adapters with live connections and enable recommendation-driven publishing.
Why now: M6 placeholders and M7 safety rails are complete; real publishing closes the recommendation -> action -> data loop.

M8A — Email Publishing — Completed
Deliverables:
- Live email adapter replacing the email placeholder
- Authorization + spend guardrails around publish actions
- End-to-end publishing tests against email sandbox
Success criteria:
- Recommendations can trigger safe email publish actions
- Auth enforced and tenant-isolated
- Spend/budget checks prevent runaway sends
- Failure modes are logged and visible, not silent
- No schema changes

M8B — Facebook + Instagram Publishing — Deferred
M8C — TikTok Publishing — Deferred
M8D — AI Media Generation — Deferred

13. MILESTONE #9: TASK ENGINE — PASS
------------------------------------
Goal: Convert recommendations and brief items into tracked, tenant-scoped tasks with lifecycle management.
Why now: M8A live publishing is complete; agencies need execution tracking to operationalize outputs from the AI Brain. Tasks are the highest-value next workflow object.
Deliverables:
- Task table + migration with audited status-event table
- TaskRepository and TaskService
- Tenant-scoped task CRUD and state transitions
- Auth + validation hardening for task workflows
- Audit trail of task status changes with deterministic ordering (monotonic sequence + timestamp tie-breaker)
- In-memory + Postgres parity tests
Success criteria:
- Recommendations/brief outputs can be converted into tenant-scoped tasks
- Tasks are assignable, trackable, and completable
- Auth and tenant isolation enforced on all task operations
- Invalid transitions/input rejected cleanly
- Audit trail order is deterministic even for rapid transitions
- All task tests are green
- QA sign-off: PASS

14. MILESTONE #10: MVP LAUNCH & CLIENT ONBOARDING — SUPERSEDED BY DECISION-002
----------------------------------------------------------------------------------------
Status: Superseded by DECISION-002
Reason: The architecture has changed after Egoric ERP became the production
system of record. LeozOps will not launch as a standalone operational CRM;
deployment now belongs to Sprint 2 of the Intelligence Integration track
(section 0).

Original goal (historical): Ship the first pilot tenant on a live
PostgreSQL-backed deployment.
Completion evidence retained:
- Local verification: PASS (159/159 tests green, typecheck clean)
- Client onboarding workflow (`POST /onboarding`, `npm run onboard` CLI) creating tenant + issuing token
- `GET /ready` readiness probe
- Pilot/support runbook (`docs/PILOT_RUNBOOK.md`)
Status:
- Local verification: PASS
- Deployment readiness (standalone): superseded — see section 0

Deployment-gate outcome at supersession:

1. PostgreSQL environment provisioned and smoke-tested: PASS.
2. Live pilot verification end-to-end: never executed; requirement
   superseded by DECISION-002. The former steps are retained below as
   history only (do not execute for the standalone CRM):

   * Deploy app with real DB.
   * Call `/ready` and confirm PASS.
   * Run `npm run onboard` or `POST /onboarding` to create the first pilot tenant.
   * Verify pilot tenant can create campaigns, leads, tasks, and receive briefs/recommendations on the live instance.
   * Record base URL, pilot client_id, and verification results in the runbook or deployment evidence file.

Deployment evidence:
--- Blocker 1: PostgreSQL smoke (Supabase Session Pooler, DATABASE_URL) --------
Date (UTC):        2026-06-**T**:__Z
Postgres target:   Supabase managed PostgreSQL via Session Pooler
DB:                postgres / disposable smoke run
TLS:               sslmode=require
pg driver:         installed
Command:           npm run db:smoke (DATABASE_URL set inline, credentials redacted)
Result:            PASS

Key output lines:
"seeded 9 funnel stages, 9 present."
"task lifecycle + monotonic audit seq verified."
"Postgres migrate/seed/rollback smoke PASSED."

Tables verified:
funnel_stages
clients
campaigns
leads
tasks
task_status_events

Notes:
Direct Supabase host failed DNS/connection from local machine.
Supabase Session Pooler connection succeeded.
DATABASE_URL was cleared from shell after verification.

Blocker 1 status: PASS (evidence carries forward to Sprint 2 deployment work)
Blocker 2 status: Superseded by DECISION-002 — never executed for the standalone CRM.

15. MILESTONE #10.1 — SUPERSEDED BY DECISION-002
-------------------------------------------------
Status: Superseded by DECISION-002.
The post-M10 candidate list (M8B publishing, monitoring expansion) is
archived. All future work follows section 0 (LeozOps Intelligence
Integration) per GOVERNANCE change-control. Options retained as history:
- M8B: Facebook + Instagram Publishing
- Operational monitoring/alerting expansion
- Any scope requested by Leoz after pilot feedback (per GOVERNANCE change-control)
