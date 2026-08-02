# Phase 13 — Goal-aware Planner

Phase 13 turns a recommendation into an explicit, reviewable plan without
turning the Planner into an operator. The repository implementation is a local
J5 candidate. It does not deploy LeozOps, accept J1–J5 live, authorize G6, or
execute an Egoric command.

## Operating contract

The Planner consumes only an accepted Business Memory snapshot and its
deterministic CEO Brief. A plan binds together:

- one immutable goal version and manifest fingerprint;
- one exact source snapshot, intelligence run, formula version, cutoff, and
  freshness status;
- one policy version (`planner_policy_v1`);
- ordered measurable steps, explicit conflicts, and three bounded scenario
  simulations; and
- an immutable graph fingerprint covering the plan and every child hash.

The scenarios are deterministic progress heuristics, not probabilistic
forecasts. They make assumptions and uncertainty inspectable; they do not
claim causality or predict revenue.

Every generated plan is `advisory_only=true` with `action_authority=none`.
The only action-shaped step has:

```json
{
  "kind": "action_candidate",
  "action_route": "g6_supervised_action",
  "execution_state": "not_authorized"
}
```

It contains no command payload, target endpoint, credential, adapter, or
execution method. Accepting a plan records founder intent only. A later real
action must independently pass the existing G6 proposal, preview, approval,
expiry, idempotency, observation, and rollback controls.

## Goal manifest

`leozops_planner_goal_v1` is exact-key validated. It records a stable goal key,
title, supported metric and direction, integer target/unit, 1–730 day horizon,
step and effort limits, action-candidate policy, bounded assumptions with
evidence references, and an owner.

Supported metrics are `active_pipeline`, `won`, `win_rate`,
`active_owner_coverage`, `overdue_expected_close`, `missing_source`, and
`missing_created_at`. Count metrics use `count`; percentage metrics use integer
`basis_points`. Metric/unit mismatches, unknown fields, unsafe strings,
duplicate evidence keys, and invalid ranges fail closed.

An existing `goal_key` cannot be overwritten. A change requires
`replaces_goal_version_id`, preserves the goal key, increments the version,
and leaves the predecessor untouched. A superseded goal cannot generate or
accept a new plan.

## Plan generation and conflicts

The deterministic policy emits four steps: verify the baseline, review the
metric-specific exceptions, prepare one non-executable supervised proposal,
and measure a later checkpoint. `conservative`, `balanced`, and `accelerated`
strategies change only declared effort and scenario progress assumptions.

Blocking conflicts include stale/future evidence, an unavailable metric,
direction/target contradiction, step or effort capacity overflow, and a goal
that forbids action candidates. Uncited assumptions and an already-satisfied
target remain advisory. A plan with any blocking conflict cannot be accepted.

The comparison endpoint scores two plans for versions of the same goal key
using one versioned deterministic rule. Its preference is advisory, grants no
authority, and carries its own comparison hash.

## Append-only evidence

The migration creates eight tenant-scoped immutable tables:

- `planner_goal_versions`
- `planner_plan_versions`
- `planner_plan_steps`
- `planner_plan_conflicts`
- `planner_plan_simulations`
- `planner_plan_decisions`
- `planner_plan_checkpoints`
- `planner_plan_outcomes`

SQLite triggers and PostgreSQL trigger functions reject update and delete.
Idempotency keys are tenant-scoped. Reusing a key with different input or a
different source-evidence fingerprint returns a conflict. Repository reads
recompute the goal, evidence, child, and complete plan-graph hashes and reject
corrupt authority or linkage state.

An accepted latest decision is required before a checkpoint. A checkpoint
measures the selected metric from a newly requested accepted snapshot/cutoff
and records `target_met`, `progress`, `no_progress`, or `unavailable`. Founder
`useful`/`not_useful` feedback requires at least one checkpoint. Decisions,
checkpoints, and outcomes are appended; they never rewrite the original plan.

## Authenticated API

All routes use the separate `egoric-readonly` tenant credential and live under
`/v1/tenants/:tenantKey`:

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/goals` | List goal versions and derived current status |
| `POST` | `/goals` | Append a goal version; requires `Idempotency-Key` |
| `GET` | `/plans` | List sanitized plan summaries |
| `POST` | `/goals/:goalVersionId/plans` | Generate a plan version; requires `Idempotency-Key` |
| `GET` | `/plans/:planId` | Inspect evidence, steps, conflicts, simulations, and history |
| `GET` | `/plans/compare?left=&right=` | Compare two plans for the same goal key |
| `POST` | `/plans/:planId/decisions` | Append founder accept/reject intent |
| `POST` | `/plans/:planId/checkpoints` | Append current evidence measurement |
| `POST` | `/plans/:planId/outcomes` | Append useful/not-useful feedback |

Responses omit tenant IDs, idempotency keys, request hashes, credentials, and
internal command material. The cockpit Planner tab lists current plan versions,
conflict state, decision state, checkpoint count, and evidence drill-down. Its
accept/reject controls mutate only the LeozOps decision ledger.

## Verification

```bash
npm run typecheck
npm run test:phase13
npm test
npm run build
npm run db:smoke:pg
```

The focused suite covers exact goal validation, cross-tenant identical goals,
idempotency conflicts, replacement chains, supersession, reproducible replay,
G6 routing, conflict blocking, simulations/comparison, decision/checkpoint/
outcome history, immutable tables, HTTP isolation/sanitization, and static
absence of network, process, scheduler, or action-adapter capability.

CI runs the focused suite on Node 22 and 24. PostgreSQL 16 runs the entire
Planner lifecycle, verifies the no-action boundary and every immutable table,
then rolls back all migrations.

## Honest J5 boundary

Repository-local J5 is satisfied only as a candidate: the policy, persistence,
replay, comparison, versioning, cockpit, and safety tests exist. Live J5 remains
open until the Planner is exercised from an accepted named deployment using
current live J1 evidence, reviewed by the founder, and the product owner accepts
its usefulness and reproducibility. J5 never grants write capability.
