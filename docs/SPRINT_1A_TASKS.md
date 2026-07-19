# Sprint 1A — Implementation Tasks (Egoric read-only snapshot endpoint)

Status: ACTIVE — hold lifted by CEO 2026-07-19 after governance commit
9137139. T1–T5 dispatched to Claude Code on
C:\Users\Asus\Desktop\repositoryrealms @ feat/leozops-s1a. T6 reserved for
independent Codex G1 review.
Target repository (per DECISION-002 addendum 2 + Repository Identity
Registry): **leozvu/repositoryrealms**, branch **feat/leozops-s1a**
(cut from protected `main` @ 76082dc). `agency-erp` (leozvu/CRMegoric.git)
is NOT the target. Deployment isolation rules:
`docs/DEPLOYMENT_FLAG_ISOLATION.md` — flag + key enabled ONLY in the Egoric
Vercel project; never aim/vnecom/fretas/egolive.

CEO go for S1.A scope recorded 2026-07-18 (see DECISIONS.md, DECISION-002
addendum). Scope: Sprint 1A ONLY. Sprint 1B/1C tasks MUST NOT be created until
S1.A is completed, Codex-reviewed, merged, and accepted.

Repository: **leozvu/repositoryrealms @ feat/leozops-s1a per the GOVERNANCE.md
Repository Identity Registry** (NOT this repo — no LeozOps source changes in S1.A)
Environment: Egoric TEST instance only. No production flag, no production key.
Contract: `docs/EGORIC_INTEGRATION.md` §6 (API contract), §7 (auth), §14 (task
order, Egoric side), §15 (QA gates)
Exit gate: **G1** — Codex auth/contract QA PASS, recorded in CODEX_REVIEW.md
Feature flag: the snapshot route ships OFF by default; enabling it on the test
instance is part of T3.
Rollback method (applies to every task): feature flag off + revoke/delete the
`LEOZOPS_READ` key. No data migration involved; no Prisma entity changes, so
rollback never requires data restoration.
Implementation owner: Claude Code. QA owner: Codex. Separate commits/PRs from
any LeozOps-repo work.

Boundaries (hard, from contract §2 — stop and escalate if a task conflicts):
- GET only; no PII fields ever serialized; no employee-role or Director key
  reuse; no generic `/api/v1/*` or `/api/data/*` grant to the integration key;
  no Prisma entity changes; no webhook/queue/cursor work.

---

## T1 — Contract/projector module `egoric_sales_v1`

Objective: Pure module producing the de-identified snapshot payload.
Deliverables:
- Field allowlist projector: `external_id, stage, source, estimated_value,
  created_at, expected_close_at, owner_assigned` — nothing else, enforced by
  construction (project TO the allowlist, never filter FROM the entity).
- Canonical serialization (stable key order, stable lead ordering) and
  SHA-256 content hash over canonical facts + contract version, EXCLUDING
  `generated_at` → `snapshot_id` (`sha256:<hex>`) and ETag value.
- `funnel_definition` block: `egoric_sales_v1`, active stages
  `new/contacted/proposal/negotiation`, terminal `won/lost`,
  `historical_transitions_available: false`.
- `quality` block: records, missing_source, missing_created_at,
  `client_attribution: "unavailable"`.
- `schema_version: "1.0"`; unknown/other versions fail closed.
Tests (in this task): deterministic hash (same facts → same id; reordered
input → same id; changed fact → new id); allowlist projection unit tests.
No HTTP surface in this task.

## T2 — `LEOZOPS_READ` service capability

Objective: Capability that authorizes ONLY the snapshot route.
Deliverables:
- Capability named exactly `LEOZOPS_READ`; not an employee role; absent from
  every generic resource read/write/delete role list.
- Key storage: Egoric stores SHA-256 hash of the key (existing pattern);
  raw key never logged, never in fixtures/Git.
- Key create/revoke path usable by an operator (revocation is the rollback
  primitive).
Tests: capability grants nothing on generic routes (401/403 matrix seed for
T5); key hash verification round-trip.

## T3 — Feature-flagged GET-only snapshot route

Objective: `GET /api/integrations/leozops/v1/lead-snapshot`.
Deliverables:
- Behind a feature flag, default OFF; flag off → route absent/404.
- Recognizes only `LEOZOPS_READ` (Bearer); missing/bad key → 401.
- All non-GET methods → 405.
- Response per contract §6 example: source block, snapshot_id, generated_at,
  funnel_definition, leads[], quality. Uses T1 projector exclusively — the
  route never touches raw entities directly.
- Reads go through the existing Egoric internal service layer (no new Prisma
  entities, no raw SQL).
Tests: flag off/on behavior; 401/405; response shape matches contract.

## T4 — Caching, correlation, rate limit, audit logs

Objective: Operational envelope on the T3 route.
Deliverables:
- ETag = snapshot_id basis; `If-None-Match` match → 304 with no body and no
  projection work beyond hash computation.
- `Cache-Control: private, no-cache`.
- `X-Correlation-ID` accepted and echoed; generated when absent.
- Rate limit: 60 requests/hour per key → 429 with `Retry-After`.
- Structured non-PII audit log per request: correlation ID, key ID (never raw
  key), endpoint, status, latency, record count, snapshot_id. Log lines must
  contain zero lead PII by construction.
Tests: 304 behavior; 429 + Retry-After; log redaction assertions.

## T5 — QA test suite (G1 evidence)

Objective: The complete gate-G1 test set, runnable by Codex.
Deliverables (all against the test instance / test harness):
- Auth matrix: no key → 401; malformed key → 401; revoked key → 401;
  `LEOZOPS_READ` on snapshot GET → 200; `LEOZOPS_READ` on every generic
  GET/POST/PUT/PATCH/DELETE API (`/api/v1/*`, `/api/data/*`) → 403.
- Recursive PII denial: walk the full response tree; assert prohibited fields
  (name, company, email, phone, note, owner id, employee data, credentials,
  invoice details) absent at every depth.
- Deterministic ETag: identical facts → identical snapshot_id/ETag across
  requests; If-None-Match → 304.
- Method denial: POST/PUT/PATCH/DELETE/HEAD-variants → 405.
- Existing Egoric test suite remains green (regression proof).

## T6 — Evidence bundle + Codex handoff (gate G1)

Objective: Close S1.A.
Deliverables:
- Evidence bundle: test run output, auth-matrix table, PII-denial result,
  deterministic-hash/304 transcript, flag-off + key-revocation drill result,
  statement that no employee workflow changed.
- Codex reviews against contract §15 gates 1–5 (the S1.A-applicable subset)
  and records PASS/FAIL in CODEX_REVIEW.md.
- PR merged only after Codex PASS.
- Hermes reports S1.A completion to Leoz; ONLY THEN may S1.B/S1.C tasks be
  created (separate CEO-visible step per DECISION-002 workflow).

---

Task order: T1 → T2 → T3 → T4 → T5 → T6 (T1/T2 may proceed in parallel).
Definition of done for S1.A: G1 recorded PASS in CODEX_REVIEW.md; merged;
Leoz acceptance of the S1.A report.
