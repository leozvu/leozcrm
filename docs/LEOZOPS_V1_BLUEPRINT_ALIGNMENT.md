# LeoZOps v1 blueprint alignment

Status: **accepted as the long-horizon completion blueprint; repository work is not reset to Sprint 1E**

The attached product blueprint defines the correct operating loop:

`Observe → Understand → Decide → Act → Remember → Learn`

It also preserves the non-negotiable boundary that high-risk R4 actions always
require explicit human approval. The blueprint's L0 assessment is a conceptual
starting point, not the current repository state: this repository already
contains the local Sprint 1 and Phase 2–14 control planes described below.

| Blueprint capability | Repository truth | Remaining production truth |
|---|---|---|
| Action loop | G6/G7/G8 control planes, one RepositoryRealms task contract, and its exact release-gated adapter exist locally | Immutable canonical source release, adapter registration, G5/G6, deployment, and live history absent |
| Long-term memory | Business Memory, goals, decisions, feedback, plans, and append-only evidence exist | No accepted continuously operating live memory loop |
| Proactive event loop | Deterministic one-shot alerts/outbox and observer orchestration exist | No live scheduler, delivery channel, or accepted usefulness baseline |
| Multimodal access | Medieval installable cockpit, push-to-talk transcript input, on-demand validated speech, and ambient preferences exist locally | Live founder/privacy/browser acceptance remains open |
| Tool/network integration | Read-only source boundary plus one narrow task-command candidate | No registered production adapter or live credential |
| Bounded autonomy | Simulation, kill switch, incidents, recovery, assurance, and activation control planes exist | No earned G7 based on live supervised history |
| Security/audit | Tenant isolation, immutable evidence, fingerprints, preflights, and fail-closed gates are implemented | External deployment/security/recovery proof remains open |
| Testing lab | Deterministic fixtures, SQLite/PostgreSQL paths, source and app regression suites exist | No long-running live shadow/canary evidence |
| UX/adoption | CEO cockpit, Ask, Business, Planner, Command Deck, evaluation dashboard, and data export controls exist | Named live usability and 30-day acceptance evidence absent |

## Execution order from the current baseline

1. Freeze the RepositoryRealms task-command patch as an immutable reviewed
   revision; keep it default-off.
2. Re-pin LeozOps to that revision, then to canonical `main` after merge.
3. Complete real read-only deployment/shadow evidence and issue G5 only from
   accepted production facts.
4. Add exactly one provider adapter and exact G6 release; keep R4 approval
   explicit and preserve preview/receipt/rollback evidence.
5. Accumulate supervised execution history and accept J6.
6. Only then evaluate the same command for bounded G7 autonomy.
7. Execute the already-built scheduler/channel, UX/voice, security, recovery,
   export, and evaluation procedures in the named deployment and collect the
   30-day J8 evidence without widening the command allowlist by implication.

This alignment turns the blueprint into a completion map while preserving the
repository's already-proven work and its capability stop rules.
