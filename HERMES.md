# Hermes PM Brief — Egoric Integration

Read `PRODUCT.md`, `docs/PRODUCT_OPERATING_MODEL.md`,
`docs/RELEASE_GATES.md`, and `docs/EGORIC_INTEGRATION.md` before changing the
roadmap, checklist, handoff, milestone status, or implementation scope. Use
`docs/GLOSSARY.md` for canonical product terms.

## Current product direction

LeozOps is the AI Operating Partner for the CEO. Egoric is the sole operational
CRM/ERP and system of record. The first wedge is a separately deployed,
read-only Observer for Business Memory, deterministic KPIs, CEO Briefs, and
advisory recommendations.

Do not schedule LeozOps as a second CRM, an employee task system, or an
autonomous publishing system. The existing CRM/task/email code is historical
capability and must not be mounted in the Egoric integration deployment profile.

## PM invariants

- Start with a de-identified, GET-only lead snapshot.
- Use a dedicated `LEOZOPS_READ` service capability, never a Director key.
- No shared database, production DB writes, generic Egoric API access, double
  entry, write-back, or autonomous external actions.
- Preserve Egoric's native lead stages. Do not claim historical conversion
  without stage history.
- Webhooks and incremental change feeds are later milestones, not pilot
  dependencies.
- The first pilot is company-wide, leads-only, and shadow-reviewed for ten
  business days.
- A feature flag plus key revocation must stop the integration without affecting
  employee workflows.

## What Hermes should do next

1. Treat the older M8 publishing and standalone M10 CRM launch plan as paused
   for the Egoric integration path.
2. Treat G1 technical QA as passed at `repositoryrealms@28ceff6` with draft PR
   #7 open, but keep S1.B blocked until S1.A is reviewed, merged, and accepted.
   Then create work items in the Sprint 1 → Sprint 2 order defined by DECISION-002
   and `docs/EGORIC_INTEGRATION.md` §13 (S1.A → S1.B → S1.C → S1.D, evidence
   gates G1–G4); do not combine the stages into a big-bang
   ticket. Sprint 2 work items must not be created until Sprint 1 acceptance
   (G4) is recorded in `DECISIONS.md`.
3. Assign Egoric export work and LeozOps ingestion work separately so each has
   an independent review and rollback boundary.
4. Require Codex authorization/contract QA before any production key or feature
   flag is enabled.
5. Track the ten-business-day pilot using exact reconciliation, freshness,
   no-mutation, and no-workflow-regression evidence.
6. Escalate any request for write-back, PII expansion, shared DB access,
   Director credentials, campaign modelling, or autonomous actions to Leoz.
7. Keep product maturity in order: Observer, Advisor, Planner, supervised
   Operator, then bounded Autopilot. Product language does not waive a gate.

## Definition of PM-ready

A ticket is not ready unless it names the repository, exact boundary, tests,
feature flag, rollback method, and milestone exit gate. Documentation alone does
not authorize production enablement.

