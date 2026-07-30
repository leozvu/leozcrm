# Phase 7 Operations — Activation Ceremony and Sealed Handoff

Status: **LOCAL CEREMONY ONLY; ACTIVATION NOT IMPLEMENTED**

Authority: DECISION-002 addendum 18. Plan: `SPRINT_7_PLAN.md`.

## Safety invariant

Phase 7 may produce a verified, sealed package for an external operator. It
cannot deploy, promote, activate, call a provider, register an adapter, recover
an external system, or change external state. Every handoff stores
`activation_status=not_executed` and `external_execution_required=true`.

The checked-in production adapter registry must remain empty. The preflight and
operator are command-and-exit programs with no network client, scheduler,
daemon, timer, background loop, or HTTP mutation route.

## Ceremony

1. Produce a new Phase 6 assessment after all eight signed attestations bind
   the same exact deployment ID and target fingerprint.
2. Fill a new policy from the pending template. Bind the exact Phase 6 policy
   and assessment fingerprints, named provider/region/project/service, adapter
   artifact, configuration, credential-reference fingerprint, one-record
   canary, success/abort metrics, and rollback artifacts.
3. Keep the authority, verifier, and operator secrets separate. A solo founder
   may use `Leoz` for all role names, but must use three independent secret
   values and ceremony steps.
4. Accept the policy, create a database-derived dossier, verify it, and seal the
   handoff. Every write rechecks active upstream policies, the latest Phase 6
   assessment, all eight current attestations, freshness, target consistency,
   and the empty registry. Snapshot checks are repeated under the Phase 6 row
   lock before persistence.
   A policy can seal at most one handoff; after recall or material change, use a
   new Phase 6 assessment and a new Phase 7 policy.
5. Give the resulting handoff fingerprint to a separately authorized external
   execution process. This repository contains no such process.

## Runtime bindings

Preflight requires exact values for:

- `LEOZOPS_PHASE7_ENVIRONMENT`, `LEOZOPS_PHASE7_POLICY_SHA256`;
- `LEOZOPS_PHASE7_PHASE6_POLICY_SHA256`,
  `LEOZOPS_PHASE7_PHASE6_ASSESSMENT_SHA256`;
- `LEOZOPS_PHASE7_TARGET_SHA256`, adapter artifact, configuration,
  credential-reference, rollback-artifact, and rollback-procedure hashes; and
- authority, verifier, and operator credential hashes.

The operator additionally reads the three raw ceremony credentials from
`LEOZOPS_PHASE7_AUTHORITY_CREDENTIAL`,
`LEOZOPS_PHASE7_VERIFIER_CREDENTIAL`, and
`LEOZOPS_PHASE7_OPERATOR_CREDENTIAL`. Load them from a secret manager into the
one-shot process environment. Never commit them or place them in JSON inputs.
The target's real provider credential is not accepted by this package; only a
non-secret reference fingerprint is policy-bound.

## Commands

```text
npm run phase7:preflight -- config/phase7.activation-ceremony-policy.example.json
npm run ceremony:operator -- accept-policy input.json
npm run ceremony:operator -- create-dossier input.json
npm run ceremony:operator -- verify-dossier input.json
npm run ceremony:operator -- seal-handoff input.json
npm run ceremony:operator -- recall-handoff input.json
npm run ceremony:operator -- status input.json
```

Exact input keys:

- `accept-policy`: `policy_file`;
- `create-dossier`: `policy_id`, `dossier_key`, `actor`;
- `verify-dossier`: `policy_id`, `dossier_key`, `verification_key`, `decision`,
  `reason_code`, `actor`;
- `seal-handoff`: `policy_id`, `dossier_key`, `handoff_key`, `actor`;
- `recall-handoff`: `policy_id`, `recall_key`, `reason_code`,
  `evidence_fingerprint`, `authority_actor`, `verifier_actor`;
- `status`: `policy_id`.

Unknown or missing keys fail before persistence. Preflight always exits 2,
including when it reports `ceremony_ready_unexecuted`, because readiness is not
activation authority.

## Fail-closed and incident procedure

Do not seal if an assessment is stale, a newer assessment exists, an
attestation expires/revokes/changes, target bindings differ, verification is
rejected/expired, any upstream policy or event chain drifts, or a production
adapter appears. Create a fresh Phase 6 assessment and a new Phase 7 policy;
never edit prior records.

If a sealed handoff becomes unsafe, stop external execution and run
`recall-handoff` with both authority and verifier credentials. Recall is
additive: the dossier, approval, handoff, and audit chain remain immutable. It
does not call a kill switch or provider. Any real stop/rollback/recovery remains
an explicit human action outside LeozOps under separate authority.

## Remaining external boundary

Real infrastructure identity, real artifacts, secret-manager reference,
production adapter installation, canary execution, monitoring, deployment,
activation, rollback, and incident response remain external facts and actions.
A future phase must explicitly authorize and implement an executor before any
sealed package can affect production.
