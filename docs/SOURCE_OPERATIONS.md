# Source Operations Core

Status: **S2.A T5–T8 MERGED AND ACCEPTED AT `main@1911349`**

This capability completes the local/test operational half of S2.A. It adds
immutable reconciliation evidence, an authenticated sanitized health
projection, and explicit one-shot operator commands around the T1–T4 polling
core. It does not mount a scheduler, add an HTTP route, provision a database,
create a credential, or activate a source.

## Exact reconciliation

`SourceReconciliationService.run` independently derives the same limited fact
projection from:

1. the validated immutable `egoric_sales_v1` source evidence in Business
   Memory;
2. the accepted snapshot row and intelligence-run provenance; and
3. the deterministic Egoric CEO Brief.

The compared projection contains only:

- total lead count;
- counts for the six native Egoric stages; and
- counts for safe source buckets. Unknown labels collapse to `unclassified`
  before hashing.

An exact match records `passed`. Missing, invalid, corrupt, or divergent
evidence records `failed` with a safe error code and emits one injected alert.
Reconciliation never polls or repairs Egoric.

## Immutable evidence

`source_reconciliations` is append-only at the database boundary in SQLite and
PostgreSQL. A deterministic evidence key makes an identical replay idempotent
and prevents duplicate failure alerts.

| Stored field class | Examples |
|---|---|
| Identity | tenant, source connection, snapshot row, snapshot hash, run ID |
| Calendar | explicit business date and IANA timezone |
| Counts | source, stored snapshot, and brief totals |
| Hashes | safe snapshot projection and safe brief projection |
| Outcome | pass/fail and bounded failure code |

The table has no payload, lead identifier, source label, endpoint, ETag,
credential, bearer token, raw header, exception message, or database URL.

## Authenticated health

`SourceHealthService` requires an operator token whose SHA-256 fingerprint is
injected at construction. It returns only:

- connection status and last success;
- source timestamp, age, and explicit fresh/stale/future/uninitialized state;
- an ETag fingerprint, never the raw ETag;
- circuit, consecutive-failure, next-attempt, and safe HTTP/error state; and
- the latest reconciliation identity/status.

The stale threshold is a required bounded input. There is no hidden production
default and no public health route for this projection.

## One-shot commands

`npm run source:operator -- <command>` exposes five authenticated commands
inside the service process:

- `health` — read the sanitized projection;
- `poll` — make an active closed connection due, then run one bounded poll;
- `reconcile` — run one exact reconciliation for an explicit date/timezone;
- `disable` — disable the connection and invalidate an in-flight lease owner;
- `recover` — explicitly re-enable and reset the persistent circuit after the
  underlying fault is fixed.

Raw operator and source tokens are accepted from environment variables only,
not command-line arguments. Poll policy remains fully explicit. The CLI prints
safe summaries and safe error codes only.

## Capability boundary

- No import was added to `src/server.ts` or `src/http`.
- No interval, cron, queue, startup hook, automatic nightly invocation, or new
  network transport was added.
- The existing source path remains GET-only with no request body.
- A manual reconciliation reads LeozOps evidence only and never contacts or
  mutates Egoric.
- P1/P2, managed/external PostgreSQL, deployment, external credentials/flags,
  production
  data, scheduled execution, write-back, publishing, and autonomy remain
  unauthorized.

## Reviewed evidence

- focused Source Operations suite: **11/11 PASS**;
- complete LeozOps suite: **206/206 PASS**;
- RepositoryRealms LeozOps suite: **69/69 PASS**;
- actual-handler local E2E: **PASS**, exact 4/4 facts and zero source mutation;
- TypeScript typecheck: **PASS**;
- SQLite migrate/rollback and both immutability triggers: **PASS**;
- auth rotation, stale health, exact/mismatch, replay, corrupt evidence, lease,
  disable/recovery, one-shot poll, database outage, PII, and secret tests:
  **PASS**;
- package lock unchanged and no dependency added.

`db:smoke:pg` covers the new tables and immutable evidence path. The approved
local disposable PostgreSQL 16 cycle passed and was cleaned up as recorded in
[`POSTGRES_SMOKE.md`](POSTGRES_SMOKE.md), closing the technical S2.A Checkpoint
A requirement. P1 and every external action remain unauthorized.
