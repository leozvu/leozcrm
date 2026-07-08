# LeozOps AI — Roadmap

Legend:
- Milestone = internal development phase ending in a verified, releasable increment
- Status: ⏳ Planned · 🚧 In Progress · ✅ Completed · ⏸️ Paused

---

M1 — CRM Foundation .................... ✅ Completed
M2 — KPI Read Layer .................... ✅ Completed
M3 — CEO Brief Engine ................... ✅ Completed
M4 — Recommendation System .............. ✅ Completed
M5 — Executive Dashboard & Team Workspace .. ✅ Completed
M6 — Integration Adapters — Placeholder .... ✅ Completed
M7 — Production Hardening ................. ✅ Completed
M8 — Real Integration Publishing ........... ✅ Completed (except M8D, deferred by design)
  M8A — Email Publishing (completed)
  M8B — Facebook + Instagram Publishing (completed — local code PASS; live Meta app verification joins the deployment gate)
  M8C — TikTok Publishing (completed — local code PASS; live TikTok app verification joins the deployment gate)
  M8D — AI Media Generation (deferred — blocked on a CEO product decision: which AI provider + budget; see DECISIONS.md 2026-07-08)
M9 — Task Engine .......................... ✅ Completed
M10 — MVP Launch & Client Onboarding ........ 🚧 Ready to deploy (one ops step remaining)
  Local code status: PASS (npm test 206/206, typecheck clean)
  Deployment readiness: VERIFIED on real PostgreSQL 16 in production mode — see docs/DEPLOYMENT_EVIDENCE.md

M10 Deployment Gate status (evidence in docs/DEPLOYMENT_EVIDENCE.md):
- PostgreSQL smoke: PASS (Supabase 2026-06; re-confirmed 2026-07-08 on PG 16 incl. new migration).
- Full pilot flow (onboarding → campaign/lead/task/brief/recommendations):
  PASS 15/15 via `npm run verify:pilot` against a production-mode instance on
  real PostgreSQL. Repeatable with one command against any base URL.
- REMAINING (ops, not code): pick the public host, `docker compose up -d`
  (packaging included), run `npm run verify:pilot -- --base-url <public-url>`,
  and paste the evidence block into docs/DEPLOYMENT_EVIDENCE.md.

Post-M10 candidates:
- M8D: AI Media Generation (needs CEO provider/budget decision first)
- Monitoring/alerting expansion (structured request logging shipped 2026-07-08; alerting still open)
- Roadmap scope additions require Leoz approval per GOVERNANCE.md.

M8B/M8C note (2026-07-08): built as the sanctioned post-M10 candidates while
the final hosting step remains with ops (CEO approved continued development
2026-07-08). Local code is PASS (206/206 tests, typecheck clean); end-to-end
verification against real Meta/TikTok apps is recorded alongside the M10
deployment-gate evidence when live credentials are issued.

Sequence notes:
- M2 is the critical path: it unlocks M3, M4, M5, and M6.
- M7 is intentionally staged into A/B/C so safety work surfaces incrementally.
- M9 passes QA; task lifecycle is stable and audit-ordered.
- M10 is the crux milestone. All code-side gate work is done and verified on
  real PostgreSQL; the one remaining step is running verify:pilot on the
  chosen public host (an ops action + hosting decision, not development).
