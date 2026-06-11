# LeozOps AI — Governance

## Source of Truth

Order of precedence:

1. PRODUCT.md — what we build and why
2. CHECKLIST.md — build order and acceptance criteria
3. ROADMAP.md — milestone sequence and status
4. DECISIONS.md — why we chose one path over another
5. CODEX_REVIEW.md — current QA state and blockers
6. ARCHITECTURE.md — module contracts and interfaces (to be created)
7. GOVERNANCE.md — this file

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
