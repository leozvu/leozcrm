# LeozOps / Jarvis cockpit session reliability

Date: 2026-09-13 UTC. Status: repository and intercepted-browser checks passed.
LeozOps and Jarvis name the same product. This batch does not introduce a
second product, operational source, authentication issuer or provider.

## Changes

- Every cockpit/auth JSON request belongs to a workspace generation. Reset,
  manual reconnection and page exit abort outstanding requests. Responses and
  failures from an earlier generation cannot populate or close the new
  workspace, including transports that ignore abort.
- A newer complete refresh wins over an older refresh. Startup workspace
  session restoration cannot replace a manual connection made in the meantime.
- Disconnect and `pagehide` clear rendered conversation, headline metrics,
  context, provenance, evidence dialogs, planner/command records, composer and
  confirmation drafts, and the previous snapshot callback. A current 401 from
  any tenant API clears the workspace immediately.
- JSON requests have independent deadlines covering both fetch and JSON body
  parsing: 20 seconds for reads, 90 seconds for writes. Tracking/timers are
  released. Failed or malformed write responses state that persistence may
  already have happened; no request is automatically resubmitted.
- Duplicate pending Ask submissions are suppressed. Simultaneous text/voice
  starts share one conversation creation. Old completion/finally handlers do
  not restore a prior question or unlock the current session's composer.
- Microphone permission, recognition callbacks, queued voice events, peer/data
  channel callbacks, and grounded answers are scoped to their original
  workspace/voice generation. A microphone granted after disconnect is stopped
  before any new tenant voice request. The 15-second WebRTC deadline includes
  a hanging SDP body and releases microphone/peer even if the adapter ignores
  abort. The temporary bootstrap envelope's credential value is cleared.

The existing manual token and human cookie/CSRF boundaries remain distinct;
tokens remain in page memory. The production adapter registry, read-only source
boundary, provider configuration, release gates and persistent schemas are not
changed by this batch.

## Evidence

| Check | Result | Evidence |
|---|---|---|
| Actual client script lifecycle regression | 13/13 PASS | `src/__tests__/cockpitClientLifecycle.test.ts` |
| Focused lifecycle + cockpit HTTP + human-session + voice | 35/35 PASS | `focused-tests.log` |
| Complete repository regression | 402/402 PASS, 0 skipped | `full-tests.log` |
| Strict TypeScript | PASS, exit 0 | `typecheck.log` and execution metadata |
| Production TypeScript build | PASS, exit 0 | `build.log` and execution metadata |
| Chromium actual HTML/script smoke | 7/7 PASS, no page errors | `browser-results.json`, `browser.log` |

The 13 new client tests are included in the total 402; the focused count must
not be added again. Compiler success logs are empty because `tsc` emitted no
diagnostic. The first exploratory test attempt failed because the DOM harness
did not parse heading tags containing digits; the harness was corrected and
all final checks above passed without weakening application assertions.

The Chromium smoke uses 1280×900 desktop and 390×844 mobile, the built HTML,
script, CSS and checked-in images. It performs real clicks, question submission,
dialog opening, pending-answer disconnect, tenant reconnection and expiry
clearing. A separate case delays automatic session restoration. Every HTTP
request is intercepted with fixture responses; unsupported secondary evidence
is intentionally unavailable. Screenshots are `desktop-reconnected.png` and
`mobile-reconnected.png` and contain fixture tenant names only.

## Reproduction

```powershell
npm run typecheck
npm test
npm run build
node qa/cockpit-session-reliability/browser-smoke.cjs
```

This machine exposes Node 24.19.0 but no `npm`/`npx` command on PATH. Equivalent
checks invoked `node node_modules/typescript/bin/tsc [--noEmit]` and the exact
test arguments from `package.json` through
`node node_modules/tsx/dist/cli.mjs`. Node test workers and headless Chromium
required sandbox escalation after the initial test runner reported `spawn
EPERM`; automatic review allowed the fixture-only test commands.

The optional browser smoke borrows Playwright already installed in sibling
`CRMegoric-Realm-3D`, relative to the LeozOps repository working directory. It
does not add a production dependency or start an ERP-connected preview.

## Limits and next work

- No live SSO issuer, cross-origin deployment, real microphone/audio sample,
  provider credential, live source, G5/G6/G7 or J1–J8 acceptance was exercised.
- No database schema changed. Existing regression uses isolated SQLite;
  this batch does not claim new PostgreSQL deployment evidence.
- A cancelled or timed-out write may have committed on the server. Manual
  reconciliation and durable idempotent retry UX across all advisory forms
  remain follow-up work; transport cancellation does not undo persistence.
- Voice disconnect evidence is best effort. Local media cleanup is verified,
  but an interrupted page exit cannot guarantee server delivery of its last
  lifecycle event.
- Browser checks cover Chromium fixtures, not a complete browser/device or
  accessibility matrix. Mobile still presents CEO memory/preferences above the
  conversation; a later work-experience pass should shorten access to the
  composer. No new visual-quality or AAA acceptance is claimed here.
