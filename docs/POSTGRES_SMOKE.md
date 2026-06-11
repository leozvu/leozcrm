# PostgreSQL Lifecycle Smoke (Milestone #7, Phase C)

The CRM schema is written with Knex's dialect-portable schema builder and
app-generated UUID keys, so the **same migrations run unchanged on SQLite
(dev/test) and PostgreSQL (production)**. This smoke proves that claim against a
real PostgreSQL instance before external exposure.

## What it does

`npm run db:smoke:pg` runs `src/db/pgSmoke.ts`, which against the configured
PostgreSQL database performs:

1. `migrate latest` — apply all migrations, then assert the four tables exist.
2. seed reference data — seed the canonical funnel stages, assert all 9 present.
3. `migrate rollback` — revert, then assert all four tables are dropped cleanly
   (no orphaned objects / non-reversible migration).

It is **env-gated**: with no PostgreSQL configured it prints a skip message and
exits `0`. When a target *is* configured, any failure exits non-zero.

## Running it

Point it at a disposable PostgreSQL database (it migrates then rolls back, but
use a throwaway DB):

```bash
# Option A: a single connection string
export DATABASE_URL="postgres://user:pass@localhost:5432/leozops_smoke"

# Option B: discrete PG* vars (used when DATABASE_URL is unset)
export PGHOST=localhost PGPORT=5432 PGUSER=leozops PGPASSWORD=leozops PGDATABASE=leozops_smoke

npm run db:smoke:pg
```

A quick disposable instance via Docker:

```bash
docker run --rm -e POSTGRES_PASSWORD=leozops -e POSTGRES_DB=leozops_smoke \
  -p 5432:5432 postgres:16
# then, in another shell, with the env above set:
npm run db:smoke:pg
```

Expected final line on success:

```
Postgres migrate/seed/rollback smoke PASSED.
```

> Note: `pg` is an optional dependency. If it is not installed in your
> environment, install it first (`npm install pg`). The dev/test suites use
> SQLite and do not require it.
