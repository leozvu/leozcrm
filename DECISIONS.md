# LeozOps AI — Decisions Log

Format:
- Date: YYYY-MM-DD
- Decision: What we decided
- Context: Why it came up
- Rationale: Why this option
- Alternatives considered
- Owner: who made / owns the decision

---

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
