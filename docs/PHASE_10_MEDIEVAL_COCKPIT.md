# Phase 10 Medieval CEO Cockpit

Status: **Repository-local implementation complete; live J2 acceptance pending**

Branch: `codex/leozops-phase10-medieval-cockpit`

## Outcome

Phase 10 turns the Phase 9 evidence and conversation contracts into a daily,
keyboard-first CEO cockpit without adding operational authority. The approved
Realm v2 medieval language is applied as presentation: obsidian surfaces,
etched gold hierarchy, restrained emerald status, and compact executive
information density. State meaning remains explicit in text and never depends
on decoration or color alone.

The cockpit is available only in `INTEGRATION_MODE=egoric-readonly`:

- `GET /cockpit` serves a public, data-free connection chamber;
- `GET /cockpit/assets/cockpit.css` and `cockpit.js` serve same-origin static
  assets with no inline script or style;
- `GET /v1/tenants/:tenantKey/cockpit` returns the authenticated,
  tenant-scoped `leozops_cockpit_v1` projection;
- existing Phase 9 conversation, context, citation, and feedback routes power
  Ask LeozOps.

## Five surfaces

1. **Today** — current headline, at most three deterministic priorities,
   freshness, provenance, limitations, and an honest unavailable-history
   state.
2. **Ask LeozOps** — one in-memory conversation session, full server-side
   validation before progressive reveal, exact citation chips, provenance
   drawer, and immutable useful/not-useful feedback.
3. **Business** — current-stage composition, safe source labels, data-quality
   conditions, and the accepted snapshot chain. No historical trend is
   invented when stage history is absent.
4. **Recommendations** — deterministic evidence-backed ordering, rationale,
   impact, and advisory-only status. An empty queue is displayed as an honest
   no-warning state.
5. **Command Deck** — visible authority boundary: read-only, approval adapter
   not connected, execution blocked, receipts/rollback/incidents unavailable,
   and kill switch not exposed. The primary notice is **“Approval is not
   execution.”**

## Trust and security contract

- The tenant read credential exists only in the page closure, is never written
  to local/session storage, is cleared from the input after connection, and is
  discarded on disconnect or `pagehide`.
- Requests use `Authorization: Bearer`, `credentials: 'omit'`, same-origin
  relative URLs, tenant scoping, and `no-store`/private no-cache responses.
- The shell uses a strict CSP with `default-src 'none'`, same-origin connect,
  script, style, and font policies, no form action, no framing, no object
  source, and no inline execution.
- Dynamic content is constructed with `textContent` and `replaceChildren`;
  there is no `innerHTML`, `eval`, generic browser/tool access, or direct
  Egoric form post.
- The cockpit projection is PII-minimized and exposes no external IDs, names,
  email, phone, owner IDs, source rows, or action-adapter handle.
- No `POST /cockpit` API exists. Phase 3-8 gates remain the only future path to
  operational execution.

## Interaction and accessibility

- Semantic tablist/tab/tabpanel structure, landmark labels, live status,
  dialog semantics, skip link, visible focus, and roving tab focus.
- `Ctrl+K`/`Cmd+K` opens Ask LeozOps and focuses the question field.
- Minimum 44 px interactive targets, AA-oriented contrast, text alternatives
  for charts, reduced-motion support, and increased-contrast support.
- Responsive layouts cover 1440/1280 desktop, 1024/768 tablet, and 390/375
  mobile. On mobile the navigation becomes a 56 px-high fixed command bar.
- Loading, fresh, stale, future timestamp, partial context, empty priority,
  blocked command, authentication, network, and recovery states are explicit.

## Local operation

1. Set `INTEGRATION_MODE=egoric-readonly`, the normal database configuration,
   and `INTEGRATION_READ_TOKEN_SECRET`.
2. Start the service with `npm start` or `npm run dev`.
3. Open `/cockpit`, enter the exact tenant key and its signed read credential,
   then connect.
4. Keep deterministic Advisor mode for offline/local use. Selecting the Phase
   9B OpenAI provider still requires its separate runtime key and live gate;
   the cockpit does not weaken that requirement.

## Verification and remaining gate

Automated coverage proves the PII-minimized projection, priority ordering,
honest empty state, CSP/data-free shell, DOM-safe client, responsive and
accessibility contracts, exact tenant authentication, and absence of an
execution route. In-app browser QA reproduced all five surfaces, citation
drill-down, the Ask flow, `Ctrl+K`, 1280 desktop and 390 mobile with no
horizontal overflow, 56 px mobile targets, and no console warning/error.

- Focused Phase 10 suite: **4/4 PASS**.
- Full repository regression: **336/336 PASS**.
- Strict TypeScript, `git diff --check`, 56 local documentation links, and
  changed-file secret scan: **PASS**.
- High/critical production dependency gate: **PASS**. The pre-existing one low
  `body-parser` and one moderate `uuid` advisory remained at the Phase 10 cut
  and were resolved during the Phase 16 release pass; Phase 10 adds no
  dependency.
- No migration changed, so no new persistence claim requires a separate
  PostgreSQL lifecycle proof.

This is a repository-local J2 candidate, not live J2 acceptance. A founder
must still complete and record the under-five-minute North Star usability run
against a named deployment with accepted live J1/G5 evidence. No local
fixture, screenshot, or simulated provider result can satisfy that fact.
