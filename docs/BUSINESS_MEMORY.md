# LeozOps Business Memory — G2 Contract

Status: **G2 COMPLETE — merged through PR #4 at `main@d1d34c5`**

Business Memory is the LeozOps-owned analytical read model. It stores accepted
source evidence and deterministic run identity. It is not a CRM, an Egoric
replica, or an operational write surface.

Binding source contract: `EGORIC_INTEGRATION.md`

## Scope in G2

- `tenant` is a LeozOps business-isolation boundary and is independent of the
  legacy CRM `Client` table.
- `source_connection` maps one tenant to one versioned source contract and
  stores no raw bearer key.
- `source_snapshot` is an immutable copy of a validated source payload.
- `intelligence_run` is an idempotent identity for one tenant, snapshot,
  engine version, and `as_of` time.
- The Egoric adapter can send only GET to the exact dedicated snapshot path.
- Unknown schemas, fields, stages, tenant identities, hashes, quality counts,
  content types, or ETags fail closed before storage.

G2 intentionally added no scheduling, retry, or circuit capability. S2.A later
added a local/test reliability core around the explicit pull, documented in
[`POLL_RELIABILITY.md`](POLL_RELIABILITY.md); it still exposes no new HTTP route,
mounts no scheduler, and enables no deployment.

## Storage model

| Table | Identity | Mutation policy |
|---|---|---|
| `tenants` | unique `tenant_key` | Configuration record |
| `source_connections` | `(tenant_id, source_system, source_tenant_key)` | Connection state only; raw keys are never stored |
| `source_snapshots` | `(source_system, source_tenant_key, snapshot_id)` | Append-only; database triggers reject UPDATE and DELETE |
| `intelligence_runs` | `(tenant_id, snapshot_id, engine_version, as_of)` | Insert-once identity |
| `source_poll_states` | one-to-one with `(tenant_id, source_connection_id)` | Mutable coordination/health only; no key or payload |
| `source_reconciliations` | deterministic tenant/connection evidence key | Immutable counts, IDs, hashes, status, and safe failure only |

Composite foreign keys bind connections, snapshots, and runs to the same
tenant. The schema runs on SQLite for local/test and PostgreSQL for a future
independent LeozOps deployment.

## Acceptance path

```text
exact HTTPS snapshot endpoint
  -> GET + Bearer + If-None-Match
  -> 304: update connection health only; create no snapshot/run
  -> 200: strict egoric_sales_v1 validation
  -> verify canonical sha256 + quoted ETag
  -> atomic insert-or-reuse snapshot
  -> atomic insert-or-reuse intelligence run
```

On `401`, `403`, schema failure, or ETag mismatch, the adapter fails closed and
the affected connection is disabled. No exception message includes payload
values or credentials.

## G2 evidence

The focused suite must prove:

- exact schema/native-funnel acceptance;
- unknown version, extra PII field, unknown stage, bad quality, and hash denial;
- GET-only/no-body network egress;
- 304 creates no snapshot or run;
- repeated 200 creates exactly one snapshot and one run;
- raw bearer token is absent from persisted connection state;
- repository and database tenant isolation;
- direct snapshot UPDATE and DELETE are rejected;
- full tests and TypeScript typecheck remain green.

G2 does not authorize S1.C, production credentials, production polling,
write-back, or autonomous action.

Product Owner authorization for local/test S1.C work is a separate decision
recorded in DECISION-002 addendum 4; it grants none of the production powers
excluded above.

Local QA evidence and the accepted pre-production limitation are recorded in
`../CODEX_REVIEW.md`. A live PostgreSQL lifecycle was not available in this
workspace; that infrastructure proof remains required before deployment, not
for the SQLite-backed local/test G2 gate.
