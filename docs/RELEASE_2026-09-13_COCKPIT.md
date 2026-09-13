# Cockpit workspace sessions and request reliability

Status: repository release candidate; named deployment unavailable.

The Product Owner requested commit and deployment of the completed ERP/Realm
and LeozOps work on 2026-09-13 UTC. LeozOps is Jarvis. This candidate contains
only the LeozOps changes; ERP/Realm remains in its own repository and release.

## Candidate behavior

The cockpit supports a disabled-until-configured human workspace sign-in
receiver with pinned Ed25519 issuer keys, one-use browser challenges, bounded
HttpOnly sessions, tenant/capability checks, origin/CSRF enforcement and durable
revocation. The manual service-credential path remains available for existing
local/operator workflows.

Client requests and voice callbacks now belong to their original workspace.
Disconnect, expiry and page exit clear rendered evidence and drafts; stale
responses cannot reopen a disconnected workspace or replace a newer tenant.
Read, write and WebRTC deadlines prevent indefinite waiting, duplicate pending
Ask submissions are suppressed, and ambiguous write outcomes are visible.

Details: [human-session contract](HUMAN_SESSION_SSO.md) and
[request reliability evidence](../qa/cockpit-session-reliability/REPORT.md).

## Verification and migration

- Complete local regression: 402/402 passed, zero skipped.
- Focused cockpit/client/human-session/voice checks: 35/35 passed.
- Strict TypeScript and production TypeScript build passed.
- Intercepted-fixture Chromium smoke: 7/7 passed across desktop and mobile,
  with no page errors.
- Reviewed changed/untracked candidate files and QA logs for credential-shaped
  secrets/private-key material; no findings. Screenshots contain fixture data.

The additive `20260908120000_create_human_sessions` migration creates only
LeozOps login/session metadata. It was exercised on isolated SQLite. Apply
through the existing LeozOps migration procedure only after identifying the
exact deployment/database; no production migration was run in this release.
The GitHub PostgreSQL lifecycle and container checks remain release evidence
to collect for the pushed revision, not results inferred from local tests.

## Deployment inspection

Read-only inspection found no existing GitHub deployment or named environment
for `leozvu/leozcrm`, and no repository variables defining a target. The only
checked-in Phase 12 production manifest is the intentionally pending example
with placeholder provider/project/service/database fields. The local worktree
contains no `.env` configuration, named live-observer/Jarvis manifest bindings,
database binding, public origin, staging port or human-SSO configuration.
Docker Desktop's Linux engine is unavailable and no local LeozOps Node server
is listening. These observations do not prove that no externally managed
deployment exists; they mean no such target is available in this context.

The standard server defaults to port 3000 and exposes `/cockpit/` only in
`egoric-readonly` mode. A URL at that port is not a deployed result. The local
build updates `dist`; it does not start or update a running server.

To complete deployment, provide or select the exact existing Jarvis hosting
service, its accepted Phase 12 runtime/source/database manifest and operational
bindings. Live Advisor/Realtime activation additionally requires the exact
Phase 18 manifest and existing provider evidence. Service secrets belong in
the deployment's secret manager, not this release document or chat.

No source flag, provider, action adapter, production credential or authority
gate was enabled. G5/G6/G7 and J1–J8 live acceptance remain unchanged. The GHCR
workflow publishes canonical immutable images only; image publication alone
is not a deployment and is not presented as one.
