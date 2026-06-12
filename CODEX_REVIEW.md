# Codex QA Review: Milestone M8A Email Publishing

Review target: current Milestone M8A implementation from `CHECKLIST.md`.

## Verdict: FAIL

Verified locally:

- `npm run typecheck` passed.
- `npm test` passed: 113/113 tests.

## Critical Issues

1. **Spend, rate, and circuit guardrails are applied per logical publish, but retries can make multiple provider calls under one guarded unit.**  
   Evidence: `src/integrations/email/emailPublishService.ts:78`-`src/integrations/email/emailPublishService.ts:84` checks the guard and reserves exactly one quota unit before retrying. The provider call happens inside the retry loop at `src/integrations/email/emailPublishService.ts:90`-`src/integrations/email/emailPublishService.ts:92`, so one accepted publish can perform `maxRetries + 1` Resend calls. The failure is only recorded once after the loop at `src/integrations/email/emailPublishService.ts:113`-`src/integrations/email/emailPublishService.ts:115`, so the circuit breaker also counts one logical failure rather than each failed provider attempt. `EMAIL_MAX_RETRIES` is read without bounds at `src/integrations/email/emailPublishService.ts:138` and `src/integrations/email/emailPublishService.ts:143`-`src/integrations/email/emailPublishService.ts:148`, allowing configuration to multiply external calls far beyond the daily/rate caps. The current test suite proves the behavior: `src/__tests__/emailPublish.test.ts:94`-`src/__tests__/emailPublish.test.ts:102` expects one publish with `maxRetries: 2` to make three attempts.

## High-Priority Issues

1. **Sender identity and required Resend configuration are not enforced at the publish boundary.**  
   Evidence: the route accepts a caller-controlled `from` field at `src/http/routes/emailPublish.ts:46` and forwards it directly to the publisher at `src/http/routes/emailPublish.ts:53`. Message validation only checks `to`, `subject`, and body at `src/integrations/email/emailPublishService.ts:53`-`src/integrations/email/emailPublishService.ts:60`; it does not reject, validate, or allowlist `from`. The adapter then prefers `message.from` over configured `EMAIL_FROM` at `src/integrations/email/resendEmailAdapter.ts:160`-`src/integrations/email/resendEmailAdapter.ts:162`. Separately, `isConfigured()` only requires an API key and transport at `src/integrations/email/resendEmailAdapter.ts:100`-`src/integrations/email/resendEmailAdapter.ts:103`, even though `buildEmailPublisherFromEnv()` reports `EMAIL_FROM` as required in the not-configured message at `src/integrations/email/emailPublishService.ts:73`-`src/integrations/email/emailPublishService.ts:75`; with `RESEND_API_KEY` set and `EMAIL_FROM` missing, the provider request can be attempted with an empty sender.

2. **The M8A tests are sandbox doubles, not end-to-end email sandbox verification.**  
   Evidence: `src/__tests__/emailPublish.test.ts:1`-`src/__tests__/emailPublish.test.ts:6` explicitly states the tests use a sandbox transport with no real network. The success transport is a local fake returning a static id at `src/__tests__/emailPublish.test.ts:53`. Route tests also inject a fake publisher/transport at `src/__tests__/emailPublishRoutes.test.ts:34`-`src/__tests__/emailPublishRoutes.test.ts:48`, and the fake success transport returns a static id at `src/__tests__/emailPublishRoutes.test.ts:51`-`src/__tests__/emailPublishRoutes.test.ts:53`. This does not prove the Resend request contract, credential behavior, or sandbox-provider response handling promised by M8A.

## Nice-to-Have Improvements

None.
