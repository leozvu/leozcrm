# Phase 9A — Ask LeozOps Core

Status: **Repository-local implementation complete; production language model absent**

Branch: `codex/leozops-phase9a-conversation-core`

Governing plan: [`JARVIS_COMPLETION_PLAN.md`](JARVIS_COMPLETION_PLAN.md)

## 1. Capability

Phase 9A turns the accepted Business Memory and deterministic CEO Brief into a
tenant-scoped conversational read surface. It can answer a fixed set of common
pipeline, funnel, source, freshness, limitation, and founder-context questions
in English or Vietnamese.

It is **read-only to Egoric**. The only writes are LeozOps-owned conversation,
context, citation, run, and feedback evidence. The checked-in provider makes no
network request and has no credential, generic tool, or action capability.

## 2. Answer contract

Every answer uses `advisor_answer_v1` and contains:

- one summary;
- zero or more facts, inferences, recommendations, and limitations;
- an explicit `cannot_answer` flag; and
- `advisory_only: true`.

Every statement carries evidence keys. A non-refusal summary must cite
evidence; every fact, inference, recommendation, and limitation must cite
evidence; and any statement containing a digit is rejected if it has no
citation. Unknown keys, duplicate keys, unsupported fields, oversized output,
and an invalid safety version fail closed before an assistant message exists.

The stored answer hash, evidence-pack hash, assistant message, and exact
citation rows must reconcile on replay. Corrupt or incomplete stored evidence
fails closed.

## 3. Evidence and typed read tools

`AdvisorEvidenceService` converts the current deterministic CEO Brief into a
PII-minimized `advisor_evidence_v1` pack. It exposes fixed evidence keys for:

- headline pipeline metrics;
- current funnel stages;
- presentation-safe sources;
- source freshness;
- data quality and known limitations; and
- active founder-recorded goals, constraints, and decisions.

Raw lead identifiers and source payloads never enter the pack. Every evidence
value has its own SHA-256 hash and points to one source snapshot or one
append-only context entry.

`AdvisorReadToolRegistry` contains six fixed projections:

1. `pipeline_summary`;
2. `funnel_state`;
3. `source_mix`;
4. `freshness`;
5. `limitations`; and
6. `business_context`.

There is no generic SQL, HTTP, filesystem, browser, code-execution, or action
tool. Provider input explicitly marks all evidence and founder context as
untrusted data rather than model instructions.

## 4. Persistence

The migration creates seven tenant-scoped tables:

| Table | Purpose |
|---|---|
| `advisor_conversations` | Immutable conversation identity and optional title |
| `advisor_messages` | Ordered user and assistant messages |
| `advisor_runs` | One persisted provider claim per idempotency key |
| `advisor_run_results` | One immutable completed or failed terminal result |
| `advisor_citations` | Exact evidence used by one assistant answer |
| `advisor_context_entries` | Versioned goals, constraints, and decisions |
| `advisor_feedback` | One immutable useful/not-useful rating per completed run |

Every table rejects direct `UPDATE` and `DELETE` on SQLite and PostgreSQL.
Context changes append a replacement that preserves kind and key. A replaced
entry remains historical evidence but leaves the active context view.

The repository claims a question and stores its user message before invoking a
provider. A concurrent request using the same key observes `in_progress` and
cannot call the provider. A completed replay returns the same stored run,
message, answer, and citations. A terminal failed run cannot be retried with the
same key.

## 5. Authenticated HTTP surface

All routes use the existing separate `egoric-readonly` tenant/admin bearer
credential and enforce the tenant key in the path.

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/v1/tenants/:tenantKey/conversations` | Create an immutable conversation |
| `GET` | `/v1/tenants/:tenantKey/conversations/:conversationId` | Read ordered messages and structured answers |
| `POST` | `/v1/tenants/:tenantKey/conversations/:conversationId/messages` | Ask one question; requires `Idempotency-Key` |
| `GET` | `/v1/tenants/:tenantKey/context` | Read active goals, constraints, and decisions |
| `POST` | `/v1/tenants/:tenantKey/context` | Append or explicitly replace one context entry |
| `POST` | `/v1/tenants/:tenantKey/feedback` | Record immutable feedback for one completed run |

Request bodies reject unknown fields and are limited to 32 KiB. Questions are
limited to 1,000 characters; context is limited to 2,000 characters. Obvious
credentials, bearer tokens, email addresses, and unsupported personal
identifiers are rejected before persistence.

## 6. Budgets and failure behavior

Default local limits:

| Limit | Value |
|---|---:|
| Evidence items | 128 |
| Estimated/provider input units | 16,000 |
| Provider output units | 4,000 |
| Cost | 50,000 microunits |
| Serialized answer | 12,000 characters |
| Provider timeout | 8 seconds |

Timeout, provider exception, invalid usage, budget excess, or answer-contract
failure creates one immutable failed result. It creates no assistant message,
no citation, no provider retry, and no external action. The caller must choose a
new idempotency key after correcting the failure.

## 7. Current provider

`DeterministicAdvisorProvider` is the only checked-in composition. It answers
the golden current-state question families and refuses:

- historical comparisons unsupported by the source contract;
- action-shaped requests;
- prompt-injection attempts;
- questions outside the fixed evidence vocabulary; and
- goal/context questions when no active context exists.

This provider is useful as a safe local baseline and regression oracle. It is
not presented as a general language model. No production model SDK, API key,
model registry, network transport, streaming, or deployment is included.

A future Phase 9B adapter must preserve the same answer/evidence contract,
budgets, typed tools, failure evidence, and tenant boundary. Installing it
requires a separate official-provider review, evaluation threshold, secret
reference, cost/latency SLO, and Product Owner release decision.

## 8. Local verification

```bash
npm run typecheck
npx tsx --test src/__tests__/advisorConversation.test.ts
npm test
npm run db:smoke:pg
```

The focused suite covers evidence minimization, typed tools, grounded answers,
numeric citations, common golden questions, stale and insufficient data,
historical/action/prompt-injection refusal, context replacement, tenant
isolation, idempotent and concurrent claims, invalid output, timeout, cost
budget, sensitive input, feedback, HTTP auth, append-only tables, and SQLite
migration rollback/latest.

`db:smoke:pg` also exercises a complete conversation, context, answer,
citation, feedback, replay, seven-table immutability proof, and rollback on
PostgreSQL when a disposable target is configured.

## 9. Explicit non-goals

- production language-model access;
- free-form chat over arbitrary data;
- a generic tool or agent runtime;
- UI, streaming, voice, alerts, or scheduling;
- approval, action, adapter, or Egoric mutation;
- satisfying real G5/G6/G7 or production Jarvis evidence.

Phase 9B model/evaluation work and Phase 10 cockpit work remain separate.
