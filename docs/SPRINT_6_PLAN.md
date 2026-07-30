# Sprint 6 — Signed External-Evidence Admission

## Outcome

Turn the eight explicit Phase 5 external blockers into an exact signed-evidence
matrix without granting production release authority.

## Contract

- One Phase 6 policy binds one accepted Phase 5 policy fingerprint, its latest
  passing assessment, and its immutable `blocked_external` package.
- The matrix contains exactly eight evidence types. Each type is assigned to one
  of four pinned issuer roles: Product Owner, implementation, monitoring, or
  independent QA.
- Attestations use Ed25519 over canonical JSON, carry exact tenant, source,
  environment, Phase 5 package, subject, digest, timestamps, nonce, and issuer
  bindings, and expire within the policy limits.
- Only an issuer pinned by ID, key ID, role, public-key fingerprint, and public
  key can satisfy its assigned matrix row.
- Accepted pass and revoke statements are immutable. Replay is idempotent only
  when the complete envelope fingerprint is identical; conflicting or stale
  statements fail closed.

## Deliverables

1. Exact policy and attestation schemas with Ed25519 verification.
2. Immutable policy, attestation, assessment, and event persistence on SQLite
   and PostgreSQL.
3. Admission service with upstream revalidation, anti-replay, expiry, issuer,
   signature, binding, and revocation checks.
4. Deterministic eight-row assessment whose only success state is
   `complete_unreleased` with `blocked_external_activation` release status.
5. File-based operator and fail-closed preflight; no HTTP mutation surface.
6. Example manifest, attestation template, operations runbook, adversarial test
   suite, migration lifecycle, and PostgreSQL smoke coverage.

## Explicit non-goals

No external trust enrollment, private key, deployment, provider call, production
adapter, autonomous action, release/promotion/activation command, G8, scheduler,
daemon, background loop, or external state mutation is authorized by this sprint.
