# Phase 11 — Proactive Nervous System

Status: **repository-local implementation; live J3 acceptance remains open**

Branch: `codex/leozops-phase11-proactive-nervous-system`

## Purpose

Phase 11 lets LeozOps tell the founder when a small, evidence-backed business
condition changes. It does not create a free-running agent, mutate Egoric, or
grant operational authority. An external scheduler invokes one authenticated,
idempotent command; the process evaluates accepted Business Memory, appends
evidence, prints a result, and exits.

The evidence chain is:

`accepted snapshot -> deterministic rule evaluation -> alert -> founder state/outcome -> delivery intent -> attempt -> terminal result`

## Frozen policy v1

`proactive_alert_policy_v1` contains all behavior-affecting thresholds:

| Control | Value |
|---|---:|
| Accepted source freshness | 30 minutes |
| Re-alert cooldown | 4 hours |
| Maximum snooze | 7 days |
| Quiet hours | 22:00–07:00 UTC |
| Overdue expected-close trigger / urgent | 1 / 3 leads |
| Active leads without owner trigger / urgent | 1 / 3 leads |
| Shadow minimum | 20 founder-reviewed alerts |
| Maximum false-positive rate | 10% |
| Maximum alert volume | 3/day |

Rules use deterministic CEO Brief facts. Missing fields are `partial`; old or
future-dated snapshots are not `fresh`. Neither condition can create a
confirmed alert. A duplicate cycle key replays the original cycle, and a new
cycle over the same unchanged episode emits no new logical alert.
Cycle, evaluation, alert, and outbox writes commit atomically; an injected
mid-cycle failure leaves no partial evidence and the same command can retry.

## Persistence and state

Seven tenant-scoped tables are append-only on SQLite and PostgreSQL:

- `proactive_cycles` and `proactive_rule_evaluations` record every decision,
  including stale/partial/cooldown/snooze suppression;
- `proactive_alerts` records confirmed alert episodes;
- `proactive_alert_events` derives acknowledgement, snooze, resolution, and
  immutable `useful` / `false_positive` outcomes;
- `proactive_delivery_outbox`, `proactive_delivery_attempts`, and
  `proactive_delivery_results` separate logical notification intent from
  provider attempts and terminal evidence.

Alert state is derived as `open`, `acknowledged`, `snoozed`, or `resolved`.
Acknowledgements, snoozes, and outcomes require an `Idempotency-Key`. A
recorded outcome cannot be changed. Delivery state is `queued`, `failed`,
`unknown`, or `delivered`; any delivered receipt dominates earlier failures.
An unknown outcome blocks automatic replay because the provider may have
accepted the message before losing the response.

## HTTP surface

The `egoric-readonly` profile adds only LeozOps-owned alert evidence routes:

| Method | Route | Effect |
|---|---|---|
| GET | `/v1/tenants/:tenantKey/alerts?state=` | List evidence-backed alert views |
| POST | `/v1/tenants/:tenantKey/alerts/:alertId/acknowledgements` | Append acknowledgement |
| POST | `/v1/tenants/:tenantKey/alerts/:alertId/snoozes` | Append bounded snooze |
| POST | `/v1/tenants/:tenantKey/alerts/:alertId/outcomes` | Append one quality outcome |
| GET | `/v1/tenants/:tenantKey/notification-deliveries` | Inspect delivery evidence |
| GET | `/v1/tenants/:tenantKey/alert-shadow-baseline?from=&to=` | Evaluate J3 shadow thresholds |

All routes enforce exact tenant scope. There is deliberately no HTTP route to
run an evaluation or deliver a notification. The medieval cockpit shows
severity and state in text, trigger facts, source/delivery hashes, 44 px
acknowledge/snooze controls, and outcome controls after acknowledgement.

## One-shot operator

Configure a separate operator secret and exact SHA-256 fingerprint through the
runtime secret manager:

```text
LEOZOPS_PROACTIVE_OPERATOR_TOKEN
LEOZOPS_PROACTIVE_OPERATOR_TOKEN_SHA256
```

After migrations, invoke exactly one command:

```bash
npm run proactive:operator -- evaluate config/proactive.evaluate.example.json
npm run proactive:operator -- daily-brief config/proactive.daily-brief.example.json
npm run proactive:operator -- status config/proactive.status.example.json
npm run proactive:operator -- shadow-status config/proactive.shadow-status.example.json
npm run proactive:operator -- deliver config/proactive.deliver.example.json
```

`as_of` must be `null` for the scheduler's current time or an exact ISO time
for an explicitly controlled replay. The scheduler owns cadence and timeout;
LeozOps contains no interval, queue consumer, daemon, or automatic retry loop.
A suggested external schedule is evaluate every 15 minutes, daily brief once
after 07:00 UTC, and delivery only for due outbox IDs obtained from `status`.

## Delivery adapter boundary

`NotificationDeliveryRegistry` accepts one versioned adapter per
`daily_brief` or `urgent_alert`. The adapter receives a stable logical key and
PII-minimized payload, then returns a provider receipt or definitive failure.
The checked-in production registry is intentionally empty. Installing Slack,
email, push, or another channel requires a separate review of credentials,
privacy, rate limits, receipts, provider idempotency, monitoring, and incident
recovery. Without that adapter `deliver` fails closed with
`delivery_adapter_unavailable`.

## Failure and replay rules

- Stale, future, or partial evidence: inspect source health; never force alert.
- `failed`: the operator may use a new attempt key after diagnosing the
  definitive provider rejection.
- `unknown`: do not retry automatically; reconcile with the provider first.
- `delivered`: later calls return the stored successful result without a new
  provider call.
- In-flight attempt: the locked outbox claim rejects a second provider call.
- Quiet-hours hold: wait until `available_at`; do not bypass it.
- Outcome conflict: preserve the first immutable founder review.

## J3 evidence boundary

Repository QA proves deterministic rules, snapshot/cycle deduplication,
freshness and completeness suppression, cooldown, quiet hours, state replay,
daily/urgent adapter contracts, delivery receipts and unknown-outcome safety,
tenant isolation, migration lifecycle, and append-only evidence.

The local SQLite lifecycle passed. The same migration and immutable guards are
registered in the repository PostgreSQL smoke, but this workstation had no
Docker, PostgreSQL server, or database credential, so that command skipped.
PostgreSQL execution remains an explicit repository QA checkpoint.

That is a local J3 candidate, not accepted J3. Live acceptance still requires:

1. a named deployment and accepted J1/J2 plus real G5 Observer evidence;
2. a reviewed, deployed delivery channel and external scheduler;
3. at least 20 genuine founder outcomes over an accepted window;
4. at most 10% false positives and at most 3 alerts/day;
5. real delivery SLO, replay/reconciliation, monitoring, privacy, and incident
   evidence; and
6. Product Owner acceptance of the measured baseline.

No fixture, simulated timestamp, local adapter, or unit test can satisfy these
external conditions.
