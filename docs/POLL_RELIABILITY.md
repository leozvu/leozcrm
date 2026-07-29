# Source Poll Reliability Core

Status: **S2.A T1–T4 MERGED AND ACCEPTED AT `main@5d140a8`**

This local/test core wraps the existing explicit `SnapshotIngestionService`
pull with persistent coordination, bounded retry, and circuit state. It is a
library capability only: no scheduler, HTTP trigger, production policy,
credential, feature flag, or deployment is created.

## Persistent state

`source_poll_states` is a one-to-one, tenant-scoped child of
`source_connections`. A separate table avoids rebuilding the existing
connection/ETag table during SQLite migration or rollback.

| Field | Purpose |
|---|---|
| `circuit_state` | `closed`, `open`, or one-probe `half_open` |
| `consecutive_failures` | Failed poll cycles, not individual retry attempts |
| `last_attempt_at` / `next_attempt_at` | Persistent due-state across restarts |
| `circuit_opened_at` | Traceable circuit transition time |
| `last_error_code` / `last_http_status` | Sanitized classification only |
| `lease_id` / `lease_expires_at` | One in-flight cycle per connection |
| `revision` | Compare-and-swap guard against concurrent lease acquisition |

The table has no credential or payload column. Existing `last_etag` and
`last_success_at` remain on `source_connections` and are not duplicated.

## State machine

```text
closed + due
  -> atomic lease
  -> 200/304 success -> closed, failures=0, next=+15m
  -> transient exhausted below threshold -> closed, failures+1, next=+15m
  -> transient exhausted at threshold -> open, next=+open interval
  -> permanent contract/auth/config error -> source disabled, open, no next

open + not due -> skip
open + due -> atomic half_open lease
half_open + 200/304 -> closed
half_open + failure -> open
expired lease -> a later process may recover it
```

Lease ownership and revision are checked again when recording success or
failure. A process that lost its lease cannot overwrite the newer owner.

## Explicit policy

The coordinator constructor requires every policy value. Code validates safety
ceilings but does not select production timeout, retry count, delay, jitter,
circuit threshold, open duration, or lease duration. The only fixed value is
the already approved 15-minute target cadence.

The lease must cover the mathematical upper bound of all request timeouts and
retry delays. Invalid or incomplete policy fails before a poll can acquire a
lease.

## Failure classification

| Failure | Retry | Connection behavior |
|---|---:|---|
| Network/timeout | Bounded | Circuit policy after exhaustion |
| `429` | Bounded | Honor sanitized/clamped `Retry-After` |
| Eligible `5xx` | Bounded | Circuit policy after exhaustion |
| `401` / `403` | Never | Disable immediately |
| `400` / `404` / `405` | Never | Disable as contract/config failure |
| Schema/hash/tenant/ETag failure | Never | Disable immediately |
| Unknown programming/infrastructure error | Never swallowed | Record safe failure if possible, then rethrow |

`Retry-After` is converted at the adapter boundary into bounded milliseconds.
The raw header and upstream response body are never retained, returned, or
logged by the reliability core.

## Runtime boundary

- The coordinator is absent from `src/http` and `src/server.ts`.
- There is no `setInterval`, cron registration, queue, public trigger, or
  startup import.
- Source transport remains the existing exact-path GET with no body.
- The bearer value exists only in the in-memory `runOnce` input.
- Permanent errors can disable a connection; authenticated one-shot recovery
  and other T7 commands are defined in
  [`SOURCE_OPERATIONS.md`](SOURCE_OPERATIONS.md).

## Reviewed evidence

- focused reliability suite: **13/13 PASS**;
- complete LeozOps suite: **195/195 PASS**;
- RepositoryRealms LeozOps suite: **69/69 PASS**;
- actual-handler local E2E: **PASS**, exact 4/4 reconciliation and zero source
  mutation;
- TypeScript typecheck and SQLite apply/rollback: **PASS**;
- concurrency, expired lease, restart, 200/304, timeout, bounded jitter,
  `Retry-After`, 401, 404, schema denial, circuit probe/recovery, corrupt-state,
  tenant, secret, and GET-only tests: **PASS**;
- package lock unchanged; no dependency added;
- no high/critical dependency finding; the existing low `body-parser` and
  moderate `uuid` advisories remain unchanged.

T5–T8 now pass locally at `cffccda`. Live PostgreSQL, scheduler mounting, P1,
P2, and any external environment remain unproved and unauthorized.
