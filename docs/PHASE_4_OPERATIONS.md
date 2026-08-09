# Phase 4 Operations — G7 Bounded-Autonomy Rehearsal

Status: **LOCAL CONTROL PLANE ONLY; EXTERNAL G5/G6/G7 BLOCKED**

Authority: DECISION-002 addendum 15.

## 1. Safety boundary

- The checked-in production action-adapter registry is empty. No command in
  this repository can reach RepositoryRealms.
- There is no scheduler, daemon, timer, background loop, HTTP action route, or
  autonomous rollback.
- One command-and-exit invocation evaluates one candidate only.
- The kill switch begins engaged. A human must release it with two distinct
  credentials after every prerequisite passes.
- Every execution failure, invalid result, crashed lease, or unknown outcome
  opens immutable incident evidence and engages the kill switch.
- Recovery is human-controlled: engage kill switch → exact zero-mutation
  recovery preview → separately authenticated approval → explicit recovery
  invocation. It is available for 24 hours after success even if G5 is later
  revoked, but it never runs automatically.

## 2. Commands

Install and migrate normally, then use exact JSON input files:

```text
npm run g7:preflight -- /absolute/path/to/accepted-g7-policy.json
npm run autonomy:operator -- simulate-policy input.json
npm run autonomy:operator -- accept-policy input.json
npm run autonomy:operator -- release-kill-switch input.json
npm run autonomy:operator -- run input.json
npm run autonomy:operator -- engage-kill-switch input.json
npm run autonomy:operator -- preview-recovery input.json
npm run autonomy:operator -- decide-recovery input.json
npm run autonomy:operator -- recover input.json
npm run autonomy:operator -- reconcile input.json
npm run autonomy:operator -- reconcile-recovery input.json
npm run autonomy:operator -- resolve-incident input.json
npm run autonomy:operator -- status input.json
```

Every input object rejects missing or extra fields. Payloads remain bounded safe
JSON; credentials are read only from environment variables.

## 3. Required runtime identity

The exact G6 variables from `docs/PHASE_3_OPERATIONS.md` remain required. G7
adds:

```text
LEOZOPS_G7_ENVIRONMENT
LEOZOPS_G7_POLICY_SHA256
LEOZOPS_G7_G6_POLICY_SHA256
LEOZOPS_G7_TARGET_SHA256
LEOZOPS_G7_RELEASE_CREDENTIAL_SHA256
LEOZOPS_G7_EXECUTOR_CREDENTIAL_SHA256
LEOZOPS_G7_KILL_SWITCH_CREDENTIAL_SHA256
```

Raw values come from a secret manager only:

```text
LEOZOPS_G7_RELEASE_CREDENTIAL
LEOZOPS_G7_EXECUTOR_CREDENTIAL
LEOZOPS_G7_KILL_SWITCH_CREDENTIAL
```

All three fingerprints must differ from one another and from every G6 human or
command credential. Raw values are never persisted or printed.

## 4. Release sequence

1. Obtain a genuine current G5 `go` and an externally released exact G6
   low-risk command.
2. Accumulate at least the policy minimum successful supervised executions,
   zero non-successful executions in the selected history window, and one
   successful supervised rollback drill.
3. Copy the pending template to an untracked secure location and replace every
   value. Do not edit the checked-in example into an apparent approval.
4. Run `simulate-policy`; verify all canonical scenarios pass.
5. Run `accept-policy` with the release credential. The persisted policy starts
   with its kill switch engaged.
6. Run `g7:preflight`; production composition in this branch remains blocked
   because no released adapter is registered.
7. Only after command-specific external QA and a separate Product Owner G7
   decision may a future deployed build register that adapter.
8. Release the kill switch with release + kill-switch credentials.
9. Invoke one `run` input. Reuse the same idempotency key only for an exact
   replay; a changed candidate is rejected.

## 5. Candidate result and exit codes

| Exit | Meaning |
|---|---|
| `0` | Denied safely, succeeded, replayed, or read-only command completed |
| `1` | Adapter reported a known zero-mutation failure |
| `2` | Policy, authorization, runtime identity, prerequisite, or input blocked |
| `3` | External outcome is uncertain and manual reconciliation is mandatory |

A policy denial is evidence, not an operator error; inspect
`evaluation.decision_code`. An allowed evaluation followed by an atomic-claim
failure still makes no command call.

## 6. Incident and recovery sequence

1. Immediately run `engage-kill-switch`. It remains available after G5 revoke,
   policy expiry, stale data, or other broken prerequisites.
2. Inspect the immutable status timeline and the source-side idempotency record.
   Never retry an uncertain command.
3. If an execution lease expired, run `reconcile`; for a recovery lease use
   `reconcile-recovery`. Both seal the attempt as
   `reconciliation_required` without an adapter call.
4. For a confirmed successful action needing reversal, keep the kill switch
   engaged and run `preview-recovery`.
5. Review the exact recovery effect and run `decide-recovery`. Approval uses
   release + kill-switch credentials and expires within the original 24-hour
   recovery window.
6. Run `recover` with the executor credential. It is idempotent and bypasses
   exhausted autonomy limits only to preserve remediation.
7. Resolve the incident only after external evidence is reconciled. Resolution
   does not release the kill switch.
8. Re-run preflight and explicitly release the kill switch again if continued
   operation is separately justified.

## 7. Evidence retained

- exact policy and deterministic simulation;
- kill-switch transitions;
- allow/deny evaluations and zero-mutation previews;
- one guarded terminal attempt per candidate;
- human recovery preview, approval, and attempt;
- incident open/resolve facts;
- policy-scoped monotonic event timeline.

All facts except the one guarded in-progress attempt transition are database
immutable in SQLite and PostgreSQL.
