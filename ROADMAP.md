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

M5 — Dashboard UI ...................... ⏳ After M2
  - Frontend shell consuming KPI API
  - Funnel visualization
  - Lead list and stage movement views

M6 — Integrations (Placeholder) ......... ⏳ After M2
  - Facebook, TikTok, Instagram, email, AI video/image stubs
  - Safe no-op adapters; extend to real publishing later

M7 — Production Hardening ............... ⏳ Parallel after M2
  - Auth + tenant access control
  - HTTP contract tests (bad IDs, cross-client, 500 prevention)
  - Request validation (email/UUID shapes, numeric bounds, enums)
  - Repository update hardening (ownership reassignment rules)
  - Postgres migrate/seed/rollback smoke test

---

Sequence notes:
- M2 is the critical path: it unlocks M3, M5, and M6.
- M7 is intentionally staged; data integrity is sound, but external exposure needs guardrails.
- Recommendation system can build on top of M3 or run parallel to M5 once M2 is done.
