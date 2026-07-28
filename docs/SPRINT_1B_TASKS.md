# Sprint 1B — LeozOps Ingestion and Business Memory

Status: **IMPLEMENTED LOCALLY — G2 QA PENDING**

Target repository: `leozvu/leozcrm`

Target branch: `codex/leozops-s1b-business-memory`

Gate: **G2 — Business Memory**

Production authorization: **NOT GRANTED**

## Tasks

- [x] T1 — Add Tenant and Source Connection identities independent of CRM Client.
- [x] T2 — Add immutable Source Snapshot and idempotent Intelligence Run storage.
- [x] T3 — Add strict `egoric_sales_v1` schema and canonical-hash validation.
- [x] T4 — Add source-neutral adapter contract and GET-only Egoric adapter.
- [x] T5 — Add atomic pull/accept service with ETag/304 handling.
- [x] T6 — Add tenant, replay, no-write-egress, fail-closed, and immutability tests.
- [ ] T7 — Independent G2 QA and gate verdict in `../CODEX_REVIEW.md`.

## Explicit exclusions

- No production endpoint or credentials.
- No scheduler, retry loop, or circuit breaker; those belong to S2.A.
- No CEO Brief or integration-only route profile; those belong to S1.C/G3.
- No legacy CRM Client/Lead/Campaign reuse.
- No Egoric write method, shared database, task creation, publishing, or
  autonomous action.

## Definition of done

G2 passes only when focused tests, the complete regression suite, typecheck,
migration rollback, schema/hash denial, idempotent replay, tenant isolation,
and no-write-egress evidence all pass and the result is recorded by Codex.
