# LeozOps Canonical Glossary

Status: **Normative vocabulary**

Effective: 2026-07-28

Use these terms in product documents, APIs, data models, UI copy, tests, and
future implementation tasks. A conflicting historical term does not override
this glossary.

| Term | Canonical meaning |
|---|---|
| **CEO** | Human decision owner. Sets goals, constraints, approvals, and acceptable risk. |
| **Egoric** | Operational CRM/ERP and sole system of record for business entities and workflows. The canonical source repository is `leozvu/repositoryrealms`. |
| **LeozOps** | Separately deployed AI Operating Partner that owns analytical memory and derived intelligence, not operational records. |
| **Tenant** | A LeozOps isolation and ownership boundary, normally representing one connected business. It is not an Egoric Client. |
| **Client** | An Egoric customer record. Historical LeozOps code also uses `Client` as a tenant, but that model must not be reused for the Egoric integration. |
| **Source connection** | Tenant-scoped configuration for one external source contract, credential reference, schema version, and sync state. |
| **Source snapshot** | Immutable, versioned set of approved source facts identified by a deterministic content hash. |
| **Business Memory** | LeozOps analytical read model containing immutable snapshots, derived facts, run identity, goals, feedback, and audit evidence. It is not an operational database. |
| **Metric** | Deterministic numerical result produced from source facts by a versioned formula. |
| **Data-quality finding** | Evidence that source facts are missing, stale, inconsistent, unsupported, or not attributable. |
| **Observation** | Direct description of a source fact or computed metric. It must not contain an unlabelled causal claim. |
| **Anomaly** | Deterministically detected deviation from a defined baseline, threshold, expectation, or data contract. |
| **Insight** | Evidence-backed interpretation connecting one or more observations. Inference and uncertainty must be explicit. |
| **CEO Brief** | Versioned, reproducible summary of business state, changes, limitations, and priorities for a defined `asOf` time. |
| **Recommendation** | Advisory proposal derived from evidence. It includes rationale, expected impact, confidence, risk, and a success measure. It is not a task or action. |
| **Action proposal** | Structured, previewable request for a future operational command. It has no effect until its approval policy is satisfied. |
| **Approval** | Explicit human authorization for a specific action proposal, scope, parameters, expiry, risk, and budget. |
| **Action** | An allowlisted operational command executed by the system that owns the affected entity. LeozOps never treats generated text as an action. |
| **Plan** | Ordered set of outcomes and proposed actions tied to a goal, constraints, owners, dependencies, and measures. |
| **Goal** | Human-owned desired outcome with a measure, target, time horizon, and constraints. |
| **Evidence** | Source snapshot, metric/formula version, timestamps, and other reproducible facts supporting an output. |
| **Provenance** | Metadata proving where an output came from: source, snapshot, formula/engine version, freshness, funnel definition, and limitations. |
| **Confidence** | Calibrated strength of an inference or recommendation. It never replaces evidence. |
| **Freshness** | Age of the source facts used by an output, measured against a declared service expectation. |
| **Read-only** | LeozOps sends no write method to Egoric, has no shared DB access, and exposes no operational mutation surface in that deployment profile. |
| **Supervised execution** | Execution of an allowlisted action only after the required explicit approval and preview. |
| **Bounded autonomy** | Pre-authorized execution limited by action type, tenant, risk, budget, frequency, reversibility, and revocation controls. |

## Semantic invariants

- A recommendation is not a task, action, approval, or proof of causality.
- An observation is not an insight unless interpretation is added and labelled.
- A tenant is not an Egoric Client.
- Current-state funnel counts are not historical conversion rates.
- A source snapshot is immutable; a newer snapshot does not update the old one.
- AI-generated prose is not a metric and may not override a deterministic
  result.
- `advisory_only: true` means no operational side effect exists on that path.
- “JARVIS” is a product metaphor, not permission for autonomous execution.
