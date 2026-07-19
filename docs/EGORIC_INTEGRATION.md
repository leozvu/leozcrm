# LeozOps ↔ Egoric Integration Architecture

Status: **Approved direction; implementation not started**  
Decision date: 2026-07-18  
Governing ADR: **DECISION-002** (`DECISIONS.md`) — Egoric becomes the
operational system of record; sequencing is evidence-gated Sprint 1 / Sprint 2
(no calendar dates); no deployment until Sprint 1 passes local end-to-end
verification.  
Product owner: Leoz  
PM: Hermes  
Implementation owner: Claude Code  
QA owner: Codex

This document is the canonical implementation contract for connecting LeozOps
to the production Egoric CRM/ERP. It supersedes any older instruction to launch
LeozOps as a second operational CRM, onboard Egoric employees into LeozOps, or
turn recommendations into autonomous external actions.

Documentation approval does not authorize a production deployment or production
data mutation. Each milestone below still needs its normal kickoff and QA gate.

## 1. Decision

Egoric remains the sole operational system of record. LeozOps becomes a
separately deployed, read-only intelligence service.

LeozOps will consume a deliberately narrow Egoric REST export, store an
independent intelligence read model, and produce versioned metrics, CEO Briefs,
and advisory recommendations. It will not operate a parallel CRM/ERP.

```text
Egoric production
      |
      | dedicated GET-only, PII-minimized snapshot
      v
LeozOps ingestion worker
      |
      v
Independent intelligence read model
      |
      +-- versioned KPIs
      +-- CEO Brief
      +-- advisory recommendations
                 |
                 v
          read-only API/UI
```

## 2. Non-negotiable boundaries

- Start read-only.
- No direct production database access or shared database credentials.
- No production database writes from LeozOps.
- No POST, PUT, PATCH, or DELETE request from LeozOps to Egoric.
- No generic Egoric Director or employee-role API key.
- No double data entry.
- No autonomous task creation, email, social publishing, invoice action, or
  other external action.
- No webhook-first pilot and no assumption that the existing webhook system is
  durable.
- No big-bang rewrite and no disruption to employee workflows.
- Recommendations remain `advisory_only: true`.
- LeozOps CRM, onboarding, task, and email-publishing routes are not mounted in
  the Egoric integration deployment profile.

If a requested implementation conflicts with a boundary above, Hermes must
escalate the product decision and Claude Code must stop before changing code.

## 3. Ownership and entity mapping

| Domain | Operational owner | LeozOps treatment |
|---|---|---|
| Company/tenant | Egoric deployment/schema | One `tenant` plus one `source_connection`; never an Egoric Client |
| Clients | Egoric | Read approved aggregates later; no duplicate client master |
| Leads | Egoric | Read de-identified facts and calculate intelligence |
| Campaigns | External ad platform for delivery facts; Egoric for a future canonical internal reference | No LeozOps campaign master; unavailable in the pilot |
| Tasks | Egoric | Recommendations are not tasks and are never auto-converted |
| Users | Egoric | No employee-directory copy; LeozOps stores service principals only |
| Invoices | Egoric | Approved aggregates may be read in a later milestone; no invoice operations |
| Metrics | Egoric owns source facts; LeozOps owns versioned formulas and derived snapshots | Include formula version and provenance |
| Briefs | LeozOps | Versioned, reproducible, read-only artifacts |
| Recommendations | LeozOps | Advisory-only artifacts |

Important semantic correction: the current LeozOps `Client` combines a tenant
boundary with a customer record. Egoric `Client` is an agency customer. The
integration must introduce `tenant` and `source_connection`; it must not map
every Egoric Client to a LeozOps tenant.

Egoric leads currently have no Client foreign key. The first pilot is therefore
company-wide. Per-client funnel attribution must be labelled unavailable.

## 4. Funnel semantics

Preserve the Egoric-native funnel:

- Active stages: `new`, `contacted`, `proposal`, `negotiation`
- Terminal outcomes: `won`, `lost`

Do not coerce those values into the current LeozOps nine-stage funnel. Egoric
does not currently retain lead-stage history, so current-state counts are not
historical transition or conversion rates. Every affected output must carry
that limitation.

## 5. Selected integration boundaries

| Boundary | Decision | Reason |
|---|---|---|
| Dedicated REST API | Use | Auditable, narrow, revocable, versionable |
| Egoric internal service layer | Use behind the dedicated route | Keeps Prisma access and filtering inside Egoric |
| Existing generic `/api/v1/*` | Reject | Role-bearing keys do not provide capability-level read-only access |
| Webhooks/events | Defer | Existing delivery is not durable or replayable |
| Queue | Not available for pilot | Add only with a later outbox milestone |
| Direct/shared database | Reject | Bypasses authorization/audit and expands production blast radius |

LeozOps must use its own database and credentials. Sharing the Supabase project,
schema access, Prisma client, `DATABASE_URL`, or `DIRECT_URL` is prohibited.

## 6. Pilot API contract

Egoric adds exactly one integration endpoint:

```http
GET /api/integrations/leozops/v1/lead-snapshot
Authorization: Bearer <LEOZOPS_READ key>
Accept: application/json
If-None-Match: "<previous-etag>"
X-Correlation-ID: <uuid>
```

Example response:

```json
{
  "schema_version": "1.0",
  "source": {
    "system": "egoric",
    "tenant_key": "egoric"
  },
  "snapshot_id": "sha256:...",
  "generated_at": "2026-07-20T12:00:00Z",
  "funnel_definition": {
    "id": "egoric_sales_v1",
    "active_stages": ["new", "contacted", "proposal", "negotiation"],
    "terminal_outcomes": ["won", "lost"],
    "historical_transitions_available": false
  },
  "leads": [
    {
      "external_id": "cuid",
      "stage": "proposal",
      "source": "Facebook",
      "estimated_value": 2500,
      "created_at": "2026-07-01T08:00:00Z",
      "expected_close_at": null,
      "owner_assigned": true
    }
  ],
  "quality": {
    "records": 1,
    "missing_source": 0,
    "missing_created_at": 0,
    "client_attribution": "unavailable"
  }
}
```

Contract rules:

- Never return lead name, company name, email, phone, note, owner ID, employee
  data, credentials, or invoice details.
- `snapshot_id` and `ETag` are the SHA-256 of canonical facts and contract
  version, excluding `generated_at`.
- Return `304` when `If-None-Match` matches.
- Return `Cache-Control: private, no-cache`.
- Only GET is implemented; other methods return `405`.
- Unknown contract versions fail closed rather than silently changing meaning.

LeozOps exposes only read results:

```http
GET /v1/tenants/{tenantKey}/metrics?asOf=...
GET /v1/tenants/{tenantKey}/brief?asOf=...
GET /v1/tenants/{tenantKey}/recommendations?asOf=...
```

Every output includes `source_snapshot_id`, `formula_version`, `generated_at`,
`data_freshness`, `funnel_definition`, known limitations, and
`advisory_only: true` where applicable.

## 7. Authentication

Create a service capability named exactly `LEOZOPS_READ`.

- Only the dedicated snapshot route recognizes it.
- It is not an employee role and is absent from every generic resource's
  read/write/delete role list.
- It receives `403` on `/api/v1/*` and `/api/data/*`.
- Egoric stores the existing SHA-256 key hash; LeozOps stores the raw key in its
  deployment secret manager.
- Rotate every 90 days with at most a 24-hour overlap.
- Limit to 60 requests/hour per key.
- Never expose the key to browser JavaScript, URLs, logs, fixtures, or Git.

If Egoric later reads LeozOps outputs, that direction uses a separate credential.

## 8. Sync, idempotency, and retry

Initial import is one complete de-identified snapshot, followed by count
reconciliation against Egoric before intelligence is accepted.

Until Egoric has reliable `updatedAt`, deletion tombstones, and a stable cursor:

- Poll the complete snapshot every 15 minutes.
- Send `If-None-Match` and do no work on `304`.
- Run a nightly full reconciliation.
- Store snapshots uniquely by `(source_system, tenant_key, snapshot_id)`.
- Store intelligence runs uniquely by
  `(tenant_key, snapshot_id, engine_version, as_of)`.

Retry network failures, `408`, `429`, and `5xx` at 1, 2, 4, 8, and 16 seconds
with full jitter. Honor `Retry-After`; stop after five attempts. Do not retry
other `4xx` responses. Disable the connector and alert immediately on `401` or
`403`. Open a circuit after five consecutive failed polling cycles.

Webhooks may be added later only after Egoric has a transactional outbox,
immutable event and delivery IDs, retry records, replay, dead-letter handling,
and HMAC timestamp/replay protection. Even then, polling reconciliation remains
the correctness mechanism.

## 9. Audit and observability

Both sides must emit structured, non-PII logs containing correlation ID, key ID
(never the raw key), tenant key, endpoint/status, latency, retry count, snapshot
ID, record count, content hash, data age, and formula/engine version.

Required metrics and alerts:

- poll success rate, p95 latency, `304` rate, and consecutive failures;
- snapshot age and nightly reconciliation differences;
- unknown stage/source values and unexplained record-count drift;
- authentication failures and schema-version mismatches;
- brief/recommendation generation failures and run duration;
- alert immediately on any `401/403`, unsupported schema, or source/derived
  reconciliation failure;
- alert when no successful snapshot exists for two polling intervals or an
  unexplained count changes by more than 20%.

Audit key creation, rotation, revocation, feature-flag changes, manual pulls,
contract/formula changes, and intelligence generation. Provide runbooks for key
rotation, stale data, schema mismatch, rollback, and snapshot replay.

## 10. Existing LeozOps CRM data

The audited local LeozOps database contains demo/integrity records only: two
clients, one campaign, five leads, and zero tasks. Do not import them into
Egoric.

If another LeozOps environment is later discovered, migration is a separate
approved project:

1. Inventory all environments and freeze LeozOps CRM mutations.
2. Export a checksummed archive and classify records as demo, duplicate, or
   legitimate.
3. Reconcile deterministic identifiers and require human review for ambiguous
   matches.
4. Import only approved missing records through an official Egoric API/import
   workflow in small reversible batches, never through direct database writes.
5. Maintain a mapping ledger with old ID, Egoric ID, disposition, reviewer, and
   timestamp.
6. Never convert historical LeozOps tasks or recommendations into operational
   Egoric tasks automatically.

This discovery/migration must not delay the read-only pilot.

## 11. Smallest pilot

The pilot is one company-wide Egoric sales-funnel brief:

- leads only;
- Egoric-native stages;
- no PII;
- no client or campaign attribution;
- no tasks, users, projects, or invoices;
- 15-minute polling;
- one daily CEO Brief plus an on-demand refresh;
- shadow review by a Director for ten business days;
- no output inserted into Egoric during the pilot.

Pilot acceptance:

- Exact stage/source/total reconciliation for ten consecutive business days.
- Zero Egoric mutations attributable to LeozOps.
- No employee workflow regression.
- Business-hours data age remains under 30 minutes.
- Every metric is reproducible from its snapshot and formula version.
- Reviewers find at least one recurring output useful without material false
  claims.

## 12. Risk register

| Rank | Severity | Risk | Required mitigation |
|---:|---|---|---|
| 1 | Critical | Director/employee-role key exposes write capability | Dedicated `LEOZOPS_READ` route and denial tests |
| 2 | Critical | Shared database access bypasses controls and broadens blast radius | Independent LeozOps DB and credentials |
| 3 | High | LeozOps Client/tenant semantics corrupt attribution | Separate `tenant` and `source_connection` |
| 4 | High | Nine-stage funnel fabricates Egoric transitions | Native funnel adapter and explicit limitations |
| 5 | High | Current webhooks miss or duplicate state | Exclude from pilot; require durable outbox later |
| 6 | High | Generic API authorization is not integration-grade read-only | Use only the dedicated endpoint |
| 7 | High | Missing update timestamps/tombstones miss changes | Full snapshots and nightly reconciliation |
| 8 | High | Production deployment changes affect employee workflows | Feature flag, test instance, canary, immediate key revocation |
| 9 | Medium | Egoric and LeozOps publish conflicting intelligence | Formula catalog and LeozOps ownership of CEO intelligence |
| 10 | Medium | PII over-fetching or logging | Field allowlist, recursive denial tests, non-PII logs |
| 11 | Medium | LeozOps has no proven live M10 deployment | Independent readiness/canary milestone |

## 13. Implementation milestones

> Sequencing per **DECISION-002** (`DECISIONS.md`, 2026-07-18): evidence-gated
> sprints, no calendar dates. A milestone exits on its evidence gate only.
> Sprint 2 must not start until Sprint 1 acceptance (gate G4) is recorded in
> `DECISIONS.md`. Detailed gate definitions live in the execution plan at
> `.hermes/plans/2026-07-18_egoric-integration-execution-plan.md`.

### Sprint 1 — Egoric Snapshot → LeozOps Ingestion → CEO Brief → Local End-to-End Proof

| Stage | Deliverable | Evidence gate |
|---|---|---|
| S1.0 — Decision freeze | Ownership ADR (DECISION-002) and forbidden-boundary tests planned | Leoz approved scope; Hermes recorded it — **complete** |
| S1.A — Egoric export | Feature-flagged GET endpoint, `LEOZOPS_READ`, schema, ETag, PII denial tests | **G1** — test instance only; Codex auth/contract PASS |
| S1.B — LeozOps ingestion | Source adapter, tenant/source_connection, immutable idempotent snapshots, schema fail-closed, no-write-egress proof | **G2** — unit/integration tests and typecheck PASS |
| S1.C — CEO Brief | Native-funnel brief with provenance/limitations, single read-only brief route, integration-only profile | **G3** — deterministic brief + profile route-denial tests PASS |
| S1.D — Local end-to-end | Test-instance pull, exact count reconciliation, flag/key-revocation drill | **G4** — Codex PASS in `CODEX_REVIEW.md`; Leoz acceptance recorded in `DECISIONS.md` (**Sprint 1 acceptance**) |

### Sprint 2 — Deployment → Test Instance → Production Shadow → Read-only Pilot

Scope re-planned and re-approved at G4. Indicative stages:

| Stage | Deliverable | Evidence gate |
|---|---|---|
| S2.A — Hardening | Scheduled 15-minute ETag polling, retry/backoff, circuit breaker, nightly reconciliation, metrics + recommendations routes, alerting, runbooks | Full suite/typecheck green; Codex PASS |
| S2.B — Deployment | Hosting decision; LeozOps deployed with independent Postgres + secrets; readiness/canary | All 12 QA release gates (§15) that are testable pre-production PASS |
| S2.C — Production shadow | Ten business days of read-only production pulls | Every pilot criterion in §11 passes |
| S2.D — Release decision | Approve, extend, or revoke; optional read-only Egoric presentation | Product-owner decision recorded in `DECISIONS.md` |

### Future (separate project, separate approval)

| Stage | Deliverable | Exit gate |
|---|---|---|
| Change feed/outbox | Timestamps, tombstones, cursor, outbox, replay, dead letter | Separate future approval |

Controlled or autonomous write-back is not part of these milestones.

## 14. Claude Code task order

Implementation is split across the Egoric repository and this repository. Keep
the changes in separate commits and pull requests.

### Egoric repository

1. Add a pure contract/projector module for `egoric_sales_v1`, the field
   allowlist, canonical serialization, and content hashing.
2. Add `LEOZOPS_READ` as a service capability without adding it to employee
   roles or generic resource permissions.
3. Add the feature-flagged GET-only lead snapshot route.
4. Implement ETag/304, correlation IDs, rate limiting, and non-PII audit logs.
5. Add contract, authorization, PII-denial, deterministic-hash, and method-denial
   tests.
6. Do not change Prisma entities for the pilot.

### LeozOps repository

7. Introduce `tenant` and `source_connection` separately from CRM `Client`.
8. Add immutable `source_snapshots` and idempotent `intelligence_runs`.
9. Add a source-neutral intelligence input interface and an Egoric adapter.
10. Implement `egoric_sales_v1`; do not reuse the nine-stage funnel.
11. Add ETag polling, retries, circuit breaking, schema checks, and nightly
    reconciliation.
12. Add provenance, freshness, formula versions, and limitations to outputs.
13. Add `INTEGRATION_MODE=egoric-readonly` and do not mount CRM mutations,
    onboarding, tasks, or email publishing in that profile.
14. Add contract, idempotency, retry, stale-data, native-funnel, tenant, and
    no-write-egress tests.
15. Add structured connector health and audit metrics plus rollback/runbook
    documentation.

## 15. Codex QA release gates

Codex must reject release unless all of these pass:

1. Existing LeozOps tests and typecheck remain green; existing Egoric tests
   remain green; all new tests are green.
2. Missing/bad keys return `401`; `LEOZOPS_READ` works only on the dedicated GET
   route.
3. The integration key receives `403` on generic GET, POST, PUT, PATCH, and
   DELETE APIs and cannot cross Egoric instances.
4. Response-schema tests prove prohibited PII fields are absent recursively.
5. Identical facts produce the same snapshot ID and ETag; matching ETag returns
   `304` without an intelligence run.
6. Counts reconcile exactly; `lost` is an outcome, not a passed active stage;
   outputs do not claim historical conversion.
7. Replaying the same snapshot creates exactly one stored snapshot and one run.
8. Network instrumentation proves LeozOps never sends a write method to Egoric.
9. Retry, exhaustion, circuit-breaker, `401/403` stop, stale-data, and recovery
   tests pass.
10. Integration mode returns `404/405` for LeozOps CRM/task/onboarding/email
    mutation routes and recommendations remain advisory-only.
11. Feature-flag shutdown and key revocation stop access within one polling
    interval.
12. The production canary shows no employee workflow, error-rate, or latency
    regression, and rollback needs no data restoration.

## 16. Explicitly out of scope

- Migrating local demo data into Egoric.
- Adding a Campaign model to Egoric during the pilot.
- Client-level lead attribution without a real Egoric relationship.
- Direct access to Egoric/Supabase schemas.
- Reusing Egoric's current generic Director API key.
- Treating current webhooks as a source of truth.
- Sending emails, publishing social content, creating tasks, or performing
  finance operations from recommendations.
- Replacing Egoric screens or employee workflows.
