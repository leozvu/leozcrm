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

7. MILESTONE #3: DAILY CEO BRIEF ENGINE V0 — PASS
--------------------------------------------------
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

8. MILESTONE #4: RECOMMENDATION SYSTEM V0 (CURRENT)
----------------------------------------------------
Goal: Add advisory-only recommendations based on funnel KPIs and brief output.
Why now: The brief gives the CEO what happened; recommendations provide the first AI Brain behavior. This closes the MVP value loop before heavier UI/integration work.
Deliverables:
- Recommendation rules/heuristics based on funnel state
- Recommendation API endpoint with stable output contract
- Advisory-only enforcement in code
- Deterministic tests for rule mapping, empty cases, unknown client handling
Success criteria:
- Recommendations are derived from existing KPI/brief data; no schema changes
- Output contract is stable and advisory-only behavior is enforced
- Rules produce relevant recommendations against the seeded dataset
- All recommendation tests are green

88|9. PRODUCTION HARDENING ITEMS (POST-M4)
89|----------------------------------------
90|- HTTP route-level contract tests for bad IDs, cross-client conflicts, and no accidental 500s.
91|- Repository update hardening: disallow ownership reassignment or add full validation.
92|- Stricter request validation: email/UUID shapes, numeric bounds, allowed enum values.
93|- Request validation depth for status/channel/score.
94|- Postgres production smoke: migrate/seed/rollback on PostgreSQL before exposing externally.
95|- Production auth and tenant access control before real users/agents can mutate CRM data.
96|
97|10. MILESTONE #5: EXECUTIVE DASHBOARD & TEAM WORKSPACE (PLANNED)
98|-----------------------------------------------------------------
99|Goal: Provide a visual, single-pane surface for the CEO and team to monitor funnel health, daily briefs, and recommendations.
100|Why now: M2, M3, and M4 APIs are complete; a UI layer is the next product-value increment before heavier integration and production exposure.
101|Deliverables:
102|- Dashboard UI shell consuming KPI, Brief, and Recommendation APIs
103|- Funnel visualization (stage counts, conversion trends)
104|- Lead list with stage movement views
105|- CEO Brief and Recommendation panels
106|Success criteria:
107|- Dashboard reflects live CRM state without schema changes
108|- CEO Brief and Recommendations render correctly from their APIs
109|- Suitable for internal pilot use before external exposure
110|
111|11. MILESTONE #6: INTEGRATION ADAPTERS — PLACEHOLDER (PLANNED)
112|---------------------------------------------------------------
113|Goal: Establish safe, no-op connector architecture for social, email, and AI tools.
114|Why now: A defined integration surface is needed before real publishing and before the Agent Workforce can trigger external actions.
115|Deliverables:
116|- Placeholder adapters for Facebook, TikTok, Instagram, email, and AI video/image stubs
117|- Explicit no-op behavior and clear documentation separating placeholder from production path
118|- Route/service tests proving adapters do not mutate external state
119|Success criteria:
120|- Adapters mount in the system but perform no external writes
121|- No dashboard, integration, or autonomous execution layer was added
123|
124|12. MILESTONE #7: PRODUCTION HARDENING (PLANNED)
125|-----------------------------------------------------------------
126|Goal: Add authorization, validation, and database safety required before external exposure.
127|Why now: M5 and M6 expose surfaces that must be protected before real users or agents interact with CRM data.
128|Deliverables:
129|- Auth + tenant access control
130|- HTTP route contract tests (bad IDs, cross-client conflicts, 500 prevention)
131|- Stricter request validation (email/UUID shapes, numeric bounds, enums)
132|- Repository update hardening (ownership reassignment rules)
133|- Postgres migrate/seed/rollback smoke test
134|Success criteria:
135|- All hardened routes handle invalid input without crashing
136|- Tenant data is fully isolated
137|- Production database lifecycle scripts pass on PostgreSQL
138|
139|13. MILESTONE #8: REAL INTEGRATION PUBLISHING (PLANNED)
140|-----------------------------------------------------------------
141|Goal: Replace placeholder adapters with live connections and enable recommendation-driven publishing.
142|Why now: M6 placeholders and M7 safety rails are complete; real publishing closes the recommendation → action → data loop.
143|Deliverables:
144|- Live social, email, and CRM sync integrations
145|- Autonomous publishing paths gated by authorization and spend guards
146|- End-to-end publishing tests against sandbox targets
147|Success criteria:
148|- Recommendations can trigger real external actions safely
149|- Failure modes are logged and visible, not silent
150|
151|14. MILESTONE #9: AGENT WORKFORCE & AUTOMATED ACTIONS (PLANNED)
152|----------------------------------------------------------------
153|Goal: Execute validated recommendations as automated workflows: lead qualification, campaign launches, nurture sequences.
154|Why now: M4 recommendations, M8 integrations, and M7 safety are complete.
155|Deliverables:
156|- Agent-driven pipelines that consume recommendation triggers
157|- Spend caps and safety stop-criteria
158|- Observability for autonomous actions (logs, failure alerts)
159|Success criteria:
160|- Autonomous workflows run within defined safety boundaries
161|- Recommendations can be auto-executed without schema changes
162|
163|15. MILESTONE #10: MVP LAUNCH & CLIENT ONBOARDING (PLANNED)
164|----------------------------------------------------------------
165|Goal: First paying client or internal pilot goes live.
166|Why now: M5 through M9 form a stable, production-ready platform with dashboard, integrations, automation, and safety.
167|Deliverables:
168|- Client onboarding workflow
169|- Pilot/support runbook
170|- Production scaling and monitoring readiness
171|Success criteria:
172|- First client can self-serve or be onboarded within defined SLA
173|- Product metrics and retention feedback loop is visible
174|- Support and escalation paths are documented and staffed
