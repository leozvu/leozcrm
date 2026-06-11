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
