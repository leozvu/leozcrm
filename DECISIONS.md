# LeozOps AI — Decisions Log

Format:
- Date: YYYY-MM-DD
- Decision: What we decided
- Context: Why it came up
- Rationale: Why this option
- Alternatives considered
- Owner: who made / owns the decision

---

2026-07-08 — M10 gate remediation: Codex review items closed, stack verified on real PostgreSQL, deployment packaged
Decision: Close all actionable Codex M10 review items in code, verify the full production path against a real PostgreSQL 16 instance, and package deployment so the remaining gate work is a single ops action.
Context: Codex's M10 verdict was FAIL on two blockers (real-PG smoke, live pilot flow) plus three nice-to-haves. Leoz directed (2026-07-08) that development continue until the app is operations-ready.
What was done:
- `npm run verify:pilot`: repeatable one-command pilot verifier (Codex nice-to-have #1) — runs /health, /ready, onboarding, tenant-token auth, campaign, lead + stage move, task + audited transition, KPI/brief/recommendations against any base URL and prints an evidence block.
- `/ready` now validates canonical stage keys/positions, not just the count (nice-to-have #2).
- Tenant emails normalized (trim+lowercase) and `clients.email` made unique at the DB level via a rollback-safe migration (nice-to-have #3, closes the onboarding race).
- Executed the gate: `db:smoke:pg` PASS on PostgreSQL 16 (including the new migration, up AND down), then the full pilot flow 15/15 PASS on `NODE_ENV=production` + real PG. Evidence: docs/DEPLOYMENT_EVIDENCE.md.
- Ops: structured JSON request logging, production seed without demo data, Dockerfile + docker-compose (app + PG 16), `npm run start:prod`.
Honest boundary: the verified instance ran in the dev container, not on a public host. The gate's last step — `docker compose up` on the chosen host + `verify:pilot` against the public URL — is an ops action awaiting the hosting decision (Leoz).
Owner: Claude Code (Senior Dev); Codex re-review requested in CODEX_REVIEW.md.

2026-07-08 — M8C implementation: TikTok publishing via the Content Posting API
Decision: Implement M8C on the M8B social path through a new `SocialProviderAdapter` seam (one adapter per channel; service/route stay provider-agnostic).
Context: CEO approved continued development to completion (2026-07-08). M8C was the last deferred publishing channel with a stable public API.
Rationale:
- PULL_FROM_URL only (TikTok fetches media from a public URL) — no byte uploads, no chunking, smallest possible live surface.
- Private-by-default: `privacy_level` defaults to SELF_ONLY so a live post is visible only to the account until an operator widens it — the safest live-posting posture for a pilot.
- TikTok-aware error classification mirrors M8B: throttling retryable; invalid params / dead tokens / spam-risk caps fatal (no retry storm).
- Same shared per-tenant-per-channel spend guard — a spent Facebook budget cannot block TikTok.
Alternatives considered:
- FILE_UPLOAD/chunked transfer: rejected for v0 — large new surface, no pilot need.
- Waiting for M10 public hosting first: rejected — same reasoning as M8B; live TikTok app verification joins the deployment-gate evidence.
Owner: Claude Code (Senior Dev), within the M8 scope listed in ROADMAP.md.

2026-07-08 — M8D deferred pending CEO provider decision (decision request)
Decision: Do NOT build AI Media Generation until Leoz picks the AI media provider and budget/usage caps.
Context: M8D is the only remaining M8 sub-milestone. Unlike email/social, there is no obvious default provider; the choice carries real per-generation cost and content-policy implications (CHECKLIST §5 reserves this class of decision for the CEO).
What is ready: the `ai_media` placeholder adapter, the proven live-adapter pattern (M8A/B/C), and the spend-guard mechanism that would cap generation spend per tenant.
Decision requested from Leoz: provider (e.g. an image/video generation API), monthly budget ceiling, and whether generation is operator-only or tenant-invocable.
Owner: Hermes to schedule; Leoz to decide.

2026-07-08 — M8B implementation: Facebook + Instagram publishing via Meta Graph API
Decision: Implement M8B (the first sanctioned post-M10 candidate) as a mirror of the M8A email architecture: a per-channel live `MetaGraphAdapter` provider edge, a `SocialPublishService` orchestrator (validate → guard → bounded retry/backoff), and one explicit, tenant-scoped endpoint `POST /integrations/social/publish`.
Context: M10's remaining blocker (live pilot verification) is ops/infrastructure work, not code. ROADMAP lists M8B as the first post-M10 candidate; building it now keeps the sequence while the gate stays with ops. Live end-to-end verification against a real Meta app joins the existing deployment-gate evidence list.
Rationale:
- Reusing the proven M8A shape (explicit invocation, guardrails, sandbox-transport tests, not_configured fail-closed) minimises new risk surface.
- The spend guard was channel-agnostic already; it moved to `src/integrations/spendGuard.ts` as `PublishSpendGuard` with the M8A name re-exported, so M8A code and tests are untouched.
- Guard scope is `client_id|channel` (per tenant per channel): one platform's budget/circuit can never starve or unlock another's.
- One endpoint with a `channel` field (not per-channel routes) because both channels share credentials, guard semantics, and result contract; the adapter split stays internal.
- Instagram uses the documented two-step container flow; a retry after a failed publish step re-creates the container (unpublished containers are inert, so no duplicate posts).
- The Meta access token is sent only in the POST body, never in the URL, so it cannot leak into request logs.
Alternatives considered:
- Meta SDK dependency: rejected; the built-in `fetch` transport keeps the zero-new-dependency posture from M8A and stays injectable for tests.
- Shared tenant-wide social budget (not per channel): rejected; a Facebook outage tripping the circuit would silently block Instagram.
- Waiting for the M10 gate to close: rejected; the gate is blocked on ops, and this is the sanctioned next candidate — code-complete now, live verification recorded with the gate evidence.
Owner: Claude Code (Senior Dev), within the M8B scope listed in ROADMAP.md.

2026-06-12 — M10 milestone state reclassification: local code PASS / deployment BLOCKED
Decision: Classify current M10 work as local code verified but deployment blocked. Do not mark M10 fully PASS until PostgreSQL smoke and live pilot verification are executed.
Context: Local verification is complete (159/159 tests green, typecheck clean) and M10.1 was committed. Codex review explicitly requires deployment evidence: real `npm run db:smoke:pg` output and recorded pilot verification on a live instance.
Rationale:
- Code verification and deployment verification are different gates. Promoting M10 to PASS without the deployment gate would misrepresent launch readiness.
- Delaying feature work until the gate closes prevents false progress and forces infrastructure/ops to be resolved.
Alternatives considered:
- Mark M10 PASS anyway: would hide a real risk and set false milestones-complete signal.
- Continue building new features while deployment is blocked: wastes feature work if infra fails.
Owner: Hermes (PM)

Remediation plan to close M10 deployment gate:
1. Provision PostgreSQL environment.
2. Run `npm run db:smoke:pg` against the real instance and record PASS or a specific blocker.
3. Deploy API in a real hosting environment.
4. Execute live pilot verification:
- `GET /ready` returns 200.
- `POST /onboarding` with admin auth creates tenant and issues token.
- Pilot tenant calls create campaign/lead/task.
- Pilot tenant reads briefs and recommendations against live data.
5. Record results: base URL, client_id, `/ready` result, live instance verification summary.
6. Only when both Postgres smoke and pilot verification are complete: mark M10 PASS in `CHECKLIST.md` and `ROADMAP.md`, then continue to the next milestone.

2026-06-12 — Milestone #10 implementation: client onboarding workflow + readiness probe
Decision: Implement the codeable M10 launch surface on the existing stack: onboarding service + admin route, readiness probe, `npm run onboard` CLI, and pilot runbook.
Context: M9 passed QA; M10 is current. The deployable code can’t be fully validated until a real PostgreSQL host is available, but the implementation surface is complete.
Rationale:
- Uses M7 auth/tenant model unchanged.
- Additive only: no schema redesign.
- `/ready` validates platform readiness from real infrastructure signals when deployed.
Alternatives considered:
- Build hosting/deploy automation into M10: out of scope; ops/hosting is env-specific.
- Add a users/identity table for operator logins: rejected; M7 per-client token model is sufficient for the launch operator.
Owner: Claude Code (Senior Dev), within the M10 scope.

2026-06-12 — M9 remediation complete: task validation and deterministic audit ordering
Decision: M9 Task Engine now passes QA after adding UUID-shape/gating validation before DB access, audit-note type/length guards, monotonic `seq` on `task_status_events`, composite unique order key `uq_task_events_task_seq`, and corresponding route/task+events coverage.
Context: M9 shipped initially with malformed input reaching the repository boundary and non-guaranteed audit ordering when rapid transitions shared millisecond timestamps. After review, the issue was patched and QA passed; `task_status_events` no longer relies on timestamp tie-breaking for read order.
Rationale:
- Front-door validation in the repository means malformed request values return 400 and never touch the DB.
- A 1-based monotonic `seq` per task makes the audit trail authoritative without depending on DB row-id insertion guarantees.
- Backward compatibility preserved: migration added columns with app-side assignment (no schema rewrite).
Alternatives considered:
- Rely only on timestamp + row-id ordering (no seq): rejected because it kept display order DB-dependent.
- Use timestamps alone with retry hacks: rejected because explicit sequence is simpler and deterministic.
Owner: Claude Code / Codex / Hermes (M9 QA loop)
