# Phase 6 Operations — Signed External-Evidence Admission

Status: **LOCAL TRUST BRIDGE ONLY; ACTIVATION ALWAYS BLOCKED**

Authority: DECISION-002 addendum 17. Plan: `SPRINT_6_PLAN.md`.

## Safety invariant

Phase 6 can accept and verify evidence but cannot release, promote, activate, or
execute anything. A complete matrix is `complete_unreleased`; release status is
always `blocked_external_activation`. The production adapter registry remains
empty and these commands contain no network client, timer, or background loop.

## Fixed evidence matrix

| Evidence type | Phase 5 blocker | Required pinned issuer role |
|---|---|---|
| `external_g5_release` | `external_g5_release_unproven` | Product Owner |
| `command_specific_g6_release` | `command_specific_g6_release_unproven` | Product Owner |
| `production_supervised_history` | `production_supervised_history_unproven` | monitoring |
| `production_adapter_and_credential` | `production_adapter_and_credential_absent` | implementation |
| `deployed_monitoring_and_kill_switch` | `deployed_monitoring_and_kill_switch_unproven` | monitoring |
| `production_canary` | `production_canary_unproven` | independent QA |
| `external_incident_recovery_drill` | `external_incident_recovery_drill_unproven` | independent QA |
| `product_owner_g7_release` | `product_owner_g7_release_unproven` | Product Owner |

There is no wildcard type and no alternate issuer. All eight are required.

## Trust and signing ceremony

1. Generate four Ed25519 key pairs outside LeozOps. Keep each private key in its
   issuer's secret manager or signing system; never put it in this repository,
   an operator input, the database, logs, or environment variables.
2. Export canonical SPKI public PEM files, independently confirm their SHA-256
   fingerprints, and pin role, issuer ID, key ID, PEM, and fingerprint in the
   exact Phase 6 policy.
3. Bind the policy to the latest passing Phase 5 assessment and exact immutable
   `blocked_external` package. Authority and assessor runtime credentials must
   be distinct from each other and all Phase 5/G7/G6 credentials.
4. The issuer signs the canonical JSON serialization of the `attestation`
   object only with Ed25519. `signature` is the detached base64 envelope field.
   The checked-in template signature is deliberately invalid and is not proof.

## Commands

Each command reads one exact JSON input and exits:

```text
npm run phase6:preflight -- config/phase6.external-evidence-policy.example.json
npm run evidence:operator -- accept-policy input.json
npm run evidence:operator -- admit input.json
npm run evidence:operator -- assess input.json
npm run evidence:operator -- status input.json
```

Input keys:

- `accept-policy`: `policy_file`;
- `admit`: `policy_id`, `envelope_file`, `actor`;
- `assess`: `policy_id`, `assessment_key`, `actor`;
- `status`: `policy_id`.

Unknown/missing keys fail before persistence. Preflight deliberately exits 2
even when admission configuration is ready because it never authorizes release.

## Fail-closed behavior

Admission revalidates the current Phase 5/G7/G6 chain, local G5 `go`, exact
Phase 5 assessment/package, empty production registry, policy validity, exact
tenant/source/environment/package bindings, allowed evidence type, assigned
issuer, pinned ID/key, Ed25519 signature, clock skew, observation age, expiry,
attestation ID, and nonce. Failure persists no untrusted envelope.

An identical replay returns the existing immutable row. The same attestation ID
with changed content, reused nonce, or non-increasing statement time is rejected.
A signed `revoke` must name and supersede the latest pass for that exact evidence
type. The next assessment marks that row `revoked`; expired/stale pass evidence
is marked `expired`.

## Incident response and key rotation

On suspected evidence or key compromise, stop admission, preserve logs, have
the currently pinned issuer sign revocations for affected latest passes, and run
a new assessment key. A new issuer key cannot be silently substituted: key
rotation requires a new exact Phase 6 policy and separate authority acceptance.
Old immutable evidence must not be edited or deleted.

## Remaining external boundary

The repository contains example public keys only. It does not enroll a real
trust root, obtain raw external evidence, sign on any issuer's behalf, register a
production adapter, deploy monitoring, or activate G7. Those actions require a
future decision naming real infrastructure and release authority.
