# Sprint 2 / G5 — Shadow Trust Plan

Status: **PHASE 2 LOCAL CONTROL PLANE COMPLETE; P1/EXTERNAL EXECUTION BLOCKED**

Authority: DECISION-002 addenda 7–11 authorize and accept the complete S2.A
local/test code cut plus one local disposable PostgreSQL checkpoint. Managed
PostgreSQL and every external checkpoint remain blocked.

Baseline:

- RepositoryRealms snapshot supply: `main@98c0eca`;
- LeozOps G4 implementation: `main@5ef3fd5`;
- Sprint 1 acceptance: `main@8a86bae`.

## 1. Outcome

Earn G5 Shadow Trust for one company-wide, read-only Egoric sales-funnel CEO
Brief. The pilot must prove that deployed LeozOps stays fresh, exact,
reproducible, useful, and operationally invisible to Egoric employees for ten
consecutive business days.

The plan deliberately separates four facts that must not be conflated:

1. G4 proved the actual RepositoryRealms handler and LeozOps path locally.
2. A networked non-production integration has not yet been proved.
3. A production read-only shadow has not been authorized or started.
4. G5 passes only after the complete shadow evidence is reviewed and accepted.

## 2. Authorization wall

DECISION-002 addenda 7–9 authorize S2.A T1–T8 in local/test scope with injected
policy values and no mounted scheduler. Every external state change remains
blocked until the Product Owner approves the relevant checkpoint and resolves
the decisions in section 11.

Separate, just-in-time approval is then required at both external checkpoints:

- **P1 — Pre-production environment approval:** permits the exact named test
  deployment, independent test PostgreSQL database, test-only keys, and the
  source flag on that test deployment.
- **P2 — Production shadow approval:** permits the exact named production
  LeozOps deployment, independent production PostgreSQL database, dedicated
  production read key, source flag, and 15-minute read-only schedule.

Neither approval permits write-back, generic Egoric API access, employee-role
keys, email/social publishing, operational task creation, invoice actions, or
autonomy.

## 3. Smallest pilot scope

Included:

- one Egoric source tenant and one company-wide funnel;
- leads only, using `egoric_sales_v1` and native stages;
- one 15-minute ETag-aware polling worker;
- one nightly exact reconciliation job;
- one authenticated CEO Brief route already provided by
  `egoric-readonly`;
- one operator-only, one-shot refresh command inside the deployed runtime;
- persistent connector health, bounded retry/circuit state, non-PII telemetry,
  and runbooks;
- a ten-business-day read-only shadow and a final go/extend/revoke decision.

Deferred:

- public metrics or recommendation routes;
- a dashboard, employee UI, email delivery, chat delivery, or Egoric-embedded
  output;
- per-client or campaign attribution;
- tasks, users, projects, invoices, and historical stage conversion;
- webhooks, change feeds, direct database access, or bidirectional sync;
- any controlled or autonomous action.

The existing authenticated JSON brief is the recommended review surface for
the shadow. A UI or outbound delivery channel requires a separate scope and
security review.

## 4. Work packages

### S2.0 — Plan approval and environment identity

Planning deliverables:

- choose the LeozOps runtime and managed PostgreSQL provider;
- record exact test and production project IDs, regions, and owners;
- record the canonical Egoric test and production deployment identities;
- confirm business timezone, business hours, Director reviewer, brief access
  surface, alert destination, and data-retention policy;
- produce a no-secret environment variable matrix;
- approve or reject every task below.

Exit: Product Owner records task-cut approval in `DECISIONS.md`. Until then all
following packages are blocked.

### S2.A — Reliability hardening, local/test code only

Implementation tasks after task-cut approval:

- [x] **T1 — Persistent poll state:** add a one-to-one source reliability state
  with last attempt, consecutive failures, circuit state, next eligible
  attempt, lease/revision, and non-secret error classification. Do not duplicate
  existing ETag or last-success state. Migrations must be reversible and work
  on SQLite plus PostgreSQL.
- [x] **T2 — Bounded poll coordinator:** one in-flight pull per connection; fixed
  15-minute target cadence; deterministic test clock; bounded exponential
  backoff with jitter; `Retry-After` support; no unbounded retries.
- [x] **T3 — Fail-closed policy:** never retry 401/403 or schema/hash/tenant
  failures; disable the affected connection, alert, and require operator
  recovery. Retry only network, 429, and eligible 5xx failures within bounds.
  The adapter may expose sanitized status and bounded `Retry-After` metadata;
  it must never expose or log the upstream body or caller-controlled headers.
- [x] **T4 — Persistent circuit breaker:** open after the approved threshold,
  remain restart-safe, support a single controlled probe, and close only after
  a valid 200 or 304 recovery.
- [x] **T5 — Nightly reconciliation:** compare source total/stage/source facts with
  the accepted stored snapshot and brief; record only counts, IDs, hashes, and
  status. Any mismatch fails the day and alerts; it never repairs Egoric.
- [x] **T6 — Freshness and health:** expose an authenticated operator health view
  with last success, source age, ETag, circuit state, next attempt, and failure
  class. No payload, PII, bearer token, or raw error body may appear.
- [x] **T7 — Operator commands:** one-shot poll, reconcile, disable, and recovery
  commands run inside the service environment. No public mutation route is
  added to `egoric-readonly`.
- [x] **T8 — Runbooks and tests:** key rotation, flag shutdown, stale data, schema
  mismatch, circuit recovery, replay, database outage, and rollback.

Checkpoint A evidence:

- full LeozOps and RepositoryRealms suites plus typecheck pass;
- SQLite migration apply/rollback and live disposable PostgreSQL
  migrate/rollback/immutability smoke pass;
- retry/exhaustion/jitter/`Retry-After`/401/403/schema/circuit/recovery tests
  pass under a fake clock;
- source instrumentation observes GET only and zero bodies;
- restart tests prove persistent schedule and circuit state;
- integration profile still denies every legacy mutation surface;
- dependency, secret, PII, and network-egress scans pass;
- Codex records the technical verdict before P1 is requested.

T1–T4 evidence is recorded in [`POLL_RELIABILITY.md`](POLL_RELIABILITY.md), and
T5–T8 evidence/runbooks are recorded in
[`SOURCE_OPERATIONS.md`](SOURCE_OPERATIONS.md) and
[`S2A_OPERATIONS_RUNBOOK.md`](S2A_OPERATIONS_RUNBOOK.md). The complete
The complete SQLite-backed local core and disposable PostgreSQL
migrate/rollback/immutability cycle pass as recorded in
[`POSTGRES_SMOKE.md`](POSTGRES_SMOKE.md). Checkpoint A is technically complete;
P1 remains blocked on the named Product Owner decisions in section 11.

### S2.B — Networked pre-production proof

Blocked until Checkpoint A passes and P1 names the exact external targets.

Operations:

1. Provision an independent LeozOps test runtime and PostgreSQL database.
2. Deploy LeozOps with `egoric-readonly`, source disabled, and no source key.
3. Prove public health, authenticated brief denial without configured output
   auth, migration status, and zero source requests.
4. Create one test-only source key; store only its hash in the named Egoric
   test deployment and its raw value in the LeozOps test secret manager.
5. Enable the source route only on the named Egoric test deployment.
6. Run a networked 200/304 pull, exact reconciliation, PII scan, cross-instance
   key denial, malformed method denial, and source latency/error comparison.
7. Rotate the key and disable the source flag; verify access stops within one
   polling interval and LeozOps records no source mutation.
8. Roll back the test deployment and database migration using the runbook.

Checkpoint B evidence:

- exact deployment identities and non-secret config hashes recorded;
- live PostgreSQL smoke and restore-free rollback pass;
- networked counts and brief reconcile exactly;
- source flag/key isolation and cross-instance denial pass;
- readiness, latency, error-rate, PII, and zero-mutation evidence pass;
- no test secret appears in Git, command output, application logs, or evidence;
- Codex records PASS before P2 is requested.

### S2.C — Production canary and ten-business-day shadow

Blocked until Checkpoint B passes and P2 names the exact production targets.

Safe activation order:

1. Deploy LeozOps with polling disabled; verify health and PostgreSQL.
2. Provision separate source-read and output-read secrets in their respective
   secret managers; record fingerprints only.
3. Verify the dedicated source key is denied by every generic Egoric API.
4. Enable the dedicated source route for the one approved Egoric deployment.
5. Run one manual 200/304 canary and reconcile it.
6. Compare Egoric employee-path latency and error rate with the approved
   baseline; abort on regression.
7. Enable one 15-minute worker for the one source connection.
8. Run nightly reconciliation and daily Director review for ten consecutive
   business days. A failed day does not count toward the ten-day sequence.

The CEO Brief remains advisory and external to Egoric. No data is inserted into
Egoric and no message is sent automatically.

### S2.D — Release decision

At the end of the evidence window, the Product Owner chooses exactly one:

- **go:** retain the read-only pilot under its existing boundaries;
- **extend:** continue shadow with named corrective criteria and a new review
  point; or
- **revoke:** disable flag, revoke key, stop worker, and retain evidence for
  audit.

The decision is recorded in `DECISIONS.md`. G5 does not unlock G6 supervised
actions; G6 is a separate project and approval.

### Local S2.B–S2.D implementation package

DECISION-002 addendum 13 authorizes the complete remaining Phase 2 code cut in
local/test scope without inferring external authority. The implementation on
`codex/leozops-phase2` provides:

- [x] Checkpoint B and P2 schemas with exact-key validation, non-secret
  evidence references, environment identity matching, and cryptographic
  binding to the accepted P1 decision.
- [x] A command-and-exit shadow worker whose test/production execution fails
  closed unless the appropriate P1 → Checkpoint B → P2 chain validates.
- [x] Public read-only readiness that proves DB/current-schema availability
  without mounting an operator or mutation route.
- [x] Immutable poll-run evidence for outcome, retries, latency, GET/no-body,
  snapshot/run provenance, freshness confirmation, and zero source mutation.
- [x] Immutable daily evidence with business-calendar schedule coverage,
  exact reconciliation, regression/false-claim review, and safe incident
  counts.
- [x] A ten-consecutive-business-day G5 evaluator and immutable
  go/extend/revoke record. `go` fails closed until every acceptance criterion
  represented by the ledger passes.
- [x] Pending-by-default P1, Checkpoint B, and P2 templates plus the complete
  solo-founder operational/rollback runbook in
  [`PHASE_2_OPERATIONS.md`](PHASE_2_OPERATIONS.md).

This completes the repository implementation required to execute S2.B–S2.D;
it does not mark their external evidence gates complete. Provisioning,
deployment, real keys/flags, the network checkpoint, production canary, and
ten elapsed business days remain facts that can only be produced against the
exact approved environments.

## 5. Failure policy

| Condition | Required behavior |
|---|---|
| 200 valid snapshot | Validate, store idempotently, record success |
| 304 matching prior ETag | Record health only; no snapshot or run |
| 400/404/405 | Disable connection; configuration/contract alert; no retry |
| 401/403 | Disable immediately; security alert; no retry |
| Schema/hash/tenant mismatch | Quarantine response metadata, disable; no persistence of invalid facts |
| 429 | Honor bounded `Retry-After`, then jitter; no burst retry |
| Eligible 5xx/network timeout | Bounded retry, then open persistent circuit |
| Database unavailable | Do not acknowledge success; never mutate source; retry under DB policy |
| Source age ≥ 30 minutes in business hours | Mark stale, alert, show limitation; never fabricate freshness |
| Reconciliation mismatch | Fail the day, preserve evidence, alert; never auto-correct Egoric |

Exact retry counts, delays, circuit thresholds, and business hours are approved
configuration, not hidden code defaults.

## 6. Secrets and capability isolation

- Use a dedicated high-entropy `LEOZOPS_READ` value per environment.
- RepositoryRealms receives only the SHA-256 hash; LeozOps receives the raw
  source value only through its environment-specific secret manager.
- Output auth uses separate values and cannot authenticate to the source.
- Test and production values must differ and fail in the opposite environment.
- Logs/evidence contain fingerprints only; CI and shell traces must mask raw
  values.
- Rotation is tested before shadow and once during a controlled shadow drill.
- Missing flag/hash/key/output auth always fails closed.

## 7. Observability and evidence

Allowed telemetry:

- tenant/source connection ID, correlation ID, key fingerprint;
- request status, latency, record count, snapshot ID, ETag fingerprint;
- last attempt/success, source age, failure class, circuit state;
- reconciliation totals and pass/fail status.

Forbidden telemetry:

- raw source/output keys or authorization headers;
- lead IDs, names, email, phone, notes, company, employee IDs, or payloads;
- raw upstream response/error bodies;
- database connection strings.

Daily evidence row:

| Field | Meaning |
|---|---|
| business date/timezone | Approved pilot calendar identity |
| attempts / successes / 304s | Reliability denominator and outcomes |
| latest source age | Freshness at review time |
| source / snapshot / brief totals | Exact reconciliation |
| native stage/source deltas | Must all equal zero |
| source mutation count | Must equal zero |
| employee error/latency regression | Must be false |
| brief formula/snapshot/run IDs | Reproducibility |
| reviewer score / material false claim | Usefulness and trust |
| incidents / rollback events | Operational record |

## 8. G5 acceptance criteria

All must pass:

- at least 99.5% successful scheduled syncs during the shadow window;
- business-hours source age below 30 minutes;
- exact total, native-stage, and safe-source reconciliation for ten
  consecutive business days;
- every displayed metric reproduces from immutable snapshot/run/formula
  provenance;
- zero Egoric mutations attributable to LeozOps;
- zero employee workflow regression and no material source latency/error
  regression;
- no material false claim in the reviewed briefs;
- recurring output usefulness rated at least 4/5 by the Product Owner;
- flag shutdown and key revocation stop access within one polling interval;
- rollback requires no Egoric data restoration;
- final go/extend/revoke decision recorded.

## 9. Rollback order

1. Disable the source feature flag on the one approved Egoric deployment.
2. Rotate/remove the source key hash.
3. Stop the LeozOps worker or scale it to zero.
4. Verify subsequent source access is 404/401 and no new run appears.
5. Keep immutable snapshots and operational evidence; do not delete or rewrite
   them during incident handling.
6. Roll back LeozOps code/schema only if required by its own failure; Egoric
   needs no data restoration because the integration never writes to it.

## 10. QA mapping

The twelve release checks in [`EGORIC_INTEGRATION.md`](EGORIC_INTEGRATION.md)
§15 remain mandatory. Checkpoint A covers deterministic and failure-path code;
Checkpoint B covers network, PostgreSQL, isolation, and rollback; S2.C covers
the production canary and sustained trust evidence. No checkpoint waives an
earlier result.

## 11. Product Owner decisions required before P1

The S2.A local/test task cut in item 9 is approved by DECISION-002 addenda 7–9.
Before P1, the Product Owner must still record:

1. LeozOps test/production runtime provider, project IDs, regions, and owners.
2. Managed PostgreSQL provider, database identities, backup expectation, and
   retention policy.
3. Canonical Egoric test/production deployment identities.
4. Business timezone and business-hours window.
5. Director reviewer and authenticated brief access method.
6. Alert destination and on-call owner; platform-native alerts are recommended
   for the smallest pilot.
7. Exact retry, timeout, circuit, and stale thresholds.
8. Snapshot/evidence retention and access policy.
9. The already recorded approval of the S2.A local/test task cut.

The local fail-closed decision schema, provisional solo-founder defaults, and
approval procedure are in [`P1_DECISION_PACKET.md`](P1_DECISION_PACKET.md).
Run `npm run p1:preflight -- <decision-manifest.json>` before recording a P1
approval. A passing preflight proves only that the decision is complete; it
does not authorize or perform external work.

Until items 1–8 are recorded in one passing manifest and accepted in a new
DECISION-002 addendum, P1 and every external action remain blocked.
