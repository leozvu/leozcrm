# Phase 15 — Exact RepositoryRealms task adapter

Status: **repository implementation complete; production registration and live J6 remain blocked**

Phase 15 supplies the one exact “hand” selected in Phase 14. It does not add a
generic RepositoryRealms client and the default production adapter registry is
still empty.

## Frozen boundary

- Contract: `repositoryrealms.leozops.task-command`
- Command: `egoric.task.create.v1`
- Endpoint: `/api/integrations/leozops/v1/commands/create-task`
- Receipt endpoint: `/api/integrations/leozops/v1/commands/create-task/receipts`
- Target: one exact project, tenant, and `task` entity
- Payload: the five reviewed task fields only; unassigned and PII-minimized
- Operations: preview, approve execute, execute, observe receipt, preview
  rollback, approve rollback, rollback

Every operation has a distinct credential reference and the approval subjects
are separate from the executor subjects. The adapter performs one bounded HTTP
attempt, rejects redirects, caps request/response size and timeout, verifies
canonical preview/receipt hashes, and never retries an unknown execution
outcome. A provider rejection with a definitive non-conflict 4xx result is a
known zero-mutation failure. Network errors, 409, and 5xx outcomes enter the
existing reconciliation-required path.

Recovery maps to the same source-owned exact-state rollback contract. It still
requires the G7 kill switch, recovery preview, and human recovery approval; no
automatic rollback was added.

## Activation boundary

`leozops_repositoryrealms_task_action_release_v1` binds the adapter artifact,
configuration digest, exact target, seven distinct runtime secret references,
source qualification, canonical source commit, G5, and G6 policy. It accepts
only a qualified source already merged to canonical RepositoryRealms `main`.
The current source qualification binds
`repositoryrealms/main@0c2b3ff236d747e87113f7d438d42b6b3caadb7c`
from [RepositoryRealms PR #9](https://github.com/leozvu/repositoryrealms/pull/9).

The explicit release builder can construct a one-adapter registry only after
the release, qualification, G6 policy, and runtime secret bindings all match.
Normal application composition continues to call the empty default registry.
`npm run adapter:preflight` always reports the remaining live/runtime checks
and exits blocked; it cannot infer a source feature flag, credentials, live G5
state, or operator registration from static files.

## Repository proof

`npm run test:phase15` covers the complete preview-to-receipt-to-rollback path,
bounded recovery, target/payload/credential separation, definitive versus
unknown failures, tampered previews, explicit release construction, and all
known drift cases. Local proof does not authorize an external request.
