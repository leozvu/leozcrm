# Phase 18 — Jarvis Live Qualification

Status: repository implementation merged through PR #24 at
`main@10b99ae3844e13a9ddf41f5728218885d49f54a6`; named deployment and CEO live
acceptance remain external.

## Outcome

Phase 18 closes the gap between “Talking Mode exists” and “a CEO can qualify a
specific Jarvis deployment.” It adds product-visible voice consent and feedback,
content-free quality evidence, an exact release manifest, startup enforcement,
and one bounded named-deployment qualification command.

It does not manufacture a cloud target, provider key, live business source,
elapsed 30-day window, or J1–J8 acceptance.

## Immutable image publication

`.github/workflows/jarvis-image-release.yml` is a manual artifact-publication
boundary. Its input must be a full revision already reachable from canonical
`main`. It publishes only the revision tag to `ghcr.io/leozvu/leozcrm`, for
`linux/amd64` and `linux/arm64`, with SBOM, maximum provenance and a GitHub
artifact attestation. Every referenced action is pinned by commit SHA.
The Node production base, QEMU helper and BuildKit worker are also pinned by
digest, and a registry probe fails closed instead of moving an existing
revision tag.

The workflow intentionally creates no `latest` tag and performs no deployment.
Its digest may populate an accepted release manifest only after the other exact
environment, source, secret, operations and ownership fields exist.

## Voice evidence contract

Every microphone session requires explicit consent to
`jarvis_voice_privacy_v1` and declares the reviewed
`webrtc_audio_barge_in_v1` capability profile. The consent, lifecycle events,
grounding outcome and optional CEO review are append-only and tenant scoped.

LeozOps stores:

- session/provider/model/voice identifiers and timestamps;
- the privacy-notice and capability-profile identifiers;
- lifecycle, interruption, grounding and safe failure events; grounding
  completion is emitted server-side only after the Advisor result, evidence
  pack, answer hash and citation hashes have validated;
- useful/not-useful rating and a boolean privacy-concern flag;
- deterministic session, event-chain and review fingerprints.

LeozOps does not store raw audio, transcript, question text in voice telemetry,
device ID, browser user-agent, standard OpenAI key or ephemeral client secret.
The grounded Advisor retains its existing separately governed text conversation
record; the voice telemetry layer never copies that text.

`GET /v1/tenants/:tenantKey/jarvis/voice/quality?days=30` reports measured
candidate quality. Its minimum sample is five sessions, ten committed turns and
five CEO reviews. Candidate thresholds are:

- at least 95% connection success;
- at least 95% grounding success;
- at least 95% audible-response coverage;
- at least 80% useful reviews;
- at least one measured barge-in/interruption;
- p95 committed-turn-to-audio latency no more than 10 seconds;
- zero failed sessions and zero reported privacy concerns.

Meeting these thresholds sets only `meets_candidate_thresholds` and always
returns `live_acceptance: not_inferred`.

## Exact release manifest

Start from `deploy/jarvis/release.pending.example.json`. Replace every pending
value, set `status` to `accepted`, and pin:

- canonical `leozvu/leozcrm` 40-character Git revision;
- immutable container digest and registry image identifier;
- exact accepted Phase 12 live-observer manifest fingerprint;
- credential-free HTTPS origin;
- pinned Advisor and Realtime providers/models/voice/privacy version;
- secret-manager environment references, never raw values;
- dashboard, alert, backup, key-rotation, incident and evidence-store IDs;
- solo-founder CEO/runtime ownership and J1–J8 acceptance sequence.

When either live Advisor or Realtime voice is enabled in a production
`egoric-readonly` runtime, startup requires
`LEOZOPS_JARVIS_RELEASE_MANIFEST`. Startup fails closed unless the Jarvis
manifest, Phase 12 manifest, runtime revision, image digest, target URL,
provider selection, source/database identities and secret injections all match.

## Preflight

Inject all Phase 12 bindings plus these non-secret identities and secret
bindings through the deployment platform:

```text
LEOZOPS_JARVIS_RELEASE_MANIFEST=/run/config/leozops-jarvis-release.json
LEOZOPS_RUNTIME_SOURCE_REVISION=<40-character canonical revision>
LEOZOPS_CONTAINER_IMAGE_DIGEST=sha256:<immutable image digest>
LEOZOPS_PUBLIC_BASE_URL=https://<named-origin>
LEOZOPS_ADVISOR_PROVIDER=openai
LEOZOPS_VOICE_PROVIDER=openai_realtime
OPENAI_API_KEY=<server-only secret>
LEOZOPS_OUTPUT_AUTH_SECRET=<distinct tenant-read signing secret>
```

Then run:

```powershell
npm run jarvis:preflight
```

Exit `0` means configuration is internally exact. Exit `2` means blocked. The
output contains identifiers, fingerprints and sanitized issues only.

## Named-deployment qualification

After the deployment is reachable and the CEO has deliberately generated the
minimum voice sample, inject two operator-only qualification values:

```text
LEOZOPS_QUALIFICATION_TENANT_KEY=<exact-tenant-key>
LEOZOPS_QUALIFICATION_READ_CREDENTIAL=<current-tenant-read-credential>
```

Run:

```powershell
npm run jarvis:qualify
```

The command uses bounded no-redirect HTTPS requests to verify:

1. `/startup` exposes the expected deployment fingerprint;
2. `/ready` proves current database migrations;
3. the Cockpit responds with its Content Security Policy;
4. voice evidence meets the candidate thresholds;
5. Jarvis readiness still denies action authority and exposes all J1–J8 gates.

The highest possible result is `candidate_ready_for_ceo_acceptance`. The read
credential is never printed. A passing result is an input to the CEO review; it
does not accept J1–J8 or the 30-day production window.

## Release and incident sequence

1. Rotate/revoke a non-production OpenAI key and record platform evidence.
2. Deploy the exact revision/image/manifest chain to named staging.
3. Complete five consented browser sessions, ten grounded spoken turns, at
   least one barge-in, and five CEO reviews across intended device classes.
4. Investigate every failed session, grounding failure or privacy concern.
5. Run `jarvis:qualify` and preserve its output in the named evidence store.
6. Perform the existing backup/restore, source-poll, alert-route, incident and
   key-rotation drills; retain exact platform artifacts.
7. Accept J1–J7 only through their existing live gate definitions.
8. Observe 30 real days, complete privacy/security/recovery/export review, then
   record explicit Product Owner J8.

On a privacy concern, credential exposure, cross-tenant symptom, unexplained
answer, or unavailable grounding evidence: disable `LEOZOPS_VOICE_PROVIDER`,
revoke the provider key, preserve immutable metadata, follow the named incident
runbook, and do not resume until the cause and recovery evidence are accepted.
