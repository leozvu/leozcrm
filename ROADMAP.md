# LeozOps AI — Roadmap

> **Governing decision:** DECISION-002 (DECISIONS.md, 2026-07-18). Egoric is
> the operational system of record; LeozOps is a read-only intelligence
> platform. All future milestones follow the "LeozOps Intelligence
> Integration" track below unless superseded by another ADR.
> Canonical contract: `docs/EGORIC_INTEGRATION.md`.
> Execution plan: `.hermes/plans/2026-07-18_egoric-integration-execution-plan.md`.

Legend:
- Milestone = internal development phase ending in a verified, releasable increment
- Status: ⏳ Planned · 🚧 In Progress · ✅ Completed · ⏸️ Paused · 🗄️ Superseded

---

## LeozOps Intelligence Integration (current track)

Evidence-gated, no calendar dates. Gates are defined in the execution plan
and Codex QA gates in `docs/EGORIC_INTEGRATION.md` §15.

### Sprint 1 — ⏳ Planned (implementation tasks not yet created; CEO go required)

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

HARD STOP: no Sprint 2 work until G4 acceptance is recorded.

### Sprint 2 — ⏳ Planned (scope re-approved at G4)

Goal:
Deployment → Test Instance → Production Shadow → Read-only Pilot.

Indicative contents (re-planned after Sprint 1 acceptance):
- Scheduled 15-min ETag polling, retry/backoff, circuit breaker, nightly
  reconciliation, alerting, operational runbooks.
- Metrics + recommendations read routes with provenance.
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
