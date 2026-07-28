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
| Product foundation | Phase 0 complete on `codex/leozops-phase-0`; merge pending |
| Egoric data supply | G1 technical QA passed locally at `repositoryrealms@28ceff6`; push, PR, merge, and Product Owner acceptance remain pending |
| LeozOps ingestion / Business Memory | Not started; blocked until S1.A is published, merged, and accepted |
| Snapshot-based CEO Brief | Not started; blocked by G2 |
| Production integration | Not authorized |

The immediate critical path is:

`Egoric Snapshot → LeozOps Ingestion → Business Memory → CEO Brief → Local E2E Proof`

## Start here

1. [`PRODUCT.md`](PRODUCT.md) — product definition, North Star, MVP, and
   non-goals.
2. [`docs/PRODUCT_OPERATING_MODEL.md`](docs/PRODUCT_OPERATING_MODEL.md) — roles,
   layers, ownership, lifecycle coverage, and deployment profiles.
3. [`docs/GLOSSARY.md`](docs/GLOSSARY.md) — canonical product and domain terms.
4. [`docs/RELEASE_GATES.md`](docs/RELEASE_GATES.md) — G0–G7 evidence gates.
5. [`docs/EGORIC_INTEGRATION.md`](docs/EGORIC_INTEGRATION.md) — binding Egoric
   API, security, rollout, and QA contract.
6. [`ROADMAP.md`](ROADMAP.md) — current milestone status and build order.

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

Some deterministic service and testing patterns may be reused, but the current
default app is **not** the approved Egoric integration deployment. In
particular, it still mounts operational routes that must be absent from the
future `INTEGRATION_MODE=egoric-readonly` profile.

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
| `npm start` / `npm run dev` | Run the current default legacy API profile |

Do not configure an Egoric production key, enable a production feature flag, or
deploy this default profile as LeozOps.

## Stack

Node.js · TypeScript strict · Express · Knex · SQLite for local/test ·
PostgreSQL for production · `node:test` via tsx

## Repository roles

Leoz = Product Owner · Hermes = PM · Claude Code = implementation · Codex = QA

Role labels describe the historical workflow. Product authority, QA evidence,
and repository governance are defined in [`GOVERNANCE.md`](GOVERNANCE.md).
