# Phase 17 — Talking Jarvis foundation

Status: **repository candidate; live Realtime proof and CEO acceptance absent**

Canonical repository revision: PR #22 merged to
`main@875ec3295e4f577af44810d1a70ed73e4f5d747a` after all eight configured
push/PR checks passed.

Phase 17 turns the Cockpit's reviewed push-to-talk fallback into an
interruptible, full-duplex conversation surface without giving voice any
business mutation authority. The browser sends microphone media directly to
OpenAI over WebRTC. LeozOps mints only a short-lived client secret on the
server, requires every spoken turn to call the existing read-only Advisor, and
stores only a privacy-minimized session lifecycle.

## Architecture

```text
CEO browser
  |-- tenant read credential --> LeozOps voice-session API
  |                               |-- server OpenAI API key
  |                               `-- short-lived ek_ client secret
  |-- microphone/WebRTC + ek_ ------------------------> OpenAI Realtime
  |<---------------------------- remote audio/data ----|
  |-- ask_leozops tool call --> LeozOps Advisor API --> Business Memory
  `-- lifecycle metadata -----> append-only evidence
```

The standard OpenAI API key never enters HTML, JavaScript, API responses,
logs, evidence rows, or browser storage. The ephemeral secret exists only in a
function-local browser variable long enough to exchange SDP and is then
cleared. LeozOps does not proxy, record, cache, or persist microphone audio,
remote audio, or transcripts.

## HTTP contract

All routes require the existing tenant-scoped read credential:

- `POST /v1/tenants/:tenantKey/jarvis/voice/sessions` creates an immutable
  session and returns a no-store WebRTC bootstrap envelope.
- `GET /v1/tenants/:tenantKey/jarvis/voice/sessions/:sessionId` returns a
  sanitized, integrity-verified lifecycle view.
- `POST /v1/tenants/:tenantKey/jarvis/voice/sessions/:sessionId/events`
  appends a strict idempotent lifecycle event.

The create response contains the short-lived `ek_` secret because the browser
needs it for the WebRTC handshake. It is never written to the database. The
stored evidence contains session/event fingerprints, provider/model metadata,
state transitions, safe failure codes, and timestamps only.

## Grounding and action boundary

The Realtime session exposes exactly one business tool: `ask_leozops`. Session
tool choice is `required`, so every user turn must pass through that tool. The
tool calls the same tenant-scoped Advisor API used by the Cockpit, then returns
compact facts, inferences, recommendations, limitations, and citation hashes
to Realtime for spoken delivery. The follow-up response explicitly disables
tools to prevent recursive calls.

Action-shaped spoken requests are deterministically blocked before the
Advisor call. The CEO is told to review and confirm through the existing text
and Command Deck flow. Talking Mode has `action_authority: none`; it cannot
preview, approve, execute, reconcile, or roll back a RepositoryRealms command.

## Provider configuration

Talking Mode is fail-closed by default:

```text
LEOZOPS_VOICE_PROVIDER=disabled
```

An approved server runtime may enable the current OpenAI Realtime adapter:

```text
LEOZOPS_VOICE_PROVIDER=openai_realtime
OPENAI_API_KEY=<server-only secret binding>
```

Optional controls:

```text
LEOZOPS_OPENAI_REALTIME_TIMEOUT_MS=8000
```

The adapter pins the OpenAI client-secret endpoint, `gpt-realtime-2.1`, voice
`marin`, server VAD, interruption,
an application-derived safety identifier, a bounded timeout, a bounded
response body, and strict ephemeral-secret validation. The endpoint must be
HTTPS. Runtime configuration cannot redirect the server API key to another
host. Provider errors expose only stable safe codes. Each tenant may create at
most five sessions per minute, and an idempotent session permits only one
credential recovery, preventing an authenticated client from turning replay
into an unbounded broker loop.

The implementation follows the current official
[Realtime WebRTC guide](https://developers.openai.com/api/docs/guides/realtime-webrtc),
[voice-agent guide](https://developers.openai.com/api/docs/guides/voice-agents),
and [Realtime model reference](https://developers.openai.com/api/docs/models/gpt-realtime).

## Lifecycle and interruption

The append-only lifecycle supports:

`authorizing → connecting → listening → thinking → speaking`

The CEO can interrupt spoken output. Barge-in records `interrupted` and returns
the session to `listening`. Disconnect, page exit, microphone failure, provider
failure, and connection timeout release the media track and peer connection;
terminal sessions cannot be reopened or rewritten.

## Evidence and current truth

Repository tests cover state transitions, interruption, idempotency,
immutability, tenant isolation, broker request shape, secret sanitization,
provider-disabled behavior, CSP, UI, and migration rollback/reapply. The
PostgreSQL smoke also creates both voice tables, appends safe credential
metadata, rejects direct mutation, and verifies rollback.

No OpenAI key was available during repository implementation. Therefore this
phase does **not** claim a successful microphone permission flow, Realtime SDP
exchange, audible response, latency/cost measurement, browser/device matrix,
CEO usability acceptance, production privacy review, or any J1–J8 gate. Those
are the next named-environment evidence tasks.
