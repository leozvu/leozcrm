# Phase 3 Operations — G6 Supervised Action

Status: **LOCAL CONTROL PLANE COMPLETE; G5/COMMAND-SPECIFIC RELEASE BLOCKED**

Plan: [`SPRINT_3_PLAN.md`](SPRINT_3_PLAN.md)

## Safety posture

- The checked-in production adapter registry is empty. This repository cannot
  currently call a real RepositoryRealms write command.
- The operator is command-and-exit. There is no HTTP action route, timer,
  scheduler, autonomous loop, broad employee credential, or direct database
  write to Egoric.
- Every new action rechecks an immutable and still-current G5 `go`, exact G6
  policy, runtime identity, proposal, dry-run, approval, expiry, rate, budget,
  idempotency, and operator credential before an adapter call.
- Approval and operator secrets are separate. Only their SHA-256 fingerprints
  are stored; raw values stay in the approved secret manager and process
  environment.
- An unknown adapter outcome is sealed as `reconciliation_required` and is
  never retried automatically.
- A rollback is not automatic. It needs a second dry-run and approval, can run
  once, and is available for 24 hours after success even if G5 is revoked.

## Evidence model

| Table | Purpose | Mutation rule |
|---|---|---|
| `supervised_action_policies` | Exact G5/command/identity/limit manifest | Immutable |
| `supervised_action_proposals` | Safe payload and evidence-bound request | Immutable |
| `supervised_action_previews` | Execute or rollback dry-run | Immutable |
| `supervised_action_approvals` | Human approve/reject decision | Immutable |
| `supervised_action_attempts` | Idempotent execution coordination/result | One guarded in-progress → terminal transition; never delete |
| `supervised_action_events` | Ordered audit timeline | Immutable |

Persisted action facts contain safe IDs, codes, canonical allowlisted payload,
fingerprints, counts, timings, and costs. Secret/PII-shaped payload fields and
raw provider responses are rejected.

## Preflight

The checked-in template is intentionally pending:

```text
npm run g6:preflight -- config/g6.action-policy.example.json
```

It must return a blocked result. A future accepted policy also needs these
runtime values to match exactly:

```text
LEOZOPS_ACTION_ENVIRONMENT
LEOZOPS_ACTION_TARGET_PROJECT_ID
LEOZOPS_ACTION_TARGET_TENANT_KEY
LEOZOPS_ACTION_COMMAND_ENDPOINT_URL
LEOZOPS_ACTION_COMMAND_CREDENTIAL_SHA256
LEOZOPS_ACTION_APPROVAL_CREDENTIAL_SHA256
LEOZOPS_ACTION_OPERATOR_CREDENTIAL_SHA256
```

Preflight remains blocked until the referenced G5 decision exists in the same
database, is the latest `go`, the policy is active, runtime identities match,
and the exact adapter is compiled into
`src/integrations/actions/buildActionAdapterRegistry.ts` after its separate
release review.

## Operator workflow

All commands read one exact-key JSON input file:

```text
npm run action:operator -- <command> <input.json>
```

Commands execute in this order:

1. `accept-policy` — input: `policy_file`.
2. `propose` — policy ID, safe payload, reason/impact codes, evidence refs,
   estimate, currency, idempotency key, requester, and expiry.
3. `preview` — proposal ID and operator. Requires
   `LEOZOPS_ACTION_OPERATOR_CREDENTIAL`.
4. `decide` with `kind=execute` — approve/reject the exact preview. Requires
   `LEOZOPS_ACTION_APPROVAL_CREDENTIAL`.
5. `execute` — explicit operator invocation with the operator credential.
6. `status` — read immutable timeline and attempt results.

If a process crashed and its lease expired, `reconcile` seals the attempt as
`reconciliation_required` without calling the adapter. This safety command
remains available after proposal/approval expiry; it still requires the exact
operator identity and credential.

Rollback uses `preview-rollback`, another `decide` with `kind=rollback`, then
`rollback`. A rejection is final for that preview; create no replacement or
silent override.

The input file must never contain either credential. The CLI reads them only
from process environment and never prints them.

## Exit behavior

| Exit | Meaning |
|---:|---|
| `0` | Safe command completed; inspect returned evidence |
| `1` | Adapter returned a known failed action with zero mutation |
| `2` | Preflight/input/auth/policy/approval/limit blocked before action |
| `3` | Outcome is unknown; manual reconciliation required, no retry |

## Incident sequence

1. Stop invoking the operator; there is no background process to stop.
2. Record a Phase 2 `revoke` to block all new G6 actions.
3. Inspect `status` by proposal ID and reconcile the external system using the
   recorded request/result fingerprints and external request ID.
4. If the original execution succeeded and rollback is still within 24 hours,
   run the separately approved rollback sequence.
5. Rotate approval/operator credentials when compromise is suspected.
6. Preserve all evidence. Never rewrite an attempt to make the timeline look
   successful.

## External release checklist

Do not register a real adapter until all are recorded:

- real G5 `go` evidence;
- narrow RepositoryRealms command endpoint and payload/result schemas;
- exact target and revocable least-privilege credential;
- dry-run parity and zero-mutation proof;
- provider/source idempotency proof;
- rollback and crash-window reconciliation drill;
- rate, budget, expiry, cross-tenant, credential-rotation, and incident tests;
- command-specific Product Owner G6 approval.

G6 approval authorizes only that command. It does not authorize another
command, generic writes, scheduled execution, or G7 bounded autonomy.
