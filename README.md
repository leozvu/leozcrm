# LeozOps AI

An AI Operating Partner for agencies and business owners — **CRM + AI Brain + Agent Workforce.**

> **Current state: MVP feature-complete and verified on real PostgreSQL.**
> The CRM data layer (Client, Campaign, Lead, FunnelStage), KPI read layer,
> daily CEO brief, advisory recommendations, dashboard, task engine, tenant
> auth/onboarding, and live email + Facebook/Instagram/TikTok publishing are
> built and tested; the full pilot flow has passed against a real PostgreSQL
> 16 instance in production mode (see `docs/DEPLOYMENT_EVIDENCE.md`). AI-media
> generation remains a safe placeholder. The remaining launch step is running
> `npm run verify:pilot` against the chosen public host.

## Quickstart (zero database setup)

```bash
npm install
cp .env.example .env
npm run migrate    # build the schema (SQLite by default)
npm run seed       # seed funnel stages + demo data and print a funnel snapshot
npm start          # CRUD API on http://localhost:3000
```

## Scripts

| Command | Does |
|---------|------|
| `npm run migrate` | Apply pending migrations |
| `npm run migrate:rollback` | Roll back the last batch (rollback-safe) |
| `npm run migrate:status` | Show applied vs pending migrations |
| `npm run seed` | Seed + self-verify the schema |
| `npm run onboard` | Provision a pilot tenant + print its API token (`-- --name … --email …`) |
| `npm run db:reset` | rollback → migrate → seed |
| `npm start` / `npm run dev` | Run the CRUD API (`dev` = watch mode) |
| `npm test` | Run the data-contract test suite (in-memory SQLite) |
| `npm run typecheck` | `tsc --noEmit` |

## Layout

```
src/
  domain/        funnel definition (source of truth) + row types
  db/            knex connection, migrations, migrate runner, seed/verify
  repositories/  model layer: BaseRepository + Client/Campaign/Lead/FunnelStage + Metrics
  services/      business layer: BriefService + RecommendationService
  http/          Express app + CRUD routes + read-only KPI + brief + recommendation routes
knexfile.ts      dev=SQLite, test=SQLite(:memory:), production=PostgreSQL
docs/DATA_MODEL.md   full setup plan, schema, indexes, and funnel notes
```

**Read `docs/DATA_MODEL.md`** for the database setup plan, schema, index
rationale, rollback-safety notes, and how the data model supports the funnel.

## KPI read layer (read-only)

The read-only metrics API converts live CRM data into funnel KPIs. Every
endpoint is **scoped to a single client** via a required `?clientId=` query
parameter (`400` if missing, `404` if the client is unknown) and only ever
reads — it never mutates. This is the layer the KPI dashboard and the Daily CEO
Brief Agent build on top of.

| Endpoint | Returns |
|----------|---------|
| `GET /metrics/funnel?clientId=` | Per-stage lead counts, cumulative reach, step + overall conversion rates |
| `GET /metrics/sources?clientId=` | Lead volume grouped by `source` |
| `GET /metrics/channels?clientId=` | Lead volume grouped by campaign `channel` (no campaign → `unattributed`) |
| `GET /metrics/campaigns?clientId=` | Per-campaign attribution (lead count, won count, budget) + unattributed count |
| `GET /metrics/trends?clientId=` | Lead-creation volume bucketed by day (UTC) |

Aggregation logic lives in `repositories/metricsRepository.ts`; the typed result
shapes are in `domain/metrics.ts`.

## Daily CEO Brief (read-only)

The brief engine turns the KPI layer into a deterministic executive summary for
one client: a funnel snapshot, an acquisition delta, anomalies, and advisory
recommended actions. It consumes only the KPI repository (no new queries, no
schema change) and recommendations are **advisory only** — nothing is automated.

| Endpoint | Returns |
|----------|---------|
| `GET /brief?clientId=` | Today's brief as JSON |
| `GET /brief?clientId=&asOf=YYYY-MM-DD` | Brief for a specific day |
| `GET /brief?clientId=&format=text` | Brief rendered as plain text |

Same client scoping as the KPI routes (`400` missing/blank `clientId` or
invalid `asOf`, `404` unknown client). The engine lives in
`services/briefService.ts`; the output contract is in `domain/brief.ts`. Given
the same CRM state and `asOf`, it always produces the same brief.

## Recommendations (advisory-only)

The Recommendation System turns the brief's funnel analysis into prioritised,
categorised advice — the first "AI Brain" behaviour. It is **advisory only**:
read-only, no scheduling or execution, and every recommendation (and the report)
carries `advisory_only: true`.

| Endpoint | Returns |
|----------|---------|
| `GET /recommendations?clientId=` | Advisory report for today |
| `GET /recommendations?clientId=&asOf=YYYY-MM-DD` | Advisory report for a specific day |

Each recommendation has a stable `code`, `title`, `rationale`, `category`
(`acquisition`/`conversion`/`attribution`/`spend`/`retention`), `priority`
(`high`/`medium`/`low`), and an optional `related_stage`; reports are sorted
high → low. Same client/`asOf` scoping as `/brief`. The engine lives in
`services/recommendationService.ts` (derived from `BriefService`); the contract
is in `domain/recommendation.ts`.

## Publishing (explicit, guardrailed — never autonomous)

Three live publish surfaces exist: **email** (M8A, Resend), **Facebook /
Instagram** (M8B, Meta Graph API), and **TikTok** (M8C, Content Posting API).
All are explicitly invoked, authenticated, tenant-scoped, and wrapped in
per-tenant spend guardrails (daily cap, rate limit, stop-on-failure circuit)
with bounded retry/backoff. Recommendations may *reference* a publish
(`recommendation_code`) but can never trigger one. AI media remains a
metadata-only placeholder with no publish surface.

| Endpoint | Does |
|----------|------|
| `POST /integrations/email/send` | Send one email — body: `{ clientId, to, subject, html?/text?, from?, recommendation_code? }` |
| `POST /integrations/social/publish` | Publish one post — body: `{ clientId, channel: "facebook"\|"instagram"\|"tiktok", message?, link?, image_url?, video_url?, recommendation_code? }` |
| `GET /integrations` | Read-only adapter metadata (mode, capabilities, advisory flag) |

Channel rules: Facebook needs `message` and/or `link`; Instagram needs a
publicly-reachable `image_url` (its `message` becomes the caption) and uses the
documented two-step container flow; TikTok needs exactly one of `video_url` /
`image_url` (media is pulled by TikTok from the public URL) and publishes with
`privacy_level` `SELF_ONLY` by default. A channel is disabled (`503
not_configured`) until its provider credentials are set (`RESEND_API_KEY` +
`EMAIL_FROM`; `META_ACCESS_TOKEN` + the channel target id;
`TIKTOK_ACCESS_TOKEN` — see `.env.example`). Failure responses carry a precise
`code` (`invalid_message` 400, caps 429 + `Retry-After`, `provider_error` 502,
`not_configured`/`circuit_open` 503, `timeout` 504). Engines live in
`src/integrations/email/` and `src/integrations/social/`; contracts in
`domain/email.ts` and `domain/social.ts`.

## Onboarding & readiness (operations)

The MVP-launch surface for putting a tenant live and monitoring the deployment.

| Endpoint | Returns |
|----------|---------|
| `GET /health` | Liveness — `{ ok: true }` (public). |
| `GET /ready` | Readiness — `200` when the DB is reachable **and** funnel stages are seeded; `503` otherwise (public). |
| `POST /onboarding` | **Admin only.** Provisions a tenant → `201 { client, api_token, readiness }`. |

The returned `api_token` is the tenant's per-client bearer token (scoped to that
one client). Onboarding rejects missing fields (`400`), malformed email (`400`),
and a duplicate tenant email (`409`). `npm run onboard` runs the same workflow
from the CLI against the deployed database. See `docs/PILOT_RUNBOOK.md` for the
launch and support runbook.

## Stack

Node + TypeScript · Knex (migrations + query builder) · Express · SQLite (dev) / PostgreSQL (prod).

## Roles

Leoz = CEO/Product Owner · Hermes = PM · Claude Code = Senior Dev · Codex = QA.
