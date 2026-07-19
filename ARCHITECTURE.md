# LeozOps AI — Architecture

> **Egoric integration scope note (2026-07-18):** This file describes the
> existing standalone LeozOps application. It is not the target deployment
> architecture for Egoric. For Egoric work, the canonical contract is
> [`docs/EGORIC_INTEGRATION.md`](docs/EGORIC_INTEGRATION.md): Egoric remains the
> operational system of record and LeozOps runs as a separate, read-only
> intelligence service. The integration profile must not mount CRM mutations,
> onboarding, tasks, or email publishing.

This document describes the architecture that **currently exists** in the
repository. It is descriptive, not aspirational: it records the stack, patterns,
and conventions already in the code so new work stays consistent with them.

> Current scope: CRM **data layer** + a read-only **KPI layer** on top of it.
> There is no dashboard UI, no AI agent, and no real integrations yet — those
> layer on top of what is documented here. See `ROADMAP.md` for sequencing and
> `docs/DATA_MODEL.md` for the schema in depth.

---

## 1. Stack

| Concern | Choice | Notes |
|---------|--------|-------|
| Language | **TypeScript** (`strict: true`) | `target`/`lib` ES2022, `module` CommonJS, `moduleResolution` Node (`tsconfig.json`). |
| Runtime | **Node.js** | No compile step to run; `tsx` executes TypeScript directly. |
| Execution / watch | **tsx** | `npm start` (`tsx src/server.ts`), `npm run dev` (`tsx watch …`). |
| Type checking | **tsc --noEmit** | `npm run typecheck`. `tsc` is used for checking only; `outDir: dist` exists but is not part of the run path. |
| Web framework | **Express 4** | Thin; no middleware stack beyond `express.json()` and a central error handler. |
| Query builder / migrations | **Knex 3** | Schema builder + query builder. No ORM. |
| Database (dev/test) | **SQLite** via `better-sqlite3` | Dev = file; test = `:memory:`. Zero-setup. |
| Database (prod) | **PostgreSQL** via `pg` | Same migrations/queries run unchanged (see §6). |
| IDs | **uuid v4** (`uuid`) | Generated in app code, never by the DB. |
| Config | **dotenv** | `.env` selects `NODE_ENV` + connection details. |
| Tests | **`node:test`** (built-in) run through tsx | No Jest/Mocha/Vitest. |

`better-sqlite3` and `pg` are `optionalDependencies` — only the driver for the
active environment needs to install.

Do not introduce new frameworks, ORMs, test runners, or DB drivers without an
explicit decision recorded in `DECISIONS.md`.

---

## 2. Architectural patterns

The system is a small, layered, stateless HTTP service over a relational store.

```
domain/        pure definitions & types (no I/O)
   │
db/            knex connection, migrations, migrate runner, seed/fixtures
   │
repositories/  data-access layer over Knex (CRUD + domain queries + read/KPI)
   │
services/      business/orchestration over repositories (e.g. brief engine)
   │
http/          Express app: thin routes -> service/repository, central error handler
   │
server.ts      process entry: createApp(), listen, graceful shutdown
```

Key patterns actually in use:

- **Repository pattern over Knex.** All DB access goes through a repository. No
  route or script builds ad-hoc queries against `knex` directly (tests are the
  only place a raw `knex(...)` call appears, deliberately, to prove DB-level
  constraints).
- **Dependency-injectable connection.** Every repository constructor accepts an
  optional `Knex` instance and defaults to the shared `db` singleton. App code
  uses the exported singleton; tests pass an in-memory connection.
- **Thin routes.** HTTP handlers parse input, call one repository or service
  method, and shape the response/status. Business logic lives below the route.
- **Service layer for orchestration.** Logic beyond single-table data access
  (the brief engine, future agent/recommendation logic) lives in `services/`,
  between routes and repositories (see §5). CRUD/KPI routes that only need one
  repository call skip it.
- **Centralized error contract.** Repositories throw `ValidationError` (carrying
  an HTTP status); the single Express error handler maps it. Bad input is never
  a 500 (see §5).
- **Funnel-as-data.** The 9 funnel stages are a seeded table, not an enum;
  `src/domain/funnel.ts` is the single source of truth that seeds it.
- **Read/write separation for metrics.** CRUD repositories mutate single tables;
  the KPI layer (`MetricsRepository`) is query-only and may read across tables.
- **Portability by construction.** App-generated UUIDs, integer-cents money, ISO
  timestamps, and dialect-agnostic Knex schema builder keep one contract across
  SQLite and Postgres.

---

## 3. Folder structure

```
.
├── ARCHITECTURE.md            this file
├── README.md                  quickstart + endpoint reference
├── ROADMAP.md / DECISIONS.md  milestone sequencing + decision log (PM-owned)
├── PRODUCT.md / CHECKLIST.md  product intent + milestone checklist
├── docs/
│   └── DATA_MODEL.md          schema, indexes, FK behavior, funnel mapping
├── knexfile.ts                env -> connection config (dev/test/prod)
├── tsconfig.json
├── package.json               scripts are the supported entry points (§7)
├── .env.example
├── data/                      dev SQLite file lives here (gitignored content)
└── src/
    ├── domain/                pure, I/O-free definitions
    │   ├── funnel.ts          canonical funnel stages (source of truth)
    │   ├── types.ts           row interfaces + TABLES name constants
    │   ├── metrics.ts         typed KPI result shapes
    │   ├── brief.ts           CEO brief output contract
    │   ├── recommendation.ts  advisory recommendation contract
    │   └── date.ts            pure date helpers (e.g. isValidIsoDate)
    ├── db/
    │   ├── knex.ts            builds the shared `db` connection from NODE_ENV
    │   ├── migrate.ts         tiny CLI wrapper over knex.migrate (latest/rollback/status)
    │   ├── migrations/        timestamped migration files (up/down)
    │   ├── fixtures.ts        idempotent reference-data seeding (funnel stages)
    │   └── seed.ts            idempotent demo seed + self-verification
    ├── repositories/          data-access layer (see §4)
    │   ├── baseRepository.ts
    │   ├── clientRepository.ts
    │   ├── campaignRepository.ts
    │   ├── leadRepository.ts
    │   ├── funnelStageRepository.ts
    │   └── metricsRepository.ts
    ├── services/              business/orchestration layer (see §5)
    │   ├── briefService.ts    daily CEO brief engine (+ text renderer)
    │   ├── recommendationService.ts  advisory recommendations from the brief
    │   ├── dashboardService.ts  composes KPI/brief/recommendation/leads into a view
    │   ├── taskService.ts     task lifecycle / state-transition validation (M9)
    │   └── onboardingService.ts  tenant provisioning + platform-readiness report (M10)
    ├── integrations/          connector layer (see §5.1, §10)
    │   ├── placeholderAdapter.ts  abstract no-op adapter base (social/AI media)
    │   ├── channels.ts        concrete adapters (FB/TikTok/IG placeholder, email live, AI media)
    │   ├── registry.ts        in-memory IntegrationRegistry (+ singleton)
    │   └── email/             live email publishing (M8A)
    │       ├── resendEmailAdapter.ts  Resend provider edge (fetch transport + timeout)
    │       ├── spendGuard.ts          per-tenant daily cap / rate limit / circuit breaker
    │       └── emailPublishService.ts orchestration: validate → guard → retry/backoff
    ├── http/
    │   ├── app.ts             createApp({ knex? }): wiring + error handler
    │   ├── asyncHandler.ts    forwards async errors to Express
    │   └── routes/            one file per resource
    │       ├── clients.ts  campaigns.ts  leads.ts
    │       ├── funnelStages.ts  metrics.ts  brief.ts  recommendations.ts
    │       ├── dashboard.ts   read-only HTML dashboard surface
    │       ├── integrations.ts  read-only integration registry metadata
    │       ├── emailPublish.ts  POST /integrations/email/send (live, guarded, M8A)
    │       ├── tasks.ts       tenant-scoped task CRUD + audited status transitions (M9)
    │       ├── onboarding.ts  POST /onboarding — admin tenant provisioning (M10)
    │       └── health.ts      GET /ready readiness probe (public, M10)
    ├── server.ts              process entry point
    ├── onboard.ts             pilot-onboarding CLI (`npm run onboard`, M10)
    └── __tests__/
        ├── *.test.ts          node:test suites (in-memory SQLite)
        └── support/           shared, non-suite test fixtures/helpers
```

Conventions:

- **One responsibility per layer.** `domain/` never imports `db/` or `http/`.
- **One file per resource** in `repositories/` and `http/routes/`, named after
  the entity (`leadRepository.ts`, `routes/leads.ts`).
- Table names are referenced through the `TABLES` constant in
  `domain/types.ts`, never as string literals scattered through queries.

---

## 4. Repository conventions

`BaseRepository<TRow extends { id: string }>` (`repositories/baseRepository.ts`)
is the shared base. Every CRUD repository follows the same shape:

```ts
export class LeadRepository extends BaseRepository<Lead> {
  constructor(knex?: Knex) { super(TABLES.leads, knex); }   // table from TABLES
  // entity-specific queries go here…
}
export const leadRepository = new LeadRepository();         // singleton for app use
```

Rules:

- **Extend `BaseRepository`** for single-table CRUD entities. It provides
  `list / findById / create / update / remove` plus helpers (`query`, `getRow`,
  `clean`, `now`).
- **Inject, then default.** Constructor takes an optional `Knex` and passes it to
  `super`; the module exports a ready singleton bound to the shared `db`.
- **IDs and timestamps are app-owned.** `create` generates a v4 UUID and sets
  `created_at`/`updated_at`; `update` always bumps `updated_at`. Do not rely on
  DB defaults for these.
- **`clean()` defines PATCH semantics.** Keys with `undefined` are dropped (so
  column defaults apply and PATCH only touches sent fields); `null` is preserved
  as an explicit "clear this field." Honor this — don't send `undefined` meaning
  "set null."
- **Validate references before writing.** When a write carries a foreign key,
  check existence with `getRow(table, id)` and throw `ValidationError(400, …)`
  for unknown refs, `ValidationError(409, …)` for conflicts (e.g. cross-client
  campaign attribution). The DB FK is the backstop, not the front door — see
  `LeadRepository.validateRelations` and `CampaignRepository.create`.
- **Domain queries live in the subclass.** Named, typed methods
  (`findByEmail`, `listByClient`, `moveToStage`, `funnelCountsByClient`,
  `listOrdered`) rather than leaking the query builder to callers.
- **Workflow rules are out of the data layer.** A repository records facts; it
  does not enforce which transitions are *allowed*. `moveToStage` stamps the
  move and validates the target stage exists, but legality of the move is left
  to a higher layer (see §5).
- **Read-only/aggregate logic does not extend `BaseRepository`.**
  `MetricsRepository` is a standalone class (still constructor-injectable with a
  `Knex` default) because it reads across tables and never mutates. KPI methods
  are query-only, scoped to a single `clientId`, return the typed shapes from
  `domain/metrics.ts`, and use only portable Knex / standard SQL (no
  dialect-specific functions — day bucketing for trends is done in app code for
  exactly this reason).

---

## 5. Service conventions

The `services/` layer holds **business logic and orchestration that is more than
data access** — it sits between the HTTP routes and the repositories. It was
introduced in M3 with `BriefService` (the Daily CEO Brief engine); M4 added
`RecommendationService` (advisory recommendations) on top of it.

Rules a service follows:

- **Route → service → repository.** A route stays thin (parse/validate input,
  pick a format, set status); it calls a service, which orchestrates one or more
  repositories. Routes do not contain business rules; repositories do not reach
  up into them. `briefRouter → BriefService → MetricsRepository` is the
  reference shape.
- **Services may compose services.** A higher-level service can depend on a
  lower one instead of re-deriving its work: `RecommendationService → BriefService
  → MetricsRepository`. Inject the dependency the same way (constructor arg with a
  singleton default) and reuse its logic rather than duplicating it.
- **Inject, then default.** Like repositories, a service constructor takes its
  dependencies (a repository or another service) and defaults them to the
  process-wide singletons; the module exports a ready singleton. `createApp({ knex })`
  builds the chain on an injected connection for route tests (see the
  `MetricsRepository → BriefService → RecommendationService` wiring in `app.ts`).
- **Typed inputs/outputs, no direct `knex`.** Services consume and return the
  typed domain shapes (`domain/brief.ts`, `domain/recommendation.ts`,
  `domain/metrics.ts`) and never touch the query builder — all DB access is
  delegated to repositories.
- **Pure and deterministic where it can be.** `generate` takes an explicit
  `asOf` (and optional `now`) so the same CRM state always yields the same
  output; no hidden `Date.now()`/random in the assembly path. This is what makes
  the brief and recommendations testable against known seed data.
- **Validate client-facing input at the boundary.** A service guards its inputs
  and throws `ValidationError(400, …)` for bad ones — e.g. `BriefService` rejects
  a date-shaped but invalid `asOf` (`isValidIsoDate` in `domain/date.ts`) before
  any date math, so it can never surface as a 500. The route does the same check
  up front; the service guard is the backstop for direct/composed callers.
- **Read-only stays read-only; advisory stays advisory.** The brief and
  recommendation engines only read the KPI layer — no writes, no new queries, no
  schema. Recommendations are **advisory only** (per PRODUCT.md): the contract
  pins `advisory_only: true` at the type level and the service never schedules or
  executes anything.
- **Business rules live here, not in the data layer.** E.g. which funnel
  transitions are legal, anomaly thresholds, and recommendation priority/category
  mapping belong in a service. `LeadRepository.moveToStage` deliberately records a
  move without judging its legality — that rule, when added, goes in a service.

### Error / validation contract (applies to every layer above the DB)

Bad input is a **client error, never a 500**. The flow:

1. Routes do shallow presence/shape checks (required fields, required
   `?clientId=`) and return `400`/`404` directly.
2. Repositories validate references and invariants and `throw new
   ValidationError(status, message, code)` with `status` `400` or `409`.
3. The single error handler in `http/app.ts`:
   - `ValidationError` → its carried status + `{ error, code }`.
   - Raw DB constraint violation that slipped through (SQLite `SQLITE_CONSTRAINT*`
     or Postgres `23xxx`) → `409 constraint_violation` (backstop).
   - Anything else → `500` (a real bug).

Async handlers are wrapped with `asyncHandler` so thrown/rejected errors reach
this handler. Status-code map is tabulated in `docs/DATA_MODEL.md`.

### 5.1 Integration adapter layer (placeholder, M6)

`src/integrations/` is the seam where future outbound channels (Facebook,
TikTok, Instagram, email, AI media) will plug in. In M6 it is **no-op by
construction** and must stay that way until production safety rails (M7) and the
real publishing milestone (M8) land:

- **The no-op guarantee is in the type system.** `domain/integration.ts` pins
  `mode: 'placeholder'` and an action result's `performed: false` / `no_op: true`
  the same way the recommendation layer pins `advisory_only: true`. `execute`
  acknowledges a request and returns synchronously without doing anything.
- **No reach to the outside.** Adapters import nothing that can touch the
  network (`http`/`https`/`fetch`/`net`) or the DB (`knex`/repositories), so "no
  external calls, no side effects" is structural, not just convention. A test
  arms every egress primitive to throw and proves `execute` stays silent.
- **No credentials, no secrets.** A request payload is never transmitted or
  stored; only its key names are echoed back for traceability.
- **The registry is a read model.** `IntegrationRegistry` holds the adapter
  instances and looks them up by channel — the role a repository plays for CRUD
  routes — so the `/integrations` route stays thin and needs no DB connection.
- **No action surface over HTTP.** `/integrations` exposes adapter *metadata*
  only (list + per-channel info). There is deliberately no execute/publish
  endpoint, so the API cannot trigger even a no-op channel action. The no-op
  `execute` path is exercised in unit tests, not over the wire.

When real integrations arrive they will define their own contract behind auth
and spend guards; nothing in this layer publishes, schedules, or mutates today.

---

## 6. Migration rules

Migrations live in `src/db/migrations/` and run through the small custom runner
`src/db/migrate.ts` (wrapped by npm scripts), not the Knex CLI.

- **Timestamped, append-only files.** Name is `YYYYMMDDHHMMSS_description.ts`
  (e.g. `20260609120000_init_crm_schema.ts`). **Never edit a shipped
  migration** — add a new file for any schema change.
- **Every migration is reversible and rollback-safe.** Provide both `up` and
  `down`. `down` drops/reverses **in strict reverse dependency order** so a
  rollback returns the DB to a clean state with no orphaned objects. This is
  verified by `npm run db:reset` and a test (§7).
- **Dialect-portable schema builder only.** Use Knex's schema builder; write no
  raw dialect-specific DDL. The same files must run unchanged on SQLite and
  Postgres. (`knex.raw` for *query* expressions is acceptable only when standard
  SQL — e.g. `CASE WHEN` — and is avoided in migrations entirely.)
- **App-generated UUID primary keys** (`t.uuid('id').primary()`); do not use
  DB auto-increment or DB-side UUID generation.
- **Money as integer cents** (`budget_cents`), never floats. **Timestamps** via
  `t.timestamps(true, true)` and treated as ISO strings in app code.
- **Foreign-key delete behavior is deliberate** and part of the contract:
  `client` delete CASCADEs campaigns/leads; `campaign` delete SET NULLs its
  leads; a `funnel_stage` is RESTRICTed while leads occupy it. A composite FK
  `leads(client_id, campaign_id) → campaigns(client_id, id)` enforces same-client
  attribution at the DB level.
- **SQLite enforces FKs per-connection.** `knexfile.ts` turns on
  `PRAGMA foreign_keys = ON` in `afterCreate`; in-memory test/dev pools are
  pinned to a single connection so schema + queries share one database.
- **Indexes are added in the migration** alongside the table, chosen for the read
  paths repositories actually hit (per-client lists, the `(client_id,
  funnel_stage_id)` funnel aggregate, etc.).

### Seeding

- `db/fixtures.ts#seedFunnelStages` seeds the canonical funnel stages from
  `domain/funnel.ts`. It is **idempotent** (upsert by `key`) and parameterized by
  a `Knex` instance so the seed script and the test suite reuse it.
- `db/seed.ts` (`npm run seed`) seeds funnel stages, then idempotently inserts
  demo data (skipped if the demo client exists), prints a funnel snapshot, and
  **self-verifies** integrity (rejects a cross-client attribution). Seeds must
  stay safe to re-run.

---

## 7. Testing rules

Tests are `node:test` suites executed through tsx; there is no separate test
framework.

- **Location & registration.** Suites live in `src/__tests__/*.test.ts` and are
  listed explicitly in the `test` script (cross-platform, no globbing):
  `contract.test.ts`, `metrics.test.ts`, `metricsRoutes.test.ts`,
  `brief.test.ts`, `briefRoutes.test.ts`, `recommendations.test.ts`,
  `recommendationsRoutes.test.ts`. Add new suites to that list. Shared,
  non-suite test helpers live under `src/__tests__/support/` (e.g.
  `metricsScenario.ts`, `briefScenario.ts`) — not named `*.test.ts`, so they
  never auto-run.
- **In-memory SQLite, isolated per suite.** Each suite creates its own
  connection with `knexFactory(config.test)` (`:memory:`), migrates + seeds in
  `before`, and `db.destroy()`s in `after`. Suites do not share state.
- **Drive repositories with an injected connection.** Construct repositories with
  the test `db` (`new LeadRepository(db)`); never hit the singleton/dev DB from a
  test.
- **Deterministic, known seed data.** Build a fixed dataset in `before` and
  assert exact numbers (counts, rates, cumulative reach). Use a second client to
  prove per-client scoping/isolation. When two suites assert the same numbers,
  share one fixture builder (see `support/metricsScenario.ts`).
- **Two test altitudes, kept distinct:**
  - **Repository / service / integration** (`contract.test.ts`, `metrics.test.ts`,
    `brief.test.ts`, `recommendations.test.ts`) — call repository or service
    methods against a real (in-memory) DB, including DB-level guarantees; a few
    tests deliberately bypass the repository with raw `knex(...)` inserts to prove
    schema constraints (e.g. the composite FK) hold on their own. The brief and
    recommendation suites assert deterministic output for a fixed `asOf` and that
    it matches the underlying KPI/brief state.
  - **HTTP route-level** (`metricsRoutes.test.ts`, `briefRoutes.test.ts`,
    `recommendationsRoutes.test.ts`) — boot the real app with `createApp({ knex })`,
    `listen(0)` on an ephemeral port, and `fetch` each endpoint to assert status
    codes, input validation (including date-shaped-but-invalid `asOf` → 400), and
    the serialized JSON/text contract. `createApp` takes an optional `knex`
    precisely so routes can be pointed at the seeded in-memory DB without global
    process setup.
- **HTTP route-level coverage exists for the `/metrics` routes.** Equivalent
  route-level tests for the M1 CRUD routes (bad IDs, cross-client conflicts,
  no-accidental-500s) are still tracked in `CHECKLIST.md` / `ROADMAP.md` M7.
- **Postgres parity is by construction, not yet executed in CI.** The verified
  runtime is SQLite; a Postgres migrate/seed/rollback smoke is a tracked
  pre-production item.

### Supported commands (the only supported entry points)

| Command | Purpose |
|---------|---------|
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Run all `node:test` suites (in-memory SQLite) |
| `npm run migrate` / `:rollback` / `:status` | Apply / revert / inspect migrations |
| `npm run seed` | Seed + self-verify |
| `npm run db:reset` | rollback → migrate → seed |
| `npm run db:smoke:pg` | PostgreSQL migrate/seed/rollback smoke (env-gated; see `docs/POSTGRES_SMOKE.md`) |
| `npm start` / `npm run dev` | Run the API (`dev` = watch) |

---

## 8. Request lifecycle (end to end)

```
HTTP request
  → Express (express.json)
  → route handler (http/routes/*)        validate presence/shape; 400/404 early
      wrapped by asyncHandler             so async errors reach the error handler
  → service (services/*)                  orchestration/business logic — OPTIONAL
      (Brief/Recommendation; may compose) present for brief/recommendations;
                                          CRUD/KPI skip it
  → repository method                     UUIDs, timestamps, reference validation
      (BaseRepository or MetricsRepository)
  → Knex query                            portable schema/queries
  → SQLite (dev/test) | PostgreSQL (prod) FK + composite-FK integrity enforced
  ← typed row(s) / KPI shape / brief / recommendations
  ← JSON or text response (or ValidationError → central handler → 400/409)
```

This is the whole shape of the system today. Keep new code inside these layers
and conventions; record any deviation in `DECISIONS.md`.

---

## 9. Auth + tenant isolation (M7)

Production hardening added authentication and per-tenant access control **without
a schema change** (`src/http/auth.ts`):

- **Bearer tokens, no users table.** A per-client token is
  `"<clientId>.<hmac_sha256(secret, clientId)>"`, so the authenticated *tenant*
  is the client itself. A separate **admin key** grants cross-tenant access for
  internal/operator use (listing all clients, the dashboard picker). Tokens
  arrive as `Authorization: Bearer <t>` or `x-api-key`.
- **Fail closed.** `authenticate()` is mounted right after the public `/health`
  probe and before every data route; a missing/invalid token is `401`. With no
  `AUTH_SECRET`/`ADMIN_API_KEY` configured, nothing validates — so the app
  denies rather than allows. `server.ts` supplies an explicit dev fallback
  (and *requires* `AUTH_SECRET` in production).
- **Tenant enforcement, per route.** Helpers in `auth.ts`:
  `enforceClientScope` (explicit client id — query `?clientId=`, `/clients/:id`,
  create-body `client_id` — → `403` on mismatch) and `scopeAllows` (resource
  lookups `/campaigns/:id`, `/leads/:id` — → `404` on cross-tenant, so existence
  is not leaked). List routes auto-scope to the caller's client; listing all
  clients and the dashboard picker are admin-only.
- **Injectable routers.** To test the protected CRUD routes against a seeded DB,
  the clients/campaigns/leads/funnel-stages routers use the same
  `createXRouter({ repo })` factory pattern as the KPI/brief/dashboard routers
  (default-bound to the singletons; `createApp({ knex })` binds them to the
  injected connection).

### Validation hardening (Phase B)

`src/domain/validate.ts` holds pure validators (UUID, email, enum membership,
integer bounds). They run **in the repositories** — the single boundary both
HTTP and programmatic callers pass through — so malformed input is a clean `400`
and never reaches the DB as a `500`. Updates additionally **block ownership
reassignment**: changing a campaign's or lead's `client_id` is a `409`
(`ownership_reassignment`). This complements the same-client composite FK already
enforced at the DB level.

### PostgreSQL parity (Phase C)

`npm run db:smoke:pg` (`src/db/pgSmoke.ts`) runs migrate → seed+verify →
rollback+verify-dropped against a configured PostgreSQL instance, proving the
dialect-portable migrations are reversible on Postgres. It is env-gated (skips
cleanly when no PG is configured). See `docs/POSTGRES_SMOKE.md`.

---

## 10. Live email publishing (M8A)

The email channel is the first **`'live'`** integration (`src/integrations/email/`).
Social and AI-media adapters remain metadata-only placeholders.

- **The integration boundary is preserved.** `IntegrationAdapter.execute()` is a
  no-op acknowledgement for *every* adapter — it never sends. The contract only
  broadened from a pinned placeholder to `mode: 'placeholder' | 'live'` /
  `advisory_only: boolean`. Real delivery is a separate method
  (`ResendEmailAdapter.sendOnce`) reached only through the publish service.
- **Explicit invocation, tenant-scoped.** `POST /integrations/email/send` is the
  only send surface. It sits behind the M7 `authenticate` middleware and calls
  `enforceClientScope(clientId)`; there is no autonomous path. The recommendation
  engine is unchanged and never sends (a route test asserts zero provider calls
  when generating recommendations). A request may carry `recommendation_code`
  purely for traceability.
- **Spend guardrails (`spendGuard.ts`), per `client_id`, in-memory (no schema).**
  A daily send cap, a rolling-60s rate limit, and a stop-on-failure circuit
  breaker (opens after N consecutive provider failures). The clock is injectable
  for deterministic tests.
- **Provider edge (`resendEmailAdapter.ts`).** The Resend HTTP call goes through
  the built-in `fetch` (no new dependency, no SDK) via an injectable
  `EmailTransport`, with a per-attempt `AbortController` timeout. One attempt is
  classified success / retryable / fatal.
- **Retry + backoff (`emailPublishService.ts`).** Transient (retryable) failures
  retry with exponential backoff; fatal ones stop immediately. `sleep` is
  injectable so tests don't wait. Each failure reason maps to a precise HTTP
  status (`400/429/502/503/504`), sets `Retry-After` for cap/rate/circuit limits,
  and is logged — failures are surfaced, not swallowed.
- **Configuration.** `RESEND_API_KEY` / `EMAIL_FROM` / `EMAIL_*` (see
  `.env.example`). Unconfigured, the endpoint returns `503 not_configured` rather
  than failing silently. Tests inject a sandbox transport, so no real email is
  ever sent.

---

## 11. Task Engine (M9)

Tracked, tenant-scoped units of work that operationalize brief/recommendation
outputs. Two tables (`src/db/migrations/*_create_tasks.ts`): `tasks` and an
append-only `task_status_events` audit trail.

- **Small, explicit state machine** (`domain/task.ts`): `open ⇄ in_progress`,
  `open → cancelled`, `in_progress → done|cancelled`; `done`/`cancelled` are
  terminal. Transition *legality* is a business rule and lives in `TaskService`,
  not the repository (per §5).
- **Status changes are audited; field edits are not.** `TaskRepository.create`
  records the initial status as the first event; `changeStatus` writes the new
  status and its event **atomically in a transaction**. PATCH edits non-status
  fields only and rejects a `status` field, so every transition goes through the
  audited path. There is no autonomous transition.
- **Audit order is a per-task monotonic `seq`, not a timestamp.** Each event
  carries a 1-based `seq` (assigned in app code inside the same transaction;
  `unique(task_id, seq)` is the integrity backstop). `listStatusEvents` orders by
  `seq`, so rapid events that share a `created_at` millisecond still read in a
  fixed, correct order and the create event (seq 1) always sorts first — rather
  than depending on DB tie-breaking.
- **Audit integrity via the composite-FK pattern.**
  `task_status_events(client_id, task_id) → tasks(client_id, id)` (with
  `tasks.unique(client_id, id)`) mirrors leads→campaigns, so an event can never
  cross tenants; the `task_id` FK cascades the trail when a task is deleted.
- **Auth/tenant + validation reuse M7 verbatim.** Routes are behind
  `authenticate`; explicit client ids → `403` on mismatch, resource lookups →
  `404` cross-tenant; lists auto-scope to the caller. Repository field validation
  keeps malformed input a clean `400`/`409`, and ownership reassignment is
  blocked. `assignee` is a free-text label — there is no users/team system.

---

## 12. Onboarding & readiness (M10)

The MVP-launch milestone adds the operator surface to put a tenant live and the
probe to monitor it — **without a schema change**, reusing the M7 auth model.

- **Onboarding workflow.** `OnboardingService` (`services/onboardingService.ts`)
  provisions a tenant: it guards required `name`/`email` (clean `400`), refuses a
  duplicate tenant email (`409 client_exists`), creates the client through
  `ClientRepository` (which validates the email shape), and returns a
  **readiness summary** (how many of the 9 canonical funnel stages are seeded).
  Funnel stages are global reference data seeded once at deploy (`npm run seed`),
  not per-tenant. The service is http-free.
- **Token issuance stays at the boundary.** Signing a tenant's bearer token is an
  auth concern, so the service does **not** mint it. `POST /onboarding`
  (`routes/onboarding.ts`, **admin-only** like `POST /clients`) and the
  `npm run onboard` CLI (`src/onboard.ts`) sign the per-client token with the
  same `AUTH_SECRET` the middleware verifies (`signClientToken`). The route
  returns `201 { client, api_token, readiness }`; with no secret configured it
  returns `503 not_configured` rather than issuing an unverifiable token.
- **Readiness probe.** `GET /ready` (`routes/health.ts`) is public like
  `/health`, but checks real dependencies: it counts funnel stages through
  `FunnelStageRepository` — a successful query proves DB reachability, and the
  count proves the platform is seeded. `200` when ready; `503` when the DB is
  unreachable or the stages are unseeded. `/health` remains a pure liveness probe.
- **CLI parity.** `npm run onboard -- --name … --email …` runs the same service
  against the deployed DB so an operator can create and verify the first pilot
  tenant; it mirrors `server.ts` for secret resolution (production must set
  `AUTH_SECRET`). See `docs/PILOT_RUNBOOK.md` for the full launch/support runbook.
