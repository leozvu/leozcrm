# Phase 12 — Live Observer and trust gate

Phase 12 turns the local Observer candidate into a deployable, recurring,
read-only production job. The repository implementation is complete; a live
deployment and J4 are not. No local fixture, simulated date, container build,
or disposable database is accepted as production evidence.

## Runtime shape

The production image has two deliberately separate entry points:

1. `node dist/src/server.js` serves the read-only cockpit/API, probes, and
   authenticated aggregate operational telemetry.
2. `node dist/src/liveObserverOperator.js <input.json>` performs exactly one
   manifest-gated source poll, then one deterministic proactive evaluation,
   records append-only events, and exits. An external scheduler owns cadence,
   retry policy, concurrency, and alerts. The HTTP server starts no loop.

The source operator still enforces the existing P1/P2 chain, exact runtime,
database, and Egoric identities, `GET` with no request body, a read-only bearer
credential, poll lease, circuit breaker, and immutable poll evidence. Phase 12
does not add an Egoric mutation route or action adapter.

## Freeze the exact deployment

Copy `deploy/live-observer/deployment.pending.example.json` into the target
configuration system, replace every placeholder, and change `status` to
`accepted` only after the identifiers are verified. Do not commit the accepted
manifest if it contains private infrastructure metadata. Its `secret_bindings`
contain only `env://NAME` references; the named values must be injected by the
platform secret manager.

```bash
NODE_ENV=production INTEGRATION_MODE=egoric-readonly \
LEOZOPS_LIVE_DEPLOYMENT_MANIFEST=/run/config/leozops-live.json \
npm run live:preflight
```

Preflight validates the schema, production/read-only invariants, distinct
secret bindings, injected values, and exact runtime/database/Egoric identities.
It prints fingerprints and safe target identifiers, never secret values.

## Deploy and operate

The named platform must provision PostgreSQL, runtime service, one-shot job,
scheduler, secret manager bindings, dashboard, alert route, and a least-
privilege Egoric read credential. Build and migrate the exact revision before
traffic:

```bash
docker build -t <registry>/leozops:<git-sha> .
node dist/src/db/migrate.js latest
node dist/src/server.js
node dist/src/liveObserverOperator.js /run/config/operator-input.json
```

Required probes are `GET /health` (process), `GET /startup` (accepted runtime
binding), and `GET /ready` (database, tables, and zero pending migrations).
Every request receives `x-request-id` and W3C `traceparent`; structured JSON
logs redact credential-shaped fields.

The separate observability bearer credential protects:

- `GET /internal/operations/snapshot`
- `GET /internal/operations/metrics`

The projection exposes only aggregates: freshness, poll outcomes/latency,
reconciliation, Advisor cost/latency, delivery outcomes, observer cycles,
incidents, and the latest recovery drill status. It contains no tenant key,
business payload, model prompt, credential, or database URL.
Only the monitoring client receives the raw observability token. The service
receives its pinned SHA-256 fingerprint in the accepted manifest.

## Backup and restore drill

Use PostgreSQL service definitions (`PGSERVICEFILE`) so credentials never
appear in process arguments. Backup writes a custom-format artifact and records
its SHA-256 and byte count:

```bash
LEOZOPS_PG_SERVICE=leozops_prod \
LEOZOPS_PRODUCTION_DATABASE_NAME=leozops \
npm run recovery:operator -- backup <unique-drill-key> /secure/backup/leozops.dump
```

Restore is permitted only into a differently named disposable service and
requires an exact acknowledgement. It runs `pg_restore`, verifies the Phase 12
migration with `psql`, and records immutable evidence:

```bash
LEOZOPS_PG_SERVICE=leozops_prod \
LEOZOPS_PRODUCTION_DATABASE_NAME=leozops \
LEOZOPS_RESTORE_DRILL_PG_SERVICE=leozops_restore_drill \
LEOZOPS_RESTORE_DRILL_DATABASE_NAME=leozops_restore_drill \
LEOZOPS_RESTORE_DRILL_ACK=RESTORE_TO_DISPOSABLE_DATABASE_ONLY \
npm run recovery:operator -- restore <unique-drill-key> /secure/backup/leozops.dump
```

Before destructive restore, the operator queries `current_database()` and
requires it to equal the separately configured disposable database name. It
refuses identical source/restore service or database names, never overwrites an
existing backup artifact, and never invokes a shell. Production restoration
remains a human incident procedure outside this command.

## External acceptance ledger

Repository QA can prove the code and safety boundary only. Live J4 remains
blocked until all of the following are admitted from the named environment:

- successful P1 network proof and P2 production authorization;
- at least ten actual business days of fresh poll/shadow evidence;
- reconciliation, credential revocation, backup/restore, and incident drills;
- dashboard/alert evidence and accepted model cost/latency and delivery SLOs;
- a Product Owner G5 decision of `go` based on that evidence.

`extend` continues observation and `revoke` removes production authority. No
repository test can transform either outcome into `go`.
