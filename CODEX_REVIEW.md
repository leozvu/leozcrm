# Codex QA Review: Milestone #4 Recommendation System V0

Review target: current Milestone #4 implementation from `CHECKLIST.md`.

## Verdict: FAIL

Milestone #4 is close, but recommendation output is not accurate for empty-client cases. The implementation returns a "maintain momentum" recommendation for a client with no leads, which is not explainable or business-accurate for an empty funnel.

Verified locally:

- `npm run typecheck` passed.
- `npm test` passed: 51/51 tests.
- No unnecessary schema changes were introduced: no new migration files are present under `src/db/migrations`, and the new recommendation service reuses `BriefService`.
- No dashboard, integration, or autonomous execution layer was added.
- The previous `asOf` validation issue is fixed by `src/domain/date.ts`, and both `/brief` and `/recommendations` use real calendar-date validation.

## Critical Issues

None.

## High-Priority Issues

1. **FAIL: Empty-client recommendations are inaccurate.**  
   Evidence: `src/services/recommendationService.ts:105` treats "no recommendations" as a "Healthy funnel" fallback, then returns `maintain_momentum` at `src/services/recommendationService.ts:109`-`src/services/recommendationService.ts:117`. The test locks this behavior in by naming a no-lead client "healthy" at `src/__tests__/recommendations.test.ts:81` and expecting `maintain_momentum` at `src/__tests__/recommendations.test.ts:86`-`src/__tests__/recommendations.test.ts:89`. This fails the Milestone #4 requirement that recommendation output be accurate and explainable: a client with no leads has no momentum to maintain. It also conflicts with the output contract comment that recommendations are "Empty only for an empty client" at `src/domain/recommendation.ts:46`.

## Nice-to-Have Improvements

1. Add an explicit no-data/empty-funnel recommendation contract, or return an empty list for empty clients and make the route/service tests assert that behavior.

2. Add a route-level assertion that recommendation rationale stays client-scoped by seeding a second client with a campaign name that should not appear in the first client's recommendation output.

3. Consider adding a small `source_signals` or `derived_from` field later so each recommendation can point to the anomaly/action code or KPI condition that produced it without requiring clients to infer that from the rationale text.

## Verification Notes

- `asOf` validation: PASS. `isValidIsoDate` rejects malformed and date-shaped invalid values via regex plus UTC round-trip validation in `src/domain/date.ts:15`-`src/domain/date.ts:20`. `/recommendations` uses it before service generation in `src/http/routes/recommendations.ts:61`-`src/http/routes/recommendations.ts:68`.
- Advisory-only behavior: PASS. The report and each recommendation carry literal `advisory_only: true` in `src/domain/recommendation.ts:33`-`src/domain/recommendation.ts:45`, and the service only reads from `BriefService` before returning a report in `src/services/recommendationService.ts:64`-`src/services/recommendationService.ts:76`.
- Schema changes: PASS. No new migration files were added; Milestone #4 implementation is in domain/service/route/test files.
- Dashboard/integration/autonomous execution: PASS. The new route is read-only and only mounts `GET /recommendations`; no dashboard UI, integration connector, scheduler, executor, or mutation path was added.
- Client scoping: PASS. `/recommendations` requires and validates one `clientId` before generation in `src/http/routes/recommendations.ts:41`-`src/http/routes/recommendations.ts:52`, then returns `brief.client_id` in `src/services/recommendationService.ts:70`-`src/services/recommendationService.ts:75`.
