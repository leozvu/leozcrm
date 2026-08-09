# Phase 8 Completion Evidence

Status: **REPOSITORY-LOCAL PASS; EXTERNAL G5/G6/G7 FACTS REMAIN BLOCKED**

Review date: 2026-08-01

Branch: `codex/leozops-phase8-controlled-activation`

Baseline: Phase 7 commit `90f6d3d`

Core implementation: `424f486`

## Implemented and verified

- One exact Phase 8 policy binds one current, unrecalled Phase 7 handoff and
  the same target, adapter artifact, configuration, credential reference,
  canary, and rollback contracts.
- Release authority, executor, safety observer, and rollback operator use four
  separate credentials, distinct from all upstream credentials. Raw secrets
  are never persisted.
- The kill switch begins engaged. A short release requires release-authority
  and observer authentication.
- A zero-mutation preview precedes one atomic claim. The claim is stored before
  the adapter invocation and concurrent requests cannot produce a second call.
- Lost/invalid adapter responses become terminal `unknown`; expired orphan
  claims reconcile to `unknown` without invoking the adapter.
- Successful activation requires an explicit receipt-bound observation after
  the canary window. Unhealthy, unknown, and missed-deadline observations open
  immutable incidents and never trigger automatic rollback.
- Rollback is explicit, dual-authenticated, idempotent, receipt-bound, and
  bounded by the policy recovery window.
- Ten Phase 8 tables and their ordered evidence are append-only on SQLite and
  PostgreSQL.
- The operator is command-and-exit. The production registry is empty and the
  checked-in code contains no provider SDK, network client, scheduler, daemon,
  background loop, HTTP mutation route, or real target credential.

## Verification record

| Check | Result |
|---|---|
| Focused Phase 8 suite | **17/17 PASS** |
| Full repository regression | **302/302 PASS** |
| Strict TypeScript | **PASS** |
| Node.js 24 isolated compatibility | **302/302 PASS**, TypeScript PASS |
| SQLite latest → rollback → latest | **PASS** |
| PostgreSQL 16 twelve-migration lifecycle | **PASS** |
| PostgreSQL activation → observation → rollback | **PASS** |
| PostgreSQL immutability and full rollback | **PASS** |
| Pending example preflight | **BLOCKED AS EXPECTED**, exit 2 |
| Production activation registry | **PASS**, zero adapters |
| Local documentation targets | **63/63 PASS** |
| GitHub Actions workflow syntax | **PASS**, two jobs parsed |
| GitHub-hosted workflow run | **NOT EXECUTED**, branch is local-only |
| Staged secret scan | **PASS** |
| Dependency audit at high severity | **PASS**, no high/critical finding |

The disposable PostgreSQL container was removed after verification and Docker
Desktop was returned to its prior stopped state.

## Automated continuation

`.github/workflows/leozops-qa.yml` repeats the full SQLite regression and
TypeScript checks on Node.js 22 and 24, runs the high-severity production
dependency gate, and executes the complete PostgreSQL 16 lifecycle for pushes,
pull requests, and manual dispatches. Checkout credentials are not persisted
and workflow permissions are read-only.

## Honest remaining boundary

The repository-local build is complete. The following are external facts and
must not be fabricated from local tests:

1. an accepted named P1 environment and P2 network proof;
2. a separately reviewed provider adapter and least-privilege target secret;
3. deployed source-side idempotency, monitoring, and provider kill controls;
4. the production canary and ten elapsed qualifying shadow business days;
5. real G5 and command-specific G6 decisions;
6. sufficient genuine supervised history and the explicit G7 release; and
7. live incident/rollback drills against the exact named infrastructure.

Until all seven exist, Phase 8 preflight correctly reports `blocked`, the
production registry stays empty, and no external activation is possible.
