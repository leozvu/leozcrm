# Sprint 5 — Operational Assurance and Release Evidence

Status: **LOCAL IMPLEMENTATION COMPLETE; EXTERNAL G5/G6/G7 REMAIN BLOCKED**

Authority: DECISION-002 addendum 16.

## 1. Outcome

Turn the Phase 4 rehearsal evidence into a deterministic, auditable safety
case for one exact G7 policy. Phase 5 proves whether local controls and drills
are internally consistent; it does not release or schedule autonomy.

## 2. Capability boundary

Phase 5 may:

- accept one exact-key local-assurance policy bound to one immutable G7 policy;
- derive observations only from stored G5/G6/G7 facts;
- compute a deterministic local pass/fail assessment over a bounded window;
- produce an immutable release package with explicit external blockers; and
- expose command-and-exit preflight/operator tools.

Phase 5 may not:

- create a new autonomy gate or widen an action policy;
- accept arbitrary operator claims as evidence;
- waive missing, failed, corrupt, or stale prerequisites;
- mark G7 released or production-ready from local evidence;
- register a production action adapter or add a timer, scheduler, daemon,
  network client, HTTP mutation route, credential, deployment, or external
  mutation.

## 3. Local assurance checks

The canonical assessment recomputes all of these from immutable records:

1. exact Phase 5 → G7 → G6 binding and active validity;
2. latest bound G5 decision is still `go`;
3. canonical G7 simulation is passing and fingerprint-consistent;
4. kill switch is engaged at assessment time;
5. no autonomy incident is open;
6. the assessment window has the required successful autonomous executions;
7. failed or reconciliation-required autonomous executions do not exceed zero;
8. at least one separately approved successful human recovery exists;
9. an incident/halt drill exists and was resolved while the kill switch
   remained engaged; and
10. the checked-in production action-adapter registry is empty.

A release package additionally requires the latest passing assessment to be at
most 5–60 configured minutes old and recomputes the same safety state before it
is packaged. Any later G5 decision or G7 event makes the prior assessment stale.

Any missing or corrupt fact fails closed. The assessment stores counts, bounded
codes, timestamps, and fingerprints only; it stores no command payload, raw
source data, credential, PII, or free-form external claim.

## 4. Release-package boundary

An assessment may be locally passing while its release package remains
`blocked_external`. The canonical blockers are always present in this local
phase:

- external G5 release unproven;
- command-specific G6 release unproven;
- qualifying production supervised history unproven;
- deployed exact production adapter and least-privilege credential absent;
- deployed monitoring and independently verified kill switch absent;
- production canary absent;
- external incident/recovery drill absent; and
- explicit Product Owner G7 release absent.

There is no approve/promote/waive command. A future externally authorized phase
must define how each blocker is proven against named infrastructure.

## 5. Completion criteria

- [x] Exact assurance policy and credential-separation validation.
- [x] Immutable policy, assessment, release-package, and ordered event tables.
- [x] Deterministic database-derived assessor and always-blocked release packager.
- [x] Fail-closed pending template, preflight, operator, and runbook.
- [x] Adversarial tests for drift, revocation, incidents, drill gaps,
  idempotency, corruption, immutability, and secret absence.
- [x] SQLite and PostgreSQL migration/apply/rollback proof.
- [x] Empty production adapter registry and no external/scheduled runtime.
