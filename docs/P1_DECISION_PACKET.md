# P1 Decision Packet — Solo Founder

Status: **LOCAL TOOLING MERGED AND ACCEPTED — [PR #17](https://github.com/leozvu/leozcrm/pull/17), `main@35ed23c`; P1 NOT APPROVED**

P1 is the permission boundary for creating the exact named networked test
environment. This packet turns the eight Product Owner decisions in
[`SPRINT_2_PLAN.md`](SPRINT_2_PLAN.md) into one fail-closed, machine-checkable
manifest. It does not provision, deploy, set credentials/flags, start a
scheduler, or contact an external system.

## Recommended smallest architecture

The provisional recommendation for a solo founder is:

- **LeozOps runtime:** one Render web service for the read-only API and one
  Render cron job for the existing one-shot operator command;
- **database:** one independent Render Postgres database per environment, in
  the same region as its runtime;
- **Egoric:** remains on its existing Vercel project and database; LeozOps gets
  only the dedicated GET-only source endpoint/key;
- **reviewer and on-call:** Leoz may hold both roles for the first pilot;
- **alerts:** platform-native email first; add another destination only when
  there is a real second responder;
- **brief access:** authenticated read API, not a second operational CRM UI.

Why this is the provisional default: Render supports Express web services,
command-and-exit cron jobs, managed Postgres, and failure notifications in one
operating surface. Its paid Postgres plans provide point-in-time recovery.
Vercel can host Express, but a 15-minute cron requires a paid plan, cron invokes
an HTTP function, failed invocations are not retried by the platform, and
duplicate/concurrent delivery must still be handled. LeozOps already has
persistent lease, retry, circuit, and idempotency logic around a one-shot CLI,
so Render is the smaller adaptation.

Primary references:

- [Render service types](https://render.com/docs/service-types)
- [Render web services](https://render.com/docs/web-services)
- [Render notifications](https://render.com/docs/notifications)
- [Render Postgres recovery and backups](https://render.com/docs/postgresql-backups)
- [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [Vercel cron behavior](https://vercel.com/docs/cron-jobs/manage-cron-jobs)

This recommendation is not an approval or purchase decision. Provider, plan,
region, service IDs, database IDs, cost, and owner must still be named by Leoz.

## Proposed operating defaults

These values are prefilled in
[`config/p1.decision.example.json`](../config/p1.decision.example.json) as a
starting point, not as accepted facts:

| Decision | Proposed value | Why |
|---|---|---|
| Poll cadence | 15 minutes | Already accepted contract |
| Request timeout | 10 seconds | Bounded network wait |
| Retries | 2 | Three total attempts without a retry storm |
| Backoff | 1–10 seconds, 20% jitter | Bounded and de-synchronized |
| Circuit | Open after 3 failed cycles for 15 minutes | Stops repeated source pressure |
| Lease | 2 minutes | Exceeds worst-case bounded poll runtime |
| Stale threshold | 30 minutes | Two missed polling intervals |
| Business window | Mon–Fri, 09:00–18:00 | Founder-friendly initial window |
| Timezone | `America/New_York` | Current working timezone; change if the business clock is Vietnam |
| Snapshot retention | 90 days | Useful short operational history |
| Reconciliation retention | 365 days | Longer trust/audit evidence |
| Test/production ownership | Leoz | Explicit solo-founder ownership |

Retention here is a policy decision only. Automated evidence expiration is not
implemented and must not bypass immutable-evidence protections. P2 requires a
separate retention implementation/review before any deletion is enabled.

## How to make the decision

1. Copy `config/p1.decision.example.json` to a new decision file.
2. Replace every `pending` value with the exact provider identity, project or
   service ID, plan, region, owner, destination, URL, tenant key, budget, or
   `secret://` reference. Never put a raw credential in this file.
3. Confirm test and production use distinct runtime, database, Egoric, and
   secret-reference identities.
4. Change `status` to `approved`, set a unique `decision_id`, and record an
   ISO-8601 `approved_at` timestamp only when Leoz accepts the complete file.
5. Run:

   ```text
   npm run p1:preflight -- <decision-manifest.json>
   ```

6. A PASS validates completeness and safety only. Its
   `decision_fingerprint` binds later Checkpoint B evidence to these exact
   normalized values. Review the diff and record a DECISION-002 addendum before
   any P1 external action.

## Fail-closed rules

The preflight blocks:

- `pending`, `TBD`, malformed, missing, or unknown fields;
- raw credentials or credential-bearing URLs;
- non-HTTPS/localhost source URLs;
- shared test/production project, database, endpoint, or secret references;
- shared test/production brief-access or alert destinations;
- invalid timezone, duplicate weekdays, or zero-length business windows;
- poll policies outside the existing safety envelope;
- stale thresholds shorter than two polling intervals; and
- empty, duplicate, public, wildcard, or generic evidence-access roles.

The emitted PASS summary omits all secret references. It never calls a network
or mutates the database.

## Current remaining decisions

The checked-in example intentionally fails preflight. The following remain
unapproved:

1. Render (or alternative) plan, workspace/service IDs, regions, and explicit
   monthly USD budget cap.
2. Independent test/production Postgres identities and backup windows.
3. Canonical Egoric test deployment identity and both source-key references.
4. Business timezone/window confirmation.
5. Distinct test/production brief-access secret references.
6. Distinct test/production alert destination references.
7. Final acceptance of the proposed runtime thresholds.
8. Final retention/access policy and later enforcement design.

Until all eight are approved in one passing manifest, P1 and every external
action remain blocked.
