# Phase 14 — Supervised-hand readiness

Status: **repository qualification slice implemented; live J6 remains blocked**

Branch: `codex/leozops-phase14-supervised-hand-readiness`

Phase 14 prepares exactly one possible supervised hand without pretending that
LeozOps may use it. The candidate is an unassigned RepositoryRealms task. This
slice pins the source contract, validates a PII-minimized payload, projects the
existing G5/G6 evidence into the Command Deck, and keeps the production action
adapter registry empty.

## Pinned RepositoryRealms evidence

The qualification manifest is
`config/phase14.repositoryrealms-task-create.audit.json`. It was derived from
`leozvu/repositoryrealms@98c0eca01330cbf101bca8ff93de38cdd8ec4045` and pins
the Git blob SHA for each reviewed source file.

| Contract field | Audited value |
|---|---|
| Contract | `repositoryrealms.ceo.command` version `1` |
| LeozOps command key | `egoric.task.create.v1` |
| Action / scope | `task.create` / `command.task.create` |
| POST | `/api/ceo/v1/commands` |
| Receipt observation | `/api/ceo/v1/commands/receipts` |
| Payload profile | `unassigned_task_only` |

The source already provides an exact payload schema, provider idempotency,
atomic receipts, receipt observation, and least-privilege dispatch scope. It
does **not** provide the dedicated LeozOps command endpoint required by G6, a
guaranteed zero-mutation preview, or a separately approved rollback contract.
The manifest verdict is therefore `blocked`.

## Candidate payload boundary

LeozOps accepts only these internal fields:

```json
{
  "title": "Review stalled opportunities",
  "note": "Optional non-PII operating note",
  "due_date": "2026-08-05",
  "priority": "high",
  "estimated_hours": 2
}
```

Unknown fields are rejected. The mapped RepositoryRealms envelope always sets
`assigneeEmail` and `projectId` to `null`; no person, client, lead, email,
telephone-number field, credential, or arbitrary target URL is accepted.
High-confidence email and telephone patterns in title/note are also rejected;
this is a data-minimization control, not a claim of universal PII detection.
Envelope construction is pure and network-free.

## Runtime boundary

- `GET /v1/tenants/:tenantKey/supervised-hand` is authenticated, tenant-scoped,
  cache-disabled, sanitized, and read-only.
- The projection reports source qualification, G5/G6 state, proposal, preview,
  approval, execution receipt, rollback, incident, and immutable event counts.
- It never reads or returns stored `payload_json`.
- The Command Deck shows explicit blocker text and a read-only evidence ledger.
- There is no POST execution route, transport, source credential, scheduler, or
  registered production action adapter.
- An accepted Planner plan still grants no command capability.

## Preflight

Run:

```bash
npm run hand:preflight
```

The current expected result is exit code `2` with these blockers:

- `source_dedicated_leozops_command_endpoint_missing`
- `source_zero_mutation_preview_missing`
- `source_separately_approved_rollback_missing`
- `production_adapter_registry_empty`
- `live_g5_go_not_verified_by_static_preflight`
- `command_specific_g6_release_not_verified_by_static_preflight`

A local test, fixture, G6 record, or UI state cannot remove a live blocker.

## Verification

```bash
npm run typecheck
npm run test:phase14
npm test
npm run build
```

The focused suite pins the source audit and candidate envelope, proves the
empty production registry, checks tenant isolation and read-only HTTP behavior,
and verifies that evidence projection excludes payload material.

## Required work before a real hand

1. Add a dedicated least-privilege LeozOps command endpoint to RepositoryRealms
   on its own reviewed branch; do not reuse the global CEO gateway directly.
2. Add a genuine zero-mutation preview contract with deterministic evidence and
   expiry.
3. Add a separately approved, idempotent rollback contract with observation and
   reconciliation semantics.
4. Re-audit and pin the exact merged RepositoryRealms commit and source blobs.
5. Obtain a real G5 `go`, then accept one command-specific G6 policy/release.
6. Implement and review one exact adapter; register it only in the named target.
7. Execute one approved task, observe its receipt, rehearse rollback, close any
   incident, and obtain Product Owner acceptance of the live history.

Until every step is evidenced, J6 is open and LeozOps has no external write
authority.
