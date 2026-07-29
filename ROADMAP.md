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

The G4 hard stop is satisfied. DECISION-002 addenda 7–9 authorize S2.A local
implementation only; live PostgreSQL, P1/P2, and deployment require separate
Product Owner approval.

### Sprint 2 — 🚧 S2.A Local Core Accepted; PostgreSQL Gate Open

Goal:
Deployment → Test Instance → Production Shadow → Read-only Pilot.

Plan: [`docs/SPRINT_2_PLAN.md`](docs/SPRINT_2_PLAN.md). DECISION-002 addendum 7
authorized S2.A T1–T4 locally; addendum 8 accepts the core merged through
[PR #11](https://github.com/leozvu/leozcrm/pull/11) at `main@5d140a8`. T5–T8
are authorized for local/test implementation by addendum 9. Live PostgreSQL,
P1/P2, and all external work remain blocked. The T5–T8 operations core passes
local QA and is accepted through
[PR #13](https://github.com/leozvu/leozcrm/pull/13) at `main@1911349`.
Planned contents:
- Scheduled 15-min ETag polling, retry/backoff, circuit breaker, nightly
  reconciliation, alerting, operational runbooks.
- Connector health, reconciliation evidence, and operator runbooks; the
  existing authenticated CEO Brief remains the only product read route.
- Hosting decision; LeozOps deployed with independent Postgres + secrets;
  readiness/canary.
- Ten-business-day read-only production shadow per
  `docs/EGORIC_INTEGRATION.md` §11, then CEO go/extend/revoke decision.

Evidence gates: all 12 Codex release gates (contract §15) before any
production key/flag; contract §11 pilot criteria for the shadow.

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
