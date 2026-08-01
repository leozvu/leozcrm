# LeozOps Product and Release Gates

Status: **Canonical gate map**

Effective: 2026-07-28

LeozOps earns capability in order. Passing a later-looking test does not waive
an earlier gate. Production credentials, write access, or autonomy always
require explicit Product Owner approval in addition to technical evidence.

| Gate | Capability unlocked | Required evidence | Current state |
|---|---|---|---|
| **G0 — Product Contract** | Implementation may follow one canonical direction | Product definition, operating model, glossary, ownership boundary, legacy classification, roadmap, and decision record agree | **Complete on `main` through [PR #1](https://github.com/leozvu/leozcrm/pull/1) at `b7aa417`** |
| **G1 — Secure Data Supply** | Egoric snapshot may be accepted for local/test integration | Dedicated GET capability; PII denial; deterministic quoted ETag/304; method and generic-API denial; non-PII audit; feature flag; independent QA PASS | **Complete: reviewed `28ceff6`; [PR #7](https://github.com/leozvu/repositoryrealms/pull/7) merged as `main@98c0eca`; Product Owner accepted local S1.B continuation** |
| **G2 — Business Memory** | A snapshot may enter the LeozOps analytical read model | Schema fail-closed; immutable/idempotent storage; tenant isolation; no-write-egress; replay tests; full suite/typecheck PASS | **Complete: [PR #4](https://github.com/leozvu/leozcrm/pull/4) merged as `main@d1d34c5`; Product Owner accepted local S1.C continuation** |
| **G3 — Deterministic Brief** | Jarvis Observer may produce a local CEO Brief | Native Egoric funnel; exact metrics; provenance and limitations; integration profile denies legacy mutation routes; independent QA PASS | **Complete: [PR #6](https://github.com/leozvu/leozcrm/pull/6) merged as `main@3a5fb9e`; Product Owner accepted local S1.D continuation** |
| **G4 — Local End-to-End** | Sprint 1 may be accepted | Actual canonical handler + local test facts → stored memory → brief; exact reconciliation; no-mutation proof; flag/key revocation drill; CEO acceptance recorded | **Complete: [PR #8](https://github.com/leozvu/leozcrm/pull/8) merged as `main@5ef3fd5`; Product Owner accepted Sprint 1** |
| **G5 — Shadow Trust** | Read-only CEO pilot may be released | Independent deployment, production canary, ten business days of read-only shadow, freshness/reliability targets, useful output, no material false claims or workflow regression | **Complete local execution/control plane on `codex/leozops-phase2`; P1 is still pending, so no external checkpoint or elapsed shadow evidence exists and G5 remains blocked** |
| **G6 — Supervised Action** | Individually allowlisted actions may be proposed and executed after approval | Action/approval contract; dry-run; idempotency; audit; expiry; risk/budget/rate controls; rollback; command-specific QA and CEO approval | **Local control plane complete on `codex/leozops-phase3-supervised-action`; G5 and every real command/adapter/release remain blocked** |
| **G7 — Bounded Autonomy** | A reversible low-risk policy may execute without per-action approval | Proven supervised history; policy simulator; blast-radius limit; kill switch; monitoring; incident drill; revocation; explicit scope and CEO approval | **Local inert rehearsal complete on `codex/leozops-phase4-bounded-autonomy`; G5/G6, production history, deployed adapter/monitoring, external drills, and G7 release remain blocked** |

Phase 5 is an assurance layer for G7, not a new gate and not G8. Its local
assessment and release package remain `blocked_external`; they do not change
the G7 row above or satisfy any external evidence requirement.

Phases 6–8 are trust, handoff, and controlled-execution layers for the same G7
boundary, not new gates. Phase 6 admits signed external evidence; Phase 7 binds
a complete set to an exact target and seals a package; Phase 8 implements a
one-attempt control plane with explicit observation and manual rollback. The
checked-in production activation registry remains empty, so no real target can
be invoked and no local result satisfies the external G7 evidence gate.

## Jarvis product checkpoints

The J-series checkpoints measure whether the product experience is complete;
they do not replace or waive G0-G7 capability authority. Their detailed scope
and evidence are defined in
[`JARVIS_COMPLETION_PLAN.md`](JARVIS_COMPLETION_PLAN.md).

| Checkpoint | Product evidence | Capability dependency |
|---|---|---|
| **J1 — Grounded conversation** | Typed read tools, evidence citations, durable context, golden evaluations, isolation and failure safety | Read-only; G1-G4 facts only |
| **J2 — Evidence cockpit** | North Star usability, drill-down provenance, accessible states, unambiguous approval/execution status | J1 |
| **J3 — Trustworthy alerts** | Deterministic triggers, deduplication, cooldown, delivery/replay evidence, accepted false-positive baseline | J1-J2 |
| **J4 — Live Observer** | Named deployment and real G5 `go` after network proof and elapsed shadow | G5 |
| **J5 — Reproducible plans** | Versioned goals, constraints, assumptions, comparisons, checkpoints, and decision history | J1 and current evidence |
| **J6 — Supervised hand** | One narrow adapter plus accepted live supervised execution and observation history | G5 and exact G6 release |
| **J7 — Bounded canary** | Real supervised history, simulation, narrow canary, kill-switch and recovery evidence | G7 |
| **J8 — Jarvis v1** | Live outcome checklist, 30-day SLO/quality acceptance, no P0/P1 blocker, operable recovery/export | J1-J7 |

Passing J1, J2, J3, or J5 grants no write capability. A conversational model,
interface approval, plan acceptance, or proactive trigger may only create a
proposal; execution continues through G6/G7 and the Phase 8 controls.

## Gate ownership

- Product Owner accepts product value, scope, and external risk.
- Implementation owner supplies code, tests, migrations, and operational
  evidence.
- QA records PASS/FAIL and blockers; passing unit tests alone never overrides a
  reproduced contract failure.
- PM keeps `ROADMAP.md`, `DECISIONS.md`, `CHECKLIST.md`, and this gate map in
  sync.

## G0 Definition of Done

- `PRODUCT.md` states the North Star, user, operating loop, MVP, and non-goals.
- `PRODUCT_OPERATING_MODEL.md` identifies system roles, component boundaries,
  current/future surfaces, lifecycle coverage, and deployment profiles.
- `GLOSSARY.md` removes ambiguity between fact, inference, recommendation,
  approval, and action.
- `LEGACY_FOUNDATION.md` classifies existing runtime capabilities and prevents
  accidental standalone-CRM deployment.
- `DECISION-003` records the approved JARVIS operating-partner direction.
- README, package metadata, governance, architecture, and roadmap point to the
  same canonical direction.
- Documentation links and repository identity are verified.

## G1–G4 technical evidence

The detailed contracts and test matrices for G1–G4 remain authoritative in:

- `EGORIC_INTEGRATION.md` §13–§16;
- `../CODEX_REVIEW.md`;
- `../.hermes/plans/2026-07-18_egoric-integration-execution-plan.md`.

This document does not weaken those requirements.

## G5 minimum product evidence

- Successful sync rate at least 99.5% during the shadow window.
- Business-hours source age under 30 minutes.
- Exact total, stage, and source reconciliation for ten consecutive business
  days.
- Every displayed metric has reproducible provenance.
- Zero Egoric mutations attributable to LeozOps.
- No employee workflow regression.
- The CEO can understand the brief in under five minutes and rates recurring
  output useful at least 4/5.

Targets may be tightened at G4; they may not be weakened without a recorded
decision.

## Capability stop rule

When a gate fails, work is limited to the smallest corrective scope for that
gate. Do not start the next capability, expose production data, or broaden
permissions while the gate is open.

DECISION-002 addendum 14 permits only inert, local G6 control-plane code while
G5 is open: the deployed adapter registry must remain empty and no external
command, credential, route, scheduler, or mutation may exist. This preparation
does not unlock or exercise G6; the stop rule still applies to every real
command capability.

DECISION-002 addendum 15 permits an inert local G7 rehearsal while external G5
and G6 remain open. It does not waive either prerequisite: production
composition stays adapter-free and scheduler-free, the kill switch defaults to
engaged, and only injected deterministic adapters may exercise the local path.
No local simulation, fake execution, or database evidence can count as
production supervised history or a G7 release.

DECISION-002 addendum 16 permits only local operational-assurance code. It may
recompute and package immutable rehearsal evidence but provides no waiver,
promote, approve, schedule, execute, or release path. The package must retain
every canonical external blocker until a future separately authorized phase
defines proof against named production infrastructure.

DECISION-002 addenda 17 and 18 permit only signed-evidence admission and an
immutable local activation ceremony. They do not relax G5/G6/G7, authorize an
executor, or turn hashes and signatures into deployment facts. Production
composition must remain adapter-free and network-free; any activation requires
new Product Owner authority and independent evidence against the exact named
target.

DECISION-002 addendum 19 authorizes the local Phase 8 one-attempt execution
control plane and deterministic injected test adapters. It does not authorize
a provider SDK, real credential, deployment, live call, scheduler, automatic
retry, automatic observation, or automatic rollback. A production adapter must
arrive through a separately reviewed and explicitly authorized change.

DECISION-002 addendum 20 defines the Jarvis v1 product checkpoints and permits
Phase 9A planning. It does not authorize production model access, external
deployment, source credentials, generic tools, a scheduler, or an action
adapter. The G-series capability stop rule remains authoritative.
