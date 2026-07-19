# Claude Code Implementation Brief — Egoric Integration

Before implementing integration work, read these files in order:

1. `PRODUCT.md`
2. `docs/EGORIC_INTEGRATION.md`
3. `DECISIONS.md`
4. `HERMES.md`
5. `CHECKLIST.md`
6. `ARCHITECTURE.md`

For Egoric integration work, `docs/EGORIC_INTEGRATION.md` is the canonical
technical contract. Older CRM-first, task, publishing, onboarding, or M10 pilot
instructions are historical when they conflict with it.

## Architecture mandate

Egoric remains the operational system of record. LeozOps is a separately
deployed, read-only API intelligence layer.

Implementation must not:

- give LeozOps direct Egoric/Supabase database access;
- reuse an Egoric Director or employee-role API key;
- call a generic Egoric CRUD endpoint;
- send POST, PUT, PATCH, or DELETE from LeozOps to Egoric;
- duplicate Egoric clients, leads, tasks, users, or invoices as operational
  records;
- map Egoric Client records to LeozOps tenants;
- coerce Egoric's native funnel into LeozOps' nine-stage funnel;
- mount LeozOps CRM mutations, onboarding, tasks, or email publishing in the
  integration deployment profile;
- create external actions from a recommendation;
- use current Egoric webhooks as the source of truth.

If a task requires any item above, stop and ask Hermes to obtain a product and
security decision. Do not silently broaden the scope.

## Approved first slice

Sequencing per DECISION-002 (`DECISIONS.md`): Sprint 1 → Sprint 2, evidence
gates G1–G4, no calendar dates. Sprint 1 is S1.A → S1.B → S1.C → S1.D per
`docs/EGORIC_INTEGRATION.md` §13. Do not start Sprint 2 work until Sprint 1
acceptance (G4) is recorded in `DECISIONS.md`.

The first slice (S1.A, gate G1) is the feature-flagged Egoric endpoint:

```http
GET /api/integrations/leozops/v1/lead-snapshot
Authorization: Bearer <LEOZOPS_READ key>
```

It returns de-identified lead facts only, uses the `egoric_sales_v1` contract,
supports deterministic ETag/304 behavior, and denies every other method and
generic resource route to the integration key.

After that contract passes Codex QA (G1), implement the LeozOps source adapter
and immutable read model (S1.B, gate G2), then the native-funnel CEO Brief and
integration-only application profile (S1.C, gate G3), then the local
end-to-end proof (S1.D, gate G4) in the task order documented in
`docs/EGORIC_INTEGRATION.md`. The scheduled 15-minute ETag poller and other
hardening are Sprint 2 (post-G4) work.

## Engineering constraints

- Keep Egoric and LeozOps changes in separate commits/PRs.
- Make the pilot additive; do not refactor employee workflows.
- Use an independent LeozOps database and secret set.
- Preserve contract and formula versions in stored data and output.
- Store snapshots and intelligence runs idempotently.
- Log identifiers, counts, latency, freshness, and versions; never log PII or
  raw credentials.
- Implement the feature flag and key-revocation rollback before production
  enablement.
- No Prisma entity change is needed for the pilot.
- Do not start a cursor/change-feed or webhook/outbox implementation inside the
  pilot PR.

## Required completion evidence

Provide:

- existing and new test results;
- authorization matrix results;
- JSON Schema and recursive PII-denial results;
- deterministic ETag/304 evidence;
- Egoric count reconciliation;
- no-write-egress test evidence;
- idempotency and retry/fault-injection evidence;
- feature-flag and key-revocation rollback evidence;
- a statement that no unrelated employee workflow changed.

Do not mark the integration ready until Codex passes every QA gate in
`docs/EGORIC_INTEGRATION.md`.
