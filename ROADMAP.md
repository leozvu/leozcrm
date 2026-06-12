# LeozOps AI — Roadmap

Legend:
- Milestone = internal development phase ending in a verified, releasable increment
- Status: ⏳ Planned · 🚧 In Progress · ✅ Completed · ⏸️ Paused

---

M1 — CRM Foundation .................... ✅ Completed
  - Database schema + migrations
  - Client, campaign, lead, funnel_stage tables
  - Repositories with validation and FK integrity
  - Seed data and verification
  - QA sign-off: PASS

M2 — KPI Read Layer .................... ✅ Completed
  - Repository methods: stage counts, conversion rates, lead volumes, campaign attribution, trends
  - Typed metrics API routes scoped per client
  - Integration tests against seed data
  - Outcome: unblocks CEO Brief Agent and dashboard UI

M3 — CEO Brief Engine ................... ✅ Completed
  - Brief domain model and output contract (JSON/text)
  - BriefService consuming KPI endpoints
  - Deterministic brief accuracy tests

M4 — Recommendation System .............. ✅ Completed
  - Rules/heuristics based on funnel KPIs
  - Recommendation API
  - Advisory-only mode (no automated actions)
  - QA sign-off: PASS

M5 — Executive Dashboard & Team Workspace .. ✅ Completed
  - Single-pane funnel dashboard consuming KPI API
  - CEO Brief viewer and recommendation panels
  - Lead list and stage movement interfaces
  - QA sign-off: PASS

M6 — Integration Adapters (Placeholder) .... ✅ Completed
  - Facebook, TikTok, Instagram, email, AI video/image stubs
  - Safe no-op adapters; extend to real publishing later
  - QA sign-off: PASS

M7 — Production Hardening .................. ✅ Completed (conditional)
  - Auth + tenant access control
  - HTTP contract tests (bad IDs, cross-client, 500 prevention)
  - Request validation (email/UUID shapes, numeric bounds, enums)
  - Repository update hardening (ownership reassignment rules)
  - Postgres verification pending as deployment gate

M8 — Real Integration Publishing ............ 🚧 In Progress
  M8A — Email Publishing (completed)
  M8B — Facebook + Instagram Publishing (deferred)
  M8C — TikTok Publishing (deferred)
  M8D — AI Media Generation (deferred)
  - Replace placeholder adapters with live connections
  - Recommendations -> real external action -> real funnel data
  - Authorization + spend guardrails for external actions

M9 — Task Engine .......................... 🚧 In Progress
  - Task persistence via Task table + migration
  - Tenant-scoped task create/update/complete
  - Auth + validation hardening for task workflows
  - Testability: in-memory + Postgres parity

M10 — MVP Launch & Client Onboarding ....... ⏳ Planned
  - First paying client or pilot goes live
  - Onboarding and early-retention feedback loop
  - Production scaling and support readiness

---
Sequence notes:
- M2 is the critical path: it unlocks M3, M4, M5, and M6.
- M7 is intentionally staged into A/B/C so safety work surfaces incrementally.
- M5 provides the operational surface that validates all prior API contracts visually.
- M8 depends on M6 architecture and M7 safety rails.
M9 depends on Task Engine workflows being stable before adding autonomous execution.
M10 still gates on M5 through M9 being production-like stable; M9 now scopes to Task Engine completion rather than full automated actions.
- Recommendation system can build on top of M3 or run parallel to M5 once M2 is done.
