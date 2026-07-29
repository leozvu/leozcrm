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
