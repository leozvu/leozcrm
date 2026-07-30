# Phase 5 Operations — Operational Assurance and Release Evidence

Status: **LOCAL CONTROL PLANE ONLY; EXTERNAL RELEASE ALWAYS BLOCKED**

Authority: DECISION-002 addendum 16. Plan: `SPRINT_5_PLAN.md`.

## Safety invariant

Phase 5 has no release, approve, promote, waive, schedule, or execute command.
It reads existing immutable G5/G6/G7 facts, writes immutable assessments and
release packages, and always reports `blocked_external` for release status.

The checked-in production action-adapter registry is empty. These tools perform
no network request and do not contain a timer or background loop.

## Credentials

Raw credentials are supplied only at invocation time:

- `LEOZOPS_PHASE5_AUTHORITY_CREDENTIAL` accepts one exact policy;
- `LEOZOPS_PHASE5_ASSESSOR_CREDENTIAL` records one assessment; and
- `LEOZOPS_PHASE5_REVIEWER_CREDENTIAL` packages a passing local assessment.

Only distinct SHA-256 fingerprints belong in policy/runtime configuration.
These three credentials must also differ from every bound G7 and G6 credential.

## Commands

All commands process one JSON input and exit:

```text
npm run phase5:preflight -- config/phase5.operational-assurance-policy.example.json
npm run assurance:operator -- accept-policy input.json
npm run assurance:operator -- assess input.json
npm run assurance:operator -- package input.json
npm run assurance:operator -- status input.json
```

Accepted input keys are exact:

- `accept-policy`: `policy_file`;
- `assess`: `policy_id`, `assessment_key`, `actor`;
- `package`: `policy_id`, `assessment_key`, `package_key`, `actor`;
- `status`: `policy_id`.

Unknown or missing fields fail before persistence. Assessment/package keys are
idempotent and at least 16 safe characters.

## Assessment behavior

The assessor recomputes policy validity, current G5, G6/G7 validity, simulation,
kill switch, open incidents, execution outcomes, recovery drills, resolved
incident drills, and the G7 event-chain fingerprint from the database. Missing,
corrupt, in-progress, failed, or reconciliation-required evidence fails the
local assessment.

The release packager accepts only the latest passing local assessment inside
its configured 5–60 minute TTL. It recomputes current upstream/safety facts and
rejects any later G5 decision or G7 event-chain drift. Its immutable result is
still `blocked_external` with the canonical external blocker list. There is
deliberately no code path to remove that list.

## Recovery and incident response

Phase 5 does not recover actions. Use the Phase 4 human recovery workflow while
the kill switch is engaged. Run a new Phase 5 assessment with a new key only
after the G7 incident is resolved and database evidence is stable. Never edit or
delete an old assessment or package.

## External acceptance boundary

Real continuation requires a future recorded decision naming infrastructure,
exact production adapter/credential, monitoring, canary, production history,
external incident/recovery drill, and explicit G7 release. Local Phase 5 output
cannot substitute for any of those facts.
