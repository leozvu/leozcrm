# LeozOps Egoric CEO Brief — G3 Contract

Status: **G3 TECHNICAL QA PASS LOCALLY — publication and acceptance pending**

The G3 brief is a deterministic current-state view over one accepted Business
Memory snapshot. It is separate from the historical CRM `BriefService` and
never uses the legacy nine-stage funnel.

Binding source and ownership contract: `EGORIC_INTEGRATION.md`

## Read contract

```http
GET /v1/tenants/{tenantKey}/brief?asOf=2026-07-28
Authorization: Bearer <tenant-scoped output token>
```

- A date-only `asOf` means the end of that UTC day.
- A timestamp must include `Z` or an explicit offset.
- The service selects the latest accepted intelligence run at or before the
  cutoff. Without `asOf`, it selects the latest accepted run.
- The stored payload is parsed and passed through the complete
  `egoric_sales_v1` schema/hash validator again before any metric is produced.
- Snapshot row identity, record count, source identity, and run provenance must
  reconcile or the request fails closed.

`generated_at` is the selected intelligence run's immutable creation time, not
the wall clock of the HTTP request. This makes repeat requests over identical
Business Memory state byte-for-byte deterministic.

## Formula version `egoric_ceo_brief_v1`

All stage metrics are current-state counts:

- active pipeline = `new + contacted + proposal + negotiation`;
- closed = `won + lost`;
- win rate = `won / closed`, or `null` when closed is zero;
- active estimated value = sum of non-null estimated values in active stages;
- active owner coverage = assigned active leads / active leads, or `null` when
  the active pipeline is empty;
- overdue expected close = active leads whose non-null expected close timestamp
  is earlier than `as_of`.

The brief never calculates stage-to-stage conversion, reached counts, velocity,
or historical deltas because the source contract has no durable stage history.
Estimated value has no currency metadata, so the output sets
`estimated_value_currency: null` and states the limitation.

## Required provenance and limitations

Every successful output contains:

- source snapshot ID and accepted intelligence run ID;
- formula and source-engine versions;
- source system, source tenant, schema version, and native funnel definition;
- source-generated and source-received times, age, 30-minute target, and a
  `fresh`, `stale`, or `future_source_timestamp` status;
- exact quality counts;
- deterministic observations with numeric evidence;
- explicit current-state, attribution, campaign/spend, currency, missing-data,
  and freshness limitations; and
- `advisory_only: true`.

Raw lead IDs are never returned. Source labels are emitted only from a small
presentation allowlist; every other non-null value is counted as
`unclassified` so a free-text source cannot echo PII or a credential.
Non-finite aggregate results fail closed.

## Integration-only runtime profile

`INTEGRATION_MODE=egoric-readonly` creates a separate capability surface:

| Surface | Profile behavior |
|---|---|
| `GET /health` | Public liveness only |
| `GET /v1/tenants/:tenantKey/brief` | Separate output auth; tenant-scoped or read-admin |
| CRM, campaign, lead, metric, legacy brief, recommendation, dashboard | Not mounted; 404 |
| Task, onboarding, integration registry, email publishing | Not mounted; 404 |
| `/ready` legacy CRM readiness | Not mounted; 404 |
| Any write method on the brief path | No route; 404 |

The profile does not install a JSON body parser and does not construct the
legacy email publisher. Its auth uses separate environment names:
`LEOZOPS_OUTPUT_AUTH_SECRET` and `LEOZOPS_OUTPUT_ADMIN_KEY`. Missing output auth
fails closed; production mode refuses to start when both are absent. No output
credential is created or committed by G3.

## Explicit exclusions

- No production deployment, endpoint, credential, flag, or data pull.
- No scheduled polling, retry, circuit breaker, or reconciliation worker.
- No recommendation execution, task creation, email, publishing, or write-back.
- No natural-language model or invented metric.
- No CEO dashboard or broad query/chat surface.

G3 authorizes neither G4 acceptance nor production. Local end-to-end proof
remains a separate gate after G3 passes and is accepted.
