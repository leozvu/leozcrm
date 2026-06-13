# LeozOps AI — Decisions Log

Format:
- Date: YYYY-MM-DD
- Decision: What we decided
- Context: Why it came up
- Rationale: Why this option
- Alternatives considered
- Owner: who made / owns the decision

---

2026-06-12 — Milestone #10 implementation: client onboarding workflow + readiness probe
Decision: Implement the codeable M10 launch surface with no schema change: an `OnboardingService` + admin-only `POST /onboarding` route that provisions a tenant, issues its per-client API token, and reports platform readiness; a public `GET /ready` readiness probe; and an `npm run onboard` CLI for provisioning/verifying the first pilot tenant on a deployed database. Plus `docs/PILOT_RUNBOOK.md` for launch/support.
Context: M9 passed QA; M10 (MVP Launch & Client Onboarding) is current. Much of M10 is deployment/ops (hosting, real Postgres, staffing), which lives outside the codebase. The implementable deliverables are the onboarding workflow, monitoring readiness, and the pilot runbook — built strictly on existing patterns.
Rationale:
  - Reuse, no new schema: onboarding creates a `client` via `ClientRepository` (which already validates email shape), keys the tenant token off the M7 `<clientId>.<hmac>` scheme via `signClientToken`, and reads global funnel-stage reference data for readiness. No new tables, dependencies, frameworks, or auth model.
  - Layering kept clean: the service is http-free and does NOT mint the token (token signing is an auth/http concern). The `/onboarding` route and the `onboard` CLI sign it at the boundary from the same `AUTH_SECRET` the middleware verifies; the route returns `201 { client, api_token, readiness }`, or `503 not_configured` when no secret is set (never an unverifiable token).
  - Admin-only, fail-safe: provisioning a new tenant crosses the tenant boundary, so it is admin-only (same rule as `POST /clients`). Bad input is a clean `400`/`409` (missing fields `invalid_onboarding`, malformed email `invalid_email`, duplicate email `client_exists`) — never a 500.
  - Real monitoring: `/ready` (public, like `/health`) verifies DB reachability and that funnel stages are seeded — distinguishing live/not-ready (`503`) for load balancers/uptime checks. `/health` stays a pure liveness probe.
  - CLI parity for the pilot: `npm run onboard` runs the same service against the deployed DB and prints the tenant token + readiness, mirroring `server.ts` secret resolution (production must set `AUTH_SECRET`), so an operator can create AND verify the first live tenant.
  - Coverage: service tests (provisioning, readiness, validation, duplicate, unseeded-DB readiness) and HTTP route tests (public probes, admin-only, issued token actually authenticates and is tenant-scoped, malformed/duplicate input) — added to the test script. typecheck clean; all suites green.
Alternatives considered:
  - Put token minting in the service (rejected: would force a `services → http/auth` import, inverting the layering; minting at the boundary keeps the service http-free).
  - Per-tenant funnel-stage seeding during onboarding (rejected: funnel stages are global reference data seeded once at deploy; onboarding verifies readiness rather than reseeding).
  - A users/identity table for onboarding (rejected: out of scope — the M7 per-client token model already makes a client its own tenant).
Scope: implementation of M10's codeable deliverables only — no hosting/deploy automation, no billing, no new schema, no self-serve signup UI.
Owner: Claude Code (Senior Dev), within the M10 scope.

2026-06-12 — M9 remediation complete: task validation and deterministic audit ordering
Decision: M9 Task Engine now passes QA after adding UUID-shape/gating validation before DB access, audit-note type/length guards, monotonic `seq` on `task_status_events`, composite unique order key `uq_task_events_task_seq`, and corresponding route/task+events coverage.
Context: M9 shipped initially with malformed input reaching the repository boundary and non-guaranteed audit ordering when rapid transitions shared millisecond timestamps. After review, the issue was patched and QA passed; `task_status_events` no longer relies on timestamp tie-breaking for read order.
Rationale:
- Front-door validation in the repository means malformed request values return 400 and never touch the DB.
- A 1-based monotonic `seq` per task makes the audit trail authoritative without depending on DB row-id insertion guarantees.
- Backward compatibility preserved: migration added columns with app-side assignment (no schema rewrite).
Alternatives considered:
- Rely only on timestamp + row-id ordering (no seq): rejected because it kept display order DB-dependent.
- Use timestamps alone with retry hacks: rejected because explicit sequence is simpler and deterministic.
Owner: Claude Code / Codex / Hermes (M9 QA loop)

2026-06-12 — M10 sequencing: client onboarding and pilot deployment as next highest-leverage milestone after M9
Decision: Advance to M10 MVP Launch & Client Onboarding immediately after M9 passes.
Context: M5-M9 together provide dashboard, integrations, publishing, task lifecycle, auth, tenant isolation, and deterministic audit. The product is mature enough for an internal/external pilot; further feature milestones before deployment would delay real-world validation.
Rationale:
  - Operationalizing an existing, QA-complete system into a hosted pilot generates real usage signals faster than expanding scope.
  - Deployment itself exposes infrastructure/ops risk (Postgres runtime, hosting, monitoring), which is highest-value to resolve now.
  - Subsequent improvements (social channels, advanced workspace views, weekly brief) are better informed by pilot feedback.
Alternatives considered:
  - Extend feature surface before deploying: lower leverage because we lack live usage evidence.
  - Rewrite UI/frontend before launch: rejected because current dashboard is functional and Sprint priority is deployment-validated progress.
Owner: Hermes (PM)

2026-06-11 — Task persistence decision: dedicated Task table
Decision: Persist tasks using a new Task table and migration.
Context: Task is a first-class workflow object for Egoric and AIM.
Rationale: A dedicated table preserves clean domain semantics, supports richer fields naturally, and avoids overloading existing entities.
Alternatives considered:
  - Co-opt an existing table (leads/campaigns): rejected because it collapses distinct workflows and adds rework later.
Owner: Hermes (PM)

2026-06-11 — Milestone sequencing after M8A
Decision: Continue Social Publishing path (M8B/C/D) before Task Engine or Approval Workflow.
Context: Gains from M8A already show an end-to-end publish path; social/AI publishing is the next critical path to validate the recommendations->action->data loop across providers.
Rationale: Publishing has higher current leverage because it proves the system can execute and measure external actions, which Task/Approval layers will later govern.
Alternatives considered:
  - Switch to Task Engine/Approval Workflow first (delays validating live-publishing behavior).
  - Client/Team Workspace now (valuable but secondary to actionable publish flow).
  - CRM Sync (reduces long-term manual import cost but is not the current highest-value blocker).
Owner: Hermes (PM)

2026-06-11 — Milestone sequencing revision: defer social/AI publishing
Decision: Defer M8B/M8C/M8D and make M9 Task Engine the current highest-value milestone.
Context: Business-value reassessment ranks Task Engine above additional live social channels for Egoric and AIM.
Rationale: Operationalizing recommendation outputs into tracked tasks creates more immediate agency workflow value than expanding publisher surface area.
Alternatives considered:
  - Continue M8B immediately (higher external integration risk with lower current workflow leverage).
  - Approval Workflow or Client/Team Workspace now (valuable, but dependent on task records).
Owner: Hermes (PM)

2026-06-11 — Milestone #8 phase split: social/AI publishing split into separate phases
Decision: Split remaining live integration publishing into separate milestones by provider ecosystem.
Context: Different social platforms have different auth, sandbox, and compliance requirements.
Rationale: Isolating channels reduces QA blast radius, review complexity, and integration risk.
Alternatives considered:
  - Build all remaining channels in one milestone (larger QA surface).
  - Keep remainder as a single planned phase (harder to sequence risk).
Owner: Hermes (PM)

2026-06-11 — Milestone #8 scope reduction: email-first publishing
Decision: Implement live integration publishing in phases, starting with Email only.
Context: To reduce risk and review complexity, full social/AI publishing is deferred.
Rationale: Email is the lowest-risk live channel to validate auth + spend guardrails, failure handling, and end-to-end recommendations -> publish -> data loop before expanding to other providers.
Alternatives considered:
  - Build all channels at once (higher integration and review risk).
  - Keep placeholders longer (delays product-value validation).
Owner: Hermes (PM)

2026-06-11 — Milestone #8 scope: Real Integration Publishing
Decision: Build real external publishing only after placeholder architecture and safety rails exist.
Context: M7 is complete with Postgres smoke left as a deployment gate.
Rationale: M7 provides the required guardrails. M8 closes the end-to-end loop from recommendation to real action and makes the product value testable in actual environments.
Alternatives considered:
  - Defer M8 and add more hardening (delays validation of the recommendation-to-action loop).
  - Skip placeholder layer and build live integrations directly (harder to review safely).
Owner: Hermes (PM)

---
2026-06-11 — Milestone #8A implementation: live email publishing (Resend)
Decision: Make the email channel a live Resend-backed adapter behind an explicitly-invoked, tenant-scoped, guardrailed publish endpoint; keep social/AI media as placeholders; no schema change.
Context: M8A replaces the email placeholder with real sending while preserving the M6 integration boundary and M7 auth/tenant rules.
Rationale:
  - Boundary preserved: `execute()` stays a no-op acknowledgement for EVERY adapter (it never sends). The integration contract broadened minimally — `mode: 'placeholder' | 'live'` and `advisory_only: boolean` — so email reports `mode: 'live'`/`advisory_only: false` while social/AI stay placeholder/advisory. Real delivery is a separate path (`ResendEmailAdapter.sendOnce` → `EmailPublishService`), reachable only via `POST /integrations/email/send`.
  - No autonomous sending: the recommendation engine is unchanged and never calls the publisher (proven by a test that hits `/recommendations` and asserts zero provider calls). A send may *reference* a recommendation (`recommendation_code`) for traceability, but only an operator/tenant call triggers it.
  - Auth + tenant isolation reused: the publish route sits behind the M7 `authenticate` middleware and calls `enforceClientScope(clientId)`; spend guardrails are keyed per `client_id` so tenants cannot spend each other's budget.
  - Spend guardrails (in-memory, no schema): per-tenant daily cap, rolling-60s rate limit, and a stop-on-failure circuit breaker (opens after N consecutive provider failures). The clock is injectable for deterministic tests.
  - Provider edge: the Resend call goes through the built-in `fetch` (no new dependency, no SDK) via an injectable `EmailTransport`, with a per-attempt AbortController timeout. Retry/backoff (exponential) lives in the publish service; tests inject a sandbox transport + no-op sleep so no real network or delay occurs.
  - Failures are explicit, not silent: each reason maps to a precise status (400/429/502/503/504), sets `Retry-After` for cap/rate/circuit, and is logged.
Alternatives considered:
  - Add the `resend` SDK (rejected: an injectable `fetch` transport is dependency-free and far easier to sandbox in tests).
  - Persist sends / guard counters in a new table (rejected: "no schema redesign"; in-memory per-tenant counters meet the M8A guardrail requirement — durable accounting can come with M9/persistence later).
  - Let recommendations trigger sends (rejected: violates "no autonomous sending"; publishing stays explicit).
Owner: Claude Code (Senior Dev), within the M8A scope.

---
2026-06-11 — Milestone #8A remediation: per-attempt guard accounting, sender enforcement, bounded retries
Decision: Resolve the Codex M8A FAIL by (a) checking the spend/rate/circuit guard and reserving one unit BEFORE every provider attempt (retries included), recording each failed attempt toward the circuit; (b) requiring a valid `EMAIL_FROM` for live sending and rejecting caller-provided `from` unless it is on an allowlist; (c) hard-bounding retries.
Context: The first M8A pass guarded once per logical publish, so one publish with N retries could make N+1 provider calls under a single unit and count one circuit failure; the caller could also set an arbitrary `from`, and `EMAIL_MAX_RETRIES` was unbounded.
Rationale:
  - Per-attempt accounting: the retry loop now calls `guard.check` → `guard.reserve` before each `sendOnce` and `guard.recordFailure` after each failure. A logical publish therefore can never exceed the daily cap, rate limit, or circuit breaker; a mid-retry block stops further provider calls and reports the last provider failure.
  - Sender identity: `isConfigured()` now also requires a syntactically valid `EMAIL_FROM` (so a missing/invalid sender returns `not_configured` before any call); the adapter refuses to send with an empty/invalid sender. Caller `from` is rejected by default and only honoured when it exactly matches `EMAIL_ALLOWED_FROM`.
  - Bounded retries: `maxRetries` is clamped to `[0, MAX_RETRIES_CEILING=5]` (default 2) in the service constructor — env or injected config cannot multiply external calls without limit — and each backoff wait is capped at `DEFAULT_BACKOFF_MAX_MS`.
  - Test realism: added tests proving per-attempt quota/rate/circuit consumption, that caps bound the number of provider calls under retries, sender rejection before any provider call, retry clamping at the ceiling, and the explicit Resend request/credential contract (adapter request shape + `fetchEmailTransport`'s HTTP call) without real network. The sandbox-double strategy is now documented in the test headers; real end-to-end remains a deployment gate.
Scope: remediation only — no new channels, no social/AI publishing, no schema change, no autonomous sending, M8B not started.
Owner: Claude Code (Senior Dev).

Decision: Add bearer-token auth + per-client tenant isolation
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
  - Tenant isolation is enforced per route: explicit client ids (query `?clientId=`, `/clients/:id`, create-body `client_id`) → 403 on mismatch; resource lookups (`/campaigns/:id`, `/leads/:id`) → 404 on cross-tenant so existence is not leaked; list routes auto-scope to the caller's client; listing all clients and the dashboard picker are admin-only.
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

---
2026-06-10 — Milestone #4 scope: Recommendation System v0
Decision: Build Recommendation System v0 before Dashboard UI, Integrations, and Production Hardening.
Context: Milestone #3 (Daily CEO Brief Engine) passed QA. Product now has stable data, KPI, and brief contracts.
Rationale: Recommendations are the first true AI Brain behavior: moving from reporting to action guidance. This closes the MVP loop described in PRODUCT.md and CHECKLIST.md. Keeping it advisory-only preserves safety while delivering value. Doing it before Dashboard/Integrations ensures later consumers build around a stable recommendation contract instead of forcing rework.
Alternatives considered:
  - Start with Dashboard UI (visual layer before stable agent contract invites rework)
  - Start with Integrations (stubs are low value without a driver triggering them)
  - Start with Production Hardening (necessary, but different from next product value milestone)
Owner: Hermes (PM)
