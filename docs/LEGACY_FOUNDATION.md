# Legacy Standalone Foundation

Status: **Preserved historical code; excluded from the canonical Egoric
deployment profile**

Effective: 2026-07-28

This repository contains a tested standalone CRM foundation built before
Egoric became the operational system of record. The code remains valuable as
implementation history and as a source of reusable deterministic patterns, but
its presence does not define the current product or authorize deployment.

## Capability classification

| Existing capability | Classification for current direction | Rule |
|---|---|---|
| Client, campaign, and lead CRUD | Legacy operational model | Do not mount in `egoric-readonly`; do not map Egoric Client to LeozOps tenant |
| Nine-stage funnel | Legacy standalone semantics | Do not use for the Egoric pilot; preserve `egoric_sales_v1` |
| KPI repository | Reuse candidate | Reuse patterns only after formulas are rebuilt against immutable snapshots and versioned |
| CEO Brief service | Reuse candidate | Reuse deterministic assembly patterns; do not claim old CRM data is Egoric intelligence |
| Recommendation service | Reuse candidate | Advisory-only; add evidence, confidence, limitations, and source provenance before current use |
| Dashboard/team workspace | Legacy UI/reference | Not on the critical path before G4; no operational mutations in the integration profile |
| Placeholder integrations | Historical | Do not treat metadata/no-op adapters as current source connectors |
| Live email publishing | Excluded operational side effect | Never mount in `egoric-readonly`; no recommendation may invoke it |
| Task engine | Excluded operational owner | Egoric owns tasks; a recommendation is not converted automatically |
| Client-token auth | Legacy tenant model | Do not reuse `Client` identity as the new integration tenant model |
| Onboarding route and CLI | Superseded launch path | Do not use to onboard Egoric employees or businesses into a second CRM |
| Knex migrations, repository/service layering, deterministic tests | Reuse foundation | May be extended while preserving strict TypeScript, portability, reversibility, and test isolation |

## Runtime warning

The current default application still mounts historical CRM, task, onboarding,
and email surfaces. The `INTEGRATION_MODE=egoric-readonly` route-isolation
profile is implemented on the local S1.C branch but remains gated and
undeployed. Only that isolated profile may become the Egoric integration after
G3, G4, and the later deployment gates pass.

Therefore:

- do not deploy the current default app as the Egoric LeozOps service;
- do not point it at Egoric or production credentials;
- keep legacy tests green as regression protection; and
- implement new integration work behind explicit source-neutral boundaries.

## Allowed reuse test

A legacy component may be reused only if all answers are yes:

1. Does Egoric remain the only operational owner?
2. Does the component consume approved source facts rather than legacy CRM
   tables?
3. Are tenant identity and funnel semantics correct for Egoric?
4. Are numerical outputs deterministic and versioned?
5. Does every output include evidence, freshness, and limitations?
6. Is the component read-only in the current profile?
7. Do integration-profile denial and no-write-egress tests cover it?

If any answer is no, treat the component as a reference and build the current
contract explicitly.

## Historical evidence

The standalone milestones and their test evidence remain recorded in
`../ROADMAP.md`, `../CHECKLIST.md`, `../ARCHITECTURE.md`, and
`DATA_MODEL.md`. Those documents are useful for regression and archaeology but
do not outrank the current product definition, operating model, or Egoric
integration contract.
