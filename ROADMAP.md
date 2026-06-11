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

M4 — Recommendation System .............. 🚧 In Progress
  - Rules/heuristics based on funnel KPIs
  - Recommendation API
  - Advisory-only mode (no automated actions)

M5 — Executive Dashboard & Team Workspace .. ⏳ Planned
  - Single-pane funnel dashboard consuming KPI API
  - CEO Brief viewer and recommendation panels
  - Lead list and stage movement interfaces

M6 — Integration Adapters (Placeholder) .... ⏳ Planned
  - Facebook, TikTok, Instagram, email, AI video/image stubs
  - Safe no-op adapters; extend to real publishing later

M7 — Production Hardening .................. ⏳ Planned
  - Auth + tenant access control
  - HTTP contract tests (bad IDs, cross-client, 500 prevention)
  - Request validation (email/UUID shapes, numeric bounds, enums)
  - Repository update hardening (ownership reassignment rules)
  - Postgres migrate/seed/rollback smoke test

M8 — Real Integration Publishing ............ ⏳ Planned
  - Replace placeholders with live connections
  - Social, email, CRM sync adapters
  - Recommendation → action → real funnel data loop

M9 — Agent Workforce & Automated Actions ... ⏳ Planned
  - AI Brain executes validated recommendations
  - Lead qualification, campaign launchers, nurture sequences
  - Spend and safety guards around autonomous actions

M10 — MVP Launch & Client Onboarding ....... ⏳ Planned
  - First paying client or pilot goes live
  - Onboarding and early-retention feedback loop
  - Production scaling and support readiness

---
Sequence notes:
- M2 is the critical path: it unlocks M3, M4, M5, and M6.
- M7 is intentionally staged; data integrity is sound, but external exposure needs guardrails.
- M5 provides the operational surface that validates all prior API contracts visually.
- M8 depends on M6 architecture and M7 safety rails.
- M9 requires M7 authorization and M8 live integrations.
- M10 gates on M5 through M9 being stable in a production-like environment.
- Recommendation system can build on top of M3 or run parallel to M5 once M2 is done.
