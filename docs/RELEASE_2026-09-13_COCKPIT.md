# Cockpit workspace sessions and request reliability

Status: validated repository release candidate; local fixture staging blocked
by Docker Desktop startup; public hosting target not identified.

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
- All eight GitHub checks passed on implementation/merge revision
  `8056cf9ab920d4906470baad4627a9b92eaa6808`: Node 22 and Node 24 regression,
  PostgreSQL 16 migration/lifecycle and production container build, on both
  [push](https://github.com/leozvu/leozcrm/actions/runs/34732908987) and
  [PR](https://github.com/leozvu/leozcrm/actions/runs/34732930568). The Node 24
  job also passed the dependency audit.

The additive `20260908120000_create_human_sessions` migration creates only
LeozOps login/session metadata. It was exercised on isolated SQLite and the
GitHub PostgreSQL 16 lifecycle job. Apply through the existing LeozOps migration
procedure only after identifying the exact deployment/database.
No deployment database was migrated.

## Deployment inspection

Read-only inspection found no existing GitHub deployment or named environment
for `leozvu/leozcrm`, and no repository variables defining a target. The only
checked-in Phase 12 live-observer manifest is the intentionally pending example
with placeholder provider/project/service/database fields. The local worktree
contains no `.env` configuration, named live-observer/Jarvis manifest bindings,
database binding, public origin, staging port or human-SSO configuration.
These observations do not prove that no externally managed deployment exists.

The original `leozcrm` checkout does contain an existing accepted **local fixture
staging** manifest and private local configuration, separate from this worktree.
Its exact target is `docker-local` / `leozops-local-staging` /
`leozops-local-staging-web`, with its own PostgreSQL 16 database. The new build's
Phase 12 preflight passed against those existing bindings without modification.
Advisor remains deterministic and voice remains disabled. This target's
configured cockpit is `http://127.0.0.1:3100/cockpit/`; it is currently stopped
and is not a public or live-business deployment.

One bounded Docker Desktop launch failed before its Linux engine became
available. The backend log identifies an Inference manager startup failure at
`%LOCALAPPDATA%/Docker/run/dockerInference`: the file cannot be accessed by the
system, with a filename/directory/volume syntax error. Docker then closed;
`docker info` could not open `dockerDesktopLinuxEngine`, and `docker desktop
status` reported that Desktop was not running. No local image build, compose start,
migration, data reset, socket deletion or system configuration change was run.
Local staging needs Docker Desktop repaired before this candidate can be
deployed there. No local LeozOps Node server is listening either.

The standard server defaults to port 3000 and exposes `/cockpit/` only in
`egoric-readonly` mode. A URL at that port is not a deployed result. The local
build updates `dist`; it does not start or update a running server.

To complete a public deployment, provide or select the exact existing Jarvis
hosting service, its accepted Phase 12 runtime/source/database manifest and operational
bindings. Live Advisor/Realtime activation additionally requires the exact
Phase 18 manifest and existing provider evidence. Service secrets belong in
the deployment's secret manager, not this release document or chat.

No source flag, provider, action adapter, production credential or authority
gate was enabled. G5/G6/G7 and J1–J8 live acceptance remain unchanged. The GHCR
workflow publishes canonical immutable images only; image publication alone
is not a deployment and is not presented as one.
