LEOZOPS AI — PROJECT CHECKLIST
===============================

1. WHAT WE ARE BUILDING
-----------------------
An AI Operating Partner for agencies and business owners.
Three core pieces: CRM + AI Brain + Agent Workforce.
One end-to-end growth funnel: Traffic -> Attention -> Lead -> Qualification -> Nurture -> Conversion -> Activation -> Upsell -> Retention.

2. WHAT THE MVP LOOP SHOULD BE
-------------------------------
- Store leads and campaign data in a working CRM.
- Track movement through the funnel stages.
- Give the CEO a daily brief and recommendations.
- Let the team act on the brief inside the same system.
- Measure whether actions move the funnel metrics.
- Repeat and improve recommendations weekly.

3. WHAT CLAUDE CODE SHOULD BUILD FIRST
--------------------------------------
- Custom CRM foundation (database + schema).
- Client and campaign models/tables.
- Lead tracking with stage changes.
- KPI dashboard using real CRM data.
- Daily CEO Brief Agent that reads the dashboard.
- Recommendation system based on funnel data.
- Placeholder integration stubs for social/email/AI tools (no real posting).

4. WHAT CODEX SHOULD REVIEW FIRST
---------------------------------
- The CRM data model and migrations.
- Lead stage transition logic and edge cases.
- CEO Brief Agent output accuracy.
- Dashboard metrics and calculation correctness.
- Integration stub architecture (safe to extend later).
- Security basics: auth, input validation, access control.

5. WHAT DECISION LEOZ MUST MAKE AS CEO
---------------------------------------
- Pick the first paying client or internal test account to pilot the CRM.
- Define which funnel stages matter most in the first 30 days.
- Decide what "good enough" looks like for the MVP launch date.
- Choose whether recommendations are advisory only or can trigger automated actions.
- Set the threshold for moving from placeholder integrations to real publishing.

6. MILESTONE #2: KPI READ LAYER — PASS
----------------------------------------
Goal: Build the read-only metrics API that converts live CRM data into funnel KPIs.
Why now: CRM foundation passed QA; this layer unblocks both the CEO Brief Agent and any future dashboard.
Deliverables:
- Repository query methods for funnel KPIs (stage counts, conversion rates, lead volumes by source/channel, campaign attribution, trends)
- Typed API routes returning those KPIs scoped to a single client
- One contract/integration test per route against known seed data
Success criteria:
- All new KPI route tests pass
- No schema changes required
- CEO Brief Agent can be implemented next by consuming these endpoints

7. MILESTONE #3: DAILY CEO BRIEF ENGINE V0 (CURRENT)
-----------------------------------------------------
Goal: Generate an accurate, deterministic daily CEO brief from live CRM KPIs.
Why now: KPI read layer is complete and QA-passed; the brief is the first AI/agent deliverable that turns data into executive action.
Deliverables:
- Brief domain model and output contract (JSON/text with funnel snapshot, deltas, anomalies, recommended actions)
- Agent/service that consumes the KPI endpoints and assembles the brief
- Deterministic tests proving brief output matches expected CRM state
Success criteria:
- Brief generation succeeds from seed data without schema changes
- Key funnel metrics in the brief exactly match KPI API output
- Anomaly detection and recommended actions are relevant and understandable
- All brief tests are green

8. PRODUCTION HARDENING ITEMS (POST-M3)
----------------------------------------
- HTTP route-level contract tests for bad IDs, cross-client conflicts, and no accidental 500s.
- Repository update hardening: disallow ownership reassignment or add full validation.
- Stricter request validation: email/UUID shapes, numeric bounds, allowed enum values.
- Request validation depth for status/channel/score.
- Postgres production smoke: migrate/seed/rollback on PostgreSQL before exposing externally.
- Production auth and tenant access control before real users/agents can mutate CRM data.
