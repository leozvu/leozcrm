# Phase 15–16 security review

Date: 2026-08-09

Scope: exact RepositoryRealms adapter/release boundary, Ambient Jarvis HTTP and
browser surfaces, preferences, evaluation, readiness, export, governance
repository, and migrations.

## Automated evidence

- `npm test`: 364/364 passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- Ruflo deep focused scan of `src/http`: 0 findings.
- Ruflo deep focused scan of `src/domain`: 0 findings.
- Ruflo deep focused scan of `src/integrations/actions`: 0 findings.
- Ruflo deep focused scan of `src/repositories`: 0 findings.
- `npm audit --audit-level=low`: 0 vulnerabilities after upgrading `uuid` to
  `11.1.1`, `tsx` to `4.23.11`, and pinning patched transitive `body-parser`
  `1.20.6` and `esbuild` `0.28.1`.
- RepositoryRealms `npm audit --audit-level=low`: 0 vulnerabilities after
  pinning patched `postcss` `8.5.26` and `nanoid` `3.3.18`.
- Ruflo deep dependency scans of both repositories: 0 findings.
- Disposable PostgreSQL 16 migrate/evidence/immutability/rollback lifecycle:
  passed; its loopback-only, no-volume container was removed after the run.

Both dependency remediations passed the full repository suites and production
builds. RepositoryRealms additionally passed Prisma validation, migration-chain
CI, coverage, Playwright E2E, and both Vercel preview checks before PR #9 was
merged to canonical `main`.

## Ruflo repo-wide heuristic triage

The repo-wide deep scan reported fourteen high heuristic findings:

- seven migration SQL findings are DDL trigger templates whose table names
  come only from closed source constants passed by migration code; no request,
  environment, database row, or file input reaches an identifier;
- three recovery-operator findings are fixed PostgreSQL SQL literals and a
  service name restricted to `[A-Za-z0-9_.-]`; commands use an argument array
  with `spawn(..., shell:false)`, strip credential environment variables, cap
  output, and verify the disposable database identity;
- four command-injection findings are regex/string literals in tests that
  assert forbidden execution primitives are absent.

These are false positives after manual data-flow review. They were not hidden
or suppressed, and the focused production-code scans above remain recorded.

## Boundary review

- All new API routes are behind exact tenant authentication and 32 KiB strict
  JSON parsing where a body exists.
- Preferences and data requests are append-only, idempotent, tenant-scoped,
  strict-field records with canonical hashes.
- Export requires an exact confirmed request and returns no raw snapshot,
  credential/secret reference, provider body, command payload, or cross-tenant
  data.
- Delete requests cannot delete data; automatic deletion is disabled.
- Browser credentials remain in memory, CSP denies inline/eval/frame/object,
  the service worker excludes `/v1`, voice never auto-sends, and action-shaped
  questions require advisory confirmation.
- The exact action adapter rejects drift before transport, separates operation
  credentials/subjects, verifies source hashes, performs no retry, and leaves
  the default registry empty.

## Live blockers

This review is repository evidence, not a production penetration test or
privacy acceptance. Live J8 still needs the exact deployed image/source,
credential revocation, browser/device review, PostgreSQL/container jobs,
external security/privacy review, recovery
and export drills, incident closure, J1–J7, and the 30-day report.
