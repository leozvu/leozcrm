/**
 * Per-tenant email spend guardrails (Milestone #8A).
 *
 * As of Milestone #8B the guard mechanism (daily cap / rate limit /
 * stop-on-failure circuit) is shared with the social publish path and lives in
 * `../spendGuard.ts` as `PublishSpendGuard`. The email publish path keys it by
 * `client_id`; behaviour, configuration, and semantics are unchanged. This
 * module keeps the M8A names/import-path stable.
 */

export { PublishSpendGuard as EmailSpendGuard, SpendGuardConfig, GuardDecision } from '../spendGuard';
