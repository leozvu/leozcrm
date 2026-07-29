# S2.A Local Source Operations Runbook

Status: **LOCAL/TEST ONLY — NO SCHEDULER OR EXTERNAL ENVIRONMENT AUTHORIZED**

This runbook operates the explicit S2.A library/CLI capability. Values shown
below are variable names or placeholders, never real credentials.

## Required configuration

All commands require:

- `LEOZOPS_OPERATOR_TOKEN_SHA256` — lowercase `sha256:<64 hex>` fingerprint;
- `LEOZOPS_OPERATOR_TOKEN` — raw operator token supplied at invocation time;
- `LEOZOPS_SOURCE_STALE_AFTER_MS` — approved stale threshold;
- `--tenant-id <uuid>` and `--connection-id <uuid>`.

`poll` additionally requires `LEOZOPS_SOURCE_BEARER_TOKEN`,
`LEOZOPS_SOURCE_ENGINE_VERSION`, and every bounded policy variable:

- `LEOZOPS_POLL_REQUEST_TIMEOUT_MS`;
- `LEOZOPS_POLL_MAX_RETRIES`;
- `LEOZOPS_POLL_BASE_DELAY_MS` and `LEOZOPS_POLL_MAX_DELAY_MS`;
- `LEOZOPS_POLL_JITTER_RATIO`;
- `LEOZOPS_POLL_CIRCUIT_FAILURE_THRESHOLD`;
- `LEOZOPS_POLL_CIRCUIT_OPEN_MS`; and
- `LEOZOPS_POLL_LEASE_MS`.

Never put a token in a CLI flag, shell history, Git, test fixture, log,
screenshot, or evidence file.

## Commands

```text
npm run source:operator -- health \
  --tenant-id <uuid> --connection-id <uuid>

npm run source:operator -- poll \
  --tenant-id <uuid> --connection-id <uuid>

npm run source:operator -- reconcile \
  --tenant-id <uuid> --connection-id <uuid> \
  --business-date YYYY-MM-DD --timezone America/New_York

npm run source:operator -- disable \
  --tenant-id <uuid> --connection-id <uuid>

npm run source:operator -- recover \
  --tenant-id <uuid> --connection-id <uuid>
```

Run `recover` only after the auth, contract, schema, endpoint, or source fault
has been corrected. An active lease blocks recovery until it expires; do not
bypass the lease in the database.

## Failure procedures

### Operator-key rotation

1. Generate/store the replacement outside Git and outside command history.
2. Replace the configured fingerprint and presented token atomically.
3. Prove the new token can read `health`.
4. Prove the old token returns `operator_unauthorized`.
5. Search logs/evidence for raw old/new values; the expected count is zero.

External secret-manager changes require the relevant environment approval.

### Source flag shutdown or key revocation

1. Run `disable` locally before any source-side change.
2. At an approved external checkpoint only, disable the exact Egoric source
   flag and rotate/remove its dedicated key hash.
3. Verify the old key receives 401 and the flag-off route receives 404.
4. Verify no new LeozOps snapshot/run appears and source mutation remains zero.
5. Do not run `recover` until the intended replacement flag/key is verified.

No external flag/key operation is authorized by this runbook alone.

### Stale data

1. Run `health` and record only source age, status, IDs, and timestamps.
2. Treat `stale` or `future_source_timestamp` as a limitation; never fabricate
   freshness or silently advance `last_success_at`.
3. Run one `poll` only if the connection is active/closed and source access is
   already authorized for that environment.
4. If freshness cannot be restored, run `disable` and preserve the latest
   immutable evidence.

### Schema, tenant, hash, or ETag mismatch

1. Confirm the safe failure code; never copy the raw upstream body into logs.
2. The connection must remain disabled and must not retry.
3. Compare the named contract/version and deployment identity out of band.
4. Correct the source/configuration, then use `recover` and one manual `poll`.
5. Run `reconcile`; a failed row remains immutable and is not rewritten.

### Circuit recovery

1. Inspect health for circuit state, failure count, next attempt, and safe code.
2. Resolve the underlying source/network/configuration fault.
3. Wait for any lease to expire or poll owner to finish.
4. Run `recover`, then one `poll`, then `reconcile`.
5. Confirm a valid 200/304 leaves the circuit closed and failures reset.

### Reconciliation mismatch and replay

1. A mismatch fails the business date and emits one safe alert.
2. Preserve the snapshot, run, brief formula, hashes, counts, and row ID.
3. Never update/delete the failed evidence and never repair Egoric from LeozOps.
4. Replaying the same date/timezone/evidence returns the same row and does not
   emit a duplicate alert.
5. A corrected later snapshot/run produces a distinct evidence key and row.

### Database outage

1. Treat any evidence-write error as a failed command, never a pass.
2. Do not acknowledge reconciliation success and do not mutate source state to
   pretend completion.
3. Restore database availability using the approved platform runbook.
4. Re-run the same explicit command; idempotency prevents duplicate evidence.
5. Escalate if immutable triggers or tenant FKs are unavailable.

## Migration and rollback

Local verification order:

1. `npm run migrate`
2. `npm run typecheck`
3. `npm test`
4. `npm run verify:e2e:local` with the explicit RepositoryRealms checkout path
5. `npm run migrate:rollback` on a disposable/local database only

Before rollback, inspect migration status and confirm the target database.
Stop explicit operator invocations first. Rolling back the operations migration
drops reconciliation evidence, so it requires a backup/retention decision in
any non-disposable environment. Egoric needs no data restoration because every
operation is read-only toward Egoric.

The prepared `npm run db:smoke:pg` path must run against a named disposable
PostgreSQL database before P1 can be requested. A skipped smoke is not evidence.
