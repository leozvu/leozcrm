# LeozOps

**The AI Operating Partner for a CEO.**

LeozOps observes business data, builds a trustworthy analytical memory,
explains what changed, and recommends what to do next. Egoric remains the
operational CRM/ERP and sole system of record; LeozOps is separately deployed
and starts as a read-only intelligence service.

Revenue and funnel intelligence are the first product wedge. The long-term
direction is Observer → Advisor → Planner → supervised Operator → bounded
Autopilot, with human authority and evidence gates at every step.

## Current status

| Area | Status |
|---|---|
| Product foundation | G0 complete on `main` via [PR #1](https://github.com/leozvu/leozcrm/pull/1) at `b7aa417` |
| Egoric data supply | G1 complete: [repositoryrealms PR #7](https://github.com/leozvu/repositoryrealms/pull/7) merged to `main@98c0eca`; Product Owner authorized local S1.B continuation |
| LeozOps ingestion / Business Memory | G2 complete: [PR #4](https://github.com/leozvu/leozcrm/pull/4) merged to `main@d1d34c5`; Product Owner accepted local S1.C continuation |
| Snapshot-based CEO Brief | G3 complete: [PR #6](https://github.com/leozvu/leozcrm/pull/6) merged to `main@3a5fb9e`; Product Owner accepted local S1.D continuation |
| Local end-to-end proof | G4 complete: [PR #8](https://github.com/leozvu/leozcrm/pull/8) merged to `main@5ef3fd5`; Sprint 1 accepted |
| Phase 2 implementation | S2.A accepted; local S2.B–S2.D authorization, poll evidence, shadow ledger, G5 evaluator, and release-decision control plane implemented on `codex/leozops-phase2`; P1/external execution still blocked |
| Phase 3 implementation | Local G6 policy, proposal, dry-run, approval, idempotent execution, immutable audit, limits, and separately approved rollback implemented on `codex/leozops-phase3-supervised-action`; adapter registry intentionally empty |
| Production integration | Not authorized |

Sprint 1 completed the initial critical path:

`Egoric Snapshot → LeozOps Ingestion → Business Memory → CEO Brief → Local E2E Proof`

The local disposable PostgreSQL checkpoint is complete. The next blocked path
requires a named Product Owner decision for the exact external environment:

`P1 named-environment decision → Networked Test → P2 → Production Shadow → G5 Decision`

Only after a real G5 `go` may the next external path begin:

`Narrow command contract → G6 policy → Dry-run → Human approval → One action`

## Start here

1. [`PRODUCT.md`](PRODUCT.md) — product definition, North Star, MVP, and
   non-goals.
2. [`docs/PRODUCT_OPERATING_MODEL.md`](docs/PRODUCT_OPERATING_MODEL.md) — roles,
   layers, ownership, lifecycle coverage, and deployment profiles.
3. [`docs/GLOSSARY.md`](docs/GLOSSARY.md) — canonical product and domain terms.
4. [`docs/RELEASE_GATES.md`](docs/RELEASE_GATES.md) — G0–G7 evidence gates.
5. [`docs/EGORIC_INTEGRATION.md`](docs/EGORIC_INTEGRATION.md) — binding Egoric
   API, security, rollout, and QA contract.
6. [`docs/BUSINESS_MEMORY.md`](docs/BUSINESS_MEMORY.md) — G2 analytical-memory
   schema, ingestion invariants, and evidence contract.
7. [`docs/CEO_BRIEF.md`](docs/CEO_BRIEF.md) — G3 formula, provenance, output,
   authentication, and route-isolation contract.
8. [`docs/SPRINT_2_PLAN.md`](docs/SPRINT_2_PLAN.md) — proposed G5 hardening,
   deployment, shadow, evidence, and approval checkpoints.
9. [`docs/POLL_RELIABILITY.md`](docs/POLL_RELIABILITY.md) — S2.A persistent
   lease, retry, and circuit contract.
10. [`docs/SOURCE_OPERATIONS.md`](docs/SOURCE_OPERATIONS.md) — S2.A exact
    reconciliation, sanitized health, and authenticated one-shot commands.
11. [`docs/POSTGRES_SMOKE.md`](docs/POSTGRES_SMOKE.md) — S2.A Checkpoint A
    PostgreSQL lifecycle and immutability evidence.
12. [`docs/P1_DECISION_PACKET.md`](docs/P1_DECISION_PACKET.md) — fail-closed
    founder decision manifest and provisional P1 defaults.
13. [`docs/S2A_OPERATIONS_RUNBOOK.md`](docs/S2A_OPERATIONS_RUNBOOK.md) — local
    failure, recovery, replay, and rollback procedures.
14. [`docs/PHASE_2_OPERATIONS.md`](docs/PHASE_2_OPERATIONS.md) — P1 → network
    proof → P2 → ten-day shadow → go/extend/revoke operations.
15. [`ROADMAP.md`](ROADMAP.md) — current milestone status and build order.
16. [`docs/SPRINT_3_PLAN.md`](docs/SPRINT_3_PLAN.md) — G6 supervised-action
    contract and acceptance boundary.
17. [`docs/PHASE_3_OPERATIONS.md`](docs/PHASE_3_OPERATIONS.md) — fail-closed
    preflight, manual operator flow, evidence, incident, and rollback runbook.

## Non-negotiable boundaries

- Egoric owns clients, leads, users, tasks, invoices, and workflows.
- LeozOps owns immutable analytical snapshots, versioned metrics, CEO Briefs,
  and advisory recommendations.
- No shared database, direct Egoric database access, generic Director key,
  double entry, or autonomous external action.
- Deterministic code calculates metrics; generated language explains them.
- Every output includes evidence, formula/engine version, freshness, funnel
  semantics, and known limitations.
- A recommendation is not an action. Operational execution requires a future
  allowlisted command contract and the appropriate approval gate.

## What currently exists in this repository

The runtime on `main` is a tested historical standalone CRM foundation with
CRUD, KPI, brief, recommendation, dashboard, task, onboarding, authentication,
and email-publishing code. It predates the current product direction.

Some deterministic service and testing patterns may be reused, but the default
`legacy` app is **not** the approved Egoric integration deployment. The local
S1.C branch implements a separate `INTEGRATION_MODE=egoric-readonly` profile
that excludes those operational routes; it remains unapproved for deployment
until its evidence gates pass.

Read [`docs/LEGACY_FOUNDATION.md`](docs/LEGACY_FOUNDATION.md) before reusing or
deploying any existing runtime capability. [`ARCHITECTURE.md`](ARCHITECTURE.md)
and [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) describe that historical
foundation, not the complete target architecture.

## Legacy local development

These commands run and verify the historical standalone foundation only. They
do not start the approved Egoric integration:

```bash
npm install
cp .env.example .env
npm run migrate
npm run seed
npm start
```

| Command | Purpose |
|---|---|
| `npm test` | Run the registered regression suites |
| `npm run typecheck` | Run strict TypeScript checking |
| `npm run migrate` | Apply pending legacy/current repository migrations |
| `npm run migrate:rollback` | Roll back the last migration batch |
| `npm run seed` | Seed and verify historical demo data |
| `npm run db:reset` | Roll back, migrate, and seed |
| `npm run phase2:preflight` | Validate Checkpoint B or P2 manifest chains without external actions |
| `npm run source:shadow` | Run one manifest-gated poll, daily close, status, or release-decision command |
| `npm start` / `npm run dev` | Run the selected profile (default: historical `legacy`) |

Do not configure an Egoric production key, enable a production feature flag, or
deploy this default profile as LeozOps.

## Stack

Node.js · TypeScript strict · Express · Knex · SQLite for local/test ·
PostgreSQL for production · `node:test` via tsx

## Repository roles

Leoz = Product Owner · Hermes = PM · Claude Code = implementation · Codex = QA

Role labels describe the historical workflow. Product authority, QA evidence,
and repository governance are defined in [`GOVERNANCE.md`](GOVERNANCE.md).
