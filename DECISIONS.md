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
