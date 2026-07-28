# Codex QA Review: Milestone #10 MVP Launch & Client Onboarding

Review target: current Milestone #10 implementation from `CHECKLIST.md`.

## Verdict: FAIL

Verified locally:

- `npm run typecheck` passed.
- `npm test` passed: 159/159 tests.
- `npm run db:smoke:pg` was invoked and skipped because no PostgreSQL connection is configured (`DATABASE_URL` or `PGHOST`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`).

Code-level evidence reviewed:

- Admin onboarding route is implemented in `src/http/routes/onboarding.ts`.
- Tenant provisioning logic is implemented in `src/services/onboardingService.ts`.
- Public readiness route is implemented in `src/http/routes/health.ts` and mounted before auth in `src/http/app.ts`.
- Pilot/support runbook exists at `docs/PILOT_RUNBOOK.md`.
- Onboarding and readiness route tests are included in `package.json` and pass.

## Critical Issues

None.

## High-Priority Issues

1. **FAIL: M10 requires a live pilot tenant verified on a deployed system, but the available changes only prove local/in-memory onboarding.**  
   Evidence: `CHECKLIST.md:182` requires the "First live pilot client or internal tenant created and verified on the deployed system", and `CHECKLIST.md:188` requires the pilot tenant to create campaigns, leads, tasks, and receive briefs/recommendations "on the live instance". `ROADMAP.md:81` also states that M10 gates on a live deployment with PostgreSQL and the current stack validated in a real hosting environment. The current verification tests boot a local ephemeral app against the injected test database at `src/__tests__/onboardingRoutes.test.ts:23`-`src/__tests__/onboardingRoutes.test.ts:31`; they do not exercise a deployed base URL. The runbook still presents manual placeholder verification commands at `docs/PILOT_RUNBOOK.md:83`-`docs/PILOT_RUNBOOK.md:89`, and states at `docs/PILOT_RUNBOOK.md:92`-`docs/PILOT_RUNBOOK.md:93` that those live-instance checks are what meet the M10 launch criterion. No repo artifact records a live `BASE_URL`, pilot `client_id`, `/ready` result, or live campaign/lead/task/brief/recommendation verification.

2. **FAIL: The PostgreSQL deployment gate was not executed against a real PostgreSQL instance.**  
   Evidence: `docs/PILOT_RUNBOOK.md:30`-`docs/PILOT_RUNBOOK.md:31` says `npm run db:smoke:pg` is the deployment gate and must pass against the real PostgreSQL instance before exposing the service. The smoke script is explicitly env-gated and skips without PostgreSQL configuration at `src/db/pgSmoke.ts:35`-`src/db/pgSmoke.ts:39`. Local verification hit that skip path, so the current review cannot confirm the production database lifecycle for M10.

## Nice-to-Have Improvements

1. Add a repeatable pilot verification script that accepts `BASE_URL`, admin credentials, and a pilot payload, then performs the full M10 live-instance flow: `/ready`, onboarding, tenant-token auth, campaign create, lead create, task create/transition, brief read, and recommendations read.

2. Tighten `/ready` to validate the canonical funnel stage keys/positions, not only the count. Current code marks readiness true when `present === FUNNEL_STAGES.length` at `src/http/routes/health.ts:34`-`src/http/routes/health.ts:38`, so a drifted table with nine noncanonical rows could pass readiness.

3. Consider normalizing client emails and adding a database-level uniqueness guard before broader onboarding. Current schema indexes email but does not make it unique at `src/db/migrations/20260609120000_init_crm_schema.ts:32`-`src/db/migrations/20260609120000_init_crm_schema.ts:39`; onboarding performs an application-level exact-match duplicate check at `src/services/onboardingService.ts:58`-`src/services/onboardingService.ts:60`.

---

# Independent G1 Review — Sprint 1A Egoric Lead Snapshot

Review date: 2026-07-19

Review task: T6 only

Target: `C:\Users\Asus\Desktop\repositoryrealms`

Branch: `feat/leozops-s1a` @ `019afea44ccdf56477244811dd24bff234e71645`

Baseline: `main` @ `76082dc287258203a7a6515545b2dd2ba5fbd202`

Verdict: **FAIL**

## A. Confirmed facts

- Git top-level is `C:/Users/Asus/Desktop/repositoryrealms`; remote is
  `https://github.com/leozvu/repositoryrealms.git`.
- The active branch is `feat/leozops-s1a`; it tracks the identical
  `origin/feat/leozops-s1a` ref and the working tree is clean.
- `main`, `origin/main`, and the merge-base are exactly `76082dc`. The branch
  contains only the five declared implementation commits, in the declared
  order: `c0513d9`, `734cc50`, `745954f`, `41dd83f`, `019afea`.
- `main..feat/leozops-s1a` contains 11 additive files and 796 inserted lines.
  No existing application file is modified.
- No Prisma file changed. `prisma/schema.prisma` has the same Git object ID on
  main and the feature branch: `dcf722a300d764a64c483d14f832454cff671efa`.
- Exactly one new API path exists:
  `/api/integrations/leozops/v1/lead-snapshot`.
- The feature flag fails closed: absent, false, or non-exact values return 404
  before authentication or database access. No integration flag/hash was added
  to tracked environment files.
- The route performs only `prisma.lead.findMany` with a seven-column `select`.
  No create/update/delete/upsert, raw SQL, event, webhook, queue, or outbound
  network call exists in the Sprint 1A code.
- The response projector constructs exactly seven lead fields by name and never
  spreads a source entity. The route also avoids fetching the known Lead PII
  columns.
- `LEOZOPS_READ` is absent from `lib/perm.js`, `lib/registry.js`, all generic API
  route role lists, and employee settings. Snapshot authentication is a separate
  environment-hash verifier.
- Flag removal produces 404. Hash removal or rotation makes the old key fail
  with 401. Because there is no schema or data migration, those controls require
  no data restoration.

## B. Test evidence

- Full branch suite: `npm test` — **142/142 passed**, 0 failed, 0 skipped.
- Pre-existing regression files, run separately — **108/108 passed**, 0 failed,
  0 skipped.
- Sprint 1A files, run separately with
  `node --test "tests/leozops-*.test.mjs"` — **34/34 passed**, 0 failed, 0
  skipped.
- The separate focused runs initially encountered sandbox `spawn EPERM`; the
  same commands passed outside the sandbox. This was a harness restriction, not
  a test failure.
- Submitted tests confirm flag-off 404, missing/wrong/rotated-key 401, valid-key
  200, deterministic facts hash, generated-at exclusion, input-order
  independence, recursive prohibited-field-name denial, 304 for the submitted
  raw validator form, 61st-request 429 with `Retry-After`, and POST/PUT/PATCH/
  DELETE 405.
- Independent method diagnostic additionally returned 405 for HEAD and OPTIONS.
- Independent correlation diagnostic returned status 200 but proved
  `response_echoes_caller_value=true`, `audit_contains_email=true`, and
  `audit_contains_raw_key=true` when the caller supplied those values as
  `X-Correlation-ID`.
- Independent cache diagnostic returned 304 for the unquoted validator used by
  the submitted tests, but returned **200** for the quoted validator shown in
  the governing HTTP contract.

## C. Security and authorization findings

Confirmed safe:

- The raw bearer key is hashed with SHA-256 and compared using
  `timingSafeEqual`; the server retains only a deployment environment hash.
- Audit output uses an eight-hex expected-hash fingerprint rather than logging
  the authorization header.
- Generic `/api/v1/*` routes authenticate only through `apiUser()` and the
  Prisma `ApiKey` table. `/api/data/*` routes authenticate through NextAuth.
  The environment-only LeozOps key is not an employee role or normal API-key
  record and has no generic API permission.
- The key fails when the other deployment's hash is absent or different.
  Five-business isolation therefore holds under the binding project-scoped
  environment configuration. If the same hash is copied to another project,
  the verifier accepts the same raw key there; this is an operational isolation
  control, not cryptographic audience binding.
- No committed real secret, connection string, production key, or private key
  was found in the Sprint diff.

Blocking security finding:

- `lib/leozops/handler.js:49` accepts any caller-provided correlation header and
  `lib/leozops/handler.js:55` writes it verbatim to the audit log. A caller can
  supply an email address, raw bearer key, or other sensitive value and cause it
  to be logged and echoed. This violates the non-PII/no-raw-credential audit
  requirement in `docs/SPRINT_1A_TASKS.md:95` and the canonical integration
  contract.

Authorization evidence gap:

- `tests/leozops-qa.test.mjs:55-70` does not invoke a generic API or the real
  `apiUser()` boundary. It models the `ApiKey` table with an empty `Map` and
  explicitly documents the deviation. Static review confirms denial, but the
  required executable generic-method matrix was not delivered.
- The actual safe result for an environment-only LeozOps key on `/api/v1/*` or
  `/api/data/*` is 401 because it does not authenticate. The governing T5 task
  requires 403. The implementation must not make generic auth recognize the
  key merely to manufacture 403; the contract should explicitly accept the
  safe 401 result or define another non-expansive mechanism.

## D. Contract compliance

Pass:

- Correct path, schema version, source block, native funnel definition,
  terminal outcomes, quality block, field names, stable sorting, and
  `client_attribution: "unavailable"`.
- Allowlist-by-construction and recursive absence of the specified prohibited
  PII field names.
- Identical facts produce identical `snapshot_id`; reordered input produces the
  same ID; a changed fact changes the ID; `generated_at` is excluded.
- Cache-Control is `private, no-cache`.
- Flag default, key removal/rotation, rate-limit response, and non-GET denial.

Fail:

- `lib/leozops/handler.js:96` emits the raw `sha256:...` value as ETag rather
  than an HTTP quoted entity-tag, and line 100 performs literal equality only.
  The governing contract shows a quoted `If-None-Match`; the independent test
  proved that form returns 200 instead of 304.
- Audit logs are not guaranteed non-PII/non-secret because correlation IDs are
  unvalidated caller input.
- T5's executable generic API 403 matrix is absent, and current safe behavior is
  401 rather than the documented 403.

## E. Drift/conflict analysis

- `feat/leozops-s1a` and `codex/realms-demo` share baseline `76082dc`.
- There is no directly intersecting changed path: the demo branch contains none
  of the 11 Sprint 1A files.
- A read-only three-way `git merge-tree` check reported no textual conflicts.
- The demo branch changes 306 files, including Prisma migrations/schema,
  generic data/API event awaiting, environment examples, package files, and
  deployment/runtime code. Its Lead fields relevant to the projector remain
  unchanged, and `lib/apiauth.js` is unchanged.
- No immediate Sprint 1A conflict exists, but if the demo branch is ever
  promoted or rebased, the full auth, schema, route, build, and regression gates
  must be rerun. This review does not approve that branch or its merger.

## F. Blockers

1. Caller-controlled `X-Correlation-ID` can leak PII and raw credentials into
   audit logs.
2. ETag/If-None-Match behavior is not standards-compliant and fails the quoted
   validator form in the governing contract.
3. The required executable generic API denial matrix is replaced by a model,
   and its expected status conflicts with actual safe 401 behavior.

## G. Required fixes, if any

Keep the corrective patch limited to Sprint 1A:

1. In `lib/leozops/handler.js`, accept a caller correlation ID only when it
   matches a strict non-sensitive correlation format (prefer UUID); otherwise
   generate a new ID. Add adversarial tests using an email, raw bearer key,
   control characters, and an overlong value, asserting none appear in response
   metadata or logs.
2. Emit a valid quoted ETag and normalize `If-None-Match` comparison for the
   quoted value. Add tests for the actual response ETag, quoted request
   validator, mismatch, and 304 empty body. Do not change `snapshot_id` itself.
3. Replace the empty-Map generic-auth model with executable tests of the real
   authentication boundary and representative `/api/v1/*` and `/api/data/*`
   denial paths. Resolve the 401-versus-403 contract discrepancy by approving
   401/403 as denial, or another mechanism that does not grant the LeozOps key
   ambient generic-auth recognition.
4. Add an explicit named deployment-isolation test: the Egoric key succeeds
   only with the Egoric test environment hash and fails when another instance's
   hash is absent or different.

No Prisma, employee-role, generic CRUD, deployment, S1.B, or S1.C change is
required or permitted for these fixes.

## H. G1 verdict: FAIL

G1 fails because mandatory audit confidentiality, conditional-GET contract, and
generic-auth evidence requirements are not all satisfied. Passing unit and
regression suites do not override these independently reproduced gate failures.

## I. Merge recommendation

**Do not merge `feat/leozops-s1a`. Do not deploy or provision a key.** Apply only
the corrective scope in section G on the same Sprint 1A branch, rerun T6, and
require a new independent G1 verdict. S1.B and S1.C remain prohibited.

---

# Phase 0 Product Contract Review

Review date: 2026-07-28

Target: `leozvu/leozcrm`, branch `codex/leozops-phase-0`

Review verdict: **LOCAL PASS**

Publication result (2026-07-28): **MERGED** through
[leozcrm PR #1](https://github.com/leozvu/leozcrm/pull/1) at `b7aa417`.

## Scope verified

- `PRODUCT.md` defines the CEO user, JARVIS operating-partner role, North Star,
  operating loop, MVP, maturity ladder, principles, and current non-goals.
- `docs/PRODUCT_OPERATING_MODEL.md` assigns CEO, LeozOps, Egoric, and external
  system ownership and separates the current read-only path from future action
  authority.
- `docs/GLOSSARY.md` distinguishes observation, insight, recommendation,
  action proposal, approval, and action and records the tenant/client and
  current-state/conversion invariants.
- `docs/RELEASE_GATES.md` preserves integration gates G1–G4 and adds G0, G5,
  G6, and G7 without weakening the existing QA contract.
- `docs/LEGACY_FOUNDATION.md`, README, architecture, data-model, pilot, and
  Postgres-smoke warnings prevent the historical standalone runtime from being
  presented as the approved Egoric deployment.
- `DECISION-003`, governance, roadmap, checklist, implementation/PM briefs, and
  the Hermes execution plan point to the same direction.
- At the time of this Phase 0 review, G1 remained FAIL. The subsequent
  corrective rereview below supersedes that technical verdict but does not
  authorize S1.B, production credentials, deployment, write-back, or autonomy.

## Verification evidence

- Repository identity: remote `https://github.com/leozvu/leozcrm.git`, branch
  `codex/leozops-phase-0`, based on `main` at `24cc08a`.
- Markdown relative-link check: PASS across 21 repository Markdown files.
- `git diff --check`: PASS.
- `package.json` and `package-lock.json` parse: PASS.
- `npm run typecheck`: PASS.
- `npm test`: PASS, 159/159.
- `npm audit`: 2 low and 1 moderate pre-existing dependency advisories; no
  dependency or lockfile was changed in Phase 0. Dependency remediation is
  separate hardening work and remains required before production release.

## Gate result

G0 is complete and repository-canonical on `main` after PR #1. G1 status is
tracked by the corrective rereview below.

---

# Corrective G1 Rereview — Sprint 1A Egoric Lead Snapshot

Review date: 2026-07-28

Target repository: `leozvu/repositoryrealms`

Local path: `C:\Users\Asus\OneDrive\Tài liệu\Fak that shit\CRMegoric-Realms-Demo`

Branch and commit: `feat/leozops-s1a` @ `28ceff6`

Current baseline: `origin/main` @ `507187f`; merge-base is exactly `507187f`

Publication status: reviewed commit `28ceff6` was admin-squash-merged through
[repositoryrealms PR #7](https://github.com/leozvu/repositoryrealms/pull/7) to
`main@98c0eca`. Branch protection remains configured.

Verdict: **G1 COMPLETE — MERGED; PRODUCT OWNER ACCEPTED LOCAL S1.B CONTINUATION**

## A. Scope and lineage

- The reviewed commit is on top of merge commit `894045d`, which integrates the
  current `origin/main@507187f` baseline without a textual conflict.
- The S1.A delta against current main is additive except for six commented
  environment-template lines: 19 files, 1,361 insertions, no deletions from
  existing application behavior.
- No Prisma schema or migration changed.
- Exactly one LeozOps route exists:
  `/api/integrations/leozops/v1/lead-snapshot`.
- The flag is still default-off. No key, hash, production flag, deployment
  configuration, or live credential was created.

## B. Prior blocker closure

1. **Correlation confidentiality — PASS.** Caller correlation IDs are accepted
   only as strict UUIDs. Email, token-like, control-character, oversized, and
   malformed values are replaced and never echoed or logged.
2. **HTTP validator compliance — PASS.** The response emits a quoted ETag;
   quoted, weak, list, wildcard, mismatch, and 304-empty-body cases are covered.
   The body `snapshot_id` remains the unquoted content identifier.
3. **Generic API denial — PASS.** Executable tests invoke the real `/api/v1/*`
   handlers and `apiUser()` boundary, plus real `/api/data/*` handlers and the
   `currentUser()` boundary. The LeozOps key receives secure 401/403 denial,
   request bodies are not read, and operational handlers do not execute.
4. **Deployment isolation — PASS.** Missing or different deployment hashes
   deny the key; only the matching deployment-scoped hash validates.

## C. Additional corrective evidence

- `HEAD` and `OPTIONS` are explicitly routed through the GET-only handler and,
  with POST/PUT/PATCH/DELETE, return 405 while enabled and 404 while disabled.
- Current string timestamp facts are preserved in the snapshot hash. Defensive
  Date inputs normalize to ISO before hashing, so the identifier covers the
  exact JSON fact served.
- Data-source and projection failures return a generic, no-store 500 and one
  payload-free audit event; underlying error details are neither returned nor
  logged.
- The route performs one allowlisted `prisma.lead.findMany` query. Static scans
  found no Prisma mutation, raw SQL, outbound network call, or generic API use
  in the route implementation.
- Recursive output tests continue to deny the prohibited PII keys and values.

## D. Verification evidence on `28ceff6`

- Focused LeozOps suite: **69/69 PASS**.
- Full repository suite: **756/756 PASS**, 0 skipped, 0 failed.
- `npm run build`: **PASS**; Next.js production build includes the snapshot
  route.
- `npm audit --omit=dev --audit-level=high`: **0 vulnerabilities**.
- `git diff --check`: **PASS**.
- Prisma schema equality with current main: **PASS**.
- Secret-pattern scan of the zero-context delta: **PASS**.
- Post-merge focused LeozOps suite on `main@98c0eca`: **69/69 PASS**.

## E. Accepted limitation

The in-memory 60/hour limiter remains best-effort per serverless instance, as
documented for S1.A. A shared global limiter is later hardening and does not
weaken the route capability, PII, method, or default-off boundaries.

## F. Gate and merge recommendation

The S1.A technical contract passes at reviewed commit `28ceff6` and merged
commit `98c0eca`. Product Owner acceptance for local S1.B continuation is
recorded in DECISION-002 addendum 3. G2 work may begin; S1.C remains blocked
until G2 passes.

No production deployment, feature-flag enablement, or key provisioning is
approved by this verdict.

---

# G2 Review — Sprint 1B LeozOps Business Memory

Review date: 2026-07-28

Target repository: `leozvu/leozcrm`

Branch: `codex/leozops-s1b-business-memory`

Baseline: `origin/main@ef9f664`

Reviewed commits: `0484b04`, `0c05e39`, and `1e5ffb9`

Publication status: **MERGED** through
[leozcrm PR #4](https://github.com/leozvu/leozcrm/pull/4) at `main@d1d34c5`

Verdict: **G2 COMPLETE — MERGED; PRODUCT OWNER ACCEPTED LOCAL S1.C CONTINUATION**

## A. Scope and ownership boundary

- `Tenant` is a LeozOps business-isolation identity and is not the legacy CRM
  `Client` entity.
- `SourceConnection` stores only source identity, contract, endpoint, health,
  and ETag state. The raw bearer key remains runtime-only.
- `SourceSnapshot` is append-only evidence. SQLite and PostgreSQL migration
  paths install database triggers that reject direct update or deletion.
- `IntelligenceRun` is unique by tenant, snapshot, engine version, and `as_of`.
- The source-neutral adapter exposes a pull operation only. The Egoric adapter
  constructs exactly one GET request with no body to the dedicated snapshot
  path; no new HTTP route, scheduler, retry loop, or runtime mount was added.

## B. Fail-closed and idempotency evidence

- Only exact `egoric_sales_v1` schema version `1.0`, native stages, field set,
  quality reconciliation, tenant identity, and canonical SHA-256 are accepted.
- Unknown fields (including recursive PII), versions, stages, invalid counts,
  duplicated external IDs, and tampered hashes are rejected before storage.
- Credential-bearing, query-bearing, generic, non-HTTPS public, and wrong-path
  endpoints are rejected before a connection can be persisted.
- A 200 response requires JSON plus an ETag exactly matching the snapshot ID.
  A 304 is accepted only after a prior ETag and may not change that ETag.
- Replaying the same 200 response inserts exactly one snapshot and one run.
  A valid 304 updates connection health and inserts neither.
- Composite foreign keys and tenant-scoped repository reads prevent a
  connection, snapshot, or run from crossing tenant boundaries.

## C. Verification evidence

- Focused Business Memory suite: **13/13 PASS**.
- Full repository regression suite: **172/172 PASS**, 0 skipped, 0 failed.
- `npm run typecheck`: **PASS**.
- Migration apply/rollback and immutable-trigger test on SQLite: **PASS**.
- `git diff --check`: **PASS**.
- Markdown relative-link check: **PASS** across 23 repository Markdown files.
- `package-lock.json` is unchanged; no dependency was added or upgraded.
- `npm audit --omit=dev --audit-level=high`: no high/critical finding; one low
  `body-parser` and one moderate `uuid` advisory are pre-existing.
- Secret-pattern and egress scans: no persisted credential or new write-method
  egress; the only Business Memory network method is GET with no body.
- Runtime-mount scan: the ingestion service is not imported by the HTTP app or
  server startup path.

## D. Accepted pre-production limitation

A live disposable PostgreSQL service was unavailable because the local Docker
engine was not running. The migration contains a PostgreSQL trigger path, but
this verdict proves the required G2 local/test contract on SQLite only. A live
PostgreSQL migrate/rollback smoke remains mandatory before any independent
deployment and is not waived by this gate.

## E. Gate result

The implemented branch satisfies the G2 technical evidence contract for local
and test use and was merged through PR #4 at `main@d1d34c5`. Product Owner
acceptance for local/test S1.C/G3 continuation is recorded in DECISION-002
addendum 4.

This verdict does not authorize production credentials, production polling,
deployment, write-back, external publishing, or autonomous action.

---

# G3 Review — Sprint 1C Deterministic Egoric CEO Brief

Review date: 2026-07-28

Target repository: `leozvu/leozcrm`

Branch: `codex/leozops-s1c-ceo-brief`

Baseline: `origin/main@cf60bc0`

Reviewed implementation commit: `3048dcd`

Publication status: **LOCAL REVIEW; PR/MERGE PENDING**

Verdict: **G3 TECHNICAL PASS LOCALLY**

## A. Snapshot-native brief contract

- The G3 engine reads only accepted Business Memory snapshot/run evidence. It
  does not call the legacy CRM KPI/Brief services or the nine-stage funnel.
- It re-parses and revalidates the complete stored `egoric_sales_v1` payload,
  then reconciles row, run, source, snapshot, and record-count provenance before
  calculating a metric.
- Formula `egoric_ceo_brief_v1` reports exact current-state stage counts, active
  pipeline, won/lost outcomes, win rate, owner coverage, active estimated value,
  overdue expected close, source distribution, quality, and freshness.
- It makes no reached, stage-to-stage conversion, velocity, or historical-delta
  claim because durable stage history is unavailable.
- Repeating the same tenant, cutoff, and Business Memory state returns the same
  complete brief, including its immutable run-based `generated_at`.

## B. Evidence, limitation, and confidentiality boundaries

- Every output includes source snapshot and run IDs, formula/source-engine
  versions, source/schema/funnel identity, freshness timestamps and status,
  exact quality, deterministic observations, known limitations, and
  `advisory_only: true`.
- Raw external lead IDs and legacy Client/Campaign fields are absent.
- Free-text source labels are presented only through a small channel allowlist;
  every other non-null value becomes `unclassified`, preventing email/token-like
  source values from being reflected to the CEO output.
- Estimated-value currency is explicitly `null`; numeric aggregate overflow,
  corrupt JSON, invalid hash/schema, missing provenance, and row/run mismatch
  fail closed.

## C. Runtime profile and authentication

- `INTEGRATION_MODE=egoric-readonly` mounts public `GET /health` and the
  authenticated `GET /v1/tenants/:tenantKey/brief` only.
- A separate HMAC tenant-read token and optional separate read-admin key use
  `LEOZOPS_OUTPUT_AUTH_SECRET` / `LEOZOPS_OUTPUT_ADMIN_KEY`; legacy Client auth
  is not used for the new tenant identity.
- CRM, lead, campaign, legacy metrics/brief/recommendation, dashboard, task,
  onboarding, integration registry, email publishing, and legacy readiness
  routes return 404 in the profile. A write method on the brief path also 404s.
- The profile mounts no JSON body parser, constructs no email publisher, emits
  no outbound request, and performs no persistence write.
- Default mode remains historical `legacy`; example profile/auth settings are
  commented and no credential, production flag, or deployment was created.

## D. Verification evidence

- Focused G3 brief/profile suite: **10/10 PASS**.
- Full repository regression suite: **182/182 PASS**, 0 skipped, 0 failed.
- `npm run typecheck`: **PASS**.
- Markdown relative-link check: **PASS** across 24 repository Markdown files.
- `git diff --check`: **PASS**.
- `package-lock.json` is unchanged; no dependency was added or upgraded.
- `npm audit --omit=dev --audit-level=high`: no high/critical finding; one low
  `body-parser` and one moderate `uuid` advisory are pre-existing.
- Secret-pattern, G3 network-egress, and persistence-write scans: **PASS**.
- The authenticated route matrix proves tenant separation and legacy surface
  denial, including malformed JSON sent to an unmounted legacy POST route.

## E. Gate result

The branch satisfies the G3 technical evidence contract for local/test use.
Publication, merge, and Product Owner acceptance remain pending. S1.D/G4 stays
blocked until those steps complete.

This verdict does not authorize production deployment, production flags or
credentials, scheduled polling, write-back, publishing, or autonomous action.
