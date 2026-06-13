# LeozOps AI — Pilot & Support Runbook (M10)

Operational runbook for the MVP launch: how to stand up the platform, onboard
the first pilot tenant, monitor it, and handle support/escalation. It documents
only what exists in this repository — no new infrastructure is assumed.

---

## 1. Prerequisites

- Node.js + npm.
- A database:
  - **Pilot/prod:** PostgreSQL. Set `DATABASE_URL` (or `PGHOST/PGUSER/PGPASSWORD/PGDATABASE`) and `NODE_ENV=production`.
  - **Local/dev:** SQLite (zero setup) is the default.
- **`AUTH_SECRET`** — required in production (the app and the onboarding CLI both
  fail loud without it, because tenant tokens are signed with it). Set
  **`ADMIN_API_KEY`** for the operator/admin caller.

## 2. Deploy / bring-up

```bash
npm install
# Production: confirm Postgres is reachable and migrations are reversible there.
npm run db:smoke:pg        # env-gated; migrate → seed → rollback verification
npm run migrate            # apply schema
npm run seed               # seed the 9 canonical funnel stages (+ demo data in dev)
NODE_ENV=production AUTH_SECRET=… ADMIN_API_KEY=… npm start
```

**`npm run db:smoke:pg` is the deployment gate** — it must pass against the real
PostgreSQL instance before exposing the service. See `docs/POSTGRES_SMOKE.md`.

## 3. Monitoring readiness

Two public, unauthenticated probes (safe for load balancers / uptime monitors):

| Probe | Meaning | Healthy |
|-------|---------|---------|
| `GET /health` | Liveness — the process is up. | `200 { ok: true }` |
| `GET /ready` | Readiness — DB reachable **and** funnel stages seeded. | `200 { ok: true, checks: { db: "ok", funnel_stages: 9, funnel_ready: true } }` |

`/ready` returns **`503`** when the database is unreachable (`checks.db:
"unreachable"`) or the funnel stages are not seeded (`funnel_ready: false`). A
`503` with `funnel_ready: false` means **run `npm run seed`** on that database.

## 4. Onboard the pilot tenant

Onboarding creates the client/tenant, issues its per-client API token, and
reports platform readiness. It is **admin-only**. Two equivalent paths:

**CLI (operator, on the deployed DB):**

```bash
AUTH_SECRET=… npm run onboard -- --name "Pilot Co" --email pilot@acme.com --company Acme
# prints: client_id, name, email, api_token, readiness
```

**HTTP (admin caller):**

```bash
curl -sX POST "$BASE_URL/onboarding" \
  -H "authorization: Bearer $ADMIN_API_KEY" \
  -H "content-type: application/json" \
  -d '{"name":"Pilot Co","email":"pilot@acme.com","company":"Acme"}'
# → 201 { "client": {…}, "api_token": "<clientId>.<hmac>", "readiness": {…} }
```

Hand the tenant its `api_token`; it authenticates every request as
`Authorization: Bearer <api_token>` (or `x-api-key: <api_token>`). The token is
scoped to that one client — it cannot read or write another tenant's data.

Failure modes (all clean, never a 500):
- missing `name`/`email` → `400 invalid_onboarding`
- malformed email → `400 invalid_email`
- email already onboarded → `409 client_exists`
- non-admin caller → `403 forbidden_admin`; unauthenticated → `401`
- `AUTH_SECRET` not configured → `503 not_configured`

## 5. Verify the tenant end to end

Using the tenant's `api_token` (set `T=<api_token>`):

```bash
curl -H "authorization: Bearer $T" "$BASE_URL/clients/<clientId>"        # its own record
curl -H "authorization: Bearer $T" -X POST "$BASE_URL/campaigns" -d '…'   # create a campaign
curl -H "authorization: Bearer $T" -X POST "$BASE_URL/leads" -d '…'       # create a lead
curl -H "authorization: Bearer $T" "$BASE_URL/brief?clientId=<clientId>"          # daily brief
curl -H "authorization: Bearer $T" "$BASE_URL/recommendations?clientId=<clientId>" # advisory recs
curl -H "authorization: Bearer $T" -X POST "$BASE_URL/tasks" -d '…'        # task lifecycle
```

A tenant that can create campaigns/leads/tasks and read its brief +
recommendations on the live instance meets the M10 launch criterion.

## 6. Support & escalation

| Symptom | First check | Action |
|---------|-------------|--------|
| All requests `401` | `AUTH_SECRET`/`ADMIN_API_KEY` set? | Configure secrets; tokens are signed with `AUTH_SECRET`. |
| `/ready` `503`, `db: "unreachable"` | DB connectivity / `DATABASE_URL` | Restore DB; the app is stateless and recovers. |
| `/ready` `503`, `funnel_ready: false` | Funnel stages seeded? | `npm run seed`. |
| Tenant token rejected (`401 invalid_token`) | Same `AUTH_SECRET` as when minted? | Re-issue via onboarding under the current secret. |
| Onboarding `409 client_exists` | Tenant already onboarded | Reuse the existing client; do not double-create. |

Escalation: data-integrity or cross-tenant concerns → Senior Dev (Claude Code);
launch/scope decisions → PM (Hermes) → CEO (Leoz). Roll back a bad migration
batch with `npm run migrate:rollback` (every migration is reversible).
