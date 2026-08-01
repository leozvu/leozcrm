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

## Jarvis Product Track — ⏳ Planned

Phase 8 completes the local safety spine; it does not complete the product
experience or production rollout. The approved plan from this point to Jarvis
v1 is [`docs/JARVIS_COMPLETION_PLAN.md`](docs/JARVIS_COMPLETION_PLAN.md).

| Phase | Product increment | Status | Release gate |
|---|---|---|---|
| 9 | Evidence-grade Ask LeozOps | ⏳ Planned next | J1 grounded conversation |
| 10 | Medieval CEO Cockpit | ⏳ Planned | J2 usable evidence cockpit |
| 11 | Proactive Nervous System | ⏳ Planned | J3 trustworthy alerts |
| 12 | Live Observer | ⏳ External critical path | J4 / real G5 `go` |
| 13 | Goal-aware Planner | ⏳ Planned | J5 reproducible plans |
| 14 | One real supervised hand | ⏳ Gate-bound | J6 / real G6 history |
| 15 | Bounded Autopilot | ⏳ Gate-bound | J7 / real G7 canary |
| 16 | Ambient Jarvis and v1 | ⏳ Planned | J8 / 30-day release acceptance |

Phase 9A is the immediate repository task: conversation evidence contracts,
durable CEO context, typed read tools, an evidence-pack builder, authenticated
Ask endpoints, deterministic provider tests, and golden evaluations. It adds no
production model credential, action capability, or external deployment.

The product and production-truth lanes may overlap while waiting for external
elapsed evidence, but they must converge before any real command is enabled.

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
