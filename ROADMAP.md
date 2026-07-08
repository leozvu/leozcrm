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
M8 — Real Integration Publishing ........... 🚧 In Progress
  M8A — Email Publishing (completed)
  M8B — Facebook + Instagram Publishing (completed — local code PASS; live Meta app verification joins the deployment gate)
  M8C — TikTok Publishing (deferred)
  M8D — AI Media Generation (deferred)
M9 — Task Engine .......................... ✅ Completed
M10 — MVP Launch & Client Onboarding ........ 🚧 In Progress
  Local code status: PASS (npm test 159/159, typecheck clean)
  Deployment readiness: BLOCKED

<!-- Upload blocker evidence in repo artifacts when resolved. -->

M10 Deployment Gate (must close before M10 can move to PASS):
- PostgreSQL instance provisioned with correct env.
- `npm run db:smoke:pg` executed against real PostgreSQL and recorded.
- Live pilot verification executed: deploy app, POST /onboarding, and verify pilot tenant flows through campaign/lead/task/brief/recommendation on real base URL.
- Evidence captured: base URL, pilot client_id, `/ready` result, and pass/fail table.

Post-M10 candidates:
- M8C: TikTok Publishing
- Monitoring/alerting expansion
- Roadmap scope additions require Leoz approval per GOVERNANCE.md.

M8B note (2026-07-08): built as the sanctioned post-M10 candidate while the
deployment gate (live pilot verification) remains ops-blocked. Local code is
PASS (193/193 tests, typecheck clean); end-to-end verification against a real
Meta app/Page/IG account is recorded alongside the M10 deployment-gate
evidence when infrastructure is available.

Sequence notes:
- M2 is the critical path: it unlocks M3, M4, M5, and M6.
- M7 is intentionally staged into A/B/C so safety work surfaces incrementally.
- M9 passes QA; task lifecycle is stable and audit-ordered.
- M10 is the crux milestone. Postgres + live pilot verification are the remaining blockers.
- No further feature milestones should start until deployment gate is closed.
