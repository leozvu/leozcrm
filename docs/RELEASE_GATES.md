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
| **G3 — Deterministic Brief** | Jarvis Observer may produce a local CEO Brief | Native Egoric funnel; exact metrics; provenance and limitations; integration profile denies legacy mutation routes; independent QA PASS | **Authorized for local/test implementation; not yet passed** |
| **G4 — Local End-to-End** | Sprint 1 may be accepted | Real test snapshot → stored memory → brief; exact reconciliation; no-mutation proof; flag/key revocation drill; CEO acceptance recorded | Blocked by G3 |
| **G5 — Shadow Trust** | Read-only CEO pilot may be released | Independent deployment, production canary, ten business days of read-only shadow, freshness/reliability targets, useful output, no material false claims or workflow regression | Blocked by G4 |
| **G6 — Supervised Action** | Individually allowlisted actions may be proposed and executed after approval | Action/approval contract; dry-run; idempotency; audit; expiry; risk/budget/rate controls; rollback; command-specific QA and CEO approval | Future separate project |
| **G7 — Bounded Autonomy** | A reversible low-risk policy may execute without per-action approval | Proven supervised history; policy simulator; blast-radius limit; kill switch; monitoring; incident drill; revocation; explicit scope and CEO approval | Future separate project |

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
