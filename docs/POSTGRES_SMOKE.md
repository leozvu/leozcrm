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
   `source_poll_states`, and `source_reconciliations`;
3. seeds and verifies the nine canonical funnel stages;
4. exercises the task lifecycle and monotonic audit sequence;
5. creates an Egoric tenant/connection, accepts a valid content-hashed
   snapshot/run, generates the deterministic brief, and records a passing exact
   reconciliation;
6. proves PostgreSQL rejects direct mutation of both the source snapshot and
   reconciliation evidence;
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
