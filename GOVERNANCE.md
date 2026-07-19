# LeozOps AI — Governance

## Source of Truth

Order of precedence:

1. PRODUCT.md — what we build and why
2. docs/EGORIC_INTEGRATION.md — canonical Egoric ownership, boundary, contract, rollout, and QA rules
3. CHECKLIST.md — build order and acceptance criteria
4. ROADMAP.md — milestone sequence and status
5. DECISIONS.md — why we chose one path over another
6. CODEX_REVIEW.md — current QA state and blockers
7. ARCHITECTURE.md — existing module contracts and interfaces
8. GOVERNANCE.md — this file

`HERMES.md` and `CLAUDE.md` are role-specific entry points. They summarize but
do not override the sources above.

When docs conflict, the higher-precedence file wins. Update downstream docs when a higher doc changes.

## Roles

- Leoz: CEO / Product Owner — sets product goals, approves scope and launch criteria, owns external risk
- Hermes: PM — maintains docs, sequence, handoffs, and decision log; recommends next tasks
- Claude Code: Senior Dev — owns implementation, migrations, tests, and architecture decisions within agreed scope
- Codex: QA — owns review checklists, contract tests, and production-readiness gates

## Decision Process

1. Hermes recommends a decision with rationale and alternatives.
2. Leoz approves for product decisions; Claude Code approves for technical decisions within scope.
3. Record in DECISIONS.md before work starts.
4. If a decision reverses a prior one, note the superseded entry and why.

## Milestone Gates

A milestone is complete when:
- All checklist items for that milestone pass
- `npm test` is green
- `npm run typecheck` is clean
- Codex review file documents PASS or a tracked blocker list with no P0 issues
- DECISIONS.md captures all non-trivial choices made during the milestone

## Change Control

- Scope additions go through PM recommendation + CEO approval.
- Architecture changes require a proposed ARCHITECTURE.md edit and PM review.
- Hardening items from CODEX_REVIEW.md stay visible in CHECKLIST.md until completed.
- Egoric integration changes must preserve the forbidden boundaries and release
  gates in `docs/EGORIC_INTEGRATION.md`.
- Documentation approval does not itself authorize production enablement,
  credential creation, or production data mutation.
