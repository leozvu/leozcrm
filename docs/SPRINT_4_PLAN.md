# Sprint 4 / G7 — Bounded Autonomy Rehearsal Plan

Status: **LOCAL REHEARSAL COMPLETE; G5, G6, AND G7 EXTERNAL RELEASE BLOCKED**

Authority: DECISION-002 addendum 15.

## 1. Outcome

Build the smallest fail-closed control plane that can prove how one already
successful, low-risk supervised command could later run inside a standing
policy without per-action approval. The repository increment is an inert
rehearsal: production composition has no command adapter and no scheduler.

## 2. Hard prerequisites

Before an allowed local cycle can reach an injected adapter, all must hold:

1. the exact tenant/source still has a latest Phase 2 `go`;
2. the bound G6 policy is exact, accepted, active, low-risk, and unchanged;
3. the recent immutable G6 history meets the policy threshold, contains no
   failed, in-progress, or reconciliation-required execution, and includes a
   successful rollback drill;
4. the exact G7 policy passed the canonical deterministic simulation suite;
5. source data is fresh, the policy is active, no incident is open, cooldown
   and rolling blast-radius limits have room, and the kill switch is released;
6. the exact adapter descriptor is registered in the invoking process.

Any later G5 revoke/extend, G6 expiry or drift, stale source, policy expiry,
incident, limit exhaustion, credential mismatch, or missing adapter denies the
cycle before an external command call.

## 3. Capability slice

### S4.A — Exact standing policy and simulator

- Exact-key `leozops_g7_bounded_autonomy_policy_v1` manifest.
- One low-risk command and target, inherited exactly from one G6 policy.
- Deterministic canonical scenario suite covering prerequisite, kill-switch,
  freshness, cooldown, cost, rate, mutation, incident, and happy paths.
- Immutable simulation result bound to the policy and G6 fingerprints.

### S4.B — Safety state and monitoring

- Kill switch begins engaged and changes only through immutable events.
- Release requires separate release-authority and kill-switch credentials.
- Manual engagement remains available even if other prerequisites are broken.
- Incident open/resolve is append-only; an open incident blocks every cycle.
- Source freshness, recent supervised history, and rolling autonomous usage are
  checked again for every candidate.

### S4.C — One-cycle rehearsal

- Command-and-exit invocation; one candidate only; no timer or scheduler.
- Safe payload and exact adapter validation followed by zero-mutation dry-run.
- Immutable allow/deny evaluation records the policy inputs and preview.
- Atomic idempotency, rate, cost, cooldown, and lease claim before execution.
- Invalid, thrown, over-preview, or unknown results become
  `reconciliation_required`, open an incident, and engage the kill switch.
- No autonomous rollback. Human recovery requires the kill switch, an exact
  zero-mutation preview, a new dual-credential approval, and explicit invocation
  inside the original 24-hour recovery window. It remains available after G5
  revoke so a stop decision cannot disable remediation.

### S4.D — Evidence and operations

- Immutable SQLite/PostgreSQL policy, simulation, evaluation, kill-switch,
  incident, and event facts.
- Guarded attempt rows allow only one `in_progress` to terminal transition.
- Adversarial tests cover stale/drifted prerequisites, credentials, replay,
  concurrency-sensitive limits, unknown outcomes, immutability, and raw-secret
  absence.
- Pending policy template, read-only preflight, operator CLI, and runbook.

## 4. Initial envelope

- G6 risk tier must be `low`;
- one candidate and at most one external mutation per invocation;
- 5–100 qualifying supervised successes in a 7–90 day history window;
- at least one successful supervised rollback drill;
- 1–10 autonomous executions per hour and 1–50 per rolling 24 hours, never
  exceeding the bound G6 policy;
- per-action and daily cost ceilings never exceed the G6 ceiling;
- 60–3600 second cooldown and 30–300 second execution lease;
- source age ceiling 5–30 minutes;
- G7 policy validity at most 30 days;
- one separately previewed/approved human recovery within 24 hours;
- any failed or uncertain autonomous attempt halts further cycles.

## 5. G7 acceptance boundary

The local Phase 4 package is complete when the simulator, safety state,
one-cycle injected-adapter path, database guards, and adversarial tests pass.
G7 itself remains blocked until G5 and G6 are genuinely released, sufficient
production supervised history exists, command-specific external evidence and
incident drills pass, a deployed kill switch is independently verified, and
Leoz records a separate explicit G7 release decision.

Local tests never authorize production credentials, external mutation,
scheduling, or autonomous rollback.

## 6. Local completion record

- [x] Exact G6-bound G7 policy and deterministic 13-scenario simulator.
- [x] Qualifying real G6 history evaluator and fresh-source prerequisite.
- [x] Initial fail-closed kill switch with distinct release/executor/kill keys.
- [x] One-candidate dry-run, immutable allow/deny evidence, and atomic claim.
- [x] Rolling rate/cost/cooldown limits and fail-closed incident handling.
- [x] Human recovery preview, separate approval, idempotent execution, and
  expired-lease reconciliation.
- [x] SQLite/PostgreSQL immutability, migration rollback, adversarial tests,
  CLI/preflight, and operations runbook.
- [x] Empty production adapter registry, no scheduler, no HTTP mutation route,
  and no external request.
