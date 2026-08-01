LEOZOPS — PROJECT CHECKLIST
===========================

PHASE 0 — PRODUCT FOUNDATION (DECISION-003)
-------------------------------------------
Status: COMPLETE ON MAIN / PR #1 MERGED AT b7aa417
Canonical product: PRODUCT.md
Operating model: docs/PRODUCT_OPERATING_MODEL.md
Vocabulary: docs/GLOSSARY.md
Gate map: docs/RELEASE_GATES.md
Legacy classification: docs/LEGACY_FOUNDATION.md

[x] North Star, first user, operating loop, MVP, and non-goals agree.
[x] CEO / LeozOps / Egoric ownership is explicit.
[x] Observer -> Advisor -> Planner -> Operator -> Autopilot sequence is gated.
[x] Observation, insight, recommendation, approval, and action are distinct.
[x] Existing standalone routes are classified and excluded from the planned
    egoric-readonly profile.
[x] README, product metadata, governance, architecture warning, roadmap, and
    decision log point to the same direction.

Phase 0 does not authorize production, credentials, write-back, or S1.B.

0. CURRENT APPROVED DIRECTION — LEOZOPS INTELLIGENCE INTEGRATION (DECISION-002)
----------------------------------------------------------------------------
Status: SPRINT 1 COMPLETE / PHASE 2–8 LOCAL CONTROL PLANES COMPLETE / PRODUCTION ADAPTER ABSENT
Canonical contract: docs/EGORIC_INTEGRATION.md
Execution plan: .hermes/plans/2026-07-18_egoric-integration-execution-plan.md
Sprint 1A tasks (Egoric repo): docs/SPRINT_1A_TASKS.md — T1-T6.
Sprint 1B tasks (LeozOps repo): docs/SPRINT_1B_TASKS.md — T1-T7.
Sprint 1C tasks (LeozOps repo): docs/SPRINT_1C_TASKS.md — T1-T7.
Sprint 1D tasks (LeozOps repo): docs/SPRINT_1D_TASKS.md — T1-T7.
Sprint 2/G5 plan: docs/SPRINT_2_PLAN.md — S2.A T1-T4 accepted and T5-T8
merged through PR #13 at leozcrm/main@1911349 and accepted. Disposable
PostgreSQL 16 Checkpoint A smoke: PASS; evidence in docs/POSTGRES_SMOKE.md.
Accepted through PR #15 at leozcrm/main@5e9a4b7. Managed/external PostgreSQL,
P1/P2, and all external work remain blocked.
P1 decision packet: docs/P1_DECISION_PACKET.md — local fail-closed manifest
validator accepted through PR #17 at leozcrm/main@35ed23c under DECISION-002
addendum 12; the checked-in example is intentionally pending and P1 remains
blocked.
Phase 2 operations: docs/PHASE_2_OPERATIONS.md — local S2.B–S2.D manifest
chain, readiness, one-shot worker, immutable poll/daily evidence, ten-business-
day evaluator, and go/extend/revoke control plane implemented on
codex/leozops-phase2 under DECISION-002 addendum 13. This is implementation
readiness only; P1/P2, deployment, credentials/flags, network proof, production
canary, and elapsed shadow evidence remain blocked/pending.
Sprint 3/G6 plan: docs/SPRINT_3_PLAN.md. Local exact policy, safe proposal,
dry-run, separate approval/operator authentication, idempotent claim,
risk/budget/rate enforcement, immutable audit, unknown-outcome reconciliation,
and separately approved rollback are implemented on
codex/leozops-phase3-supervised-action under DECISION-002 addendum 14.
Operations: docs/PHASE_3_OPERATIONS.md. The production adapter registry is
intentionally empty; real G5 go, one narrow RepositoryRealms command contract,
command-specific QA, deployment, credential, and G6 release remain blocked.
Sprint 4/G7 plan: docs/SPRINT_4_PLAN.md. Local exact standing policy,
deterministic simulator, real G6 history gate, fresh-source check, kill switch,
one-candidate envelope, immutable incidents, atomic limits, and separately
approved human recovery are implemented on
codex/leozops-phase4-bounded-autonomy under DECISION-002 addendum 15.
Operations: docs/PHASE_4_OPERATIONS.md. The production adapter registry remains
empty; G5/G6 release, production supervised history, deployed monitoring,
incident drills, and explicit G7 release remain blocked.
Sprint 5 assurance plan: docs/SPRINT_5_PLAN.md. The exact G7-bound local policy,
database-derived assessment, 15-check safety case, freshness/event-chain recheck,
immutable `blocked_external` package, preflight, and command-and-exit operator
are implemented on codex/leozops-phase5-operational-assurance under
DECISION-002 addendum 16. Operations: docs/PHASE_5_OPERATIONS.md. Phase 5 does
not create G8 or release G7; every external evidence requirement remains
explicitly blocked and production composition remains adapter-free.
Sprint 6 signed-evidence plan: docs/SPRINT_6_PLAN.md. Exact Phase 5 binding,
four pinned Ed25519 issuer keys, canonical eight-row matrix, signature/freshness/
replay/revocation enforcement, immutable admission and assessments, preflight,
and command-and-exit operator are implemented on
codex/leozops-phase6-external-evidence under DECISION-002 addendum 17.
Operations: docs/PHASE_6_OPERATIONS.md. A complete matrix is only
`complete_unreleased`; real issuer enrollment, infrastructure, deployment, and
activation remain outside repository authority.
S2.A reliability contract: docs/POLL_RELIABILITY.md — T1-T4 merged through
PR #11 at leozcrm/main@5d140a8 and accepted in DECISION-002 addendum 8.
S2.A operations contract: docs/SOURCE_OPERATIONS.md — T5-T8 accepted in
DECISION-002 addendum 10. Runbook: docs/S2A_OPERATIONS_RUNBOOK.md.
Business Memory contract: docs/BUSINESS_MEMORY.md.
Corrective QA passed at repositoryrealms@28ceff6 against main@507187f.
PR #7 merged to repositoryrealms/main@98c0eca and Product Owner accepted G1
for local S1.B continuation. G2 technical QA passed on
codex/leozops-s1b-business-memory and PR #4 was squash-merged to
leozcrm/main@d1d34c5. Product Owner accepted local S1.C/G3 continuation.
S1.C passed technical QA and PR #6 was squash-merged to
leozcrm/main@3a5fb9e. Product Owner accepted local S1.D/G4 continuation.
S1.D passed actual-handler local E2E QA and PR #8 was squash-merged to
leozcrm/main@5ef3fd5. Product Owner accepted Sprint 1 in DECISION-002
addendum 6.

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
- G4 (SPRINT 1 ACCEPTANCE): actual canonical handler + local test facts —
  exact count reconciliation, zero-mutation proof, feature-flag +
  key-revocation drill. Codex PASS in CODEX_REVIEW.md; Leoz acceptance
  recorded in DECISIONS.md.

G4 HARD STOP SATISFIED. Local Sprint 2–4 control-plane implementation is
separately authorized by DECISION-002 addenda 13–15. External deployment, G5
evidence, real command registration, G6 release, and G7 authority remain
blocked by their named gates.

SPRINT 2 — Goal (planning authorization only):
  Deployment -> Test Instance -> Production Shadow -> Read-only Pilot
- Polling cadence/retry/circuit/reconciliation, connector health, alerting,
  runbooks; no new product read routes.
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

The sections below are retained as historical checklist evidence. They are not
the current product plan and must be interpreted through
docs/LEGACY_FOUNDATION.md.

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

16. PHASE 6 SIGNED EXTERNAL-EVIDENCE ADMISSION — LOCAL PASS
-----------------------------------------------------------
Status: COMPLETE ON `codex/leozops-phase6-external-evidence`; ACTIVATION BLOCKED

[x] Exact Phase 5 assessment/package binding and separated credentials.
[x] Four unique pinned Ed25519 issuer identities/public keys.
[x] Canonical eight-row evidence matrix; no wildcard, waiver, or inference.
[x] Signature, identity, binding, freshness, expiry, skew, nonce, replay, and
    monotonic-order validation.
[x] Signed revocation of the exact latest pass and derived expired/revoked state.
[x] Immutable SQLite/PostgreSQL policies, attestations, assessments, and events.
[x] File-only command-and-exit operator and deliberately blocking preflight.
[x] Full regression 272/272; focused Phase 6 suite 13/13; TypeScript PASS.
[x] SQLite up/down/up and PostgreSQL 16 full lifecycle/rollback PASS.
[x] No high/critical npm advisory; no new dependency; no production adapter,
    private key, network call, scheduler, daemon, HTTP mutation, or release path.

Eight valid rows remain `complete_unreleased` and
`blocked_external_activation`. Real trust enrollment, external evidence,
deployment, named production infrastructure, and activation are not completed
or authorized.

17. PHASE 7 ACTIVATION CEREMONY — LOCAL PASS
---------------------------------------------
Status: COMPLETE ON `codex/leozops-phase7-activation-ceremony`; EXECUTION ABSENT

[x] Exact fresh Phase 6 assessment and eight-attestation target binding.
[x] Named target plus artifact/configuration/credential-reference/canary/
    rollback fingerprints; no wildcard, placeholder, URL, waiver, or secret.
[x] Separate authority, verifier, and operator credentials for solo operation.
[x] Immutable dossier, verification, sealed handoff, additive recall, events.
[x] Recheck plus transactional Phase 6 snapshot lock before accept/create/seal.
[x] File-only command-and-exit operator and deliberately blocking preflight.
[x] Focused Phase 7 suite 13/13, SQLite up/down/up, TypeScript, full regression
    285/285, PostgreSQL 16 eleven-migration lifecycle, dependency audit, and
    documentation verification.
[x] No executor, provider SDK, production adapter, target credential, network,
    scheduler, daemon, background loop, HTTP mutation, deploy, or activation.

Every sealed handoff remains `not_executed` with
`external_execution_required=true`. Real external execution requires a future
explicit authorization and implementation.

18. PHASE 8 CONTROLLED SINGLE ACTIVATION — LOCAL PASS
-----------------------------------------------------
Status: COMPLETE ON `codex/leozops-phase8-controlled-activation`; PRODUCTION ADAPTER ABSENT

[x] Exact unrecalled Phase 7 handoff and target/canary/rollback binding.
[x] Four new separate release/executor/observer/rollback credentials.
[x] Initially engaged switch and short dual-credential release.
[x] Zero-mutation preview and one persisted claim before one adapter call.
[x] Lost response and expired orphan claim become terminal unknown with no retry.
[x] Explicit receipt-bound observation; unhealthy/unknown opens an incident.
[x] Explicit dual-authorized idempotent rollback; no automatic rollback.
[x] Ten append-only SQLite/PostgreSQL tables and monotonic audit events.
[x] Fail-closed preflight, exact-key one-shot operator, pending template,
    adversarial tests, migration lifecycle, and operations runbook.
[x] Focused Phase 8 suite 17/17, full regression 302/302, TypeScript PASS,
    SQLite up/down/up, PostgreSQL 16 twelve-migration lifecycle/rollback,
    Node 24 isolated compatibility, 63/63 local documentation links, and no
    high/critical dependency advisory.
[x] Read-only GitHub Actions QA for Node 22/24, full SQLite regression,
    high-severity audit, and disposable PostgreSQL 16 lifecycle.
[x] Final local evidence packet with explicit non-fabricable external blockers.
[x] Production activation registry empty; no provider SDK, real secret, network,
    scheduler, daemon, background loop, HTTP mutation route, or deployment.

Phase 8 completes the local control-plane implementation. Real provider
adapter/credential, target deployment, live canary/monitoring/drills, and the
external G5/G6/G7 evidence gates remain separately blocked.

19. JARVIS PRODUCT TRACK — PHASE 9B LOCAL ADAPTER COMPLETE
----------------------------------------------------------
Status: PHASE 9A CORE + PHASE 9B ADAPTER COMPLETE LOCALLY; LIVE MODEL EVIDENCE ABSENT

[x] Define the bounded Jarvis v1 outcome and explicit non-goals.
[x] Record the honest Phase 8 repository/production baseline.
[x] Split product work from non-fabricable production-truth work.
[x] Define J1-J8 acceptance checkpoints without weakening G0-G7.
[x] Order Phases 9-16 through conversation, cockpit, proactive delivery, live
    trust, planning, one supervised hand, bounded autonomy, and v1 release.
[x] Define the solo-founder critical path, estimate, external elapsed windows,
    and stop rules.

Phase 9A implementation checklist:

[x] Fact/inference/recommendation/limitation answer contract.
[x] Tenant-scoped conversation, message, run, citation, feedback, goal,
    constraint, and decision schemas.
[x] Evidence-pack builder over approved Business Memory and CEO Brief facts.
[x] Typed read-only tool registry and deterministic model-provider double.
[x] Authenticated, idempotent conversation create/read/ask routes.
[x] Golden factual/comparative/insufficient/stale/adversarial question set.
[x] Tenant isolation, prompt-injection, replay, budget, timeout, and provider-
    failure tests.
[x] SQLite migration lifecycle and seven-table immutability proof.
[x] Disposable PostgreSQL 16 thirteen-migration lifecycle, conversation,
    context, citation, feedback, replay, seven-table immutability, and rollback.
[x] Focused Phase 9A suite 18/18, full regression 320/320, TypeScript PASS,
    71/71 local documentation links, and no high/critical dependency advisory.

Phase 9A adds no production model credential, generic SQL/HTTP/filesystem tool,
action execution, notification scheduler, voice, or external deployment.

Phase 9B implementation checklist:

[x] Official current model/Responses/Structured Outputs contract reviewed.
[x] One pinned `gpt-5.6-sol` adapter with fixed official endpoint.
[x] Strict `advisor_answer_v1` schema plus existing domain/citation validation.
[x] `store:false`, no tools, no retry, current-turn reasoning, bounded output.
[x] Deterministic provider remains the default; explicit OpenAI opt-in fails
    startup without a runtime key.
[x] Provider body/key redaction and malformed/refused/incomplete/model-drift/
    usage/content-type/response-size failure handling.
[x] Versioned input/cached/cache-write/output cost policy and pre-call maximum-
    cost guard before transport.
[x] Expanded 12-case eval with 100% contract and 90% behavior thresholds plus
    per-case latency/token/cost evidence.
[x] Billable live-eval command requires an exact acknowledgement and key; the
    unconfigured guard exits nonzero before transport.
[x] Durable streaming deferred to Phase 10 so partial unvalidated claims cannot
    become conversation evidence.
[x] Phase 9B-specific provider/eval and trust-boundary suites 11/11; Phase 9
    conversation suite 20/20; full regression 332/332; TypeScript PASS.
[x] 55/55 local links across changed documentation, `git diff --check`, secret scan, and
    high/critical production dependency audit PASS; no dependency added.

Phase 9B installs no key, makes no live request, and performs no deployment.
J1 remains open for live use until credential/revocation proof, privacy review,
accepted live eval, repeated p95 latency/cost, monitoring, named deployment,
Product Owner SLO acceptance, and real G5 evidence exist.

20. PHASE 10 MEDIEVAL CEO COCKPIT — LOCAL PASS CANDIDATE
--------------------------------------------------------
Status: IMPLEMENTED ON `codex/leozops-phase10-medieval-cockpit`; LIVE J2 OPEN

[x] Canonical Realm v2 tokens and page contract recorded under `design-system/`.
[x] Versioned, tenant-scoped, PII-minimized cockpit projection.
[x] Public data-free connection chamber with strict same-origin CSP.
[x] Today, Ask LeozOps, Business, Recommendations, and Command Deck surfaces.
[x] Full answer validation before progressive reveal and exact citation drawer.
[x] Read credential held only in page memory and cleared on disconnect/pagehide.
[x] Keyboard tabs, Ctrl/Cmd+K, skip link, focus states, 44 px targets, reduced
    motion, high contrast, and responsive desktop/tablet/mobile layouts.
[x] Loading, freshness, partial context, empty queue, blocked, auth, network,
    and recovery states.
[x] Command Deck reports read-only/not-connected/blocked/not-available truth;
    no execution route or direct Egoric post exists.
[x] In-app browser QA: five surfaces, Ask/citations, Ctrl+K, 1280 desktop,
    390 mobile, no horizontal overflow, 56 px mobile targets, and zero console
    warning/error.
[x] Focused Phase 10 suite 4/4, full regression 336/336, TypeScript, 56 local
    links, diff check, changed-file secret scan, and high/critical dependency
    audit PASS.
[ ] Live J2: founder under-five-minute run on named deployment with accepted
    live J1/G5 evidence.

Phase 10 adds no dependency, migration, model key, production adapter,
deployment, scheduler, notification, generic tool, or operational authority.
