# LeozOps AI — Decisions Log

Format:
- Date: YYYY-MM-DD
- Decision: What we decided
- Context: Why it came up
- Rationale: Why this option
- Alternatives considered
- Owner: who made / owns the decision

---

DECISION-003 — 2026-07-28 — LeozOps is the AI Operating Partner for a CEO

Status: Approved by Leoz; Phase 0 documentation merged to `main` through
[PR #1](https://github.com/leozvu/leozcrm/pull/1) at `b7aa417`.

Decision:

- LeozOps is the AI Operating Partner for a CEO: it observes the business,
  maintains trustworthy analytical memory, explains change, recommends next
  actions, and may eventually coordinate approved actions through the systems
  that own them.
- Egoric remains the operational body and sole CRM/ERP system of record. The
  CEO remains the decision and approval authority.
- Revenue/funnel intelligence is the first product wedge. The maturity order is
  Connected → Observer → Advisor → Planner → supervised Operator → bounded
  Autopilot.
- The immediate MVP remains Jarvis Observer:
  `Egoric Snapshot → Business Memory → Deterministic Metrics → CEO Brief`.
- Capability is evidence-gated by `docs/RELEASE_GATES.md`. The JARVIS metaphor
  grants no write, execution, production, credential, or autonomy authority.
- The existing standalone CRM/task/onboarding/email runtime is legacy
  foundation. Its classification and reuse rules are binding in
  `docs/LEGACY_FOUNDATION.md`.

Context:

The repository already contained a safe read-only Egoric integration decision,
but its public identity and metadata still presented “CRM + AI Brain + Agent
Workforce”. The product vision is broader than a revenue dashboard and narrower
than uncontrolled autonomy: a trusted intelligence-to-action loop for the CEO.
Phase 0 aligns the product language without weakening DECISION-002.

Rationale:

- Gives the long-term JARVIS vision a concrete, testable capability ladder.
- Keeps the first release small enough to verify against real source facts.
- Prevents the legacy standalone CRM from competing with Egoric.
- Separates deterministic truth, AI interpretation, recommendation, approval,
  and action so trust can be earned progressively.

Consequences:

- `PRODUCT.md` and `docs/PRODUCT_OPERATING_MODEL.md` become the product entry
  points.
- `docs/GLOSSARY.md` is normative for domain/API/UI language.
- G0–G7 govern capability sequencing; G1–G4 technical requirements in the
  Egoric integration contract remain unchanged.
- Voice, broad dashboards, autonomous agents, publishing, task creation, and
  write-back remain off the critical path.
- Any supervised action or bounded autonomy requires a separate future
  decision and explicit CEO approval.

Alternatives considered:

- Position LeozOps only as Revenue Intelligence: rejected because it describes
  the first wedge but not the approved product destination.
- Resume the standalone “CRM + Agent Workforce” roadmap: rejected because it
  duplicates Egoric ownership and expands risk before trust is established.
- Build a general-purpose chatbot first: rejected because fluent answers
  without deterministic Business Memory and evidence do not satisfy the CEO
  operating job.

Owner: Leoz (Product Owner). Implemented in documentation by Codex.

---

DECISION-002 — 2026-07-18 — Egoric becomes the operational system of record
Status: Approved
Decision:
- Egoric owns operational CRM/ERP.
- LeozOps becomes a read-only intelligence platform.
- No duplicate CRM.
- No shared database.
- Sprint 1 scope: Egoric Snapshot → LeozOps Ingestion → CEO Brief. Nothing else.
- No deployment until Sprint 1 passes local end-to-end verification.
Reason:
Egoric is already deployed and used by employees. LeozOps now provides
intelligence instead of replacing CRM.
Consequences:
- Legacy standalone CRM roadmap archived.
- Integration-first architecture adopted.
- All future milestones follow this decision unless superseded by another ADR.
Process notes:
- Execution plan: `.hermes/plans/2026-07-18_egoric-integration-execution-plan.md`
  (v2, evidence-gated, dates removed, deployment deferred to Sprint 2).
- Sprint 2 must not start until Sprint 1 acceptance (gate G4) is recorded here.
- Implementation tasks are not yet created; a separate CEO go is required.
Owner: Leoz (Product Owner). Recorded by Hermes (PM).

DECISION-002 addendum — 2026-07-18 — Sprint 1A implementation authorized
Status: Approved (Leoz). EXECUTION ON HOLD pending Repository Identity Rule.
Decision: Begin Sprint 1A ONLY — implementation tasks exclusively for the
Egoric read-only snapshot endpoint (Egoric repository, test instance only,
gate G1). Sprint 1B and 1C tasks must not be created until Sprint 1A is
completed, Codex-reviewed, merged, and accepted.
Task breakdown: `docs/SPRINT_1A_TASKS.md` (T1–T6).
Repository identity ruling (Leoz, 2026-07-18): `agency-erp`
(leozvu/CRMegoric.git) is NOT the canonical Egoric repository. The canonical
ERP/CRM repository is `repositoryrealms`. The Repository Identity Rule was
added to GOVERNANCE.md; implementation may not begin until the canonical
repository's local path, remote, and branch are confirmed and its registry
row is marked CONFIRMED.
Owner: Leoz. Recorded by Hermes (PM).

DECISION-002 addendum 2 — 2026-07-19 — Canonical source, branch model, and deployment isolation
Status: Approved (Leoz).
Decision (option (a) of the production-lineage question):
- leozvu/repositoryrealms is the go-forward canonical ERP/CRM source.
- Sprint 1A targets repositoryrealms, not agency-erp/CRMegoric.git.
- `codex/realms-demo` is NOT an approved production branch; it is preserved
  as staging/demo.
- Protected production baseline branch `main` created from 76082dc (latest
  verified production-lineage commit, v3.36); GitHub branch protection
  enabled (PR + 1 approving review); set as default branch.
- Sprint 1A implementation branch `feat/leozops-s1a` created from main.
- Promotion flow: feat/leozops-s1a -> Egoric-only test/staging deployment ->
  Codex G1 PASS -> merge to main -> explicit CEO production approval ->
  Vercel CLI deploy to the Egoric project only.
- The integration feature flag and LEOZOPS_READ key must never be deployed
  to aim, vnecom, fretas, or egolive. The route is disabled by default in
  every deployment and enabled only via deployment-specific environment
  variables in the Egoric Vercel project (prj_Hh4aZEj9q3hvULaUfC4GwFvxYii9).
  See `docs/DEPLOYMENT_FLAG_ISOLATION.md`.
- Production deployment approval: NOT YET GRANTED.
Context: Production-lineage verification (GOVERNANCE.md) proved
repositoryrealms/codex/realms-demo contains the full production v3.x history
plus staging/demo commits; the live Egoric ERP runs at
erp-egoric.vercel.app as one of five businesses served by one codebase.
Hold conditions (all satisfied 2026-07-19; see GOVERNANCE.md):
main created from 76082dc; feat/leozops-s1a created; credential-file risk
verified resolved (untracked + gitignored in agency-erp, absent from
repositoryrealms); flag-isolation documented.
Sprint 1A remains ON HOLD pending explicit CEO release. No source code
modified.
Owner: Leoz. Recorded by Hermes (PM).

DECISION-002 addendum 3 — 2026-07-28 — G1 accepted; local S1B authorized
Status: Approved by Leoz (Product Owner).
Decision:
- Accept the independently verified Sprint 1A/G1 contract at reviewed commit
  `28ceff6` and merged `repositoryrealms/main@98c0eca`.
- Because `leozvu` is the solo repository collaborator and cannot approve the
  author's own PR, PR #7 was admin-squash-merged after all required checks
  passed. Branch protection remains configured; it was not removed or weakened.
- Authorize Sprint 1B/G2 implementation in `leozcrm` for local/test read-only
  ingestion and Business Memory only.
- Keep S1.C blocked until G2 passes independent QA.
- This acceptance does not authorize production deployment, production flags,
  credential creation, Egoric write-back, or autonomous action.
Owner: Leoz. Recorded by Codex from the explicit solo-continuation instruction.

DECISION-002 addendum 4 — 2026-07-28 — G2 accepted; local S1.C authorized
Status: Approved by Leoz (Product Owner).
Decision:
- Accept the G2 Business Memory implementation and QA evidence merged through
  `leozcrm` [PR #4](https://github.com/leozvu/leozcrm/pull/4) at
  `main@d1d34c5`.
- Authorize Sprint 1C/G3 implementation for a deterministic, snapshot-based CEO
  Brief and integration-only read profile in local/test scope.
- Continue the solo-repository workflow: Codex must record technical evidence,
  publish a PR, and may merge only after the branch is clean and mergeable.
- Keep G4 blocked until G3 passes and is accepted.
- This acceptance does not authorize production deployment, production flags,
  credential creation, scheduled polling, Egoric write-back, publishing, or
  autonomous action.
Owner: Leoz. Recorded by Codex from the explicit solo-continuation instruction.

DECISION-002 addendum 5 — 2026-07-28 — G3 accepted; local S1.D authorized
Status: Approved by Leoz (Product Owner).
Decision:
- Accept the deterministic Egoric CEO Brief and isolated `egoric-readonly`
  profile merged through `leozcrm`
  [PR #6](https://github.com/leozvu/leozcrm/pull/6) at `main@3a5fb9e`.
- Authorize Sprint 1D/G4 implementation for local/test end-to-end proof only:
  test snapshot pull, exact reconciliation, no-mutation evidence, and local
  feature-flag/key-revocation drills.
- Keep Sprint 2 and all deployment work blocked until G4 passes technical QA
  and Product Owner acceptance is recorded.
- This acceptance does not authorize production deployment, production flags,
  production or test-instance credential creation, scheduled polling, Egoric
  write-back, publishing, or autonomous action.
Owner: Leoz. Recorded by Codex from the explicit solo-continuation instruction.

DECISION-002 addendum 6 — 2026-07-28 — G4 accepted; Sprint 1 complete
Status: Approved by Leoz (Product Owner).
Decision:
- Accept the actual-handler local end-to-end proof merged through `leozcrm`
  [PR #8](https://github.com/leozvu/leozcrm/pull/8) at `main@5ef3fd5`.
- Record G4 and Sprint 1 complete: the canonical source handler, production
  adapter, immutable Business Memory, deterministic CEO Brief, and isolated
  read profile reconcile exactly with no source mutation.
- Authorize Sprint 2/G5 planning only. The plan must separately define hosting,
  PostgreSQL verification, secret/flag isolation, canary, polling reliability,
  reconciliation, monitoring, rollback, and the ten-business-day shadow gate.
- Require a new explicit Product Owner approval before G5 implementation or
  any deployment, test/production credential, source feature flag, scheduled
  poll, or production-data access.
- Continue the solo-repository workflow: Codex records evidence and may merge a
  clean, mergeable PR only after self-QA; this does not waive product gates.
- Write-back, publishing, employee workflow changes, and autonomy remain out of
  scope.
Owner: Leoz. Recorded by Codex from the explicit solo-continuation instruction.

DECISION-002 addendum 7 — 2026-07-28 — S2.A reliability core authorized locally
Status: Approved by Leoz (Product Owner).
Decision:
- Treat the explicit instruction to continue after review of the merged G5
  proposal as approval for S2.A tasks T1–T4 only: persistent poll state,
  bounded coordination, fail-closed retry classification, and persistent
  circuit breaking in local/test scope.
- Keep reliability thresholds constructor-injected and test-controlled. The
  canonical 15-minute target may be represented in code, but no scheduler is
  mounted and no production retry/circuit defaults are activated.
- Require SQLite migration/restart/concurrency/failure-path evidence and the
  full regression suite before this core may merge.
- Keep T5–T8, P1, P2, external PostgreSQL provisioning, runtime deployment,
  secret or key creation, source feature flags, scheduled polling, and
  production-data access blocked pending their named approval checkpoints.
- Preserve GET-only/no-body source access and all existing no-write, PII,
  tenant, profile-isolation, and advisory-only boundaries.
Owner: Leoz. Recorded by Codex from the explicit instruction to continue.

DECISION-002 addendum 8 — 2026-07-28 — S2.A reliability core accepted
Status: Approved by Leoz (Product Owner).
Decision:
- Accept the local/test S2.A T1–T4 reliability core merged through `leozcrm`
  [PR #11](https://github.com/leozvu/leozcrm/pull/11) at `main@5d140a8`.
- Record the persistent lease, bounded retry, fail-closed classification, and
  restart-safe circuit capability as complete library infrastructure only.
- Keep Checkpoint A open. T5 reconciliation, T6 operator health, T7 commands,
  T8 runbooks, and live disposable PostgreSQL verification are not accepted or
  authorized by this addendum.
- Keep P1, P2, external provisioning, deployment, credentials, feature flags,
  scheduler activation, production-data access, write-back, publishing, and
  autonomous action blocked pending their explicit named approvals.
Owner: Leoz. Recorded by Codex from the instruction to continue the solo
workflow after the authorized core passed QA.

DECISION-002 addendum 9 — 2026-07-28 — S2.A operations core authorized locally
Status: Approved by Leoz (Product Owner).
Decision:
- Treat the explicit instruction to continue after acceptance of T1–T4 as
  approval for S2.A tasks T5–T8 in local/test code scope only.
- Authorize a persistent exact-reconciliation record, a sanitized operator
  health projection, and one-shot poll/reconcile/disable/recover commands that
  run inside the service environment.
- Authorize failure, replay, stale-data, recovery, database-outage, migration,
  and rollback tests plus local runbooks. Scheduled execution may be modeled
  and invoked explicitly in tests, but no scheduler or startup hook is mounted.
- Require reconciliation to record counts, IDs, hashes, status, and safe error
  classes only. It must never store source payloads, lead PII, credentials, raw
  headers, or raw exception bodies and must never repair or mutate Egoric.
- Keep live PostgreSQL provisioning, P1, P2, deployment, external credentials,
  feature flags, production-data access, scheduled polling, write-back,
  publishing, employee workflow changes, and autonomous action blocked.
Owner: Leoz. Recorded by Codex from the explicit instruction to continue after
the T1–T4 acceptance boundary was presented.

DECISION-002 addendum 10 — 2026-07-28 — S2.A T5–T8 accepted locally
Status: Approved by Leoz (Product Owner).
Decision:
- Accept the local/test Source Operations core merged through `leozcrm`
  [PR #13](https://github.com/leozvu/leozcrm/pull/13) at `main@1911349`.
- Record S2.A T1–T8 local/SQLite implementation complete: persistent polling
  reliability, immutable exact reconciliation, sanitized authenticated health,
  one-shot operator commands, and local failure/recovery runbooks all pass QA.
- Keep S2.A Checkpoint A open because the required live disposable PostgreSQL
  migrate/rollback/immutability smoke was skipped and remains unproved.
- Do not infer P1 or authorize an external target. Runtime/provider identities,
  policies, alert destination, retention, live PostgreSQL, deployment,
  credentials, feature flags, scheduler activation, and production data still
  require their named approvals.
- Write-back, publishing, employee workflow changes, and autonomy remain out of
  scope.
Owner: Leoz. Recorded by Codex from the instruction to continue the solo
workflow through the clean local/test task cut.

DECISION-002 addendum 11 — 2026-07-28 — S2.A PostgreSQL checkpoint accepted
Status: Approved by Leoz (Product Owner).
Decision:
- Treat the explicit instruction to continue after presentation of the
  PostgreSQL blocker as authorization for one disposable PostgreSQL smoke on
  the local machine only; no cloud/external target is authorized.
- Accept the PostgreSQL 16 migrate/seed/task/source-evidence/immutability/
  rollback PASS recorded in `docs/POSTGRES_SMOKE.md` and merged through PR #15
  at `leozcrm/main@5e9a4b7`.
- Record S2.A Checkpoint A technically complete. The complete T1–T8 code cut
  now passes SQLite, PostgreSQL, full LeozOps, RepositoryRealms, typecheck,
  local actual-handler E2E, dependency, secret, and boundary verification.
- Keep P1 blocked. Before P1, separately record the exact runtime/database
  providers and identities, regions/owners, business timezone/hours, reviewer,
  alert destination, approved runtime policies, and retention/access policy.
- This decision does not authorize a managed database, deployment, external
  credential or flag, scheduled worker, production data, write-back,
  publishing, employee workflow change, or autonomous action.
Owner: Leoz. Recorded by Codex from the explicit instruction to continue after
the named local PostgreSQL checkpoint was presented.

DECISION-002 addendum 12 — 2026-07-28 — P1 decision preflight authorized
Status: Approved by Leoz (Product Owner).
Decision:
- Treat the explicit instruction to continue after Checkpoint A acceptance as
  authorization for local-only P1 decision tooling and documentation.
- Create a fail-closed, secret-reference-only manifest validator covering the
  exact runtime, database, Egoric deployment, business calendar, reviewer,
  alert, polling, retention/access, and monthly-budget decisions.
- Record Render web service + command-and-exit cron + independent Render
  Postgres as the provisional smallest solo-founder recommendation only. It is
  not an approved provider, plan, purchase, project, database, or deployment.
- Permit Leoz to be both Director reviewer and on-call owner for the smallest
  pilot; this does not create a collaborator or weaken authentication.
- Keep P1 blocked until one complete manifest passes local preflight and Leoz
  separately accepts its exact values in a later DECISION-002 addendum.
- Accept the local decision tooling and evidence merged through PR #17 at
  `leozcrm/main@35ed23c`; this acceptance does not approve the pending example.
- This decision does not authorize account creation, paid spend, managed
  infrastructure, deployment, credentials, feature flags, scheduler
  activation, production data, write-back, publishing, employee workflow
  change, or autonomous action.
Owner: Leoz. Recorded by Codex from the instruction to continue the solo
workflow after S2.A Checkpoint A was merged and accepted.

2026-07-18 — Egoric is the operational system of record; LeozOps becomes a read-only intelligence layer
Decision: Keep Egoric as the sole CRM/ERP and employee workflow system. Integrate LeozOps as a separately deployed, read-only API intelligence service for versioned KPIs, CEO Briefs, and advisory recommendations.
Context: Egoric is already deployed and used by real employees. LeozOps contains useful deterministic intelligence components but also duplicates clients, leads, campaigns, tasks, onboarding, and publishing responsibilities. Launching both as operational CRMs would create double entry, ownership conflicts, and production risk.
Rationale:
- Preserves existing employee workflows and gives every operational entity one owner.
- Reuses the highest-value LeozOps components without making LeozOps another ERP.
- A narrow REST export provides an auditable, versioned, revocable boundary.
- A separate LeozOps deployment and database limit blast radius.
- Read-only shadow operation makes correctness measurable before any UI exposure.
Decision boundaries:
- Egoric owns clients, leads, tasks, users, invoices, and operational workflows.
- External ad platforms own delivery facts; Egoric may later own a canonical campaign reference. LeozOps owns neither campaign master.
- LeozOps owns derived metric definitions/snapshots, briefs, and advisory recommendations.
- The pilot uses a dedicated `LEOZOPS_READ` GET-only, PII-minimized lead snapshot. It does not use a Director key, generic CRUD API, existing webhooks, queue, or direct database access.
- No write-back, autonomous external action, production DB write, shared database credential, double entry, or big-bang rewrite.
- The Egoric-native funnel is preserved; no historical conversion is claimed without stage history.
Supersedes:
- The prior assumption that M10 should deploy LeozOps as a standalone operational CRM for the Egoric organization.
- The prior sequencing assumption that real publishing or task automation is the next integration priority.
Does not delete:
- Existing CRM/task/email code or its historical test evidence. Those capabilities remain present but are excluded from the Egoric read-only integration deployment profile.
Implementation contract: `docs/EGORIC_INTEGRATION.md`.
Alternatives considered:
- Embed the full LeozOps application inside Egoric: rejected because it couples releases and duplicates domain logic.
- Use a background worker with direct Supabase access: rejected because it bypasses API authorization/audit and broadens production blast radius.
- Use Egoric webhooks first: rejected because delivery is not yet durable or replayable.
- Use a Director API key against generic `/api/v1/*`: rejected because the key also has write capability.
- Bidirectional entity sync: rejected because it creates two operational owners and conflict resolution requirements.
Owner: Leoz (Product Owner). Hermes owns sequencing; Claude Code owns implementation within the contract; Codex owns release QA.

2026-06-12 — M10 milestone state reclassification: local code PASS / deployment BLOCKED
Decision: Classify current M10 work as local code verified but deployment blocked. Do not mark M10 fully PASS until PostgreSQL smoke and live pilot verification are executed.
Context: Local verification is complete (159/159 tests green, typecheck clean) and M10.1 was committed. Codex review explicitly requires deployment evidence: real `npm run db:smoke:pg` output and recorded pilot verification on a live instance.
Rationale:
- Code verification and deployment verification are different gates. Promoting M10 to PASS without the deployment gate would misrepresent launch readiness.
- Delaying feature work until the gate closes prevents false progress and forces infrastructure/ops to be resolved.
Alternatives considered:
- Mark M10 PASS anyway: would hide a real risk and set false milestones-complete signal.
- Continue building new features while deployment is blocked: wastes feature work if infra fails.
Owner: Hermes (PM)

Remediation plan to close M10 deployment gate:
1. Provision PostgreSQL environment.
2. Run `npm run db:smoke:pg` against the real instance and record PASS or a specific blocker.
3. Deploy API in a real hosting environment.
4. Execute live pilot verification:
- `GET /ready` returns 200.
- `POST /onboarding` with admin auth creates tenant and issues token.
- Pilot tenant calls create campaign/lead/task.
- Pilot tenant reads briefs and recommendations against live data.
5. Record results: base URL, client_id, `/ready` result, live instance verification summary.
6. Only when both Postgres smoke and pilot verification are complete: mark M10 PASS in `CHECKLIST.md` and `ROADMAP.md`, then continue to the next milestone.

2026-06-12 — Milestone #10 implementation: client onboarding workflow + readiness probe
Decision: Implement the codeable M10 launch surface on the existing stack: onboarding service + admin route, readiness probe, `npm run onboard` CLI, and pilot runbook.
Context: M9 passed QA; M10 is current. The deployable code can’t be fully validated until a real PostgreSQL host is available, but the implementation surface is complete.
Rationale:
- Uses M7 auth/tenant model unchanged.
- Additive only: no schema redesign.
- `/ready` validates platform readiness from real infrastructure signals when deployed.
Alternatives considered:
- Build hosting/deploy automation into M10: out of scope; ops/hosting is env-specific.
- Add a users/identity table for operator logins: rejected; M7 per-client token model is sufficient for the launch operator.
Owner: Claude Code (Senior Dev), within the M10 scope.

2026-06-12 — M9 remediation complete: task validation and deterministic audit ordering
Decision: M9 Task Engine now passes QA after adding UUID-shape/gating validation before DB access, audit-note type/length guards, monotonic `seq` on `task_status_events`, composite unique order key `uq_task_events_task_seq`, and corresponding route/task+events coverage.
Context: M9 shipped initially with malformed input reaching the repository boundary and non-guaranteed audit ordering when rapid transitions shared millisecond timestamps. After review, the issue was patched and QA passed; `task_status_events` no longer relies on timestamp tie-breaking for read order.
Rationale:
- Front-door validation in the repository means malformed request values return 400 and never touch the DB.
- A 1-based monotonic `seq` per task makes the audit trail authoritative without depending on DB row-id insertion guarantees.
- Backward compatibility preserved: migration added columns with app-side assignment (no schema rewrite).
Alternatives considered:
- Rely only on timestamp + row-id ordering (no seq): rejected because it kept display order DB-dependent.
- Use timestamps alone with retry hacks: rejected because explicit sequence is simpler and deterministic.
Owner: Claude Code / Codex / Hermes (M9 QA loop)
DECISION-002 addendum 13 — 2026-07-29 — complete Phase 2 local control plane authorized
Status: Approved by Leoz (Product Owner) for local repository implementation.
Decision:
- Treat the explicit instruction to complete all of Phase 2 as authorization
  to implement every remaining S2.B–S2.D code, migration, test, manifest,
  evidence, evaluator, CLI, and runbook artifact that can be completed without
  creating or changing an external environment.
- Authorize fail-closed Checkpoint B and P2 decision contracts, an externally
  scheduled command-and-exit read worker, immutable poll and daily shadow
  evidence, G5 acceptance evaluation, and go/extend/revoke decision records.
- Require the worker to validate the exact P1 identity in test and the complete
  P1 → Checkpoint B → P2 chain in production before any source request.
- Keep the existing authenticated CEO Brief as the only product read surface;
  add no dashboard, publishing, write-back, generic Egoric access, employee
  workflow, or autonomous action.
- Do not infer that repository implementation creates P1/P2 approval or proves
  external facts. Managed infrastructure, purchases, deployment, credentials,
  source flags, network proof, production canary, and ten elapsed business days
  remain blocked until separately executed against accepted named targets.
- For this solo-founder pilot Leoz may remain reviewer/on-call/Product Owner,
  but pending templates and simulated dates must never be recorded as live G5
  evidence.
Owner: Leoz. Recorded by Codex from the explicit instruction to complete
Phase 2 while preserving the plan's authorization wall.

DECISION-002 addendum 14 — 2026-07-29 — Phase 3/G6 local control plane authorized
Status: Approved by Leoz (Product Owner) for local repository implementation.
Decision:
- Treat the explicit instruction to continue to the next phase as approval to
  implement the complete local Phase 3/G6 Supervised Action control plane on a
  branch based on the completed Phase 2 work.
- Authorize exact, fail-closed contracts for one-command-at-a-time policy,
  proposal, dry-run preview, human approval, idempotent execution, immutable
  evidence, expiry, risk/budget/rate limits, and separately approved rollback.
- Preserve G5 as a hard prerequisite. Every G6 policy and every new execution
  must bind to an immutable, still-current Phase 2 `go` decision; a later
  `extend` or `revoke` immediately blocks new action. A separately approved,
  idempotent rollback of an already successful action remains available for a
  bounded 24-hour safety window so revocation cannot disable recovery.
- For the solo-founder workflow, Leoz may hold proposer, approver, and operator
  roles, but approval and execution use separate credential fingerprints and
  no proposal may self-approve or execute automatically.
- Add only an injected command-adapter boundary and deterministic test adapter.
  Do not invent or call a RepositoryRealms write endpoint, create a production
  credential, enable a command, deploy, purchase infrastructure, or mutate any
  external system under this authorization.
- Require each future real command to receive its own accepted policy, schema,
  dry-run and rollback implementation, command-specific QA, and Product Owner
  release decision before registration in a deployed operator.
Owner: Leoz. Recorded by Codex before Phase 3 implementation.

DECISION-002 addendum 15 — 2026-07-29 — Phase 4/G7 local rehearsal authorized
Status: Approved by Leoz (Product Owner) for local repository implementation.
Decision:
- Treat the explicit instruction to continue to the next step as approval to
  implement an inert Phase 4/G7 bounded-autonomy rehearsal and control plane on
  a branch based on the completed Phase 3 work.
- Preserve G5 and G6 as hard external prerequisites. Local code may simulate,
  validate, persist, and adversarially test a G7 policy, but it must not assert
  that G7 is earned or manufacture supervised production history.
- Limit the first autonomy envelope to one exact low-risk G6 command, one
  candidate per command-and-exit cycle, one mutation at most, tighter hourly,
  daily, cost, cooldown, freshness, and validity bounds, and no wildcard scope.
- Require a passing deterministic policy simulation, qualifying immutable G6
  supervised history, a current G5 `go`, an active exact G6 policy, a fresh
  source snapshot, no open incident, and a released kill switch before an
  injected adapter can be called.
- Start and fail closed with the kill switch engaged. Any failed, invalid,
  over-envelope, crashed, or unknown action result must create immutable
  incident evidence and engage the kill switch before another cycle can run.
- Keep human release, executor, and kill-switch credentials distinct even when
  Leoz performs all roles. Recovery remains human-controlled; no autonomous
  rollback, self-resolution, scheduler, daemon, HTTP action route, external
  credential, or background loop is authorized.
- Keep the checked-in production action-adapter registry empty. A deterministic
  injected test adapter may prove local mechanics, but no RepositoryRealms
  command, network request, deployment, or external mutation is authorized.
Owner: Leoz. Recorded by Codex before Phase 4 implementation.

DECISION-002 addendum 16 — 2026-07-30 — Phase 5 operational assurance authorized
Status: Approved by Leoz (Product Owner) for local repository implementation.
Decision:
- Treat the explicit instruction to build Phase 5 as approval for an inert
  operational-assurance and release-evidence control plane on a branch based on
  the completed Phase 4 work.
- Phase 5 does not create G8 or broaden G7 action authority. It may derive and
  persist deterministic safety assessments from existing immutable G5/G6/G7
  records, but it must never convert local rehearsal facts into production
  evidence.
- Bind one exact assurance policy to one accepted G7 policy and require
  separate assurance-authority, assessor, and release-reviewer credential
  fingerprints, all distinct from every G7 and G6 credential.
- Evaluate local policy integrity, current upstream decisions, simulation,
  kill-switch state, incidents, bounded execution outcomes, recovery drills,
  and incident/halt drills from database facts only. Operator-supplied success
  booleans, arbitrary evidence claims, or waivers are not accepted.
- Every Phase 5 release package must remain `blocked_external` while production
  G5/G6/G7 evidence is absent. Local tests, injected adapters, synthetic dates,
  or a local Product Owner identity cannot satisfy external deployment,
  monitoring, canary, supervised-history, drill, or release requirements.
- Keep production adapter composition empty and add no network request,
  scheduler, daemon, background loop, HTTP mutation route, credential, provider
  resource, deployment, or external system change.
Owner: Leoz. Recorded by Codex before Phase 5 implementation.

DECISION-002 addendum 17 — 2026-07-30 — Phase 6 signed external-evidence admission authorized
Status: Approved by Leoz (Product Owner) for local repository implementation.
Decision:
- Treat the explicit instruction to continue to the next phase as approval to
  implement a local trust bridge for the eight external blockers named by the
  immutable Phase 5 release package.
- Bind one exact Phase 6 policy to one passing Phase 5 assessment and its exact
  `blocked_external` package. Pin four Ed25519 issuer identities and public keys;
  accept only canonical, signed, time-bounded attestations for the fixed evidence
  matrix. Operator booleans, untrusted keys, unknown evidence types, inferred
  evidence, wildcard scope, and waivers remain invalid.
- Store accepted attestations and assessments as immutable evidence. Reject
  invalid signatures, wrong issuers, wrong tenant/source/package bindings,
  stale or future evidence, conflicting replay, and non-monotonic statements.
  A signed revocation supersedes the latest pass for its evidence type and
  immediately makes the matrix incomplete.
- Leoz may perform the local trust-authority and assessor roles, but their
  credential fingerprints remain separate from each other and from all Phase 5,
  G7, and G6 credentials. Issuer private keys and raw external evidence are never
  persisted; only pinned public keys, signatures, digests, and metadata are kept.
- A complete eight-of-eight matrix is `complete_unreleased`, never a production
  release. Phase 6 creates no G8, activation endpoint, adapter registration,
  scheduler, daemon, HTTP mutation route, external credential, deployment, or
  network call. Real trust-root enrollment and any production activation require
  a separately authorized phase against named infrastructure.
Owner: Leoz. Recorded by Codex before Phase 6 implementation.

DECISION-002 addendum 18 — 2026-07-30 — Phase 7 activation ceremony authorized
Status: Approved by Leoz (Product Owner) for local repository implementation.
Decision:
- Treat the explicit instruction to start Phase 7 as approval to implement a
  local production-activation ceremony and sealed external handoff on a branch
  based on the completed Phase 6 work.
- Bind one exact Phase 7 policy to a fresh, current `complete_unreleased`
  Phase 6 assessment and its complete signed evidence set. Require one named
  target plus exact artifact, configuration, credential-reference, canary, and
  rollback fingerprints; placeholders, URLs, raw credentials, wildcard scope,
  inferred evidence, and waivers remain invalid.
- Require distinct ceremony-authority, independent-verifier, and activation-
  operator credential fingerprints. Leoz may perform all three solo-founder
  roles, but each ceremony step remains separately authenticated and recorded.
- Persist immutable candidate dossiers, approve/reject verifications, sealed
  handoff packages, recalls, and ordered events. Revalidate Phase 6 evidence,
  upstream G5/G6/G7/Phase 5 state, target consistency, expiry, and event drift
  before sealing. A recall is additive and must never rewrite prior evidence.
- Phase 7 is handoff-only. Even a sealed production package remains
  `not_executed` and requires a separately authorized external executor. Add no
  deploy/activate/promote method, production adapter registration, scheduler,
  daemon, HTTP mutation route, provider credential, private key, network call,
  managed resource, or external system change.
Owner: Leoz. Recorded by Codex before Phase 7 implementation.

DECISION-002 addendum 19 — 2026-08-01 — Phase 8 controlled activation authorized
Status: Approved by Leoz (Product Owner) for local repository implementation.
Decision:
- Treat the explicit instruction to build the final phase as approval to
  implement the final controlled-activation control plane on a branch based on
  the completed Phase 7 ceremony. This authorizes code, deterministic injected
  test adapters, and disposable local database evidence; it does not authorize
  use of a real target credential, provider account, deployment, or external
  mutation from this workstation.
- Bind one exact Phase 8 policy to one current, unrecalled Phase 7 sealed
  handoff and its exact target, adapter artifact, configuration,
  credential-reference, canary, and rollback fingerprints. Placeholders,
  wildcard scope, inferred readiness, raw credentials, waivers, and retargeting
  remain invalid.
- Require distinct activation-release, executor, safety-observer, and rollback
  credential fingerprints, separate from every Phase 7/6/5/G7/G6 credential.
  Leoz may perform all solo-founder roles, but every transition remains
  independently authenticated and audit-recorded.
- Start with the kill switch engaged. Release requires authority plus safety
  observer authentication. Permit one explicit command-and-exit activation
  attempt for the policy, with one external mutation at most and exact adapter
  evidence. Unknown adapter outcomes become terminal incident evidence; an
  expired orphan claim is reconciled to terminal unknown without another
  adapter call. Neither path may be automatically retried.
- Require an explicit later observation against the same adapter and provider
  receipt. Success may close the local control plane as `activated_healthy`;
  unhealthy or unknown evidence requires an explicit human recovery decision.
  Rollback is separately authenticated, idempotent, evidence-bound, and never
  automatic.
- Keep the checked-in production activation-adapter registry empty. Add no real
  provider adapter, target credential, scheduler, daemon, background loop, HTTP
  mutation route, managed resource, infrastructure purchase, or live external
  call. A real activation remains a separate deployment/configuration act using
  a reviewed adapter and least-privilege secret outside this implementation.
Owner: Leoz. Recorded by Codex before Phase 8 implementation.

DECISION-002 addendum 20 — 2026-08-01 — Jarvis completion track approved
Status: Approved by Leoz (Product Owner) as the planning baseline.
Decision:
- Treat the instruction to plan and continue toward an Iron-Man-like Jarvis as
  approval to define the bounded LeozOps Jarvis v1 outcome and its ordered
  product/evidence roadmap in `docs/JARVIS_COMPLETION_PLAN.md`.
- Stop extending abstract activation control planes as the default next move.
  Prioritize visible vertical product increments: evidence-grade conversation,
  the CEO cockpit, proactive alerts, live read-only trust, goal-aware planning,
  one real supervised command, and only then bounded autonomy and ambient
  access.
- Run repository product work and external production-truth work as two lanes
  only where external elapsed evidence would otherwise idle development. Test
  providers, fixtures, disposable databases, and simulated dates never satisfy
  live G5/G6/G7 or Jarvis release evidence.
- Authorize Phase 9A as the immediate proposed repository increment: durable
  CEO conversation/context contracts, typed read-only tools, grounded evidence
  packs, authenticated Ask endpoints, deterministic provider tests, and golden
  evaluations. This planning decision does not authorize a production language
  model credential, generic tool access, action adapter, deployment, source
  credential, external mutation, scheduler, or autonomous runtime.
- Preserve Egoric as the operational system of record and preserve every
  existing release gate. Conversation, a medieval interface, voice, or Jarvis
  language must never be interpreted as execution authority.
Owner: Leoz. Recorded by Codex from the explicit request to plan and continue.

DECISION-002 addendum 21 — 2026-08-01 — Phase 9A grounded conversation core authorized
Status: Approved by Leoz (Product Owner) for local repository implementation.
Decision:
- Treat the explicit instruction to plan and continue as approval to implement
  the Phase 9A repository increment defined by addendum 20 on a branch based on
  the completed Jarvis roadmap commit.
- Authorize append-only, tenant-scoped conversations, ordered messages,
  provider claims/results, exact citations, versioned goals/constraints/
  decisions, and immutable feedback in the LeozOps database. These are
  analytical/advisory records and never operational Egoric records.
- Require a PII-minimized evidence pack derived from the deterministic CEO
  Brief, six fixed read projections, an exact fact/inference/recommendation/
  limitation answer contract, citations for every material claim, explicit
  insufficient-data behavior, input/output/cost/time budgets, and terminal
  failure evidence.
- Permit only a deterministic bilingual provider and injected test providers
  in checked-in composition. The provider has no network, secret, generic SQL,
  HTTP, filesystem, browser, code-execution, scheduler, or action capability.
- Permit authenticated POST routes only for LeozOps-owned conversation,
  context, and feedback evidence. Preserve the `egoric-readonly` source
  boundary and every G5/G6/G7 action gate.
- Do not infer authorization for a production language-model SDK, API key,
  model selection, external deployment, notification loop, UI, voice, or
  action adapter. These remain Phase 9B or later decisions.
Owner: Leoz. Recorded by Codex before Phase 9A implementation completion.

DECISION-002 addendum 22 — 2026-08-01 — Phase 9B OpenAI Advisor adapter authorized
Status: Approved by Leoz (Product Owner) for local repository implementation.
Decision:
- Treat the explicit instruction to continue implementation as approval to add
  one reviewed OpenAI Responses API adapter behind the frozen Phase 9A
  provider, evidence, answer, citation, idempotency, and failure contracts on a
  new branch. This approval covers code, injected transports, frozen evals, and
  documentation; it does not authorize installing or using a real API key in
  this session or deploying the adapter.
- Pin the adapter to the official `gpt-5.6-sol` model and
  `https://api.openai.com/v1/responses`. Require strict Structured Outputs,
  stateless storage, current-turn reasoning, one bounded response, no retry,
  and no configurable endpoint or unreviewed model.
- Send only the existing PII-minimized structured evidence pack. Expose no
  function, web, file, browser, SQL, code-execution, scheduler, or action tool.
  Generated language remains advisory and every persisted claim must pass the
  existing domain citation validator.
- Keep deterministic composition as the default. OpenAI requires explicit
  provider selection plus a runtime `OPENAI_API_KEY`; missing or invalid
  configuration fails startup. Secrets never enter provider identity,
  persistence, eval output, logs, fixtures, or errors.
- Version the reviewed cost rate card and reject a request before transport
  when its conservative maximum cannot fit the run budget. Add a 12-case eval
  with 100% contract and 90% behavior thresholds, but require a separately
  acknowledged billable command before any live evaluation.
- Keep Phase 9 durable answers non-streaming. Phase 10 may separately design an
  ephemeral cockpit stream, but it may not persist or present unvalidated
  partial claims as accepted evidence.
- J1 remains open for live use until credential revocation, privacy, live eval,
  repeated cost/latency, monitoring, named deployment, and Product Owner SLO
  acceptance evidence exist. G5/G6/G7 and all action authority remain
  unchanged.
Owner: Leoz. Recorded by Codex before Phase 9B implementation completion.

DECISION-002 addendum 23 — 2026-08-01 — Phase 10 medieval CEO cockpit authorized
Status: Approved by Leoz (Product Owner) for local repository implementation.
Decision:
- Treat the explicit instruction to continue development as approval to build
  the Phase 10 repository increment on a new branch based on completed Phase
  9B. This covers the local web experience, deterministic fixtures, browser
  QA, tests, and documentation; it does not authorize deployment or a live
  provider call.
- Apply the approved Realm v2 medieval language to the CEO cockpit while
  preserving semantic state clarity, keyboard operation, AA-oriented
  contrast, reduced motion, high contrast, and responsive layouts.
- Expose Today, Ask LeozOps, Business, Recommendations, and a Command Deck.
  The shell must contain no tenant data. Evidence arrives only through the
  exact tenant-authenticated LeozOps API.
- Permit progressive visual reveal only after the complete Phase 9 answer has
  passed server-side grounding and citation validation. Partial generated text
  must never be presented or persisted as accepted evidence.
- Keep every command state observational. Approval, execution, receipt,
  rollback, incident, and kill-switch labels must report unavailable/blocked
  truth and expose no action adapter, direct Egoric post, credential, generic
  tool, scheduler, notification loop, or mutation route.
- Treat local automated/browser QA as a J2 candidate only. Live J2 still needs
  a recorded founder usability run against a named deployment after live J1
  and G5 evidence are accepted.
Owner: Leoz. Recorded by Codex before Phase 10 implementation completion.

DECISION-002 addendum 24 — 2026-08-01 — Phase 11 proactive nervous system authorized
Status: Approved by Leoz (Product Owner) for local repository implementation.
Decision:
- Treat the explicit request to implement Phase 11 as approval for the local
  deterministic alert, outbox, founder-state, quality-baseline, cockpit, test,
  and documentation increment on a new branch based on completed Phase 10.
- Derive alerts only from accepted Business Memory and deterministic CEO Brief
  facts. Version thresholds and fail closed for stale, future, or partial data.
- Require append-only tenant evidence, cycle/episode idempotency, worsening-only
  re-alert, cooldown, quiet hours, bounded snooze, resolution, stable logical
  delivery keys, receipts, and unknown-outcome replay blocking.
- Permit authenticated acknowledgement, snooze, and immutable useful/false-
  positive evidence because they belong to LeozOps; do not mutate Egoric.
- Permit a command-and-exit operator and injected test adapters. Do not install
  a scheduler, daemon, background loop, production channel, provider secret,
  deployment, generic tool, or action authority.
- Treat local tests and simulated outcomes only as a J3 candidate. Live J3
  requires a deployed reviewed channel/scheduler, at least 20 genuine founder
  reviews, accepted <=10% false positives and <=3 alerts/day, delivery SLO and
  incident evidence, named deployment, real G5, and Product Owner acceptance.
Owner: Leoz. Recorded by Codex before Phase 11 implementation completion.

DECISION-002 addendum 25 — 2026-08-01 — Phase 12 live observer authorized
Status: Approved by Leoz (Product Owner) for local repository implementation.
Decision:
- Treat the explicit request to implement Phase 12 as approval for production
  packaging, fail-closed deployment configuration, one-shot observer
  orchestration, operational telemetry, recovery tooling, tests, and docs on a
  new branch. It does not authorize provisioning or deployment.
- Preserve the existing P1/P2 and read-only source boundary. The observer may
  run one source poll followed by one deterministic proactive evaluation; it
  may not start in the HTTP process, mutate Egoric, or acquire action authority.
- Require an accepted exact target manifest with secret references only and
  matching runtime, database, and Egoric identities. Missing target, binding,
  credential, or migration blocks startup/operator execution.
- Emit structured redacted logs, request/trace correlation, protected
  aggregate telemetry, and append-only observer/recovery evidence.
- Permit backup from the named PostgreSQL service. Permit automated restore
  only to a differently named disposable service after an exact acknowledgement;
  production restoration remains an external human incident procedure.
- Keep J4 open. A container, CI PostgreSQL, fixture, simulated date, or local
  drill cannot substitute for the named platform, P1/P2, ten elapsed business
  days, live drills, monitoring evidence, and a real G5 `go`.
Owner: Leoz. Recorded by Codex before Phase 12 implementation completion.

DECISION-002 addendum 26 — 2026-08-01 — Phase 13 goal-aware Planner authorized
Status: Approved by Leoz (Product Owner) for local repository implementation.
Decision:
- Treat the explicit request to continue with Phase 13 as approval to implement
  strict durable goals, deterministic plan versions, conflict detection,
  simulations/comparison, checkpoints, outcomes, tenant APIs, cockpit review,
  tests, and documentation on a new branch.
- Bind each plan to one immutable goal version, accepted source snapshot,
  intelligence run, formula, cutoff, policy version, and complete graph hash.
  Goal or source changes create append-only versions; silent mutation is denied.
- Permit founder accept/reject decisions and useful/not-useful outcomes because
  they mutate only LeozOps-owned evidence. Acceptance records intent and grants
  no action authority.
- Require every action-shaped step to contain no command payload or adapter,
  remain `not_authorized`, and route only to the existing separately gated G6
  proposal/preview/approval path.
- Treat scenarios as deterministic planning heuristics with explicit
  uncertainty, not causal or revenue forecasts. Blocking evidence, goal,
  policy, budget, or capacity conflicts prevent acceptance.
- Keep live J5 open. Local SQLite, PostgreSQL CI, fixtures, or simulated dates
  cannot replace a named-deployment founder review using accepted live J1
  evidence and explicit Product Owner acceptance.
Owner: Leoz. Recorded by Codex before Phase 13 implementation completion.

DECISION-002 addendum 27 — 2026-08-01 — Phase 14 supervised-hand qualification authorized
Status: Approved by Leoz (Product Owner) for local repository implementation.
Decision:
- Treat the explicit request to continue after Phase 13 as approval to inspect
  the real RepositoryRealms command boundary and implement a local Phase 14
  readiness slice on a new branch. This does not authorize changing the source
  repository, registering an adapter, deploying, or executing a command.
- Select only `task.create` with the `command.task.create` scope as the candidate.
  Pin its exact source commit and blob evidence and restrict LeozOps input to an
  unassigned, PII-minimized task payload.
- Preserve the existing G6 proposal, preview, approval, execution, rollback,
  receipt, incident, idempotency, and immutable-evidence boundaries. Expose
  only sanitized tenant-scoped state through the Command Deck.
- Fail closed because the audited source has no dedicated G6-compatible LeozOps
  endpoint, guaranteed zero-mutation preview, or separately approved rollback,
  and because the production adapter registry and live G5/G6 authority remain
  absent.
- Require any RepositoryRealms preview/rollback work to occur on its own branch
  and pass separate review before the LeozOps source pin or adapter can change.
- Keep J6 open. Local fixtures, simulated G6 records, UI states, and tests do
  not constitute a real supervised hand or production execution history.
Owner: Leoz. Recorded by Codex before Phase 14 readiness completion.

DECISION-002 addendum 28 — 2026-08-08 — Phase 14 source contract implementation authorized
Status: Approved by Leoz (Product Owner) for isolated local implementation.
Decision:
- Treat the explicit instruction to continue building LeoZOps with Ruflo as
  authorization to implement the previously required RepositoryRealms source
  contract on its own `codex/` branch and re-audit the LeozOps qualification.
- Limit the source capability to `egoric.task.create.v1`, an exact five-field
  unassigned payload, a default-off dedicated endpoint, zero-business-mutation
  preview, separate execute approval, idempotent execution/receipt, exact-state
  rollback preview, new separate rollback approval, and idempotent rollback.
- Permit Ruflo only as an observe-only engineering harness for SPARC planning,
  routing advice, doctor checks, and focused security scans. It grants no
  product authority and may not auto-spawn agents, run workers, or execute a
  source mutation.
- Permit LeozOps to pin the uncommitted source branch, base commit, exact blob
  hashes, and aggregate patch fingerprint only as working-tree evidence. The
  qualification must remain blocked until an immutable reviewed revision and
  canonical `main` release exist.
- Keep the production adapter registry empty. This authorization does not
  permit commit, push, merge, deploy, migration deployment, credentials,
  feature-flag enablement, adapter registration, a live command, G5/G6/G7
  release, J6 acceptance, or autonomous rollback.
- Adopt the attached L0–L5/Phase 1–9 blueprint as a long-horizon completion map,
  not as a reset of the already completed Sprint 1 and Phase 2–14 repository
  work. R4 actions always retain explicit human approval.
Owner: Leoz. Recorded by Codex during the Ruflo-assisted Phase 14 source-contract cut.

DECISION-002 addendum 29 — 2026-08-09 — Exact RepositoryRealms adapter authorized
Status: Approved by Leoz (Product Owner) for local repository implementation.
Decision:
- Treat the instruction to build the full path to a RepositoryRealms Jarvis as
  authorization to implement the exact Phase 15 adapter and release boundary,
  but not to register it, inject live credentials, enable the source flag,
  execute a command, deploy, commit, push, or merge.
- Restrict the adapter to `egoric.task.create.v1`, the dedicated endpoint and
  receipt path, one exact target, five PII-minimized fields, and the source's
  preview/approval/execute/rollback operations.
- Require distinct operation credentials and subjects, fresh preview/effect
  matching, canonical response/receipt hashes, one bounded attempt, no retry
  after unknown outcome, and explicit reconciliation.
- Permit human G7 recovery only through the same separately approved source
  rollback. Preserve the empty default registry and require canonical merged
  source qualification plus exact release/G5/G6/runtime binding.
Owner: Leoz. Recorded by Codex before Phase 15 repository completion.

DECISION-002 addendum 30 — 2026-08-09 — Ambient Jarvis v1 candidate authorized
Status: Approved by Leoz (Product Owner) for local repository implementation.
Decision:
- Permit an installable mobile shell, push-to-talk transcript input,
  on-demand validated speech output, append-only personal preferences,
  product/safety evaluation, readiness visibility, and data-governance controls.
- Cache only data-free cockpit assets. Never cache `/v1`, store credentials in
  browser persistence, retain audio, auto-send voice, or let an action-shaped
  turn skip its explicit advisory confirmation.
- Measure answer, citation, alert, plan, action, latency, cost, and safety
  evidence from tenant-scoped database records. Empty samples remain
  insufficient and every J1–J8 live status remains blocked without its named
  external evidence.
- Permit confirmed sanitized export. Permit delete-request capture only; actual
  deletion stays disabled until retention, privacy/legal, backup, immutable
  evidence, and operator enforcement receive separate acceptance.
- Require the release/incident runbook and 30 live days before Product Owner J8.
  Local tests, fixtures, UI, PWA installation, or a generated report cannot
  satisfy live J6/J7/J8.
Owner: Leoz. Recorded by Codex before Phase 16 repository completion.

DECISION-002 addendum 31 — 2026-08-09 — Canonical integration release authorized
Status: Approved by Leoz (Product Owner) for repository publish and evidence-bound promotion.
Decision:
- Treat the explicit instruction to “do it all” after the release plan as
  authorization to remediate dependencies, commit, push, open PRs, merge after
  automated gates pass, and attempt staging/canary only where exact runtime
  credentials and named-environment evidence actually exist.
- Merge RepositoryRealms first, then re-pin LeoZOps to the resulting canonical
  commit. Never bind LeoZOps to an unmerged branch or stale release digest.
- Because the repository is solo and an author cannot self-approve, permit the
  owner review bypass only after every configured migration, coverage, audit,
  build, E2E, and preview check passes. Do not bypass a failed or pending check.
- Dependency remediation must use compatible patched versions and pass the
  complete repository suites; no framework major upgrade is implied.
- Keep source feature flags, credentials, adapter registration, migrations,
  live commands, and production acceptance fail-closed whenever their named
  environment or evidence is unavailable. Authorization to attempt promotion
  does not authorize fabricated G5/G6/J1-J8 history or shortened elapsed gates.
Owner: Leoz. Recorded by Codex during the canonical Phase 14–16 release pass.

DECISION-002 addendum 32 — 2026-08-09 — Isolated local staging authorized
Status: Approved by Leoz (Product Owner) for non-production provisioning.
Decision:
- Treat the explicit instruction to proceed after the canonical release as
  authorization to provision one production-shaped local staging environment
  using only newly generated local secrets and independent Docker resources.
- Name the target `leozops-local-staging`; bind it to an independent PostgreSQL
  16 database, the reviewed non-root image, an exact staging manifest, and an
  HTTPS token-protected PII-minimized fixture source.
- Permit migrations, idempotent tenant/source fixture provisioning, loopback
  health/readiness/auth probes, restart persistence, and backup/restore into a
  separately named disposable database that is removed after the drill.
- Keep the production action registry empty and omit source task flags,
  RepositoryRealms command credentials, schedulers, OpenAI credentials, and
  live business data. Generated secrets, manifests, certificates, and keys stay
  untracked and are never printed.
- This local environment closes only the reproducible packaging/infrastructure
  rehearsal. It cannot satisfy P1/P2, G5/G6/G7, J4-J8, supervised history, or
  any elapsed evidence window.
Owner: Leoz. Recorded by Codex during local staging provisioning.

DECISION-002 addendum 33 — 2026-08-11 — Talking Jarvis foundation authorized
Status: Approved by Leoz (Product Owner) for repository implementation and evidence-bound release.
Decision:
- Treat the explicit instruction to continue toward a talking CEO Jarvis as
  authorization to implement, test, publish, and merge the Phase 17 repository
  foundation under the canonical integration-release rules in addendum 31.
- Use browser WebRTC for microphone and remote audio. Mint only a short-lived
  client secret through a server-side broker; the standard provider API key
  must remain server-only and neither secret may enter durable evidence, logs,
  browser storage, or checked-in configuration.
- Require every spoken turn to call the existing tenant-scoped read-only
  Advisor. Voice has `action_authority: none`; action-shaped speech is blocked
  until the CEO uses the reviewed text and Command Deck confirmation path.
- Retain no raw audio or transcript in LeozOps. Permit only append-only,
  privacy-minimized session-state evidence, interruption metadata, safe failure
  codes, hashes, provider/model identifiers, and timestamps.
- Keep the voice provider disabled by default. Without an approved server key,
  named deployment, live WebRTC/audio proof, grounding and interruption evals,
  privacy/latency/cost evidence, and CEO acceptance, label the result only a
  repository candidate and leave J1–J8 unchanged.
Owner: Leoz. Recorded by Codex during Phase 17 Talking Jarvis implementation.
