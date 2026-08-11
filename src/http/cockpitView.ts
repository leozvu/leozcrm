function icon(id: string): string {
  return `<svg aria-hidden="true" focusable="false"><use href="#icon-${id}"></use></svg>`;
}

export function renderCockpitHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#111923">
  <meta name="mobile-web-app-capable" content="yes">
  <title>LeozOps — CEO Cockpit</title>
  <link rel="manifest" href="/cockpit/manifest.webmanifest">
  <link rel="icon" href="/cockpit/assets/icon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/cockpit/assets/cockpit.css">
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to cockpit</a>
  <svg class="icon-sprite" aria-hidden="true">
    <symbol id="icon-realm" viewBox="0 0 24 24"><path d="M12 2 19 6v12l-7 4-7-4V6l7-4Z"/><path d="m8 8 4-2 4 2v5l-4 5-4-5V8Z"/></symbol>
    <symbol id="icon-today" viewBox="0 0 24 24"><path d="M4 5h16v15H4z"/><path d="M8 3v4m8-4v4M4 10h16M8 14h3m-3 3h6"/></symbol>
    <symbol id="icon-ask" viewBox="0 0 24 24"><path d="M5 4h14v12H8l-3 3V4Z"/><path d="M9 8h6m-6 4h4"/></symbol>
    <symbol id="icon-business" viewBox="0 0 24 24"><path d="M4 20V10m6 10V4m6 16v-7m4 7H2"/></symbol>
    <symbol id="icon-plan" viewBox="0 0 24 24"><path d="M5 4h14v16H5z"/><path d="m8 9 2 2 3-4m1 3h2M8 15h8"/></symbol>
    <symbol id="icon-command" viewBox="0 0 24 24"><path d="M5 3h14v18H5z"/><path d="m9 8 2 2-2 2m4 0h3m-7 4h7"/></symbol>
    <symbol id="icon-shield" viewBox="0 0 24 24"><path d="M12 3 19 6v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3Z"/><path d="m9 12 2 2 4-5"/></symbol>
    <symbol id="icon-evidence" viewBox="0 0 24 24"><path d="M6 3h9l3 3v15H6z"/><path d="M14 3v4h4M9 11h6m-6 4h6"/></symbol>
    <symbol id="icon-refresh" viewBox="0 0 24 24"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M7 7a7 7 0 0 1 11 2m-1 8A7 7 0 0 1 6 15"/></symbol>
    <symbol id="icon-exit" viewBox="0 0 24 24"><path d="M10 4H4v16h6m4-4 4-4-4-4m4 4H9"/></symbol>
    <symbol id="icon-close" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></symbol>
    <symbol id="icon-send" viewBox="0 0 24 24"><path d="m4 4 17 8-17 8 3-8-3-8Z"/><path d="M7 12h14"/></symbol>
    <symbol id="icon-mic" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3m-4 0h8"/></symbol>
    <symbol id="icon-install" viewBox="0 0 24 24"><path d="M12 3v12m-5-5 5 5 5-5M5 20h14"/></symbol>
  </svg>

  <div class="realm-shell">
    <aside class="realm-rail" aria-label="Cockpit navigation">
      <div class="realm-brand">
        <span class="realm-sigil">${icon('realm')}</span>
        <span><strong>LEOZOPS</strong><small>Founder command realm</small></span>
      </div>
      <nav class="realm-nav" role="tablist" aria-label="Cockpit destinations">
        <button id="nav-today" type="button" role="tab" aria-selected="true" aria-controls="view-today" data-view="today" disabled>${icon('today')}<span>Today</span></button>
        <button id="nav-ask" type="button" role="tab" aria-selected="false" aria-controls="view-ask" data-view="ask" disabled>${icon('ask')}<span>Ask LeozOps</span></button>
        <button id="nav-business" type="button" role="tab" aria-selected="false" aria-controls="view-business" data-view="business" disabled>${icon('business')}<span>Business</span></button>
        <button id="nav-planner" type="button" role="tab" aria-selected="false" aria-controls="view-planner" data-view="planner" disabled>${icon('plan')}<span>Planner</span></button>
        <button id="nav-command" type="button" role="tab" aria-selected="false" aria-controls="view-command" data-view="command" disabled>${icon('command')}<span>Command Deck</span></button>
      </nav>
      <div class="rail-seal">
        ${icon('shield')}
        <span><strong>Read-only realm</strong><small>No Egoric mutation route</small></span>
      </div>
    </aside>

    <header class="realm-topbar">
      <div>
        <span class="eyebrow">REALM / CEO COCKPIT</span>
        <span id="tenant-label" class="tenant-label">Awaiting secure connection</span>
      </div>
      <div class="topbar-actions">
        <span id="connection-state" class="state-chip state-offline"><span></span>Disconnected</span>
        <button id="install-button" class="icon-button" type="button" aria-label="Install LeozOps cockpit" title="Install cockpit" hidden>${icon('install')}</button>
        <button id="refresh-button" class="icon-button" type="button" aria-label="Refresh cockpit" title="Refresh cockpit" disabled>${icon('refresh')}</button>
        <button id="disconnect-button" class="icon-button" type="button" aria-label="Disconnect and clear credential" title="Disconnect" disabled>${icon('exit')}</button>
      </div>
    </header>

    <main id="main-content" class="realm-main" tabindex="-1">
      <section id="connection-chamber" class="connection-chamber" aria-labelledby="connection-title">
        <div class="connection-crest">${icon('realm')}</div>
        <p class="eyebrow">SECURE ENTRY</p>
        <h1 id="connection-title">Enter the founder cockpit</h1>
        <p class="lede">Your credential stays in this page's memory, is sent only to same-origin LeozOps APIs, and is discarded when you disconnect or close the page.</p>
        <form id="connection-form" autocomplete="off" novalidate>
          <div class="field">
            <label for="tenant-key">Tenant key</label>
            <input id="tenant-key" name="tenant" type="text" inputmode="text" autocapitalize="none" spellcheck="false" maxlength="64" required aria-describedby="tenant-help">
            <small id="tenant-help">The tenant key encoded in your read credential.</small>
          </div>
          <div class="field">
            <label for="read-token">Read credential</label>
            <input id="read-token" name="token" type="password" autocomplete="off" maxlength="2048" required aria-describedby="token-help">
            <small id="token-help">Never persisted in local or session storage.</small>
          </div>
          <p id="connection-error" class="form-error" role="alert" hidden></p>
          <button id="connect-button" class="primary-button" type="submit">${icon('shield')}<span>Open read-only cockpit</span></button>
        </form>
        <div class="trust-strip"><span>Tenant scoped</span><span>Evidence cited</span><span>Actions sealed</span></div>
      </section>

      <section id="cockpit-workspace" class="cockpit-workspace" hidden>
        <div id="global-status" class="sr-only" aria-live="polite"></div>
        <header class="cockpit-hero">
          <div>
            <p class="eyebrow">THE FOUNDER'S MORNING BRIEF</p>
            <h1 id="workspace-title">The realm at a glance</h1>
            <p id="workspace-subtitle" class="lede">Verified business state, visible evidence, bounded advice.</p>
          </div>
          <div class="freshness-panel">
            <span id="freshness-chip" class="state-chip"><span></span>Unknown</span>
            <small id="freshness-copy">No source timestamp</small>
          </div>
        </header>

        <section id="view-today" class="cockpit-view" role="tabpanel" aria-labelledby="nav-today" data-panel="today">
          <h2 class="sr-only" tabindex="-1">Today</h2>
          <div id="headline-metrics" class="metric-grid" aria-label="Current business headline"></div>
          <div class="workspace-grid today-grid">
            <article class="realm-panel attention-panel">
              <div class="panel-heading"><div><p class="eyebrow">ATTENTION</p><h2>What requires you now</h2></div><span id="attention-count" class="count-seal">0</span></div>
              <div id="today-priorities" class="priority-list"></div>
            </article>
            <article class="realm-panel evidence-panel">
              <div class="panel-heading"><div><p class="eyebrow">TRUTH WINDOW</p><h2>What changed</h2></div>${icon('evidence')}</div>
              <div id="changes-state" class="truth-state"></div>
              <dl id="provenance-summary" class="provenance-list"></dl>
            </article>
          </div>
          <article class="realm-panel signal-panel" aria-labelledby="signal-title">
            <div class="panel-heading">
              <div><p class="eyebrow">PROACTIVE NERVOUS SYSTEM</p><h2 id="signal-title">Signals that changed</h2></div>
              <span id="alert-count" class="count-seal" aria-label="Active alert count">0</span>
            </div>
            <p class="panel-intro">Deduplicated alerts from fresh, complete evidence. Acknowledgement and snooze affect LeozOps only.</p>
            <p id="alert-error" class="form-error" role="alert" hidden></p>
            <div id="alert-list" class="alert-list" aria-live="polite"></div>
          </article>
          <article class="realm-panel limitation-panel">
            <div class="panel-heading"><div><p class="eyebrow">KNOWN BOUNDARIES</p><h2>Limitations before decisions</h2></div></div>
            <div id="today-limitations" class="limitation-grid"></div>
          </article>
        </section>

        <section id="view-ask" class="cockpit-view" role="tabpanel" data-panel="ask" hidden>
          <header class="section-heading"><div><p class="eyebrow">EVIDENCE-GROUNDED ADVISOR</p><h2 tabindex="-1">Ask LeozOps</h2><p>Answers are validated in full before this cockpit reveals them progressively.</p></div><span class="authority-label">Advisory only</span></header>
          <div class="ask-layout">
            <div class="conversation-panel realm-panel">
              <div class="talking-mode-bar">
                <div><p class="eyebrow">SECURE REALTIME VOICE</p><strong>Talking Mode</strong><small id="talking-mode-copy">Off · WebRTC audio is not retained by LeozOps.</small></div>
                <span id="talking-mode-state" class="state-chip state-offline"><span></span>Off</span>
                <button id="talking-mode-button" type="button" class="secondary-button"><span>Start Talking Mode</span></button>
              </div>
              <div id="conversation-log" class="conversation-log" role="log" aria-live="polite" aria-label="Advisor conversation">
                <div class="conversation-empty"><span class="realm-sigil">${icon('ask')}</span><h3>Ask from the evidence already in the room</h3><p>Try “What needs my attention?” or “What can this snapshot not tell me?”</p></div>
              </div>
              <form id="ask-form" class="ask-composer">
                <label for="advisor-question">Question for LeozOps</label>
                <div><textarea id="advisor-question" rows="2" maxlength="1000" placeholder="Ask about current business evidence…" required></textarea><button id="voice-input-button" type="button" class="icon-button voice-button" aria-label="Start push-to-talk voice input" title="Push to talk">${icon('mic')}</button><button id="ask-button" type="submit" class="send-button" aria-label="Send question">${icon('send')}</button></div>
                <small id="voice-boundary-copy">The mic button only fills this composer. Talking Mode uses grounded read-only advice and has no action authority.</small>
                <p id="ask-error" class="form-error" role="alert" hidden></p>
              </form>
            </div>
            <aside class="realm-panel memory-panel" aria-labelledby="memory-title">
              <div class="panel-heading"><div><p class="eyebrow">CEO MEMORY</p><h2 id="memory-title">Current context</h2></div></div>
              <div id="context-list" class="context-list"></div>
              <form id="preference-form" class="preference-form">
                <div class="panel-heading"><div><p class="eyebrow">AMBIENT PREFERENCES</p><h3>How Jarvis meets you</h3></div><span id="preference-version" class="authority-label">Defaults</span></div>
                <div class="preference-grid">
                  <label>Language<select id="preference-locale"><option value="en">English</option><option value="vi">Tiếng Việt</option></select></label>
                  <label>Briefing cadence<select id="preference-cadence"><option value="manual">Manual</option><option value="daily">Daily</option><option value="weekdays">Weekdays</option></select></label>
                  <label>Timezone<input id="preference-timezone" value="UTC" maxlength="64" autocomplete="off"></label>
                  <label>Voice output<select id="preference-voice"><option value="off">Off</option><option value="on_demand">On demand</option></select></label>
                  <label>Quiet start<input id="preference-quiet-start" type="time" value="22:00"></label>
                  <label>Quiet end<input id="preference-quiet-end" type="time" value="07:00"></label>
                </div>
                <button id="preference-save" class="secondary-button" type="submit"><span>Save preferences</span></button>
                <p id="preference-error" class="form-error" role="alert" hidden></p>
              </form>
            </aside>
          </div>
        </section>

        <section id="view-business" class="cockpit-view" role="tabpanel" data-panel="business" hidden>
          <header class="section-heading"><div><p class="eyebrow">BUSINESS MEMORY</p><h2 tabindex="-1">Pipeline truth</h2><p>Current-state funnel, acquisition source, data quality, and provenance.</p></div><button id="business-evidence-button" class="secondary-button" type="button">${icon('evidence')}Evidence chain</button></header>
          <div class="workspace-grid business-grid">
            <article class="realm-panel"><div class="panel-heading"><div><p class="eyebrow">FUNNEL</p><h3>Stage composition</h3></div></div><div id="funnel-list" class="funnel-list"></div></article>
            <article class="realm-panel"><div class="panel-heading"><div><p class="eyebrow">ACQUISITION</p><h3>Safe source labels</h3></div></div><div id="source-list" class="source-list"></div></article>
          </div>
          <article class="realm-panel"><div class="panel-heading"><div><p class="eyebrow">DATA QUALITY</p><h3>Evidence condition</h3></div></div><div id="quality-grid" class="quality-grid"></div></article>
        </section>

        <section id="view-planner" class="cockpit-view" role="tabpanel" data-panel="planner" hidden>
          <header class="section-heading"><div><p class="eyebrow">GOAL-AWARE PLANNER</p><h2 tabindex="-1">Plan the next move</h2><p>Versioned goals, reproducible evidence, explicit conflicts, and scenario comparison.</p></div><span class="authority-label">Accept plan ≠ execute action</span></header>
          <article class="realm-panel planner-inputs">
            <div class="panel-heading"><div><p class="eyebrow">ADVISORY INPUTS</p><h3>Recommendations</h3><p>Deterministic priorities derived only from warning evidence.</p></div><span class="authority-label">No automatic action</span></div>
            <div id="recommendation-list" class="recommendation-grid"></div>
          </article>
          <article class="planner-boundary realm-panel">
            <div class="command-crest">${icon('shield')}</div>
            <div><p class="eyebrow">AUTHORITY BOUNDARY</p><h3>Every plan is advisory.</h3><p>Accepting a plan records founder intent inside LeozOps only. Any action-shaped step remains not authorized and must enter the separate G6 proposal, preview, and approval gateway.</p></div>
          </article>
          <p id="planner-error" class="form-error" role="alert" hidden></p>
          <div id="planner-summary" class="planner-summary" aria-label="Planner summary"></div>
          <div id="planner-list" class="planner-grid" aria-live="polite"></div>
        </section>

        <section id="view-command" class="cockpit-view" role="tabpanel" data-panel="command" hidden>
          <header class="section-heading"><div><p class="eyebrow">SEALED CONTROL PLANE</p><h2 tabindex="-1">Command Deck</h2><p>Observe authority state without widening it.</p></div><span class="state-chip state-blocked"><span></span>Execution blocked</span></header>
          <article class="command-seal realm-panel">
            <div class="command-crest">${icon('shield')}</div>
            <div><p class="eyebrow">CAPABILITY BOUNDARY</p><h3 id="command-notice">Approval is not execution.</h3><p id="command-reason"></p></div>
          </article>
          <p id="command-error" class="form-error" role="alert" hidden></p>
          <div id="command-state-grid" class="command-state-grid"></div>
          <div class="hand-layout">
            <article class="realm-panel hand-readiness">
              <div class="panel-heading"><div><p class="eyebrow">PHASE 14 QUALIFICATION</p><h3>One supervised hand</h3><p id="command-contract-copy" class="panel-intro"></p></div><span id="command-contract-status" class="state-chip state-blocked"><span></span>Blocked</span></div>
              <ul id="command-blocker-list" class="command-blocker-list" aria-label="Supervised hand blockers"></ul>
            </article>
            <article class="realm-panel hand-ledger">
              <div class="panel-heading"><div><p class="eyebrow">IMMUTABLE EVIDENCE</p><h3>Approval, receipt, and incident ledger</h3></div><span class="authority-label">Read only</span></div>
              <div id="command-record-list" class="command-record-list" aria-live="polite"></div>
            </article>
          </div>
          <article class="realm-panel jarvis-evaluation-panel">
            <div class="panel-heading"><div><p class="eyebrow">JARVIS V1 EVALUATION</p><h3>30-day product and safety window</h3><p class="panel-intro">Measured repository evidence. It never substitutes for live J1–J8 acceptance.</p></div><span id="jarvis-readiness-status" class="state-chip state-blocked"><span></span>Blocked external</span></div>
            <div id="jarvis-evaluation-grid" class="quality-grid"></div>
            <div id="jarvis-checkpoint-list" class="checkpoint-list"></div>
          </article>
          <article class="realm-panel data-governance-panel">
            <div class="panel-heading"><div><p class="eyebrow">DATA GOVERNANCE</p><h3>Inspect, export, and request deletion</h3><p class="panel-intro">Exports are sanitized. Delete requests preserve evidence and remain blocked until an accepted retention policy and operator review exist.</p></div><span class="authority-label">Tenant scoped</span></div>
            <form id="data-request-form" class="data-request-form">
              <label>Request type<select id="data-request-kind"><option value="export">Sanitized export</option><option value="delete">Delete request</option></select></label>
              <label>Exact confirmation<input id="data-request-confirmation" maxlength="96" autocomplete="off" placeholder="EXPORT tenant-key"></label>
              <button id="data-request-submit" class="secondary-button" type="submit"><span>Create request</span></button>
            </form>
            <p id="data-request-error" class="form-error" role="alert" hidden></p>
            <div id="data-request-list" class="data-request-list" aria-live="polite"></div>
          </article>
        </section>
      </section>
    </main>
  </div>

  <dialog id="evidence-dialog" aria-labelledby="evidence-title">
    <div class="dialog-heading"><div><p class="eyebrow">PROVENANCE</p><h2 id="evidence-title">Evidence detail</h2></div><button id="evidence-close" class="icon-button" type="button" aria-label="Close evidence detail">${icon('close')}</button></div>
    <p id="evidence-description"></p>
    <dl id="evidence-items" class="evidence-items"></dl>
  </dialog>
  <dialog id="advisory-confirmation-dialog" aria-labelledby="advisory-confirmation-title">
    <div class="dialog-heading"><div><p class="eyebrow">ADVISORY BOUNDARY</p><h2 id="advisory-confirmation-title">This sounds action-shaped</h2></div><button id="advisory-confirmation-close" class="icon-button" type="button" aria-label="Cancel question">${icon('close')}</button></div>
    <p>LeozOps will treat this only as a question. Sending it cannot approve, schedule, mutate, or execute anything in RepositoryRealms.</p>
    <div class="dialog-actions"><button id="advisory-confirmation-cancel" class="secondary-button" type="button">Cancel</button><button id="advisory-confirmation-send" class="primary-button" type="button">Send as advisory question</button></div>
  </dialog>
  <script src="/cockpit/assets/cockpit.js" defer></script>
</body>
</html>`;
}
