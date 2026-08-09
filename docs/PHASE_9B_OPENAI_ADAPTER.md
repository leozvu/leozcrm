# Phase 9B — OpenAI Responses Advisor Adapter

Status: **Repository implementation complete; live credentialed evaluation pending**

Authority: DECISION-002 addendum 22.

Branch: `codex/leozops-phase9b-openai-adapter`

## 1. Outcome

Phase 9B adds one allowlisted network provider behind the frozen Phase 9A
`AdvisorModelProvider` contract. It can turn the existing PII-minimized evidence
pack into `advisor_answer_v1`; it cannot retrieve more data, browse, call a
tool, run code, mutate Egoric, or reach the Phase 3-8 action adapters.

The runtime remains offline by default. `LEOZOPS_ADVISOR_PROVIDER` defaults to
`deterministic`. Selecting `openai` without `OPENAI_API_KEY` stops application
composition instead of falling back silently.

## 2. Reviewed OpenAI contract

The model-selection resolver and current official documentation were reviewed
on 2026-08-01:

- model: [`gpt-5.6-sol`](https://developers.openai.com/api/docs/models/gpt-5.6-sol);
- endpoint: [`POST /v1/responses`](https://developers.openai.com/api/reference/resources/responses/methods/create);
- structured output: strict `text.format` JSON Schema per the
  [Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs);
- model guidance: explicit `none` reasoning for the initial factual/latency baseline,
  current-turn reasoning state, and representative evals per the
  [GPT-5.6 guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6).

The adapter uses the direct HTTPS contract rather than adding an SDK. This
keeps retries at zero, preserves the existing service-owned timeout, and adds
no dependency. The endpoint and model are constants; environment configuration
cannot redirect evidence to another host or select an unreviewed model.

## 3. Exact request boundary

Every call uses:

- `https://api.openai.com/v1/responses`;
- `gpt-5.6-sol`;
- `store: false`, `stream: false`, and truncation disabled;
- `reasoning.effort: none` and `reasoning.context: current_turn`;
- one user `input_text` containing the question and the already-approved
  structured evidence pack;
- strict `leozops_advisor_answer` JSON Schema;
- `tools: []`, `tool_choice: none`, and parallel tool calls disabled;
- explicit prompt-cache mode with no breakpoint, preventing an implicit cache
  write for this stateless path; and
- a bounded output maximum, 512 tokens by default plus a concise-section prompt.

Question text, evidence labels, and evidence values are explicitly treated as
untrusted data. The system instruction cannot grant action capability because
no tool or action transport is present in the request or adapter.

Responses fail closed on non-2xx status, wrong content type, excessive body,
invalid JSON, incomplete status, model mismatch, refusal, missing/duplicate
assistant text, invalid token usage, or malformed structured output. Provider
bodies and the API key are never included in persisted failure codes or public
errors.

## 4. Cost contract

The checked-in pricing policy is versioned
`gpt-5.6-sol-standard-2026-08-01`. The canonical model page showed this
standard-service rate card per one million tokens when reviewed:

| Unit | USD | Stored policy in USD microunits |
|---|---:|---:|
| Input | 5.00 | 5,000,000 |
| Cached input | 0.50 | 500,000 |
| Cache write | 6.25 | 6,250,000 |
| Output | 30.00 | 30,000,000 |

Requests over 272,000 input tokens apply the documented 2x input and 1.5x
output multipliers, although the Advisor service currently rejects input above
16,000 units first.

The adapter computes a conservative maximum from estimated application input,
a 1,200-token system/schema/wire allowance, and its full configured output
allowance before a billable call. If that estimate exceeds
the service's 50,000-microunit run budget, the run terminates as
`provider_budget_preflight_exceeded` with zero transport calls. Completed calls
and failed runs that received valid usage record provider input/output units
and the versioned cost calculation. A
pricing change requires code review and a provider-version change; it may not
silently reinterpret old runs.

## 5. Configuration

Keep the default offline mode for tests and ordinary development:

```dotenv
LEOZOPS_ADVISOR_PROVIDER=deterministic
```

The reviewed network adapter is an explicit opt-in:

```dotenv
INTEGRATION_MODE=egoric-readonly
LEOZOPS_ADVISOR_PROVIDER=openai
OPENAI_API_KEY=<runtime-secret-reference>
LEOZOPS_OPENAI_MAX_OUTPUT_TOKENS=512
```

The key belongs in the deployment secret manager, never in a manifest,
database, shell transcript, test fixture, or Git commit. The output-token value
must be an integer from 256 to 4,000 and becomes part of the provider version.
Changing it can make the cost preflight reject requests that previously fit.

## 6. Evaluation gate

The expanded frozen set has 12 factual, overview, insufficient-data,
action-shaped, prompt-injection, evidence-injection, secret-exfiltration, and
PII-request cases. Acceptance requires:

- 100% valid `advisor_answer_v1` contracts, including numeric-citation rules;
- at least 90% expected answer-versus-cannot-answer behavior;
- recorded per-case latency, input units, output units, cost, and safe failure;
  and
- no action/tool request emitted by the adapter.

The offline evaluator and transport/security tests run under `npm test`. A
billable live evaluation requires two explicit environment values:

```powershell
$env:OPENAI_API_KEY = '<secret-manager-value>'
$env:LEOZOPS_RUN_LIVE_OPENAI_EVAL = 'I_UNDERSTAND_THIS_CALLS_OPENAI'
npm run advisor:eval:openai
```

The command prints a JSON report without the key or answer prose and exits
nonzero below threshold. This repository change did not install a key and did
not run the live command. Consequently, live model quality, p95 latency, real
cost distribution, rate limits, and deployment data-handling approval remain
open evidence.

## 7. Streaming decision

Provider streaming is deliberately deferred. Phase 9 persists an assistant
message only after the complete JSON object passes schema, evidence, PII, and
budget validation. Partial token delivery would create a second state machine
and could display an unvalidated claim.

Phase 10 may add cockpit transport streaming as a separate, explicitly marked
ephemeral preview, but the durable Phase 9 answer remains one validated
terminal object. The provider boundary stays non-streaming until that UI state
and cancellation contract are reviewed.

## 8. Remaining release blockers

The local adapter is production-shaped, not production-released. J1 remains
open until a named deployment provides:

1. secret-manager injection and revocation proof;
2. the accepted live 12-case report and repeated latency/cost sample;
3. privacy/data-retention review for the exact OpenAI project;
4. monitoring and alert thresholds for provider failures, latency, and spend;
5. a Product Owner decision accepting the measured model/SLO envelope; and
6. the still-separate G5 live Observer evidence.

No part of Phase 9B authorizes UI approval, notifications, scheduling, generic
agent tools, or operational execution.
