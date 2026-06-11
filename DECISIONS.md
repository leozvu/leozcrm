# LeozOps AI — Decisions Log

Format:
- Date: YYYY-MM-DD
- Decision: What we decided
- Context: Why it came up
- Rationale: Why this option
- Alternatives considered
- Owner: who made / owns the decision

---

2026-06-11 — Milestone #7 outcome: treat as complete (conditional)
Decision: M7 feature work is complete and QA-passed; blocked only by inability to obtain a PostgreSQL target in this environment.
Context: Codex returned PASS WITH BLOCKER; blocker is missing PostgreSQL runtime, not code quality or test failure.
Rationale: The PostgreSQL smoke was an environment-validation item, not a completed feature. Blocking product/value progress on infrastructure outside our control would stall M8/M9 unnecessarily. It is safer to convert this into a deployment gate: M7 is complete, and any environment with PostgreSQL must run migrate/seed/rollback before production exposure.
Alternatives considered:
  - Keep M7 blocked until a PostgreSQL instance is acquired (delays all later milestones).
  - Downgrade M7 and revert features (removes safety work already verified).
Owner: Hermes (PM)
Decision: Add bearer-token auth + per-client tenant isolation, repository-level input validation and ownership-reassignment guards, route contract tests, and an env-gated Postgres lifecycle smoke — all without a schema change.
Context: M7 (Production Hardening) must protect the surfaces M5/M6 exposed before external users/agents touch CRM data. There is no users/tenants table and the milestone forbids a schema redesign.
Rationale:
  - Auth without a schema change: a per-client token is `"<clientId>.<hmac(secret, clientId)>"`, so the authenticated "tenant" is the client itself; a separate admin key grants cross-tenant/internal access. The middleware mounts after `/health` and fails closed (missing/invalid token → 401), so there is no unauthenticated bypass.
  - Tenant isolation is enforced per route: explicit client ids (query `?clientId=`, `/clients/:id`, create-body `client_id`) → 403 on mismatch; resource lookups (`/campaigns/:id`, `/leads/:id`) → 404 on cross-tenant so existence is not leaked; list routes auto-scope to the caller's client. Listing all clients and the dashboard picker are admin-only.
  - Validation lives in the repositories (the one choke point both HTTP and programmatic callers share), so malformed input is a clean 400 and never reaches the DB as a 500. Ownership reassignment (changing a campaign/lead `client_id` on update) is blocked with a 409.
  - To drive CRUD route contract tests against a seeded DB, the clients/campaigns/leads/funnel-stages routers were converted to the same injectable factory pattern already used by metrics/brief/recommendations/dashboard. This was necessary: previously those routers always used the process-wide singletons, so route tests could not bind them to an in-memory DB.
  - Postgres parity is proven by an env-gated `db:smoke:pg` (migrate → seed+verify → rollback+verify-dropped). It skips cleanly when no PG is configured; it was not executed end-to-end here (no PostgreSQL/Docker available in this environment) and is run by QA against a real instance.
Alternatives considered:
  - A full users/sessions/roles schema (rejected: explicit "no schema redesign unless required"; per-client tokens meet the isolation requirement now).
  - A single shared API key with no per-tenant scoping (rejected: does not satisfy "tenant data fully isolated per client_id").
  - Validation in routes only (rejected: leaves programmatic/composed callers unguarded; repositories are the shared boundary).
Owner: Claude Code (Senior Dev), within the M7 scope.

2026-06-10 — Milestone #2 scope
Decision: Next milestone is the KPI read layer (metrics API), not dashboard UI, CEO Brief Agent, or QA hardening.
Context: CRM foundation passed final QA (Codex review). Multiple valid next steps existed.
Rationale: The KPI read layer is the highest-leverage dependency. It enables the CEO Brief Agent (M3), dashboard UI (M5), and integrations (M6) without schema changes. Hardening (M7) is necessary before external exposure but does not unblock product value.
Alternatives considered:
  - Start with CEO Brief Agent (would require inventing ad hoc queries without a stable metrics contract)
  - Start with dashboard UI (visual layer before a stable data contract invites rework)
  - Start with QA hardening (important, but not the next value milestone)
Owner: Hermes (PM)

---

2026-06-10 — Milestone #3 scope: Daily CEO Brief Engine v0
Decision: Build the Daily CEO Brief Engine before dashboard UI, integrations, and the recommendation system.
Context: Milestone #2 (KPI Read Layer) passed QA. Multiple next steps were valid.
Rationale: The CEO Brief is the first product value that converts data into executive action. Building it next validates the KPI API in real business logic before heavier UI/integration work. Dashboard and integrations depend on a stable brief contract; the recommendation system should follow after brief output is validated.
Alternatives considered:
  - Start with Recommendation System (needs validated brief output to be useful)
  - Start with Dashboard UI (visual layer before stable agent contract invites rework)
  - Start with Integrations (stubs are lower value without a driver like the brief)
Owner: Hermes (PM)

---

2026-06-11 — Milestone #6 scope: Integration Adapters — Placeholder
Decision: Next milestone is a safe no-op integration adapter layer, not production publishing or hardening.
Context: Milestone #5 passed QA.
Rationale: A defined integration surface is required before later milestones can legally publish or automate external actions. Keeping these adapters placeholder-only preserves safety while establishing the extension points for real integrations.
Alternatives considered:
  - Skip placeholders and build live integrations directly (higher external risk and harder to review cleanly).
  - Advance to production hardening first (delays visible product integration surface).
Owner: Hermes (PM)

---

2026-06-11 — Milestone #6 implementation: placeholder adapter architecture
Decision: Add a new `src/integrations/` module — an `IntegrationAdapter` contract in `domain/integration.ts`, a `PlaceholderAdapter` base, five concrete channel adapters (Facebook, TikTok, Instagram, Email, AI Media), and an in-memory `IntegrationRegistry` singleton — surfaced through a read-only `GET /integrations` route. No execute/publish HTTP endpoint is exposed.
Context: M6 requires a connector surface that mounts in the system but performs no external action. The existing layers (domain/repositories/services/http) had no home for outbound-channel concerns.
Rationale:
  - The no-op guarantee is pinned at the type level (`mode: 'placeholder'`, result `performed: false` / `no_op: true`), mirroring how M4 pins `advisory_only: true`. Adapters import nothing that can reach the network or DB, so "no external calls / no side effects" is structural, not just convention — and is proven by a test that arms every egress primitive (fetch/http/https/net) to throw.
  - The registry plays the read-model role a repository plays for CRUD routes, so the route stays thin and needs no service or DB connection (it mounts unconditionally in `createApp`).
  - The HTTP surface is metadata-only (list + per-channel info). Deliberately no action endpoint, so the API cannot trigger even a no-op publish; no-op `execute` is exercised in unit tests only.
  - No schema change, no migration, no credentials/OAuth, no background jobs.
Alternatives considered:
  - Put adapters under `services/` (they are not orchestration over repositories; a dedicated module reads cleaner and isolates the future-external concern).
  - Expose a no-op `execute`/dry-run endpoint (rejected: reads like a publish surface and invites misuse before M7 safety rails exist).
  - One file per adapter (rejected: the five are trivial specialisations of one base; a single `channels.ts` keeps them cohesive with the registry as the single source of truth).
Owner: Claude Code (Senior Dev), within the M6 scope approved above.

2026-06-10 — Milestone #4 scope: Recommendation System v0
Decision: Build Recommendation System v0 before Dashboard UI, Integrations, and Production Hardening.
Context: Milestone #3 (Daily CEO Brief Engine) passed QA. Product now has stable data, KPI, and brief contracts.
Rationale: Recommendations are the first true AI Brain behavior: moving from reporting to action guidance. This closes the MVP loop described in PRODUCT.md and CHECKLIST.md. Keeping it advisory-only preserves safety while delivering value. Doing it before Dashboard/Integrations ensures later consumers build around a stable recommendation contract instead of forcing rework.
Alternatives considered:
  - Start with Dashboard UI (visual layer before stable agent contract invites rework)
  - Start with Integrations (stubs are low value without a driver triggering them)
  - Start with Production Hardening (necessary, but different from next product value milestone)
Owner: Hermes (PM)
