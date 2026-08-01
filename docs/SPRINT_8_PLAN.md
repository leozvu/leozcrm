# Sprint 8 — Controlled Activation and Final Proof Closure

## Outcome

Consume one exact, current, unrecalled Phase 7 sealed handoff through a
fail-closed, human-released, one-attempt activation control plane; require
external observation and preserve an explicit human rollback path.

## Contract

- One Phase 8 policy binds one Phase 7 handoff fingerprint and its exact target,
  adapter, artifact, configuration, credential-reference, canary, and rollback
  contracts.
- Four separate credentials authenticate activation release, execution, safety
  observation, and rollback. Leoz may hold all four credentials while operating
  solo, but no credential may be reused across roles or upstream phases.
- Kill switch begins engaged. Release requires both release-authority and safety
  observer credentials and expires quickly.
- One policy permits one activation claim and at most one external mutation.
  The claim is persisted before adapter invocation. Every terminal outcome
  re-engages the kill switch; unknown/crashed attempts are never retried.
- A successful call is not completion. A later explicit observation must bind
  the exact provider receipt and target. Failed observation requires an
  explicit human recovery decision; successful observation closes as
  `activated_healthy`.
- Rollback is manual, separately authenticated, idempotent, and evidence-bound.
  No autonomous recovery path exists.

## Deliverables

1. Exact Phase 8 policy, adapter, preview, result, observation, and rollback
   contracts.
2. Empty production activation-adapter registry with deterministic injected
   adapters only in tests and PostgreSQL smoke.
3. Guarded policies, kill-switch/release events, previews, attempts,
   observations, rollbacks, incidents, and ordered events for SQLite/PostgreSQL.
4. Command-and-exit operator and deliberately fail-closed preflight.
5. Pending policy template, final operations/incident runbook, adversarial
   tests, migration lifecycle, PostgreSQL parity, and canonical documentation.

## Explicit non-goals

No real provider adapter, real target secret, live deployment, infrastructure
provisioning, production flag change, external API call, scheduler, daemon,
background loop, HTTP mutation route, automatic retry, automatic observation,
or automatic rollback is authorized or included.
