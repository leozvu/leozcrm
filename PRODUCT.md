# LeozOps — Product Definition

Status: **Canonical product direction**

Approved by: Leoz, Product Owner

Effective: 2026-07-28

Governing decision: `DECISION-003`

## Product statement

LeozOps is the AI Operating Partner for a CEO. It observes the business,
maintains a trustworthy analytical memory, explains what is changing, proposes
what to do next, and eventually coordinates approved actions through the
operational systems that own them.

Egoric is the operational body and system of record. LeozOps is the
intelligence and decision-support layer. The CEO remains the decision owner.

Revenue and funnel intelligence are the first useful wedge, not the final
product boundary.

## North Star

A CEO should be able to open LeozOps and, in less than five minutes, answer:

1. What is the state of the business?
2. What changed or is off target?
3. What evidence explains it?
4. What should we do next?
5. Which approved actions can LeozOps coordinate safely?

## Jarvis v1 completion outcome

The long-term product direction becomes a release only when the CEO can use a
single live cockpit to observe the business, ask evidence-backed questions,
retain goals and decisions, receive useful proactive alerts, review a plan,
and supervise one narrow reversible action through receipt, observation, and
recovery. Freshness, provenance, limitations, cost, incidents, and the kill
switch remain visible throughout the loop.

The implementation and evidence sequence is defined in
[`docs/JARVIS_COMPLETION_PLAN.md`](docs/JARVIS_COMPLETION_PLAN.md). This outcome
does not authorize a production model credential, deployment, source access,
action adapter, or autonomous policy by itself; each capability still requires
its named release gate.

## Core operating loop

`Observe → Understand → Recommend → Approve → Coordinate → Measure → Learn`

The current product implements the left side of this loop first. Approval,
coordination, and bounded autonomy are future capabilities gated by evidence;
they are not authorized by this product definition.

## Primary user and job

The first user is the CEO/founder operating an Egoric-backed business. LeozOps
must reduce the time needed to understand business performance and turn source
facts into a small number of evidence-backed priorities.

The first production job is a company-wide sales-funnel brief based on a
PII-minimized Egoric snapshot. The current source data supports lead-state and
conversion-pipeline observation only; it does not yet support historical
stage-conversion, client attribution, or the complete customer lifecycle.

## Product maturity model

| Level | Product role | Capability | Authorization |
|---|---|---|---|
| L0 — Connected | Data connection | Reads a narrow, revocable Egoric snapshot | Current integration work |
| L1 — Observer | Situational awareness | Business Memory, metrics, anomalies, CEO Brief | MVP |
| L2 — Advisor | Decision support | Evidence-backed diagnosis and recommendations | After read-only pilot |
| L3 — Planner | Goal orchestration | Turns CEO goals and constraints into plans | Future gate |
| L4 — Operator | Supervised execution | Executes allowlisted actions after approval | Future gate |
| L5 — Autopilot | Bounded autonomy | Executes reversible, low-risk policies within limits | Separate future approval |

## MVP outcome

The MVP is **Jarvis Observer**, not a general chatbot or a second CRM:

`Egoric Snapshot → Business Memory → Deterministic Metrics → CEO Brief`

It is successful when:

- source and derived counts reconcile exactly;
- every metric and conclusion is traceable to source evidence;
- unknowns and data limitations are explicit;
- the CEO understands the situation in under five minutes;
- no LeozOps request mutates Egoric; and
- the output is repeatedly useful during the read-only shadow pilot.

## Product principles

- **Truth before fluency.** Deterministic code calculates metrics; AI may
  explain them but must not invent or silently recompute them.
- **Evidence with every claim.** Outputs carry snapshot, formula, freshness,
  funnel, and limitation provenance.
- **One operational owner.** Egoric owns CRM/ERP entities and workflows.
- **Human authority.** A recommendation is not an action. The CEO controls
  approval, risk, budget, and revocation.
- **Earn autonomy.** Read-only trust precedes planning; planning precedes
  supervised execution; supervised execution precedes bounded autonomy.
- **Fail closed.** Unsupported schemas, stale data, ambiguous identity, and
  missing authorization stop the flow rather than produce a plausible answer.

## Explicit non-goals for the current track

- A duplicate CRM/ERP, campaign master, employee directory, or task system.
- Shared or direct access to the Egoric database.
- Autonomous email, social publishing, invoice operations, or task creation.
- Replacing Egoric screens or employee workflows.
- Claiming coverage of all nine customer-lifecycle stages before the required
  source facts exist.
- Building voice, a general agent marketplace, or broad automation before the
  Observer and Advisor gates pass.

## Canonical supporting documents

- Product operating model: `docs/PRODUCT_OPERATING_MODEL.md`
- Terms and semantic invariants: `docs/GLOSSARY.md`
- Product and release gates: `docs/RELEASE_GATES.md`
- Egoric technical contract: `docs/EGORIC_INTEGRATION.md`
- Legacy-code classification: `docs/LEGACY_FOUNDATION.md`
- Milestone status: `ROADMAP.md`
- Jarvis v1 completion plan: `docs/JARVIS_COMPLETION_PLAN.md`

Historical descriptions of LeozOps as “CRM + AI Brain + Agent Workforce” are
preserved only as product history. They do not authorize a standalone CRM
deployment or operational write-back.
