# Phase 8 Operations — Controlled Single Activation

Status: **LOCAL CONTROL PLANE COMPLETE; PRODUCTION ADAPTER NOT INSTALLED**

Authority: DECISION-002 addendum 19. Plan: `SPRINT_8_PLAN.md`.

## Safety invariant

One accepted Phase 8 policy can consume one exact, current, unrecalled Phase 7
handoff. It allows one persisted activation claim and at most one adapter
invocation. The kill switch starts engaged, release is short-lived and requires
two separately hashed credentials, and every terminal result re-engages it.

An absent or invalid adapter response is not a failure and is never guessed as
success. It is stored as terminal `unknown`, an incident is opened, and the
adapter is not called again. An orphan claim whose lease expires is reconciled
to `unknown` without external invocation. Automatic retry, observation, and
rollback are forbidden.

The checked-in production activation registry is empty. Therefore this branch
cannot affect a real target. Only deterministic injected adapters exercise the
path in tests. Installing a provider adapter, target credential, or deployment
remains a separate reviewed and explicitly authorized change.

## Solo-founder roles

Leoz may be the named actor for all four roles, but must use four different
secret values:

- release authority: accepts policy and authorizes a short release;
- executor: requests zero-mutation preview and consumes the one claim;
- safety observer: co-releases, observes, and reconciles expired claims; and
- rollback operator: invokes rollback after separate release-authority approval.

None of these four secrets may equal another Phase 8 secret or any upstream
G6/G7/Phase 5/6/7 credential. Only SHA-256 fingerprints enter policies and the
database. Raw values belong in a secret manager and the one-shot process
environment, never JSON or source control.

## Required order

1. Verify the exact Phase 7 handoff is sealed, unrecalled, `not_executed`, and
   still backed by the fresh current Phase 6 assessment and eight attestations.
2. Review a new pending template and replace every pending value with exact
   fingerprints. The Phase 8 target, canary, and rollback contracts must equal
   Phase 7 byte-for-byte after canonical hashing.
3. Register and independently review one exact adapter implementation. It must
   report idempotency, observation, and rollback support and match environment,
   target, artifact, configuration, version, and credential-reference hashes.
4. Run preflight. Any issue blocks. Accept the policy only in its validity
   window and while the exact Phase 7/6 chain is current.
5. Request one zero-mutation preview. A policy has one immutable preview; if it
   expires before release, recall/rebuild the upstream handoff rather than
   editing evidence.
6. Release with release-authority plus observer credentials. Release lasts no
   longer than the policy, preview, or configured five-to-thirty-minute limit.
7. Invoke `activate` once. The claim is committed before the adapter is called.
   Never retry manually after a lost response or process crash.
8. If the claim lease expires with no outcome, run `reconcile-expired-claim`.
   This records `unknown`, opens an incident, engages the switch, and performs
   no adapter call.
9. After the exact canary observation period, invoke `observe`. Healthy evidence
   must bind the configured success metric and activation receipt. Unhealthy,
   unknown, or missed-deadline evidence opens an incident.
10. If recovery is required, review evidence and invoke `rollback` explicitly
    with release-authority and rollback-operator credentials before the policy
    window closes. No incident triggers rollback automatically.

## Runtime bindings

Preflight requires exact values for `LEOZOPS_PHASE8_ENVIRONMENT`, policy,
Phase 7 policy/handoff, target, adapter artifact, configuration,
credential-reference, rollback artifact, rollback procedure, and all four
credential fingerprints. The operator reads raw secrets only from:

- `LEOZOPS_PHASE8_RELEASE_CREDENTIAL`;
- `LEOZOPS_PHASE8_EXECUTOR_CREDENTIAL`;
- `LEOZOPS_PHASE8_OBSERVER_CREDENTIAL`; and
- `LEOZOPS_PHASE8_ROLLBACK_CREDENTIAL`.

The corresponding `*_SHA256` environment values are fingerprints, not raw
secrets. Never print or persist the raw variables.

## Commands

```text
npm run phase8:preflight -- config/phase8.activation-execution-policy.example.json
npm run activation:operator -- accept-policy input.json
npm run activation:operator -- preview input.json
npm run activation:operator -- release input.json
npm run activation:operator -- activate input.json
npm run activation:operator -- reconcile-expired-claim input.json
npm run activation:operator -- observe input.json
npm run activation:operator -- rollback input.json
npm run activation:operator -- readiness input.json
npm run activation:operator -- status input.json
```

Exact JSON keys:

- `accept-policy`: `policy_file`;
- `preview`: `policy_id`, `preview_key`, `actor`;
- `release`: `policy_id`, `release_key`, `reason_code`, `release_actor`,
  `observer_actor`;
- `activate`: `policy_id`, `activation_key`, `actor`;
- `reconcile-expired-claim`: `policy_id`, `actor`;
- `observe`: `policy_id`, `observation_key`, `actor`;
- `rollback`: `policy_id`, `rollback_key`, `reason_code`, `authority_actor`,
  `rollback_actor`; and
- `readiness` / `status`: `policy_id`.

Unknown or missing keys fail before persistence. Reusing a key returns the same
immutable result only when it binds the same operation; retargeting fails.

## Incident decisions

- `activation_failed`: adapter states zero mutations. Keep the switch engaged;
  verify target facts out of band before creating any new upstream chain.
- `activation_unknown`: mutation count is unknown. Do not retry or accept a new
  policy for the same handoff. Investigate provider state using the bound target
  and idempotency key.
- `observation_unhealthy` / `observation_unknown`: no automatic rollback. The
  release authority decides whether the explicit rollback path is safe.
- `rollback_failed` / `rollback_unknown`: do not invoke rollback again. Escalate
  to the provider-specific incident procedure and preserve all receipts.

All policy, switch, preview, release, claim, outcome, observation, rollback,
incident, and ordered event rows are append-only on SQLite and PostgreSQL.

## Remaining production boundary

Real infrastructure, source-side idempotency verification, provider adapter,
least-privilege credential, live canary, monitoring, deployment, and incident
drill are external facts. Until those are separately authorized, implemented,
reviewed, and registered, Phase 8 preflight must report `blocked` and activation
is impossible from the checked-in production composition.
