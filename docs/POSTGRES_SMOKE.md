# PostgreSQL Lifecycle and S2.A Checkpoint Smoke

Status: **MERGED AND ACCEPTED — [PR #15](https://github.com/leozvu/leozcrm/pull/15), `main@5e9a4b7`**

`npm run db:smoke:pg` exercises the complete current migration stack against a
real PostgreSQL server. It is destructive to the named target database because
it deliberately migrates and rolls back; use a new disposable database only.

## What the smoke proves

Against the configured PostgreSQL database the script:

1. applies every migration;
2. verifies the legacy and LeozOps tables exist, including `tenants`,
   `source_connections`, `source_snapshots`, `intelligence_runs`,
   `source_poll_states`, `source_reconciliations`, `source_poll_runs`,
   `shadow_daily_evidence`, and `phase2_release_decisions`;
3. seeds and verifies the nine canonical funnel stages;
4. exercises the task lifecycle and monotonic audit sequence;
5. creates an Egoric tenant/connection, accepts a valid content-hashed
   snapshot/run, generates the deterministic brief, and records a passing exact
   reconciliation;
6. proves PostgreSQL rejects direct mutation of source snapshot,
   reconciliation, poll, daily-shadow, and release-decision evidence;
7. rolls back the complete batch; and
8. verifies every expected table is gone.

Missing PostgreSQL configuration prints a skip and exits zero so local test
commands remain convenient. A skip is never passing release evidence.

## Checkpoint A evidence — 2026-07-28

The approved local disposable target was:

- engine: Docker Desktop, restored to its original stopped state afterward;
- image: `postgres:16-alpine`, digest
  `sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777`;
- container: `leozops-pg-checkpoint-a-20260728`;
- endpoint: loopback only, `127.0.0.1:55432`;
- database: `leozops_checkpoint_a`;
- storage: disposable container filesystem, no named/shared volume;
- credentials: generated in process, never printed or retained.

Observed result:

```text
Postgres smoke: applying migrations…
Postgres smoke: seeding reference data…
  seeded 9 funnel stages, 9 present.
Postgres smoke: exercising the task lifecycle…
  task lifecycle + monotonic audit seq verified.
Postgres smoke: exercising immutable source evidence…
  source snapshot + reconciliation immutability verified.
Postgres smoke: rolling back…
Postgres migrate/seed/rollback smoke PASSED.
```

Cleanup evidence:

- exact disposable container absent after the `finally` cleanup;
- loopback port `55432` no longer listening;
- Docker Desktop service returned to `Stopped / Manual`;
- no cloud resource, deployment, named volume, production data, source flag,
  or external credential was created.

This closes the technical PostgreSQL requirement in S2.A Checkpoint A. It does
not authorize P1, choose a managed provider, prove a networked test deployment,
or authorize any production/external action.

## Phase 2 migration checkpoint — 2026-07-29

The Phase 2 branch reran the complete lifecycle after adding the three shadow
trust tables and their PostgreSQL immutability triggers:

- branch: `codex/leozops-phase2`;
- engine: Docker Desktop `29.6.2`, returned to stopped state afterward;
- image: `postgres:16-alpine`;
- container: `leozops-phase2-pg-qa`;
- endpoint: loopback only, final verification used ephemeral port
  `127.0.0.1:62682`;
- database: `leozops_phase2`;
- storage: disposable container filesystem, no named/shared volume;
- external/cloud resources: none.

Observed result:

```text
Postgres smoke: applying migrations…
Postgres smoke: seeding reference data…
  seeded 9 funnel stages, 9 present.
Postgres smoke: exercising the task lifecycle…
  task lifecycle + monotonic audit seq verified.
Postgres smoke: exercising immutable source evidence…
  source, reconciliation, poll, daily, and release immutability verified.
Postgres smoke: rolling back…
Postgres migrate/seed/rollback smoke PASSED.
```

The exact container auto-removed after shutdown. This proves the new migration
and rollback on PostgreSQL; it is not Checkpoint B because no networked test
deployment, managed database, external key/flag, or source request was used.

## Phase 3 migration checkpoint — 2026-07-29

The Phase 3 branch reran the complete lifecycle after adding the supervised
action policy, proposal, preview, approval, attempt, and event tables:

- branch: `codex/leozops-phase3-supervised-action`;
- engine: Docker Desktop `29.6.2`, returned to its original stopped state;
- image: `postgres:16-alpine`;
- container: `leozops-phase3-pg-qa`;
- endpoint: loopback-only ephemeral port `127.0.0.1:50409`;
- database: `leozops_phase3`;
- storage: disposable container filesystem, no named/shared volume;
- adapter: deterministic in-process smoke adapter only; no network call;
- external/cloud resources: none.

Observed result:

```text
Postgres smoke: applying migrations…
Postgres smoke: seeding reference data…
  seeded 9 funnel stages, 9 present.
Postgres smoke: exercising the task lifecycle…
  task lifecycle + monotonic audit seq verified.
Postgres smoke: exercising immutable source evidence…
  source, shadow, and supervised-action immutability verified.
Postgres smoke: rolling back…
Postgres migrate/seed/rollback smoke PASSED.
```

The smoke exercised one complete fake proposal → preview → approval →
idempotent execution, immutable policy/proposal/preview/approval/event guards,
the guarded one-time attempt terminal transition, and full rollback of every
migration. The exact container was stopped and auto-removed; Docker Desktop
was shut down afterward. This is dialect/control-plane evidence only and does
not prove or authorize an external command.

## Phase 4 migration checkpoint — 2026-07-29

The Phase 4 branch reran the complete lifecycle after adding bounded-autonomy
simulation, policy, kill-switch, evaluation, attempt, human-recovery, incident,
and ordered event tables:

- branch: `codex/leozops-phase4-bounded-autonomy`;
- engine: Docker Desktop `29.6.2`, returned to its original stopped state;
- image: `postgres:16-alpine`;
- container: `leozops-phase4-pg-qa`;
- endpoint: loopback-only ephemeral port `127.0.0.1:57118`;
- database: `leozops_phase4`;
- storage: disposable container filesystem, no named/shared volume;
- adapter: deterministic in-process smoke adapter only; no network call;
- external/cloud resources: none.

Observed result:

```text
Postgres smoke: applying migrations…
Postgres smoke: seeding reference data…
  seeded 9 funnel stages, 9 present.
Postgres smoke: exercising the task lifecycle…
  task lifecycle + monotonic audit seq verified.
Postgres smoke: exercising immutable source evidence…
  source, shadow, supervised-action, and bounded-autonomy immutability verified.
Postgres smoke: rolling back…
Postgres migrate/seed/rollback smoke PASSED.
```

The smoke created five real in-database supervised successes plus one rollback
drill, simulated and accepted one G7 policy, released its kill switch, executed
one fake bounded candidate, performed one separately approved human recovery,
opened an incident drill, rejected rewrites across every Phase 4 fact class, and
rolled back the full migration chain. The exact container auto-removed and
Docker Desktop was stopped. This is dialect/control-plane proof only; it does
not establish production history or authorize G7.

## Phase 5 migration checkpoint — 2026-07-30

The Phase 5 branch reran the full lifecycle after adding operational-assurance
policy, assessment, blocked release-package, and ordered event tables:

- branch: `codex/leozops-phase5-operational-assurance`;
- engine: Docker Desktop `29.6.2`, returned to its original stopped state;
- image: `postgres:16-alpine`;
- container: `leozops-phase5-pg-qa`;
- endpoint: loopback-only ephemeral port `127.0.0.1:51661`;
- database: `leozops_phase5`;
- storage: disposable container filesystem, no named/shared volume;
- adapter: deterministic in-process G6/G7 smoke adapter only; Phase 5 used an
  empty production registry and made no network call;
- external/cloud resources: none.

Observed result:

```text
Postgres smoke: applying migrations…
Postgres smoke: seeding reference data…
  seeded 9 funnel stages, 9 present.
Postgres smoke: exercising the task lifecycle…
  task lifecycle + monotonic audit seq verified.
Postgres smoke: exercising immutable source evidence…
  source, shadow, supervised-action, bounded-autonomy, and operational-assurance immutability verified.
Postgres smoke: rolling back…
Postgres migrate/seed/rollback smoke PASSED.
```

The smoke built real database-linked local G6/G7 rehearsal evidence, resolved
an incident drill, accepted one Phase 5 policy, produced a passing local
assessment and a `blocked_external` package, rejected rewrites across all four
Phase 5 tables, and rolled back all nine migrations. The container auto-removed
and Docker Desktop stopped. This is dialect/control-plane evidence only.

## Phase 6 migration checkpoint — 2026-07-30

The Phase 6 branch reran the full lifecycle after adding signed external-
evidence policy, attestation, assessment, and ordered event tables:

- branch: `codex/leozops-phase6-external-evidence`;
- engine: Docker Desktop `29.6.2`, returned to its original stopped state;
- image: `postgres:16-alpine`;
- container: `leozops-phase6-pg` (auto-removed);
- endpoint: loopback-only `127.0.0.1:51662`;
- database: `leozops_phase6_qa`;
- storage: disposable container filesystem, no named/shared volume;
- keys: ephemeral in-process Ed25519 QA keys; private keys were neither logged
  nor persisted;
- adapter: deterministic in-process G6/G7 smoke adapter only; Phase 6 used an
  empty production registry and made no network call;
- external/cloud resources: none.

Observed result:

```text
Postgres smoke: applying migrations…
Postgres smoke: seeding reference data…
  seeded 9 funnel stages, 9 present.
Postgres smoke: exercising the task lifecycle…
  task lifecycle + monotonic audit seq verified.
Postgres smoke: exercising immutable source evidence…
  source, shadow, supervised-action, bounded-autonomy, assurance, and external-evidence immutability verified.
Postgres smoke: rolling back…
Postgres migrate/seed/rollback smoke PASSED.
```

The smoke accepted one Phase 6 policy bound to the exact passing Phase 5
assessment/package, admitted all eight correctly signed rows, derived
`complete_unreleased` plus `blocked_external_activation`, rejected rewrites
across all four new tables, and rolled back all ten migrations. This proves
SQL dialect and local control-plane behavior only; it does not enroll external
issuers or authorize activation.

## Phase 7 migration checkpoint — 2026-07-30

The Phase 7 branch reran the full lifecycle after adding activation-ceremony
policy, dossier, verification, handoff, recall, and ordered event tables:

- branch: `codex/leozops-phase7-activation-ceremony`;
- engine: Docker Desktop `29.6.2`, returned to its original stopped state;
- image: `postgres:16-alpine`;
- container: `leozops-phase7-pg` (auto-removed);
- endpoint: loopback-only `127.0.0.1:51672`;
- database: `leozops_phase7_qa`;
- storage: disposable container filesystem, no named/shared volume;
- adapter: deterministic in-process G6/G7 smoke adapter only; Phase 6 and
  Phase 7 used empty production registries and made no network call;
- external/cloud resources and target credentials: none.

Observed result:

```text
Postgres smoke: applying migrations…
Postgres smoke: seeding reference data…
  seeded 9 funnel stages, 9 present.
Postgres smoke: exercising the task lifecycle…
  task lifecycle + monotonic audit seq verified.
Postgres smoke: exercising immutable source evidence…
  source, shadow, supervised-action, bounded-autonomy, assurance, external-evidence, and activation-ceremony immutability verified.
Postgres smoke: rolling back…
Postgres migrate/seed/rollback smoke PASSED.
```

The smoke created an exact Phase 7 policy, database-derived dossier,
independent approval, one sealed handoff, and dual-authenticated recall. The
handoff remained `not_executed`; rewrites were rejected across all six new
tables; all eleven migrations rolled back. This proves SQL dialect and local
ceremony behavior only, not deployment or activation.

## Phase 16 Ambient Jarvis checkpoint — 2026-08-09

The complete current lifecycle was executed after adding Ambient Jarvis
preferences, Jarvis v1 governance, and the canonical RepositoryRealms adapter
boundary:

- branch: `codex/ruflo-phase14-contract-unlock`;
- engine: Docker Desktop `29.6.2`;
- image: `postgres:16-alpine`;
- container: `leozops-phase16-pg-20260809`;
- endpoint: loopback-only `127.0.0.1:55436`;
- database: `leozops_phase16`;
- storage: disposable container filesystem, no volume;
- credential: generated in process, never printed or persisted;
- source/network action: none; all action adapters used by the smoke are
  deterministic in-process test boundaries.

The first run stopped honestly at Planner checkpoint integrity verification.
PostgreSQL returns timestamp columns as `Date` values while the immutable hash
was created from an ISO string. The repository now normalizes every Planner
timestamp to canonical ISO before integrity verification, with a focused
regression covering the PostgreSQL representation.

The clean rerun applied all migrations, exercised task, source, Advisor,
Planner, Ambient Jarvis, data-governance, shadow, supervised-action,
bounded-autonomy, assurance, external-evidence, ceremony, and activation
records, rejected direct evidence mutation, rolled the full migration batch
back, and verified all expected tables were absent. Final output:

```text
Postgres migrate/seed/rollback smoke PASSED.
PHASE16_POSTGRES_SMOKE=PASS
DISPOSABLE_CONTAINER_CLEANUP=PASS
```

This closes the Phase 16 disposable PostgreSQL dialect/lifecycle check. It is
not a managed staging deployment, production history, or action authority.

## Running on another approved disposable target

Set either one connection string:

```text
DATABASE_URL=postgresql://<user>:<password>@<host>:<port>/<disposable_db>
```

or the standard `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, and `PGDATABASE`
variables, then run:

```text
npm run db:smoke:pg
```

Never use an existing application database. Confirm the target identity,
backup/retention expectation, and destruction authority before execution.
