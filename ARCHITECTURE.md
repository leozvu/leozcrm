# LeozOps AI — Architecture

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
http/          Express app: thin routes -> repositories, central error handler
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
- **Thin routes.** HTTP handlers parse input, call one repository method, and
  shape the response/status. Business logic lives below the route.
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
    │   └── metrics.ts         typed KPI result shapes
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
    ├── http/
    │   ├── app.ts             createApp({ knex? }): wiring + error handler
    │   ├── asyncHandler.ts    forwards async errors to Express
    │   └── routes/            one file per resource
    │       ├── clients.ts  campaigns.ts  leads.ts
    │       ├── funnelStages.ts            metrics.ts (createMetricsRouter factory)
    ├── server.ts              process entry point
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

**There is no `services/` layer in the codebase today.** This is intentional for
the current scope, and the convention is:

- **Routes call repositories directly.** For the current CRUD + KPI surface there
  is no business orchestration between the HTTP layer and the data layer, so a
  service tier would be empty indirection. Handlers in `http/routes/` invoke a
  single repository method.
- **The service seam is explicitly reserved, not built.** Logic that is *more
  than data access* — e.g. which funnel transitions are legal, multi-step
  workflows, recommendation rules, agent orchestration — belongs in a future
  service layer that sits **between routes and repositories**. The code already
  draws this line: `LeadRepository.moveToStage` records a move but leaves
  transition *rules* to "a later service layer" (see its doc comment and
  `docs/DATA_MODEL.md` §7).

When a service layer is introduced, follow the patterns already established
below it: dependency-injected repositories, `ValidationError` for client-facing
failures, typed inputs/outputs, and no direct `knex` use. Do not push business
rules up into routes or down into repositories to avoid creating it.

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
  `contract.test.ts`, `metrics.test.ts`, `metricsRoutes.test.ts`. Add new suites
  to that list. Shared, non-suite test helpers live under `src/__tests__/support/`
  (e.g. `metricsScenario.ts`) — not named `*.test.ts`, so they never auto-run.
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
  - **Repository / integration** (`contract.test.ts`, `metrics.test.ts`) — call
    repository methods against a real (in-memory) DB, including DB-level
    guarantees; a few tests deliberately bypass the repository with raw
    `knex(...)` inserts to prove schema constraints (e.g. the composite FK) hold
    on their own. Test names are prefixed with the method under test.
  - **HTTP route-level** (`metricsRoutes.test.ts`) — boot the real app with
    `createApp({ knex })`, `listen(0)` on an ephemeral port, and `fetch` each
    endpoint to assert status codes, `clientId` validation, and the serialized
    JSON contract. `createApp` takes an optional `knex` precisely so routes can
    be pointed at the seeded in-memory DB without global process setup.
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
| `npm start` / `npm run dev` | Run the API (`dev` = watch) |

---

## 8. Request lifecycle (end to end)

```
HTTP request
  → Express (express.json)
  → route handler (http/routes/*)        validate presence/shape; 400/404 early
      wrapped by asyncHandler             so async errors reach the error handler
  → repository method                     UUIDs, timestamps, reference validation
      (BaseRepository or MetricsRepository)
  → Knex query                            portable schema/queries
  → SQLite (dev/test) | PostgreSQL (prod) FK + composite-FK integrity enforced
  ← typed row(s) / KPI shape
  ← JSON response (or ValidationError → central handler → 400/409)
```

This is the whole shape of the system today. Keep new code inside these layers
and conventions; record any deviation in `DECISIONS.md`.
