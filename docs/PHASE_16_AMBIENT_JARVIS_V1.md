# Phase 16 — Ambient Jarvis and v1 repository candidate

Status: **repository implementation complete; live J8 remains blocked**

Phase 16 makes the evidence-bound operating partner natural to reach without
widening its authority. It adds no production credential, deployment,
scheduler, delivery channel, action registration, or live acceptance.

## Ambient experience

- The medieval cockpit remains a five-destination interface and is installable
  as a PWA.
- Its service worker caches only the public, data-free shell, stylesheet,
  script, manifest, and icon. It never intercepts or caches `/v1` traffic.
- Push-to-talk uses the browser speech-recognition API only after a user click.
  A transcript is copied into the composer for review; it is never submitted
  automatically and audio is not stored by LeozOps.
- Voice output is optional and on-demand. Only a fully validated answer summary
  may be read aloud, and speech is cancelled on disconnect/page hide.
- Action-shaped English or Vietnamese questions open a separate confirmation.
  Confirmation sends an advisory question only; it cannot approve or execute.
- The read credential remains page-memory-only. No local or session storage is
  used.

## Durable preferences

`jarvis_preference_revisions` stores append-only tenant-scoped versions of:

- English or Vietnamese locale;
- manual, daily, or weekdays briefing cadence;
- IANA timezone and distinct quiet-hour boundaries;
- off or on-demand voice output.

Updates require an idempotency key, strict fields, a valid timezone, and the
existing exact tenant credential. Defaults are explicit when no revision
exists. Preferences are LeozOps-owned configuration and grant no source or
action authority.

## Evaluation and readiness

`GET /v1/tenants/:tenantKey/jarvis/evaluation?days=30` calculates a bounded
1–90 day view directly from accepted repository evidence:

- answer completion, failure, feedback usefulness, citation coverage, p95
  latency, and cost;
- alert review, false-positive rate, and alerts per day;
- plan decisions, acceptance, and outcome usefulness;
- supervised outcomes, external mutation count, p95 latency, reconciliation,
  and incident blockers.

Every response has a canonical SHA-256. Empty samples are `null`/insufficient,
not zero-quality claims. `jarvis/readiness` shows J1–J8 as repository candidates
while keeping every live checkpoint `blocked_external`. Metrics cannot prove a
privacy review, named deployment, incident closure, or SLO acceptance.

## Data governance

Export and delete requests are exact-confirmation, idempotent, append-only
records in `jarvis_data_governance_requests`.

- Export requires `EXPORT <tenant-key>`. The downloadable JSON contains
  tenant identity, preferences, evaluation, retention policy, and record
  inventory with an integrity hash.
- Raw source payloads, credentials/secret references, provider bodies,
  command payloads, and cross-tenant data are excluded.
- Delete requires `DELETE <tenant-key>`. It records founder intent but remains
  `blocked_pending_retention_policy`; no data is deleted. Immutable evidence is
  not silently weakened.

The current candidate policy is 90 days for source snapshots and 365 days for
audit evidence, with automatic deletion disabled until the Product Owner,
privacy reviewer, and operator accept an enforcement design.

## HTTP surface

All routes use the existing tenant-authenticated `/v1/tenants` boundary:

- `GET|POST /:tenantKey/jarvis/preferences`
- `GET /:tenantKey/jarvis/evaluation`
- `GET /:tenantKey/jarvis/readiness`
- `GET /:tenantKey/jarvis/data-policy`
- `GET|POST /:tenantKey/jarvis/data-requests`
- `GET /:tenantKey/jarvis/exports/:requestId`

There is no Jarvis execute, scheduler, deletion, generic tool, SQL, filesystem,
browser, or credential route.

## Repository proof

`npm run test:phase16` covers preferences, validation, tenant auth,
idempotency, immutability, PWA/CSP/DOM safety, service-worker exclusions,
evaluation math, honest J1–J8 blockers, confirmed export, blocked deletion, and
migration rollback/reapply. The final local run passed 13/13; the complete
registered suite passed 364/364 and production TypeScript compilation passed.
Focused Ruflo deep scans found zero issues in HTTP, domain, action integration,
and repository code. The repo-wide heuristic triage and remaining non-high
dependency maintenance items are recorded in
[`SECURITY_REVIEW_PHASE15_16.md`](SECURITY_REVIEW_PHASE15_16.md).
