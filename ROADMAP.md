# LeozOps — Roadmap

> **Governing decision:** DECISION-002 (DECISIONS.md, 2026-07-18). Egoric is
> the operational system of record; LeozOps is a read-only intelligence
> platform. All future milestones follow the "LeozOps Intelligence
> Integration" track below unless superseded by another ADR.
> Canonical contract: `docs/EGORIC_INTEGRATION.md`.
> Execution plan: `.hermes/plans/2026-07-18_egoric-integration-execution-plan.md`.
> Product maturity gates: `docs/RELEASE_GATES.md`.

Legend:
- Milestone = internal development phase ending in a verified, releasable increment
- Status: ⏳ Planned · 🚧 In Progress · ✅ Completed · ⏸️ Paused · 🗄️ Superseded

---

## Phase 0 — Product Foundation — ✅ Complete on `main`

Goal: establish one product identity and one build contract before adding more
runtime capability.

Evidence merged through [PR #1](https://github.com/leozvu/leozcrm/pull/1) at
`main@b7aa417`:

- LeozOps defined as the AI Operating Partner for a CEO; Revenue Intelligence
  is the first wedge, not the final boundary.
- CEO, LeozOps, Egoric, and external-system responsibilities made explicit.
- Observer → Advisor → Planner → Operator → Autopilot maturity sequence defined.
- Canonical vocabulary separates observation, insight, recommendation,
  approval, and action.
- G0–G7 product/release gates and capability stop rule defined.
- Historical CRM/task/onboarding/email runtime classified as legacy and
  excluded from the `egoric-readonly` deployment profile.
- README, product definition, architecture warning, package metadata,
  governance, integration status, roadmap, and decision log aligned.

Gate G0 is repository-canonical on `main` through PR #1 and the status follow-up
PR #2. Phase 0 itself grants no production enablement, credential, write-back,
or autonomy authority.

---

## LeozOps Intelligence Integration (current track)

Evidence-gated, no calendar dates. Gates are defined in the execution plan
and Codex QA gates in `docs/EGORIC_INTEGRATION.md` §15.

### Sprint 1 — ✅ Complete — G4 accepted

S1.A task breakdown: `docs/SPRINT_1A_TASKS.md` (T1–T6, Egoric repo, gate G1).
Corrective technical QA passed at `repositoryrealms@28ceff6` against
`main@507187f`. [PR #7](https://github.com/leozvu/repositoryrealms/pull/7)
was admin-squash-merged for the solo repository to `main@98c0eca` without
changing branch protection. DECISION-002 addendum 3 authorized S1.B/G2 and
kept S1.C blocked until G2 passed. G2 technical QA passed on
`codex/leozops-s1b-business-memory`; [PR #4](https://github.com/leozvu/leozcrm/pull/4)
was squash-merged to `main@d1d34c5`, and Product Owner acceptance for local
S1.C/G3 continuation is recorded in DECISION-002 addendum 4.
The deterministic native-funnel brief and `egoric-readonly` route-isolation
profile passed G3 technical QA and [PR #6](https://github.com/leozvu/leozcrm/pull/6)
was squash-merged to `main@3a5fb9e`. Product Owner acceptance for local S1.D/G4
continuation is recorded in DECISION-002 addendum 5. The actual-handler local
end-to-end proof passed G4 and [PR #8](https://github.com/leozvu/leozcrm/pull/8)
was squash-merged to `main@5ef3fd5`; Sprint 1 acceptance is recorded in
DECISION-002 addendum 6.

Goal:
Egoric Snapshot → LeozOps Ingestion → CEO Brief → Local End-to-End Proof.
Nothing else.

Evidence gates G1–G4 — ALL required before Sprint 2:
- G1: Egoric snapshot endpoint (test instance) — auth matrix, recursive
  PII denial, deterministic ETag/304, method denial. Codex PASS.
- G2: LeozOps ingestion — schema fail-closed, idempotent snapshot storage,
  tenant scoping, no-write-egress proof. Codex PASS.
- G3: CEO Brief from snapshot — deterministic output, native Egoric funnel
  semantics, provenance/limitations on every output, integration profile
  denies CRM/task/onboarding/email routes. Codex PASS.
- G4 (Sprint 1 acceptance): local end-to-end against the Egoric test
  instance — exact count reconciliation, no-mutation proof, feature-flag +
  key-revocation drill. Evidence recorded in repo; Codex PASS in
  CODEX_REVIEW.md; Leoz formally accepts (recorded in DECISIONS.md).

The G4 hard stop is satisfied. DECISION-002 addenda 7–11 authorize and accept
the S2.A local implementation plus one local disposable PostgreSQL checkpoint.
P1/P2, managed infrastructure, and deployment require separate Product Owner
approval.

### Sprint 2 — 🚧 Local implementation complete; external G5 execution pending

Goal:
Deployment → Test Instance → Production Shadow → Read-only Pilot.

Plan: [`docs/SPRINT_2_PLAN.md`](docs/SPRINT_2_PLAN.md). DECISION-002 addendum 7
authorized S2.A T1–T4 locally; addendum 8 accepts the core merged through
[PR #11](https://github.com/leozvu/leozcrm/pull/11) at `main@5d140a8`. T5–T8
are authorized for local/test implementation by addendum 9. The T5–T8
operations core passes local QA and is accepted through
[PR #13](https://github.com/leozvu/leozcrm/pull/13) at `main@1911349`.
The disposable PostgreSQL 16 migrate/immutability/rollback cycle is accepted
through [PR #15](https://github.com/leozvu/leozcrm/pull/15) at `main@5e9a4b7`;
see [`docs/POSTGRES_SMOKE.md`](docs/POSTGRES_SMOKE.md). P1 remains blocked on
named environment and operating-policy decisions; managed infrastructure and
every external action remain unauthorized.
DECISION-002 addendum 12 authorizes the local fail-closed manifest and
provisional solo-founder defaults in
[`docs/P1_DECISION_PACKET.md`](docs/P1_DECISION_PACKET.md), accepted through
[PR #17](https://github.com/leozvu/leozcrm/pull/17) at `main@35ed23c`. Its
pending example does not approve P1 or any provider/spend.
The remaining S2.B–S2.D repository control plane is implemented on
`codex/leozops-phase2`: environment-bound Checkpoint B/P2 manifests, public
integration readiness, a manifest-gated command-and-exit worker, immutable
poll/daily evidence, exact daily reconciliation, a ten-consecutive-business-
day evaluator, and fail-closed go/extend/revoke decisions. Operational usage
and rollback are defined in
[`docs/PHASE_2_OPERATIONS.md`](docs/PHASE_2_OPERATIONS.md).

Still pending as external facts:
- accepted exact P1 values and the named test infrastructure;
- networked Checkpoint B evidence and accepted P2;
- production canary plus ten elapsed, qualifying business days;
- the final Product Owner go/extend/revoke decision.

Evidence gates: all 12 Codex release gates (contract §15) before any
production key/flag; contract §11 pilot criteria for the shadow.

---

### Sprint 3 — 🚧 Local G6 control plane complete; real command release blocked

Goal:
Recommendation → Safe Proposal → Exact Dry-run → Human Approval → One
Idempotent Action → Auditable Result / Separately Approved Rollback.

Plan: [`docs/SPRINT_3_PLAN.md`](docs/SPRINT_3_PLAN.md). DECISION-002 addendum 14
authorizes the local repository package only. The implementation on
`codex/leozops-phase3-supervised-action` provides:

- an exact one-command G6 policy bound to a still-current G5 `go`;
- recursively safe payloads and immutable evidence-bound proposals;
- zero-mutation dry-runs plus separate approval/operator credentials;
- atomic rate/budget/idempotency claims and unknown-outcome reconciliation;
- immutable SQLite/PostgreSQL audit evidence;
- one separately previewed/approved rollback in a bounded safety window;
- a fail-closed CLI/preflight and intentionally empty production adapter
  registry.

Still pending as external facts:

- the real G5 `go` prerequisite;
- a narrow RepositoryRealms command contract and source-side idempotency;
- one named test/production target and least-privilege command credential;
- command-specific network, dry-run parity, rollback, incident, and CEO QA;
- explicit G6 release for that command.

No real adapter, external write, deployment, credential, scheduler, or G7
autonomy is authorized or present.

---

### Sprint 4 — 🚧 Local G7 rehearsal complete; bounded-autonomy release blocked

Goal:
Proven Supervised History → Policy Simulation → Explicit Kill-switch Release →
One Bounded Candidate → Monitor / Incident → Human-controlled Recovery.

Plan: [`docs/SPRINT_4_PLAN.md`](docs/SPRINT_4_PLAN.md). DECISION-002 addendum 15
authorizes only the inert local package on
`codex/leozops-phase4-bounded-autonomy`. It provides:

- an exact low-risk G6-bound standing policy and deterministic safety simulator;
- real supervised-history, source-freshness, current-G5/G6, and adapter gates;
- an initially engaged dual-credential kill switch and immutable incidents;
- one-candidate dry-run/evaluate/atomic-claim/execute orchestration;
- rolling rate, daily cost, cooldown, one-mutation, and lease limits;
- automatic halt on every failed or uncertain result;
- a separately previewed, dual-credential-approved, explicitly invoked human
  recovery within 24 hours; and
- immutable SQLite/PostgreSQL evidence plus a fail-closed CLI/preflight.

Still pending as external facts:

- genuine G5 and command-specific G6 releases;
- sufficient qualifying production supervised history;
- a deployed exact adapter, least-privilege credentials, and verified kill
  switch/monitoring;
- production simulator replay, canary, incident/recovery drill, and explicit G7
  Product Owner release.

The production adapter registry remains empty. No external request, scheduler,
HTTP mutation route, autonomous rollback, deployment, credential, or real G7
authority is present.

---

## Legacy Foundation (historical — completion evidence intact)

The standalone LeozOps application track. Preserved as history per
DECISION-002; this code remains in the repository but is not mounted in the
Egoric integration deployment profile.

M1 — CRM Foundation .................... ✅ Completed
M2 — KPI Read Layer .................... ✅ Completed
M3 — CEO Brief Engine ................... ✅ Completed
M4 — Recommendation System .............. ✅ Completed
M5 — Executive Dashboard & Team Workspace .. ✅ Completed
M6 — Integration Adapters — Placeholder .... ✅ Completed
M7 — Production Hardening ................. ✅ Completed
M8 — Real Integration Publishing ........... ⏸️ Paused
  M8A — Email Publishing (completed)
  M8B — Facebook + Instagram Publishing (paused per DECISION-002)
  M8C — TikTok Publishing (paused per DECISION-002)
  M8D — AI Media Generation (paused per DECISION-002)
M9 — Task Engine .......................... ✅ Completed
M10 — MVP Launch & Client Onboarding ........ 🗄️ Superseded by DECISION-002
  Status: Superseded by DECISION-002
  Reason: The architecture has changed after Egoric ERP became the
  production system of record. LeozOps will not launch as a standalone
  operational CRM.
  Completion evidence retained:
  - Local code: PASS (npm test 159/159, typecheck clean)
  - Onboarding workflow, /ready probe, pilot runbook implemented
  - PostgreSQL smoke (Supabase Session Pooler): PASS — see CHECKLIST.md §14
  - Live standalone pilot verification: never executed; requirement
    superseded by DECISION-002 (deployment now belongs to Sprint 2 of the
    integration track)

Legacy sequence notes (historical):
- M2 was the critical path: it unlocked M3, M4, M5, and M6.
- M7 was staged so safety work surfaced incrementally.
- M9 passed QA; task lifecycle is stable and audit-ordered.
- The former "M10 deployment gate" is closed as superseded; its Postgres
  smoke evidence carries forward to the integration track.

Roadmap scope additions require Leoz approval per GOVERNANCE.md.
