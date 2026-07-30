# Phase 2 Operations — Network Proof to G5 Decision

Status: **LOCAL CONTROL PLANE COMPLETE; P1/P2 AND EXTERNAL EXECUTION PENDING**

This runbook is the executable companion to [`SPRINT_2_PLAN.md`](SPRINT_2_PLAN.md).
It covers S2.B network proof, S2.C production shadow, and S2.D release decision
without adding another product surface. It does not provision infrastructure,
create credentials, change an Egoric flag, or claim that a ten-day window has
occurred.

## 1. What the implementation now enforces

- A test worker requires one valid, exact P1 manifest.
- A production worker additionally requires passing Checkpoint B evidence and
  a P2 manifest cryptographically bound to the same P1 decision.
- Runtime, database, Egoric project, tenant, and endpoint identities must match
  the approved manifest before a poll can start.
- Every scheduler invocation is one command-and-exit process. The API server
  never mounts a timer, background worker, public operator route, or mutation
  route.
- Poll evidence is immutable and contains only safe IDs, status, timing,
  counts, fingerprints, GET/no-body proof, and a zero-mutation counter.
- Daily evidence is immutable. A failed day never counts toward the required
  ten consecutive business days.
- `go` is impossible until the evaluator passes the complete G5 window.
  `extend` and `revoke` remain available so an unsafe or incomplete pilot can
  be represented honestly.

The three new evidence tables are `source_poll_runs`,
`shadow_daily_evidence`, and `phase2_release_decisions`. SQLite and PostgreSQL
triggers reject update/delete on all three.

## 2. P1 — authorize the named test environment

Complete `config/p1.decision.example.json` with exact, non-secret values and
logical `secret://` references, then run:

```text
npm run p1:preflight -- <p1.json>
```

A PASS validates the decision file only. Record Product Owner acceptance in
`DECISIONS.md` before creating the named resources. The checked-in example is
deliberately pending and must fail.

## 3. S2.B — networked test proof

Safe order:

1. Create only the exact P1-named test runtime and independent test database.
2. Deploy with `INTEGRATION_MODE=egoric-readonly`, source flag disabled, no
   source key, and no mounted schedule.
3. Apply current migrations. Verify `GET /health` and `GET /ready`; `/ready`
   returns only DB reachability and current-schema status.
4. Verify the brief denies missing/bad output authentication and zero source
   requests occurred before enablement.
5. Create one test-only source-read credential in the designated secret
   managers; never put the raw value in Git, evidence, logs, or command flags.
6. Enable only the named Egoric test route and run one worker invocation for a
   network `200`, then another for `304`.
7. Run exact reconciliation, PII/secret scans, cross-instance denial, method
   denial, latency/error comparison, key rotation, and flag shutdown.
8. Roll back the test deployment and migration. Egoric data restoration must
   remain unnecessary.

The test worker requires these environment identities to match P1:

```text
LEOZOPS_PHASE2_ENVIRONMENT=test
LEOZOPS_P1_MANIFEST=<absolute path to accepted p1.json>
LEOZOPS_RUNTIME_PROJECT_ID=<P1 test runtime project>
LEOZOPS_DATABASE_ID=<P1 test database>
LEOZOPS_EGORIC_PROJECT_ID=<P1 test Egoric project>
LEOZOPS_OPERATOR_TOKEN=<secret-manager value>
LEOZOPS_OPERATOR_TOKEN_SHA256=sha256:<fingerprint>
LEOZOPS_SOURCE_BEARER_TOKEN=<test source-read secret>
LEOZOPS_SOURCE_ENGINE_VERSION=egoric_ingestion_v1
```

Invoke one due poll:

```text
npm run source:shadow -- poll --tenant-id <uuid> --connection-id <uuid>
```

Copy `config/checkpoint-b.evidence.example.json`, replace every pending value
with a safe artifact reference/result, and validate the chain:

```text
npm run phase2:preflight -- checkpoint-b <p1.json> <checkpoint-b.json>
```

Checkpoint B must report only GET, zero bodies, zero source mutations, zero
PII findings, zero secret findings, and no required source restore. A PASS does
not authorize production.

## 4. P2 — authorize the named production shadow

Copy `config/p2.decision.example.json`, bind it to the exact P1 and Checkpoint
B fingerprints emitted by the preflights, and record the exact production
identities. Then run:

```text
npm run phase2:preflight -- p2 <p1.json> <checkpoint-b.json> <p2.json>
```

After Product Owner acceptance is recorded, production command invocations
also require:

```text
LEOZOPS_PHASE2_ENVIRONMENT=production
LEOZOPS_P1_MANIFEST=<accepted p1.json>
LEOZOPS_CHECKPOINT_B_EVIDENCE=<passing checkpoint-b.json>
LEOZOPS_P2_MANIFEST=<accepted p2.json>
LEOZOPS_RUNTIME_PROJECT_ID=<P1 production runtime project>
LEOZOPS_DATABASE_ID=<P1 production database>
LEOZOPS_EGORIC_PROJECT_ID=<P1 production Egoric project>
```

Missing, altered, mixed-environment, or stale manifests fail before a source
request.

## 5. S2.C — canary and scheduled shadow

Use the activation order in `SPRINT_2_PLAN.md`: deploy disabled, verify
PostgreSQL/readiness, install separate source/output secrets, prove the source
key is denied by generic APIs, enable only the dedicated route, run one manual
200/304 canary and reconciliation, compare employee latency/error baselines,
then mount the external 15-minute schedule.

The schedule runs the same one-shot command:

```text
npm run source:shadow -- poll --tenant-id <uuid> --connection-id <uuid>
```

Do not run multiple schedules for the same connection. Persistent lease and
circuit state still reject overlap and unsafe retries.

At the end of each approved business day, after nightly reconciliation and
Director review, record explicit evidence. Boolean values must be literal
`true` or `false`; counts must be non-negative integers:

```text
npm run source:shadow -- daily-close \
  --tenant-id <uuid> \
  --connection-id <uuid> \
  --business-date YYYY-MM-DD \
  --reviewer Leoz \
  --score 4 \
  --material-false-claim false \
  --source-mutations 0 \
  --employee-regression false \
  --latency-regression false \
  --error-regression false \
  --incidents 0 \
  --rollbacks 0
```

A day fails if it has incomplete in-business-hours schedule coverage, any
failed poll, stale confirmation, failed reconciliation, count/stage/source drift, mutation,
workflow/latency/error regression, authorization mixing, or a material false
claim. A failed day is immutable and resets the consecutive-day streak.

Inspect the current window:

```text
npm run source:shadow -- status --tenant-id <uuid> --connection-id <uuid>
```

The evaluator requires ten consecutive approved business dates, at least
99.5% successful scheduled syncs, exact reconciliation, zero mutation and
regression, no material false claim, and an average reviewer score of at least
4/5.

## 6. S2.D — go, extend, or revoke

Record exactly one evidence-bound outcome:

```text
npm run source:shadow -- decide --tenant-id <uuid> --connection-id <uuid> \
  --decision go --decided-by Leoz --reason g5_shadow_passed
```

For extension, add `--extend-until YYYY-MM-DD`. `go` fails closed while the
evaluator is blocked. `extend` or `revoke` can be recorded against incomplete
or failed evidence. The command records the decision only and performs no
provider, secret-manager, or Egoric action.

## 7. Rollback and revoke

External rollback remains deliberately manual and provider-specific:

1. Disable the dedicated source flag on the one approved Egoric deployment.
2. Rotate/remove the source-read hash.
3. Stop or scale the LeozOps schedule to zero.
4. Verify the next access is denied and no new poll run is recorded.
5. Preserve immutable snapshots and evidence.
6. Roll back LeozOps code/schema only if required; never restore Egoric data
   because LeozOps did not write it.

Record a `revoke` decision after executing and verifying those steps. Do not
claim external shutdown from the decision command itself.

## 8. Solo-founder review

Leoz may be the Director reviewer, on-call owner, and Product Owner for this
smallest pilot. The system still requires explicit identities, authenticated
commands, immutable evidence, and separate P1/P2 decisions. Solo operation
does not turn a pending template, local rehearsal, or elapsed calendar day
into production evidence.
