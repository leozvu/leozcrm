# LeozOps — Roadmap

> **Governing decision:** DECISION-002 (DECISIONS.md, 2026-07-18). Egoric is
> the operational system of record; LeozOps is a read-only intelligence
> platform. All future milestones follow the "LeozOps Intelligence
> Integration" track below unless superseded by another ADR.
> Canonical contract: `docs/EGORIC_INTEGRATION.md`.
> Execution plan: `.hermes/plans/2026-07-18_egoric-integration-execution-plan.md`.
> Product maturity gates: `docs/RELEASE_GATES.md`.

Legend:
- Milestone = internal development phase ending in a verified, releasable increment
- Status: ⏳ Planned · 🚧 In Progress · ✅ Completed · ⏸️ Paused · 🗄️ Superseded

---

## Phase 0 — Product Foundation — ✅ Complete on `main`

Goal: establish one product identity and one build contract before adding more
runtime capability.

Evidence merged through [PR #1](https://github.com/leozvu/leozcrm/pull/1) at
`main@b7aa417`:

- LeozOps defined as the AI Operating Partner for a CEO; Revenue Intelligence
  is the first wedge, not the final boundary.
- CEO, LeozOps, Egoric, and external-system responsibilities made explicit.
- Observer → Advisor → Planner → Operator → Autopilot maturity sequence defined.
- Canonical vocabulary separates observation, insight, recommendation,
  approval, and action.
- G0–G7 product/release gates and capability stop rule defined.
- Historical CRM/task/onboarding/email runtime classified as legacy and
  excluded from the `egoric-readonly` deployment profile.
- README, product definition, architecture warning, package metadata,
  governance, integration status, roadmap, and decision log aligned.

Gate G0 is repository-canonical on `main` through PR #1 and the status follow-up
PR #2. Phase 0 itself grants no production enablement, credential, write-back,
or autonomy authority.

---

## LeozOps Intelligence Integration (current track)

Evidence-gated, no calendar dates. Gates are defined in the execution plan
and Codex QA gates in `docs/EGORIC_INTEGRATION.md` §15.

### Sprint 1 — ✅ Complete — G4 accepted

S1.A task breakdown: `docs/SPRINT_1A_TASKS.md` (T1–T6, Egoric repo, gate G1).
Corrective technical QA passed at `repositoryrealms@28ceff6` against
`main@507187f`. [PR #7](https://github.com/leozvu/repositoryrealms/pull/7)
was admin-squash-merged for the solo repository to `main@98c0eca` without
changing branch protection. DECISION-002 addendum 3 authorized S1.B/G2 and
kept S1.C blocked until G2 passed. G2 technical QA passed on
`codex/leozops-s1b-business-memory`; [PR #4](https://github.com/leozvu/leozcrm/pull/4)
was squash-merged to `main@d1d34c5`, and Product Owner acceptance for local
S1.C/G3 continuation is recorded in DECISION-002 addendum 4.
The deterministic native-funnel brief and `egoric-readonly` route-isolation
profile passed G3 technical QA and [PR #6](https://github.com/leozvu/leozcrm/pull/6)
was squash-merged to `main@3a5fb9e`. Product Owner acceptance for local S1.D/G4
continuation is recorded in DECISION-002 addendum 5. The actual-handler local
end-to-end proof passed G4 and [PR #8](https://github.com/leozvu/leozcrm/pull/8)
was squash-merged to `main@5ef3fd5`; Sprint 1 acceptance is recorded in
DECISION-002 addendum 6.

Goal:
Egoric Snapshot → LeozOps Ingestion → CEO Brief → Local End-to-End Proof.
Nothing else.

Evidence gates G1–G4 — ALL required before Sprint 2:
- G1: Egoric snapshot endpoint (test instance) — auth matrix, recursive
  PII denial, deterministic ETag/304, method denial. Codex PASS.
- G2: LeozOps ingestion — schema fail-closed, idempotent snapshot storage,
  tenant scoping, no-write-egress proof. Codex PASS.
- G3: CEO Brief from snapshot — deterministic output, native Egoric funnel
  semantics, provenance/limitations on every output, integration profile
  denies CRM/task/onboarding/email routes. Codex PASS.
- G4 (Sprint 1 acceptance): local end-to-end against the Egoric test
  instance — exact count reconciliation, no-mutation proof, feature-flag +
  key-revocation drill. Evidence recorded in repo; Codex PASS in
  CODEX_REVIEW.md; Leoz formally accepts (recorded in DECISIONS.md).

The G4 hard stop is satisfied. DECISION-002 addenda 7–11 authorize and accept
the S2.A local implementation plus one local disposable PostgreSQL checkpoint.
P1/P2, managed infrastructure, and deployment require separate Product Owner
approval.

### Sprint 2 — 🚧 Local implementation complete; external G5 execution pending

Goal:
Deployment → Test Instance → Production Shadow → Read-only Pilot.

Plan: [`docs/SPRINT_2_PLAN.md`](docs/SPRINT_2_PLAN.md). DECISION-002 addendum 7
authorized S2.A T1–T4 locally; addendum 8 accepts the core merged through
[PR #11](https://github.com/leozvu/leozcrm/pull/11) at `main@5d140a8`. T5–T8
are authorized for local/test implementation by addendum 9. The T5–T8
operations core passes local QA and is accepted through
[PR #13](https://github.com/leozvu/leozcrm/pull/13) at `main@1911349`.
The disposable PostgreSQL 16 migrate/immutability/rollback cycle is accepted
through [PR #15](https://github.com/leozvu/leozcrm/pull/15) at `main@5e9a4b7`;
see [`docs/POSTGRES_SMOKE.md`](docs/POSTGRES_SMOKE.md). P1 remains blocked on
named environment and operating-policy decisions; managed infrastructure and
every external action remain unauthorized.
DECISION-002 addendum 12 authorizes the local fail-closed manifest and
provisional solo-founder defaults in
[`docs/P1_DECISION_PACKET.md`](docs/P1_DECISION_PACKET.md), accepted through
[PR #17](https://github.com/leozvu/leozcrm/pull/17) at `main@35ed23c`. Its
pending example does not approve P1 or any provider/spend.
The remaining S2.B–S2.D repository control plane is implemented on
`codex/leozops-phase2`: environment-bound Checkpoint B/P2 manifests, public
integration readiness, a manifest-gated command-and-exit worker, immutable
poll/daily evidence, exact daily reconciliation, a ten-consecutive-business-
day evaluator, and fail-closed go/extend/revoke decisions. Operational usage
and rollback are defined in
[`docs/PHASE_2_OPERATIONS.md`](docs/PHASE_2_OPERATIONS.md).

Still pending as external facts:
- accepted exact P1 values and the named test infrastructure;
- networked Checkpoint B evidence and accepted P2;
- production canary plus ten elapsed, qualifying business days;
- the final Product Owner go/extend/revoke decision.

Evidence gates: all 12 Codex release gates (contract §15) before any
production key/flag; contract §11 pilot criteria for the shadow.

---

### Sprint 3 — 🚧 Local G6 control plane complete; real command release blocked

Goal:
Recommendation → Safe Proposal → Exact Dry-run → Human Approval → One
Idempotent Action → Auditable Result / Separately Approved Rollback.

Plan: [`docs/SPRINT_3_PLAN.md`](docs/SPRINT_3_PLAN.md). DECISION-002 addendum 14
authorizes the local repository package only. The implementation on
`codex/leozops-phase3-supervised-action` provides:

- an exact one-command G6 policy bound to a still-current G5 `go`;
- recursively safe payloads and immutable evidence-bound proposals;
- zero-mutation dry-runs plus separate approval/operator credentials;
- atomic rate/budget/idempotency claims and unknown-outcome reconciliation;
- immutable SQLite/PostgreSQL audit evidence;
- one separately previewed/approved rollback in a bounded safety window;
- a fail-closed CLI/preflight and intentionally empty production adapter
  registry.

Still pending as external facts:

- the real G5 `go` prerequisite;
- a narrow RepositoryRealms command contract and source-side idempotency;
- one named test/production target and least-privilege command credential;
- command-specific network, dry-run parity, rollback, incident, and CEO QA;
- explicit G6 release for that command.

No real adapter, external write, deployment, credential, scheduler, or G7
autonomy is authorized or present.

---

### Sprint 4 — 🚧 Local G7 rehearsal complete; bounded-autonomy release blocked

Goal:
Proven Supervised History → Policy Simulation → Explicit Kill-switch Release →
One Bounded Candidate → Monitor / Incident → Human-controlled Recovery.

Plan: [`docs/SPRINT_4_PLAN.md`](docs/SPRINT_4_PLAN.md). DECISION-002 addendum 15
authorizes only the inert local package on
`codex/leozops-phase4-bounded-autonomy`. It provides:

- an exact low-risk G6-bound standing policy and deterministic safety simulator;
- real supervised-history, source-freshness, current-G5/G6, and adapter gates;
- an initially engaged dual-credential kill switch and immutable incidents;
- one-candidate dry-run/evaluate/atomic-claim/execute orchestration;
- rolling rate, daily cost, cooldown, one-mutation, and lease limits;
- automatic halt on every failed or uncertain result;
- a separately previewed, dual-credential-approved, explicitly invoked human
  recovery within 24 hours; and
- immutable SQLite/PostgreSQL evidence plus a fail-closed CLI/preflight.

Still pending as external facts:

- genuine G5 and command-specific G6 releases;
- sufficient qualifying production supervised history;
- a deployed exact adapter, least-privilege credentials, and verified kill
  switch/monitoring;
- production simulator replay, canary, incident/recovery drill, and explicit G7
  Product Owner release.

The production adapter registry remains empty. No external request, scheduler,
HTTP mutation route, autonomous rollback, deployment, credential, or real G7
authority is present.

---

### Sprint 5 — ✅ Local operational assurance complete; external release blocked

Goal:
Immutable G5/G6/G7 Facts → Deterministic Safety Assessment → Freshness / Drift
Recheck → Immutable Release Package → Explicit External Blockers.

Plan: [`docs/SPRINT_5_PLAN.md`](docs/SPRINT_5_PLAN.md). DECISION-002 addendum 16
authorizes only the local assurance package on
`codex/leozops-phase5-operational-assurance`. It provides:

- an exact G7-bound policy with three new credential fingerprints separated
  from all G7/G6 credentials;
- a 15-check assessment derived from immutable upstream records only;
- execution, failure, reconciliation, recovery, incident, kill-switch, and
  event-chain evidence over a bounded window;
- idempotent immutable assessments and monotonic audit events;
- latest-assessment TTL plus current-state and event-chain rechecks at review;
- an immutable release package that can only be `blocked_external`; and
- a fail-closed pending template, preflight, command-and-exit operator, SQLite /
  PostgreSQL guards, and operations runbook.

Still pending as external facts are the same G5/G6/G7 deployment, production
history, exact adapter/credential, monitoring, canary, drills, and explicit
Product Owner release evidence. Phase 5 creates no G8, no waiver/promote path,
and no external capability.

---

### Sprint 6 — ✅ Signed external-evidence admission complete; activation blocked

Goal:
Exact Phase 5 Package → Pinned Issuers → Signed Evidence Admission → Eight-row
Assessment → Complete-but-Unreleased Candidate.

Plan: [`docs/SPRINT_6_PLAN.md`](docs/SPRINT_6_PLAN.md). DECISION-002 addendum 17
authorizes only a local trust bridge on
`codex/leozops-phase6-external-evidence`. It provides:

- an exact Phase 5 package-bound policy with separate authority/assessor
  credentials and four unique pinned Ed25519 public keys;
- the canonical eight-blocker matrix with no wildcard, waiver, or inferred
  evidence path;
- canonical signed envelopes bound to tenant, source, environment, package,
  subject, issuer, timestamps, digest, and nonce;
- signature, issuer, expiry, freshness, clock-skew, replay, nonce, ordering, and
  signed-revocation enforcement;
- immutable SQLite/PostgreSQL policies, attestations, assessments, and monotonic
  events; and
- a file-only operator, fail-closed preflight, templates, and incident/key
  rotation runbook.

Even eight valid rows produce only `complete_unreleased` with
`blocked_external_activation`. Real issuer enrollment, raw evidence collection,
named production infrastructure, adapter registration, deployment, and any G7
activation/release act remain pending a separately authorized phase. No G8,
network call, scheduler, daemon, HTTP mutation route, private key, or production
capability is present.

---

### Sprint 7 — ✅ Local activation ceremony complete; external execution absent

Goal:
Fresh Phase 6 Evidence → Exact Target Dossier → Independent Verification →
Sealed External Handoff / Additive Recall.

Plan: [`docs/SPRINT_7_PLAN.md`](docs/SPRINT_7_PLAN.md). DECISION-002 addendum 18
authorizes only the local ceremony package on
`codex/leozops-phase7-activation-ceremony`. It provides:

- one exact policy bound to the latest fresh Phase 6 assessment and all eight
  currently effective signed attestations;
- named deployment/provider/region/project/service plus exact artifact,
  configuration, non-secret credential-reference, canary, and rollback hashes;
- three separately authenticated solo-founder roles: authority, verifier, and
  operator;
- immutable dossiers, approve/reject verifications, sealed handoffs, additive
  recalls, and monotonic events;
- current upstream/expiry/revocation/target drift checks plus transactional
  Phase 6 snapshot locking at every persistence boundary; and
- a fail-closed pending template, preflight, one-shot operator, SQLite /
  PostgreSQL guards, tests, and operations runbook.

Every handoff remains `not_executed` and requires new external authority. Real
infrastructure, artifacts, credentials, adapter registration, canary,
monitoring, deployment, activation, rollback, and incident operations remain
external. No executor, provider SDK, network call, scheduler, daemon,
background loop, HTTP mutation route, or production capability is present.

---

### Sprint 8 — ✅ Local controlled-activation control plane complete; adapter absent

Goal:
Exact Phase 7 Handoff → Zero-mutation Preview → Dual Release → One Persisted
Claim / One Adapter Call → Explicit Observation → Manual Rollback if required.

Plan: [`docs/SPRINT_8_PLAN.md`](docs/SPRINT_8_PLAN.md). DECISION-002 addendum 19
authorizes the local control plane on
`codex/leozops-phase8-controlled-activation`. It provides:

- an exact policy bound to one unrecalled Phase 7 handoff and its target,
  artifact, configuration, canary, and rollback contracts;
- four separately hashed solo-founder credentials for release, execution,
  observation, and rollback, distinct from every upstream credential;
- an initially engaged switch, short dual-credential release, zero-mutation
  preview, and one atomic pre-invocation claim;
- terminal unknown handling for lost responses and crash reconciliation with no
  second adapter invocation;
- explicit receipt-bound observation, immutable incidents, and explicit
  dual-authorized manual rollback; and
- ten append-only SQLite/PostgreSQL tables, a fail-closed preflight, one-shot
  operator, pending template, adversarial tests, operations runbook, automated
  Node 22/24 plus PostgreSQL 16 QA, and a final completion-evidence packet.

The production activation registry is intentionally empty. No provider SDK,
real target secret, external call, deployment, scheduler, daemon, background
loop, HTTP mutation route, automatic retry, observation, or rollback is
installed or authorized. Phase 8 completes the repository-local control-plane
sequence; real G5/G6/G7 evidence and production activation remain external.

---

## Jarvis Product Track — 🚧 In Progress

Phase 8 completes the local safety spine; it does not complete the product
experience or production rollout. The approved plan from this point to Jarvis
v1 is [`docs/JARVIS_COMPLETION_PLAN.md`](docs/JARVIS_COMPLETION_PLAN.md).

| Phase | Product increment | Status | Release gate |
|---|---|---|---|
| 9 | Evidence-grade Ask LeozOps | 🚧 Phase 9A core + Phase 9B OpenAI adapter complete locally; live eval/SLO pending | J1 grounded conversation |
| 10 | Medieval CEO Cockpit | ✅ Complete locally; founder/live acceptance pending | J2 usable evidence cockpit |
| 11 | Proactive Nervous System | ✅ Complete locally; live baseline/channel acceptance pending | J3 trustworthy alerts |
| 12 | Live Observer | ⏳ External critical path | J4 / real G5 `go` |
| 13 | Goal-aware Planner | ✅ Complete locally; named live review pending | J5 reproducible plans |
| 14 | One real supervised hand | ✅ Source command contract canonical on RepositoryRealms `main@0c2b3ff`; registration/live gates blocked | J6 / real G6 history |
| 15 | Exact RepositoryRealms hand | ✅ Adapter and release boundary complete locally; registration/live gates blocked | J6 / real G6 history |
| 16 | Ambient Jarvis and v1 | ✅ Repository candidate complete; live 30-day acceptance blocked | J8 / 30-day release acceptance |
| 17 | Talking Mode | ✅ Merged; provider/device/live voice acceptance blocked | J1 voice qualification / J8 |
| 18 | Jarvis live qualification | ✅ Repository candidate merged; named deployment and CEO acceptance blocked | Exact J1–J8 live evidence |

Phase 9A is implemented on `codex/leozops-phase9a-conversation-core`:
conversation evidence contracts, durable CEO context, six fixed read tools, an
evidence-pack builder, authenticated Ask endpoints, deterministic provider,
golden evaluations, budgets, failure evidence, and SQLite/PostgreSQL lifecycle
coverage. It adds no production model credential, action capability, or
external deployment.

Phase 9B is implemented on `codex/leozops-phase9b-openai-adapter`: one pinned
`gpt-5.6-sol` Responses adapter, strict no-tool structured output, stateless
request semantics, versioned token-cost accounting, billable-call preflight,
and a 12-case eval runner. Deterministic mode remains the default. No key or
live request was used, so credential/revocation proof, live eval quality,
repeated p95 latency/cost, provider monitoring, privacy review, and Product
Owner SLO acceptance still block live J1.

Phase 10 is implemented on `codex/leozops-phase10-medieval-cockpit`: a
responsive medieval CEO cockpit exposes Today, Ask LeozOps, Business,
Recommendations, and a deliberately sealed Command Deck. The public shell is
data-free; tenant evidence arrives only through authenticated same-origin APIs.
The UI progressively reveals only a fully validated Phase 9 answer, keeps
citations inspectable, supports keyboard/reduced-motion/high-contrast use, and
adds no execution route. Repository QA is complete, but the named-deployment
founder usability run and accepted live J1/G5 evidence still block live J2.

Phase 11 is implemented on
`codex/leozops-phase11-proactive-nervous-system`: accepted snapshots feed two
versioned deterministic rules, append-only evaluations and alert state, quiet
hours/cooldown/deduplication, daily and urgent outbox intents, replay-safe
delivery evidence, immutable founder quality outcomes, a J3 shadow evaluator,
and a command-and-exit operator. The production delivery registry and
scheduler remain absent. A named deployment, at least 20 genuine reviews,
accepted volume/FPR, delivery SLO evidence, and Product Owner acceptance still
block live J3.

Phase 12 is implemented on `codex/leozops-phase12-live-observer`: the compiled
read-only runtime now has a non-root production image, exact deployment and
secret-reference preflight, scheduler-owned one-shot poll/evaluate composition,
append-only operational/recovery evidence, redacted request/trace logs,
protected aggregate telemetry, and a disposable-only restore drill. This is a
repository candidate, not a live Observer. The named platform, real network,
P1/P2, at least ten actual business days, live drills, monitoring acceptance,
and a real G5 `go` still block J4.

Phase 13 is implemented on `codex/leozops-phase13-goal-aware-planner`:
strict versioned goal manifests feed evidence-bound deterministic plan graphs,
explicit blocking/advisory conflicts, three uncertainty-labelled simulations,
same-goal comparison, immutable founder decisions/checkpoints/outcomes, and a
Planner cockpit review surface. Every action candidate is non-executable and
routes only to the existing G6 gateway. Repository QA establishes a local J5
candidate; named-deployment review using accepted live J1 evidence and Product
Owner acceptance still block live J5.

Phase 14 qualification is implemented on
`codex/leozops-phase14-supervised-hand-readiness`: the real
RepositoryRealms `task.create` contract is pinned to canonical
`main@0c2b3ff236d747e87113f7d438d42b6b3caadb7c` and exact source blobs, the only
candidate payload is unassigned and PII-minimized, and
the Command Deck exposes tenant-scoped G5/G6/receipt/incident evidence without
an execution route. The exact adapter is implemented and separately tested,
but the production registry remains empty. Real G5 `go`, a command-specific G6
release, named-runtime credentials and registration, supervised live history,
and J6 acceptance still block any real hand.

The product and production-truth lanes may overlap while waiting for external
elapsed evidence, but they must converge before any real command is enabled.

Phase 17 was merged through PR #22 to canonical
`main@875ec3295e4f577af44810d1a70ed73e4f5d747a`: the CEO Cockpit has a
full-duplex WebRTC Talking Mode backed by a server-minted
short-lived Realtime credential, a mandatory read-only Advisor grounding tool,
barge-in lifecycle evidence, and zero LeozOps audio/transcript retention. The
voice provider is disabled by default, the source action registry remains
empty, and action-shaped speech must move to reviewed text confirmation. No
OpenAI key, live SDP/audio exchange, device matrix, CEO acceptance, or live
J1–J8 evidence is claimed.

Phase 18 was merged through PR #24 to canonical
`main@10b99ae3844e13a9ddf41f5728218885d49f54a6`: every
Talking Mode start requires versioned microphone consent; immutable,
content-free events and terminal CEO reviews produce tenant-scoped candidate
quality metrics; the Advisor server—not the browser—attests grounded turns.
An exact release manifest, production startup preflight and bounded HTTPS
qualifier bind revision, immutable image, deployment/source fingerprint,
provider configuration, secret references and J1–J8 operations. The qualifier
can report only `candidate_ready_for_ceo_acceptance`, never live acceptance.
Repository, PostgreSQL and production-shaped local-staging evidence do not
replace a named HTTPS deployment, approved provider/source credentials, real
device samples, elapsed operating windows or CEO acceptance.

The hardened Phase 18 release image was published from canonical
`main@18ce627ce1bbf59d0e3e9221a69b84afcba13d9d` by Actions run 31994132176 as
`ghcr.io/leozvu/leozcrm@sha256:8be1b29008ac38c740e8431e490b2fc34ff3fb4c714ca70cd4fa8371cc0717d7`.
The immutable OCI index contains `linux/amd64` and `linux/arm64` manifests,
digest-pinned SBOM/provenance and GitHub/Sigstore attestation 41064915. Registry,
attestation and an exact-digest non-root/read-only readiness smoke passed. This
closes the repository artifact gate only; it creates no deployment, credential,
live source, device evidence, elapsed acceptance window or action authority.

A post-release qualification audit removed another false-positive path: the
named-deployment qualifier now recomputes both evidence hashes, verifies the
actual five-session/ten-turn/five-review OpenAI Realtime sample and all quality/
privacy invariants, and requires the exact ordered blocked J1–J8 set plus safe
operator truth. A deployment can no longer qualify by echoing
`meets_candidate_thresholds`, returning zero counters, or duplicating J1 eight
times. This strengthens candidate evidence only and does not manufacture live
acceptance.

The credential boundary now also refuses to treat a merely present environment
variable as deployment evidence. Live/Jarvis preflight accepts only structurally
usable, non-placeholder bindings without disclosing them. The Realtime broker
enforces an anonymous 64-hex safety identifier, byte-bounded streaming response,
JSON media type and credential lifetime, sanitized errors, and a deadline that
still fires when a transport ignores abort. These controls close repository
false-positive and resource-exhaustion paths; they do not prove a real OpenAI key
or satisfy a named-runtime, revocation, device, CEO, or J1–J8 gate.

After those runtime changes merged through PR #31, the current executable
candidate was republished from canonical
`main@a0a5ae642c29a9601874e92fccaf0f3c5ae86ec3` by Actions run 31996371713 as
`ghcr.io/leozvu/leozcrm@sha256:b18d66fe55268b1ca31dcde31d40c191c6c62deb0d8f685b1e64da6c8b38f593`.
Registry/platform inspection, GitHub and OCI-bundle attestation verification,
the source-revision label and an exact-digest non-root/read-only readiness smoke
all passed. The earlier digest remains immutable historical evidence; the new
digest is the artifact to bind in a future accepted release manifest. It is not
a deployment and changes no external gate.

---

## Legacy Foundation (historical — completion evidence intact)

The standalone LeozOps application track. Preserved as history per
DECISION-002; this code remains in the repository but is not mounted in the
Egoric integration deployment profile.

M1 — CRM Foundation .................... ✅ Completed
M2 — KPI Read Layer .................... ✅ Completed
M3 — CEO Brief Engine ................... ✅ Completed
M4 — Recommendation System .............. ✅ Completed
M5 — Executive Dashboard & Team Workspace .. ✅ Completed
M6 — Integration Adapters — Placeholder .... ✅ Completed
M7 — Production Hardening ................. ✅ Completed
M8 — Real Integration Publishing ........... ⏸️ Paused
  M8A — Email Publishing (completed)
  M8B — Facebook + Instagram Publishing (paused per DECISION-002)
  M8C — TikTok Publishing (paused per DECISION-002)
  M8D — AI Media Generation (paused per DECISION-002)
M9 — Task Engine .......................... ✅ Completed
M10 — MVP Launch & Client Onboarding ........ 🗄️ Superseded by DECISION-002
  Status: Superseded by DECISION-002
  Reason: The architecture has changed after Egoric ERP became the
  production system of record. LeozOps will not launch as a standalone
  operational CRM.
  Completion evidence retained:
  - Local code: PASS (npm test 159/159, typecheck clean)
  - Onboarding workflow, /ready probe, pilot runbook implemented
  - PostgreSQL smoke (Supabase Session Pooler): PASS — see CHECKLIST.md §14
  - Live standalone pilot verification: never executed; requirement
    superseded by DECISION-002 (deployment now belongs to Sprint 2 of the
    integration track)

Legacy sequence notes (historical):
- M2 was the critical path: it unlocked M3, M4, M5, and M6.
- M7 was staged so safety work surfaced incrementally.
- M9 passed QA; task lifecycle is stable and audit-ordered.
- The former "M10 deployment gate" is closed as superseded; its Postgres
  smoke evidence carries forward to the integration track.

Roadmap scope additions require Leoz approval per GOVERNANCE.md.
