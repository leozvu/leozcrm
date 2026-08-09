# Phase 14 — Supervised-hand readiness

Status: **canonical source qualified; registration and live J6 remain blocked**

LeozOps branch: `codex/ruflo-phase14-contract-unlock`

RepositoryRealms release: `main@0c2b3ff236d747e87113f7d438d42b6b3caadb7c`
via [PR #9](https://github.com/leozvu/repositoryrealms/pull/9)

Phase 14 prepares exactly one possible supervised hand without registering or
exercising it. The candidate creates one unassigned RepositoryRealms task. The
source has the dedicated endpoint, zero-business-mutation preview, durable
receipt, and separately approved rollback semantics in an immutable canonical
`main` revision. Qualification of that source does not grant runtime authority.

## Pinned canonical evidence

The qualification manifest is
`config/phase14.repositoryrealms-task-create.audit.json`. It binds the source
canonical commit, seven Git blob hashes, and an aggregate SHA-256 contract
fingerprint. The aggregate is SHA-256 over the seven lexically sorted
`path:git_blob_sha` lines joined by `\n` with no trailing newline. A
qualification fingerprint is source evidence, not an action release.

| Contract field | Current value |
|---|---|
| Contract | `repositoryrealms.leozops.task-command` version `1` |
| LeozOps command key | `egoric.task.create.v1` |
| Action / execute scope | `task.create` / `leozops.task.create.execute` |
| POST | `/api/integrations/leozops/v1/commands/create-task` |
| Receipt observation | `/api/integrations/leozops/v1/commands/create-task/receipts` |
| Source state | `merged_main` |
| Canonical commit | `0c2b3ff236d747e87113f7d438d42b6b3caadb7c` |
| Qualification fingerprint | `sha256:562f0d73936cea5d46230f01cb58b32a5ac07f4d7b3d635f7c53fc4eaa1f6828` |
| Payload profile | `unassigned_task_only` |

The source contract is default-off and implements six explicit operations:

1. `preview`;
2. `approve_execute` with a separately scoped credential and subject;
3. `execute` with idempotent durable receipt evidence;
4. `preview_rollback` against the exact unchanged task and zero linked evidence;
5. `approve_rollback` as a new separate approval; and
6. `rollback`, idempotently deleting only that exact unchanged task.

No operation automatically rolls back. The approval ledger stores only
fingerprints and bounded metadata, not command payloads or credentials.

## Candidate payload boundary

LeozOps accepts only these internal fields:

```json
{
  "title": "Review stalled opportunities",
  "note": "Optional non-PII operating note",
  "due_date": "2026-08-10",
  "priority": "high",
  "estimated_hours": 2
}
```

It maps them to exactly `title`, `note`, `dueDate`, `priority`, and `estHours`.
Unknown fields, assignees, projects, URLs, arbitrary resources, and contact
data are rejected. Envelope construction remains pure and network-free in
LeozOps; its only permitted initial operation is `preview`.

## Runtime boundary

- `GET /v1/tenants/:tenantKey/supervised-hand` remains authenticated,
  tenant-scoped, cache-disabled, sanitized, and read-only.
- The projection reports source state/fingerprint, G5/G6 state, proposals,
  previews, approvals, receipts, rollbacks, incidents, and event counts.
- It never reads or returns stored `payload_json`.
- The production action adapter registry remains empty.
- The separately reviewed exact adapter exists but is not registered or
  invocable by the application composition.
- There is no checked-in runtime credential, scheduler, or HTTP execution route.
- An accepted Planner plan still grants no command capability.

## Current preflight

Run `npm run hand:preflight`. Exit code `2` is expected with:

- `production_adapter_registry_empty`;
- `live_g5_go_not_verified_by_static_preflight`; and
- `command_specific_g6_release_not_verified_by_static_preflight`.

## Required work before a real hand

1. Obtain real G5 `go` and one exact command-specific G6 release.
2. Bind a named-environment release manifest to the canonical qualification,
   exact adapter digest, seven runtime credential references, and target.
3. Register the adapter only in that authorized action worker after runtime
   verification; the default application registry stays empty.
4. Execute approved tasks, observe receipts, rehearse separately approved
   rollback, close incidents, and gather the live history required by J6.

Until every step is evidenced, LeozOps has no external write authority.

## Verification

```powershell
npm run test:phase14
npm run typecheck
npm test
npm run build
```

Ruflo SPARC and focused security scans supplement these gates. They do not
replace repository QA or create Product Owner/release authority.

RepositoryRealms PR #9 passed 851/851 tests, coverage, migration-chain CI,
production audit, build, Prisma validation, Playwright E2E, and two Vercel
preview deployments before canonical merge. The seven contract blobs and the
aggregate fingerprint match the reviewed source exactly.
