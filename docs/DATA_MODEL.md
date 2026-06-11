# LeozOps AI — CRM Data Layer Foundation

> Scope of this deliverable: **data layer only.** No dashboard, no AI agents, no
> integrations, no social posting. This is the migration contract everything
> else will build on top of.

---

## 1. Database setup plan

**Two dialects, one contract.**

| Environment | Engine | Why |
|-------------|--------|-----|
| `development` / `test` | **SQLite** (file / in-memory) | Zero-setup. Lets anyone clone, run, and verify the schema on Windows/Mac/Linux with no database server. |
| `production` | **PostgreSQL** | Concurrency, real indexes, JSON, and room to grow into the AI/dashboard layers. |

The migrations are written with Knex's **dialect-portable schema builder** and
UUID primary keys are generated in application code, so the *exact same*
migration files run unchanged on both engines. There is no SQLite-only or
Postgres-only SQL to maintain.

### Local quickstart (SQLite — no server needed)

```bash
npm install
cp .env.example .env        # defaults are fine for dev
npm run migrate             # create the schema
npm run seed                # seed funnel stages + demo data, print a funnel snapshot
npm start                   # CRUD API on http://localhost:3000
```

Useful loops:

```bash
npm run migrate:rollback    # roll the schema back (rollback-safe)
npm run migrate:status      # applied vs pending
npm run db:reset            # rollback -> migrate -> seed
npm run typecheck           # tsc --noEmit
```

### Production (PostgreSQL)

```bash
# 1. Provide a database. Example with Docker:
docker run --name leozops-pg -e POSTGRES_PASSWORD=leozops \
  -e POSTGRES_USER=leozops -e POSTGRES_DB=leozops -p 5432:5432 -d postgres:16

# 2. Point the app at it (in .env):
#    NODE_ENV=production
#    DATABASE_URL=postgres://leozops:leozops@localhost:5432/leozops

# 3. Same commands, now against Postgres:
NODE_ENV=production npm run migrate
NODE_ENV=production npm run seed
```

---

## 2. The schema (four tables)

```
funnel_stages        clients
─────────────        ───────
id (uuid, pk)        id (uuid, pk)
key (unique)         name
name                 email
position (unique)    company
description          status            ── active | paused | churned
created_at           notes
updated_at           created_at / updated_at

campaigns                         leads
─────────                         ─────
id (uuid, pk)                     id (uuid, pk)
client_id  ──► clients (CASCADE)  client_id        ──► clients         (CASCADE)
name                              campaign_id (nullable) ──► campaigns  (SET NULL)
channel    ── placeholder label   funnel_stage_id  ──► funnel_stages   (RESTRICT)
status     ── draft|active|...    name / email / phone   (nullable: anonymous early)
budget_cents (money as cents)     source            ── free-text origin
started_at / ended_at             score             ── 0..100 qualification
created_at / updated_at           status            ── open | won | lost
                                  entered_stage_at  ── stamped on each stage move
                                  created_at / updated_at
```

**Design choices worth knowing:**

- **UUID primary keys** — generated in app code (`uuid` v4). Portable across
  engines and safe to expose in URLs / merge across systems later.
- **Money as integer cents** (`budget_cents`) — never floats.
- **`channel` is a plain label, not an integration.** It is the seam where real
  Facebook / TikTok / Instagram / email adapters plug in later. Nothing here
  posts or fetches anything.
- **FK delete behavior is deliberate:**
  - Delete a client → its campaigns and leads cascade away.
  - Delete a campaign → its leads survive but become unattributed (`SET NULL`).
  - A funnel stage **cannot** be deleted while leads still occupy it (`RESTRICT`).
- **Same-client integrity is enforced in the schema.** A lead may be
  unattributed (`campaign_id` NULL), but if it *is* attributed, the campaign
  **must** belong to the lead's client. This is guaranteed by a composite
  foreign key `leads(client_id, campaign_id) → campaigns(client_id, id)`
  (targeting a unique index on `campaigns(client_id, id)`). Because
  `campaign_id` is nullable, unattributed leads skip the check entirely. This
  keeps per-client funnel metrics and attribution trustworthy for the dashboard
  and agents that build on top.

### Validation & error contract

Bad input is a **client error, never a 500**. The repository layer validates
referenced IDs before touching the DB, and the schema composite FK is the
backstop:

| Situation | HTTP |
|-----------|------|
| Missing required field (`name`, `client_id`, …) | `400` |
| Referenced `client_id` / `campaign_id` / `funnel_stage_id` does not exist | `400` |
| Campaign belongs to a **different** client than the lead | `409` (`campaign_client_mismatch`) |
| Any DB constraint violation that slips past validation | `409` (backstop) |

---

## 3. Indexes (query performance)

Indexes were chosen for the read paths the dashboard/agents will actually hit:

| Table | Index | Serves |
|-------|-------|--------|
| `funnel_stages` | `position` | Rendering the funnel in order. |
| `clients` | `status`, `email` | Active-client lists; lookup/dedupe by email. |
| `campaigns` | `client_id`, `status`, **`(client_id, status)`** | "Active campaigns for client X". |
| `campaigns` | **unique `(client_id, id)`** | Target for the leads same-client composite FK. |
| `leads` | `client_id`, `campaign_id`, `funnel_stage_id`, `status`, `email`, `created_at` | Per-client / per-campaign lists, stage filters, time-series. |
| `leads` | **`(client_id, funnel_stage_id)`** | The funnel snapshot — count of leads per stage per client (the core KPI query). |

The two composite indexes are the important ones: they back the most expensive,
most frequent aggregate queries the funnel needs.

---

## 4. Models / CRUD endpoints

Two layers are provided:

**Repository (model) layer** — `src/repositories/`. A thin `BaseRepository`
gives portable `list / findById / create / update / remove`, with entity repos
adding domain queries (`clientRepository.findByEmail`,
`campaignRepository.listByClient`, `leadRepository.moveToStage`,
`leadRepository.funnelCountsByClient`, `funnelStageRepository.listOrdered`).
Lead/campaign creates and moves validate their references first (see the
error contract above). Repositories accept an injected Knex instance, so they
can be driven against an in-memory DB in tests.

**HTTP CRUD layer** — `src/http/` (Express):

| Resource | Endpoints |
|----------|-----------|
| Funnel stages | `GET /funnel-stages`, `GET /funnel-stages/:id` (read-only reference data) |
| Clients | `GET/POST /clients`, `GET/PATCH/DELETE /clients/:id` |
| Campaigns | `GET/POST /campaigns` (`?clientId=`), `GET/PATCH/DELETE /campaigns/:id` |
| Leads | `GET/POST /leads` (`?clientId=`), `GET/PATCH/DELETE /leads/:id`, **`POST /leads/:id/move`** |

> Auth, access control, and pagination hardening are intentionally **out of
> scope** for this foundation — they are on the Codex review/security list and
> belong to the next layer. Referential validation (existence + same-client) IS
> in scope and implemented, so the API returns predictable `400`/`409` codes.

---

## 5. Migrations & rollback safety

Single initial migration: `src/db/migrations/20260609120000_init_crm_schema.ts`.

It is **rollback-safe**: every object created in `up()` is dropped in `down()`
in strict reverse dependency order (`leads → campaigns → clients →
funnel_stages`), so a rollback returns the database to a clean empty state with
no orphaned tables, indexes, or constraints. Verified:

```
npm run migrate            # applies the batch
npm run migrate:rollback   # drops all four tables cleanly
npm run migrate            # re-applies — idempotent
```

New changes always go in **new** migration files; existing migrations are never
edited once shipped.

---

## 6. Seed script

`src/db/seed.ts` (`npm run seed`):

1. Idempotently seeds the 9 canonical funnel stages from `src/domain/funnel.ts`.
2. Inserts one demo client + campaign + 5 leads spread across the funnel
   (skipped if the demo client already exists — safe to re-run).
3. Reads everything back and prints a **funnel snapshot**, proving the schema,
   foreign keys, and aggregate index all work end-to-end.
4. Runs an **integrity check** that attempts a cross-client lead/campaign
   attribution and confirms it is rejected (`409`).

## 6a. Automated tests

`npm test` runs `src/__tests__/contract.test.ts` against an in-memory SQLite
database (Node's built-in test runner). It covers the data contract end-to-end:

- migrate → seed the 9 funnel stages,
- create client → campaign → lead and verify funnel counts,
- reject unknown `client_id` / `campaign_id` / `funnel_stage_id` (`400`),
- reject a cross-client lead/campaign mismatch — both at the **repository**
  (`409`) and at the **DB composite FK** (backstop),
- allow an unattributed lead (`campaign_id` NULL),
- confirm deleting a campaign nulls its leads (`SET NULL`) and they survive,
- reject `moveToStage` to an unknown stage (`400`),
- roll back cleanly (all four tables dropped).

---

## 7. How the data model supports the funnel

```
Traffic → Attention → Lead → Qualification → Nurture → Conversion → Activation → Upsell → Retention
```

The funnel is **data, not code**: the 9 stages live in `funnel_stages` (seeded
from `src/domain/funnel.ts`), each with a stable `key` and an ordered
`position`. This means the funnel can be re-ordered or extended later via a
seed/migration change — no code deploy, and existing leads keep their stage.

A **lead's journey** is a single pointer: `leads.funnel_stage_id` is its current
stage, and `entered_stage_at` records when it arrived there. Moving a lead
(`leadRepository.moveToStage` / `POST /leads/:id/move`) updates both atomically.

Mapping each stage to the columns that carry its meaning:

| Stage | Captured in the model |
|-------|----------------------|
| **Traffic** | A lead row at stage `traffic`, usually anonymous (`name`/`email` null), tagged by `source` and `campaign_id`. |
| **Attention** | Same row advanced to `attention`; early `score` signal begins. |
| **Lead** | Identity captured — `email`/`phone` now populated; the agency owns the contact. |
| **Qualification** | `score` (0–100) expresses ICP fit + intent against the lead. |
| **Nurture** | Stage `nurture`; `entered_stage_at` shows how long warming has run. |
| **Conversion** | Stage `conversion` + `status = won`; tied to the `campaign` that drove it. |
| **Activation** | Stage `activation` — first value realized post-purchase. |
| **Upsell** | Stage `upsell` — expansion motion on an existing customer. |
| **Retention** | Stage `retention`; the client-level `status` (active/paused/churned) tracks the account. |

The **core KPI query** — how many leads sit in each stage for a client — is the
`(client_id, funnel_stage_id)` aggregate (`leadRepository.funnelCountsByClient`),
backed by its dedicated composite index. That single query is what the future
KPI dashboard and CEO Brief agent will read; this foundation already returns it
correctly (see the seed snapshot).

### Clean extension points (intentionally left open)

- **Stage transition history** — add a `lead_stage_events` table (lead_id,
  from_stage, to_stage, occurred_at) when you need velocity/conversion-rate
  analytics. The `moveToStage` method is the single place to also write it.
- **Transition rules** — *which* moves are legal belongs to a service layer
  above these repositories; the data layer only records moves.
- **Status/channel/score value checks** — these are TypeScript-only conventions
  today. Add DB `CHECK` constraints before external use if stricter guarantees
  are wanted (deferred per the QA review).
- **Integrations** — `campaigns.channel` and `leads.source` are the seams for
  real social/email adapters.
- **Content queue, KPI dashboard, agents** — all read from these four tables;
  none required schema changes here.
