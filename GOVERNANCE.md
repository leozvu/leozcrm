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

## Repository Identity Rule

Before implementation tasks are created, Hermes must verify and record:

- Local repository path
- Git top-level (`git rev-parse --show-toplevel`)
- Remote URL (`git remote -v`)
- Active branch (`git branch --show-current`)
- Canonical repository name

Implementation may not begin until repository identity has been explicitly
recorded in governance and matches the approved target repository.

Repository identity must never be inferred from folder names or application
contents. Only a CEO-declared canonical name, matched against a verified Git
remote, satisfies this rule.

### Repository Identity Registry

| Role | Canonical name | Local path | Git top-level | Remote URL | Branch | Verified | Status |
|---|---|---|---|---|---|---|---|
| LeozOps (intelligence layer) | leozcrm | C:\Users\Asus\Desktop\leozops-main | C:/Users/Asus/Desktop/leozops-main | https://github.com/leozvu/leozcrm.git | main | 2026-07-18 | CONFIRMED |
| Egoric ERP/CRM (canonical product source) | repositoryrealms (CEO-declared 2026-07-18; option (a) chosen 2026-07-19) | C:\Users\Asus\Desktop\repositoryrealms | C:/Users/Asus/Desktop/repositoryrealms | https://github.com/leozvu/repositoryrealms.git | main (protected baseline @ 76082dc); feat/leozops-s1a (S1.A work); codex/realms-demo (staging/demo, preserved) | 2026-07-19 | Canonical product source: CONFIRMED · Sprint 1A implementation target: CONFIRMED · Production deployment target: Egoric Vercel project only (prj_Hh4aZEj9q3hvULaUfC4GwFvxYii9) · Production deployment approval: NOT YET GRANTED |

### Production-lineage verification (2026-07-19, read-only evidence)

1. Live deployment identified: the Egoric ERP runs at
   **https://erp-egoric.vercel.app** (HTTP 200, Next.js on Vercel,
   redirects unauthenticated traffic to /login — live and auth-protected).
2. Hosting project recorded: Vercel project `prj_Hh4aZEj9q3hvULaUfC4GwFvxYii9`
   ("Egoric Agency"), org `team_8Ll3jhqYrRxE3FH7SMvgRXNj`. Source:
   `deploy-all.ps1` present in both repos — ONE codebase is deployed to five
   businesses (aim, egoric, vnecom, fretas, egolive), each with its own
   Vercel project and database. The working copy `agency-erp` is
   Vercel-linked via `.vercel/project.json` (projectName "agency-erp").
3. Deployed commit: **NOT directly provable from this machine.** Deploys are
   pushed via Vercel CLI from the local working copy (not via Git
   integration), so Vercel deployments do not necessarily map 1:1 to Git
   commits. Latest local production-lineage commit is `76082dc` (v3.36).
   Exact deployed build requires Vercel dashboard/CLI auth (VERCEL_TOKEN).
4. Lineage relationship PROVEN by ancestry:
   `agency-erp` HEAD `76082dc` (v3.36) **is an ancestor** of
   `repositoryrealms/codex/realms-demo`. repositoryrealms = the full
   production history (v3.x series) PLUS four additional commits:
   "Build CRMegoric Realms staging clone" + three feat(realms) commits.
5. Determination: **repositoryrealms is a staging/demo clone built on top of
   the production codebase.** The production source lineage is the
   agency-erp/CRMegoric v3.x history (which repositoryrealms fully
   contains). Whether repositoryrealms is also the intended future
   canonical replacement is a CEO product decision, not derivable from Git.
6. No code modified; no branch created; Sprint 1A remains ON HOLD.

Open item before the Sprint 1A target can be set: RESOLVED 2026-07-19 — CEO
chose option (a): repositoryrealms is the go-forward canonical source.
Branch model executed same day: protected `main` created from 76082dc
(GitHub branch protection: PR + 1 review; set as default branch),
`feat/leozops-s1a` created from main, `codex/realms-demo` preserved as
staging/demo. Promotion flow and per-deployment flag isolation are defined in
`docs/DEPLOYMENT_FLAG_ISOLATION.md`. `agency-erp`/CRMegoric.git remains
excluded as an implementation target.

### Sprint 1A hold conditions (CEO, 2026-07-19)

Implementation remains ON HOLD until ALL of the following are true:
1. `main` created from 76082dc — DONE (pushed, protected, default branch)
2. `feat/leozops-s1a` created from main — DONE (pushed)
3. Credential file risk resolved — DONE (verified: CREDENTIALS-NOI-BO.txt is
   untracked in agency-erp and listed in its .gitignore line 11; it does not
   exist in repositoryrealms, and no credential-named file is tracked there.
   Residual note: the plaintext file still exists on disk in the agency-erp
   working copy; recommend moving it to a password manager — outside repo
   governance scope.)
4. Deployment-specific feature flag isolation documented — DONE
   (`docs/DEPLOYMENT_FLAG_ISOLATION.md`)

All hold conditions are satisfied. Source code remains unmodified; the
remaining step is CEO release of the hold, after which T1–T6 in
`docs/SPRINT_1A_TASKS.md` execute on `feat/leozops-s1a`.
