# Sprint 7 — Production Activation Ceremony and Sealed Handoff

## Outcome

Transform one fresh, current Phase 6 `complete_unreleased` evidence set into a
tamper-evident activation dossier, independent verification, and sealed external
handoff package without implementing or performing activation.

## Contract

- One exact policy binds one Phase 6 policy and assessment fingerprint.
- Every currently effective Phase 6 pass must share the policy's exact named
  deployment ID and target fingerprint.
- The policy names provider, region, project, service, adapter artifact,
  configuration, credential reference, canary metrics, and rollback artifacts
  through safe identifiers and SHA-256 fingerprints only.
- Ceremony authority creates a database-derived dossier; an independently
  authenticated verifier approves or rejects it; an activation operator may
  seal only the latest fresh approval after a full Phase 6 drift recheck. One
  policy can produce at most one sealed handoff.
- A dual-credential recall is immutable and changes derived status to recalled.
  No record is updated or deleted.

## Deliverables

1. Exact Phase 7 policy and validation contract.
2. Current Phase 6 readiness derivation with signature, expiry, revocation,
   target-consistency, and upstream-state rechecks.
3. Immutable policy, dossier, verification, sealed handoff, recall, and event
   persistence for SQLite and PostgreSQL.
4. Command-and-exit operator and fail-closed preflight.
5. Pending templates, operations/incident runbook, adversarial tests, migration
   lifecycle, and PostgreSQL smoke evidence.

## Explicit non-goals

No external issuer enrollment, deployment, activation, promotion, provider API,
production adapter registration, scheduler, daemon, background loop, HTTP
mutation route, real credential, private key, infrastructure purchase, or
external state change is authorized by this sprint.
