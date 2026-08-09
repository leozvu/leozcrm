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
| Phase 4 implementation | Local G7 simulator, supervised-history gate, blast-radius envelope, kill switch, incidents, one-candidate rehearsal, and human recovery implemented on `codex/leozops-phase4-bounded-autonomy`; no production adapter or scheduler |
| Phase 5 implementation | Local operational-assurance policy, database-derived safety assessment, freshness/drift recheck, immutable evidence, and always-`blocked_external` release package implemented on `codex/leozops-phase5-operational-assurance` |
| Phase 6 implementation | Signed eight-row external-evidence admission and complete-but-unreleased assessment implemented on `codex/leozops-phase6-external-evidence` |
| Phase 7 implementation | Exact target dossier, independent verification, sealed handoff, and additive recall implemented on `codex/leozops-phase7-activation-ceremony`; handoffs remain unexecuted |
| Phase 8 implementation | Controlled single-activation control plane, explicit observation, crash-safe unknown reconciliation, and manual rollback implemented on `codex/leozops-phase8-controlled-activation`; production adapter registry remains empty |
| Jarvis product track | Repository implementation complete through Phase 16; all live J1-J8 acceptance remains evidence-gated |
| Phase 9A implementation | Evidence packs, fixed read tools, append-only conversation/context/citation/feedback, deterministic bilingual Advisor, budgets, failure evidence, and authenticated Ask routes implemented on `codex/leozops-phase9a-conversation-core`; production model absent |
| Phase 9B implementation | Pinned `gpt-5.6-sol` Responses adapter, strict structured output, no-tool/stateless request, pre-call cost guard, and 12-case eval implemented on `codex/leozops-phase9b-openai-adapter`; live key/eval/deployment absent |
| Phase 10 implementation | Responsive medieval CEO cockpit, evidence drill-down, validated Ask reveal, and sealed Command Deck implemented on `codex/leozops-phase10-medieval-cockpit`; founder/live J2 acceptance absent |
| Phase 11 implementation | Deterministic alerts, append-only state/outbox evidence, replay-safe delivery boundary, founder outcomes, shadow evaluator, and one-shot operator implemented on `codex/leozops-phase11-proactive-nervous-system`; live channel/scheduler/baseline and J3 acceptance absent |
| Phase 12 implementation | Production image, fail-closed deployment preflight, one-shot poll/evaluate orchestration, append-only operations/recovery evidence, structured traces/logs, protected aggregate telemetry, and disposable-only restore drill implemented on `codex/leozops-phase12-live-observer`; named platform, elapsed shadow, and J4 absent |
| Phase 13 implementation | Versioned goals/plans, evidence-bound deterministic steps, conflicts, simulations/comparison, decision/checkpoint/outcome history, Planner cockpit, and no-action enforcement implemented on `codex/leozops-phase13-goal-aware-planner`; named live review and J5 acceptance absent |
| Phase 14 qualification | RepositoryRealms [PR #9](https://github.com/leozvu/repositoryrealms/pull/9) merged the default-off `task.create` preview/approval/receipt/rollback contract to `main@0c2b3ff`; the v2 qualification is canonical, while adapter registration, live G5/G6, credentials, and J6 remain blocked |
| Phase 15 exact hand | Exact RepositoryRealms task adapter, receipt/reconciliation semantics, release binding, seven-way credential separation, and fail-closed preflight implemented locally; default registry remains empty |
| Phase 16 Ambient Jarvis | Installable data-free PWA, push-to-talk/on-demand speech, action-shaped confirmation, append-only preferences, 30-day evaluation/J1-J8 blocker dashboard, sanitized export/delete-request controls, and release runbook implemented locally; live J8 absent |
| Development harness | Ruflo scaffold is observe-only; CLI doctor passes config/native memory integrity, daemon/hooks/workers stay disabled, and the current Codex task needs a reload before newly discovered MCP methods are available |
| Production integration | Not authorized |

Sprint 1 completed the initial critical path:

`Egoric Snapshot → LeozOps Ingestion → Business Memory → CEO Brief → Local E2E Proof`

The local disposable PostgreSQL checkpoint is complete. The next blocked path
requires a named Product Owner decision for the exact external environment:

`P1 named-environment decision → Networked Test → P2 → Production Shadow → G5 Decision`

Only after a real G5 `go` may the next external path begin:

`Narrow command contract → G6 policy → Dry-run → Human approval → One action`

Only after real supervised history and a separate G7 release may this external
path begin:

`Policy simulation → Kill-switch release → One bounded candidate → Monitor → Human recovery if needed`

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
18. [`docs/SPRINT_4_PLAN.md`](docs/SPRINT_4_PLAN.md) — G7 bounded-autonomy
    rehearsal contract and acceptance boundary.
19. [`docs/PHASE_4_OPERATIONS.md`](docs/PHASE_4_OPERATIONS.md) — simulator,
    kill-switch, one-cycle, incident, and human-recovery runbook.
20. [`docs/SPRINT_5_PLAN.md`](docs/SPRINT_5_PLAN.md) — operational-assurance
    scope, evidence rules, and external release boundary.
21. [`docs/PHASE_5_OPERATIONS.md`](docs/PHASE_5_OPERATIONS.md) — assessment,
    freshness/drift recheck, and blocked-external packaging runbook.
22. [`docs/SPRINT_6_PLAN.md`](docs/SPRINT_6_PLAN.md) — signed external-evidence
    admission contract and explicit non-goals.
23. [`docs/PHASE_6_OPERATIONS.md`](docs/PHASE_6_OPERATIONS.md) — pinned issuer,
    signing, replay, revocation, assessment, and key-rotation runbook.
24. [`docs/SPRINT_7_PLAN.md`](docs/SPRINT_7_PLAN.md) — activation-ceremony scope,
    immutable dossier contract, and explicit execution boundary.
25. [`docs/PHASE_7_OPERATIONS.md`](docs/PHASE_7_OPERATIONS.md) — exact target,
    verification, sealing, recall, and incident runbook.
26. [`docs/SPRINT_8_PLAN.md`](docs/SPRINT_8_PLAN.md) — controlled single-
    activation contract and final local proof boundary.
27. [`docs/PHASE_8_OPERATIONS.md`](docs/PHASE_8_OPERATIONS.md) — release,
    one-attempt claim, observation, incident, and manual rollback runbook.
28. [`docs/PHASE_8_COMPLETION_EVIDENCE.md`](docs/PHASE_8_COMPLETION_EVIDENCE.md)
    — final local QA evidence and the exact external blocker boundary.
29. [`docs/JARVIS_COMPLETION_PLAN.md`](docs/JARVIS_COMPLETION_PLAN.md) — the
    product, production, and evidence path from Phase 8 to Jarvis v1.
30. [`docs/PHASE_9A_ASK_LEOZOPS.md`](docs/PHASE_9A_ASK_LEOZOPS.md) — grounded
    answer contract, typed read tools, APIs, persistence, budgets, and QA.
31. [`docs/PHASE_9B_OPENAI_ADAPTER.md`](docs/PHASE_9B_OPENAI_ADAPTER.md) — pinned
    Responses request, cost policy, eval gate, configuration, and live blockers.
32. [`docs/PHASE_10_MEDIEVAL_COCKPIT.md`](docs/PHASE_10_MEDIEVAL_COCKPIT.md) —
    five cockpit surfaces, design/security contract, local operation, QA, and
    the remaining live J2 blocker.
33. [`docs/PHASE_11_PROACTIVE_NERVOUS_SYSTEM.md`](docs/PHASE_11_PROACTIVE_NERVOUS_SYSTEM.md)
    — alert policy, evidence/state model, operator and delivery contracts,
    replay rules, QA, and the non-fabricable live J3 boundary.
34. [`docs/PHASE_12_LIVE_OBSERVER.md`](docs/PHASE_12_LIVE_OBSERVER.md) —
    production packaging, one-shot observer, observability/recovery contract,
    and the non-fabricable live J4 boundary.
35. [`docs/PHASE_13_GOAL_AWARE_PLANNER.md`](docs/PHASE_13_GOAL_AWARE_PLANNER.md)
    — versioned goal/plan contract, conflicts, simulations, feedback loop,
    cockpit/API, no-action boundary, and local J5 evidence.
36. [`docs/PHASE_14_SUPERVISED_HAND_READINESS.md`](docs/PHASE_14_SUPERVISED_HAND_READINESS.md)
    — pinned RepositoryRealms command audit, exact candidate payload, read-only
    evidence projection, fail-closed preflight, and remaining J6 blockers.
37. [`docs/RUFLO_INTEGRATION.md`](docs/RUFLO_INTEGRATION.md) — Ruflo
    observe-only policy, doctor evidence, SPARC dry-run, security scans, and
    current MCP/runtime limitations.
38. [`docs/LEOZOPS_V1_BLUEPRINT_ALIGNMENT.md`](docs/LEOZOPS_V1_BLUEPRINT_ALIGNMENT.md)
    — mapping from the L0–L5 completion blueprint to repository and live truth.

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
| `npm run phase6:preflight` | Validate exact Phase 6 trust/runtime bindings while keeping activation blocked |
| `npm run evidence:operator` | Admit one signed envelope or assess/read the immutable evidence matrix |
| `npm run phase7:preflight` | Recheck an accepted ceremony policy while keeping execution blocked |
| `npm run ceremony:operator` | Create, verify, seal, recall, or inspect an immutable external handoff |
| `npm run phase8:preflight` | Recheck exact Phase 8 runtime bindings and adapter registration fail-closed |
| `npm run activation:operator` | Operate the one-attempt activation control plane when an exact adapter is separately installed |
| `npm run advisor:eval:openai` | Run the explicitly acknowledged, billable Phase 9B live model eval; blocked by default |
| `npm run proactive:operator -- <command> <input.json>` | Run one authenticated Phase 11 evaluate, daily brief, deliver, status, or shadow-status command and exit |
| `npm run live:preflight` | Validate the exact Phase 12 target, identities, secret references, and read-only safety contract |
| `npm run live:operator -- <input.json>` | Run one scheduler-owned poll → proactive-evaluation cycle and append immutable evidence |
| `npm run recovery:operator -- <backup\|restore> <key> <path>` | Create a verified backup or restore only into an acknowledged disposable PostgreSQL target |
| `npm run test:phase13` | Verify the focused Phase 13 Planner contract and no-action boundary |
| `npm run test:phase14` | Verify the pinned supervised-hand qualification, tenant projection, and no-command boundary |
| `npm run hand:preflight` | Report exact RepositoryRealms/G5/G6/adapter blockers and exit fail-closed |
| `npm start` / `npm run dev` | Run the selected profile (default: historical `legacy`) |

With `INTEGRATION_MODE=egoric-readonly`, Phase 9A adds authenticated LeozOps-
owned conversation and context routes documented in
[`docs/PHASE_9A_ASK_LEOZOPS.md`](docs/PHASE_9A_ASK_LEOZOPS.md). They never
mutate Egoric. Composition remains deterministic and network-free unless an
operator explicitly selects the separately reviewed Phase 9B adapter described
in [`docs/PHASE_9B_OPENAI_ADAPTER.md`](docs/PHASE_9B_OPENAI_ADAPTER.md).
The data-free `/cockpit` shell and authenticated Phase 10 projection are
documented in
[`docs/PHASE_10_MEDIEVAL_COCKPIT.md`](docs/PHASE_10_MEDIEVAL_COCKPIT.md).
Phase 11 adds evidence-backed alert views and founder-owned acknowledgement,
snooze, and outcome evidence to that cockpit; evaluation and delivery remain
one-shot operator commands documented in
[`docs/PHASE_11_PROACTIVE_NERVOUS_SYSTEM.md`](docs/PHASE_11_PROACTIVE_NERVOUS_SYSTEM.md).
Phase 12 packages that read path as a production container and one-shot live
observer with fail-closed deployment identity, structured observability, and a
disposable-only recovery drill. The code and live acceptance boundary are
documented in
[`docs/PHASE_12_LIVE_OBSERVER.md`](docs/PHASE_12_LIVE_OBSERVER.md); J4 remains
open until a named environment supplies ten real business days and a real G5
`go`.

Phase 13 adds an authenticated Planner surface to the same profile. Goals,
plans, conflicts, scenario comparisons, founder decisions, checkpoints, and
outcomes are immutable and evidence-bound. Accepting a plan grants no action
authority; every action candidate remains `not_authorized` and points only to
the separately gated G6 control plane. See
[`docs/PHASE_13_GOAL_AWARE_PLANNER.md`](docs/PHASE_13_GOAL_AWARE_PLANNER.md).

Phase 14 now qualifies one potential supervised hand: creating an unassigned
RepositoryRealms task. RepositoryRealms PR #9 merged the dedicated default-off
endpoint, zero-business-mutation preview, receipt, and separately approved
rollback contract to canonical `main@0c2b3ff`. The cockpit remains read-only,
the exact adapter is not registered, and real G5/G6 evidence, runtime
credentials, and supervised history remain absent. See
[`docs/PHASE_14_SUPERVISED_HAND_READINESS.md`](docs/PHASE_14_SUPERVISED_HAND_READINESS.md).

Do not configure an Egoric production key, enable a production feature flag, or
deploy this default profile as LeozOps.

## Stack

Node.js · TypeScript strict · Express · Knex · SQLite for local/test ·
PostgreSQL for production · `node:test` via tsx

## Repository roles

Leoz = Product Owner · Hermes = PM · Claude Code = implementation · Codex = QA

Role labels describe the historical workflow. Product authority, QA evidence,
and repository governance are defined in [`GOVERNANCE.md`](GOVERNANCE.md).
