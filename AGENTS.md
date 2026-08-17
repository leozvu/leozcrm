# LeozOps Codex and Ruflo Guide

LeozOps is the evidence-bound AI Operating Partner for a CEO. Egoric remains
the operational system of record. Treat every production claim, credential,
deployment, external action, and elapsed-live-evidence gate as unavailable
unless the repository contains the exact accepted evidence named by the task.

## Read before changing code

Read these sources in order, narrowing to the task after the first six:

1. `PRODUCT.md`
2. `docs/PRODUCT_OPERATING_MODEL.md`
3. `docs/GLOSSARY.md`
4. `docs/RELEASE_GATES.md`
5. `docs/EGORIC_INTEGRATION.md`
6. `DECISIONS.md`
7. `CHECKLIST.md`
8. The phase document and tests for the area being changed

`CLAUDE.md` contains the historical Egoric implementation brief. This file is
the Codex entry point; where either conflicts with a newer recorded Product
Owner decision, the newer decision and release-gate evidence win.

## Current boundary

- Repository implementation includes the Phase 18 Jarvis live-qualification candidate;
  repository acceptance and live acceptance remain separate evidence gates.
- Live release remains gate-bound. Do not fabricate G5, G6, G7, J1-J8,
  production history, named-environment evidence, credentials, or approvals.
- The production action-adapter registry stays empty until the exact external
  source, preview, rollback, authority, and review gates pass.
- PWA, voice, preferences, evaluation, and export are LeozOps-owned experience
  surfaces. Talking Mode is read-only, grounds every spoken turn through the
  Advisor, retains no raw audio/transcript, and never bypasses confirmation,
  tenant scope, or G6/G7.
- Enabling a live Advisor or Realtime voice provider requires the exact Phase
  18 release manifest. Voice quality can reach only candidate readiness; it
  never infers named-deployment, CEO, J1-J8, or production acceptance.
- Never add a generic Egoric CRUD path, direct database access, cross-tenant
  access, or an HTTP route that turns a recommendation into an action.

## Ruflo operating mode

Ruflo is installed as a project harness in observe-only mode. Use its local
skills to structure work, recall decisions, inspect risk, and verify results.
It does not grant product or production authority.

Use the smallest matching workflow:

- `$memory-management` for reusable repository decisions and patterns.
- `$sparc-methodology` for a new multi-stage feature or architectural change.
- `$security-audit` for auth, input, dependency, or production-boundary work.
- `$swarm-orchestration` only when the user explicitly requests delegation or
  parallel agents. Never start unattended fanout or autopilot by default.

The Ruflo MCP entry is present but disabled until the local Codex CLI can be
registered and `ruflo doctor` passes. Do not claim MCP memory, hooks, workers,
or swarm execution is active merely because configuration files exist.

## Implementation rules

- Keep domain calculations deterministic; generated language may explain but
  may not invent facts or authority.
- Preserve tenant scope, append-only evidence, idempotency, source/version
  fingerprints, freshness, limitations, and fail-closed behavior.
- Validate all external inputs and structured model output before persistence
  or presentation. Never log raw credentials or unnecessary PII.
- Do not weaken tests or safety gates to make a feature pass.
- Do not commit, push, deploy, register credentials, execute external actions,
  or mark live gates complete unless the user explicitly authorizes the action
  and the required evidence exists.

## Verification

Run focused tests first, then the proportional repository gates:

```powershell
npm run typecheck
npm test
npm run build
```

For the current phase use its focused script when available, such as
`npm run test:phase18`. Record failures honestly and distinguish repository
proof from live-environment proof.
