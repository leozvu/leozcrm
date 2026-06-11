# LeozOps AI

An AI Operating Partner for agencies and business owners — **CRM + AI Brain + Agent Workforce.**

> **Current state: data layer foundation only.**
> This repo currently contains the CRM data-model migration contract: the four
> core tables (Client, Campaign, Lead, FunnelStage), rollback-safe migrations,
> a seed/verify script, and basic CRUD. The dashboard, AI agents, integrations,
> and social posting are **not** built yet — they layer on top of this.

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
| `npm run db:reset` | rollback → migrate → seed |
| `npm start` / `npm run dev` | Run the CRUD API (`dev` = watch mode) |
| `npm test` | Run the data-contract test suite (in-memory SQLite) |
| `npm run typecheck` | `tsc --noEmit` |

## Layout

```
src/
  domain/        funnel definition (source of truth) + row types
  db/            knex connection, migrations, migrate runner, seed/verify
  repositories/  model layer: BaseRepository + Client/Campaign/Lead/FunnelStage
  http/          Express app + CRUD routes
knexfile.ts      dev=SQLite, test=SQLite(:memory:), production=PostgreSQL
docs/DATA_MODEL.md   full setup plan, schema, indexes, and funnel notes
```

**Read `docs/DATA_MODEL.md`** for the database setup plan, schema, index
rationale, rollback-safety notes, and how the data model supports the funnel.

## Stack

Node + TypeScript · Knex (migrations + query builder) · Express · SQLite (dev) / PostgreSQL (prod).

## Roles

Leoz = CEO/Product Owner · Hermes = PM · Claude Code = Senior Dev · Codex = QA.
