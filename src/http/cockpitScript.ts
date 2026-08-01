export const COCKPIT_SCRIPT = String.raw`
(function () {
  'use strict';

  var state = {
    token: '',
    tenant: '',
    snapshot: null,
    context: [],
    conversationId: null,
    activeView: 'today',
    requestController: null
  };

  function id(value) { return document.getElementById(value); }
  function all(selector) { return Array.prototype.slice.call(document.querySelectorAll(selector)); }
  function clear(element) { element.replaceChildren(); }
  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }
  function setHidden(elementValue, hidden) { elementValue.hidden = hidden; }
  function announce(message) { id('global-status').textContent = message; }
  function setError(target, message) {
    target.textContent = message || '';
    target.hidden = !message;
  }
  function setBusy(button, busy, busyLabel, idleLabel) {
    button.disabled = busy;
    button.setAttribute('aria-busy', busy ? 'true' : 'false');
    var text = button.querySelector('span');
    if (text) text.textContent = busy ? busyLabel : idleLabel;
  }

  function formatNumber(value) {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(Number(value));
  }
  function formatPercent(value) {
    return value === null ? 'Unavailable' : new Intl.NumberFormat('en-US', {
      style: 'percent', maximumFractionDigits: 1
    }).format(Number(value));
  }
  function formatDate(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Invalid timestamp';
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC'
    }).format(date) + ' UTC';
  }
  function formatAge(seconds) {
    var value = Math.abs(Number(seconds));
    if (value < 60) return Math.floor(value) + ' seconds';
    if (value < 3600) return Math.floor(value / 60) + ' minutes';
    if (value < 86400) return (value / 3600).toFixed(1) + ' hours';
    return (value / 86400).toFixed(1) + ' days';
  }
  function titleCase(value) {
    return String(value).replace(/_/g, ' ').replace(/\b\w/g, function (letter) {
      return letter.toUpperCase();
    });
  }

  function friendlyError(error) {
    if (!navigator.onLine) return 'You appear to be offline. Reconnect and try again.';
    if (error && error.status === 401) return 'The read credential was rejected. Re-enter a current credential.';
    if (error && error.status === 403) return 'This credential cannot access the requested tenant.';
    if (error && error.status === 404) return 'No accepted business snapshot is available for this tenant.';
    if (error && error.code === 'provider_timeout') return 'LeozOps timed out before producing a validated answer. Retry the question.';
    return 'The cockpit could not complete this request. Retry or reconnect.';
  }

  async function api(path, options) {
    if (!state.token) throw new Error('No in-memory credential');
    var request = options || {};
    var headers = new Headers(request.headers || {});
    headers.set('Authorization', 'Bearer ' + state.token);
    headers.set('Accept', 'application/json');
    if (request.body) headers.set('Content-Type', 'application/json');
    var response = await fetch(path, {
      method: request.method || 'GET',
      headers: headers,
      body: request.body,
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: request.signal
    });
    var contentType = response.headers.get('content-type') || '';
    var payload = contentType.indexOf('application/json') >= 0 ? await response.json() : null;
    if (!response.ok) {
      var error = new Error('Cockpit API request failed');
      error.status = response.status;
      error.code = payload && typeof payload.code === 'string' ? payload.code : 'request_failed';
      throw error;
    }
    if (!payload || typeof payload !== 'object') throw new Error('Cockpit API returned an invalid response');
    return payload;
  }

  function setConnectionChip(label, className) {
    var chip = id('connection-state');
    chip.className = 'state-chip ' + className;
    chip.lastChild.textContent = label;
  }

  function enableWorkspace(enabled) {
    all('.realm-nav button').forEach(function (button) { button.disabled = !enabled; });
    id('refresh-button').disabled = !enabled;
    id('disconnect-button').disabled = !enabled;
  }

  function resetWorkspace(message) {
    state.token = '';
    state.tenant = '';
    state.snapshot = null;
    state.context = [];
    state.conversationId = null;
    if (state.requestController) state.requestController.abort();
    state.requestController = null;
    enableWorkspace(false);
    setHidden(id('cockpit-workspace'), true);
    setHidden(id('connection-chamber'), false);
    id('tenant-label').textContent = 'Awaiting secure connection';
    setConnectionChip('Disconnected', 'state-offline');
    setError(id('connection-error'), message || '');
    id('read-token').value = '';
    id('read-token').focus();
  }

  function showView(name, moveFocus) {
    state.activeView = name;
    all('[data-panel]').forEach(function (panel) { panel.hidden = panel.dataset.panel !== name; });
    all('[data-view]').forEach(function (button) {
      button.setAttribute('aria-selected', button.dataset.view === name ? 'true' : 'false');
      button.tabIndex = button.dataset.view === name ? 0 : -1;
    });
    var titles = {
      today: ['The realm at a glance', 'Verified business state, visible evidence, bounded advice.'],
      ask: ['Ask the realm', 'Grounded answers from the evidence already in LeozOps.'],
      business: ['Pipeline truth', 'Current-state funnel, source quality, and provenance.'],
      recommendations: ['The advisory queue', 'Evidence-backed priorities without automatic execution.'],
      command: ['The sealed command deck', 'Authority is visible; operational execution remains blocked.']
    };
    id('workspace-title').textContent = titles[name][0];
    id('workspace-subtitle').textContent = titles[name][1];
    if (moveFocus) {
      var heading = document.querySelector('[data-panel="' + name + '"] h2[tabindex="-1"]');
      if (heading) heading.focus(); else id('main-content').focus();
    }
  }

  function addDefinition(list, term, description) {
    list.append(element('dt', '', term), element('dd', '', description));
  }

  function openEvidence(title, description, items) {
    id('evidence-title').textContent = title;
    id('evidence-description').textContent = description || 'Evidence attached to this claim.';
    var list = id('evidence-items');
    clear(list);
    (items || []).forEach(function (item) {
      addDefinition(list, item.label || item.key || 'Evidence', item.value === null ? 'Unavailable' : item.value);
    });
    var dialog = id('evidence-dialog');
    if (typeof dialog.showModal === 'function') dialog.showModal();
  }

  function metric(label, value, note) {
    var card = element('article', 'metric-card');
    card.append(element('small', '', label), element('strong', '', value), element('span', '', note));
    return card;
  }

  function renderHeadline(snapshot) {
    var target = id('headline-metrics');
    clear(target);
    var headline = snapshot.today.headline;
    target.append(
      metric('Total leads', formatNumber(headline.total_leads), 'Accepted current snapshot'),
      metric('Active pipeline', formatNumber(headline.active_pipeline), 'Open operational state'),
      metric('Win rate', formatPercent(headline.win_rate), headline.win_rate === null ? 'No closed outcomes' : 'Won / closed outcomes'),
      metric('Overdue closes', formatNumber(headline.overdue_expected_close), 'Expected close before cutoff')
    );
  }

  function priorityCard(priority) {
    var card = element('article', 'priority-card');
    var mark = element('span', 'severity-mark' + (priority.severity === 'warning' ? ' severity-warning' : ''));
    mark.setAttribute('aria-label', priority.severity + ' priority');
    var copy = element('div');
    copy.append(element('h3', '', priority.title), element('p', '', priority.rationale));
    var button = element('button', 'evidence-button', 'View evidence');
    button.type = 'button';
    button.addEventListener('click', function () {
      openEvidence(priority.title, priority.rationale, priority.evidence);
    });
    card.append(mark, copy, button);
    return card;
  }

  function renderPriorities(snapshot) {
    id('attention-count').textContent = String(snapshot.today.attention_count);
    var target = id('today-priorities');
    clear(target);
    if (!snapshot.today.priorities.length) {
      target.append(element('div', 'empty-state', 'No warning-derived priority exists in the current snapshot.'));
      return;
    }
    snapshot.today.priorities.forEach(function (priority) { target.append(priorityCard(priority)); });
  }

  function renderTruth(snapshot) {
    var changes = id('changes-state');
    clear(changes);
    changes.append(element('strong', '', 'Historical change is unavailable'), element('p', '', snapshot.today.changes.reason));
    var provenance = id('provenance-summary');
    clear(provenance);
    addDefinition(provenance, 'Source', snapshot.provenance.source_system);
    addDefinition(provenance, 'As of', formatDate(snapshot.as_of));
    addDefinition(provenance, 'Snapshot', snapshot.provenance.source_snapshot_id);
    addDefinition(provenance, 'Formula', snapshot.provenance.formula_version);
  }

  function renderLimitations(snapshot) {
    var target = id('today-limitations');
    clear(target);
    snapshot.limitations.forEach(function (limitation) {
      var card = element('article', 'limitation-item');
      card.append(element('strong', '', titleCase(limitation.code)), element('p', '', limitation.message));
      target.append(card);
    });
  }

  function renderFunnel(snapshot) {
    var target = id('funnel-list');
    clear(target);
    var maximum = snapshot.business.stages.reduce(function (max, stage) {
      return Math.max(max, Number(stage.count));
    }, 0);
    snapshot.business.stages.forEach(function (stage) {
      var row = element('div', 'funnel-row');
      var copy = element('div', 'funnel-copy');
      copy.append(element('strong', '', titleCase(stage.stage)), element('span', '', formatNumber(stage.count) + ' at stage'));
      var track = element('div', 'funnel-track');
      var bar = element('span', 'funnel-bar');
      var percentage = maximum > 0 ? Math.round(Number(stage.count) / maximum * 100) : 0;
      bar.style.setProperty('--bar-size', percentage + '%');
      track.append(bar);
      row.append(copy, track);
      target.append(row);
    });
  }

  function renderSources(snapshot) {
    var target = id('source-list');
    clear(target);
    var maximum = snapshot.business.sources.reduce(function (max, source) {
      return Math.max(max, Number(source.count));
    }, 0);
    if (!snapshot.business.sources.length) {
      target.append(element('div', 'empty-state', 'No safe source labels are available.'));
      return;
    }
    snapshot.business.sources.forEach(function (source) {
      var row = element('div', 'source-row');
      var copy = element('div', 'source-copy');
      copy.append(element('strong', '', source.source || 'Missing source'), element('span', '', formatNumber(source.count)));
      var track = element('div', 'source-track');
      var bar = element('span', 'source-bar');
      var percentage = maximum > 0 ? Math.round(Number(source.count) / maximum * 100) : 0;
      bar.style.setProperty('--bar-size', percentage + '%');
      track.append(bar);
      row.append(copy, track);
      target.append(row);
    });
  }

  function qualityCard(label, value, note) {
    var card = element('div', 'quality-card');
    card.append(element('small', '', label), element('strong', '', value), element('span', '', note));
    return card;
  }

  function renderQuality(snapshot) {
    var quality = snapshot.business.quality;
    var target = id('quality-grid');
    clear(target);
    target.append(
      qualityCard('Records', formatNumber(quality.records), 'Accepted source rows'),
      qualityCard('Missing source', formatNumber(quality.missing_source), 'Explicitly unavailable'),
      qualityCard('Missing created at', formatNumber(quality.missing_created_at), 'Limits time analysis'),
      qualityCard('Client attribution', titleCase(quality.client_attribution), 'Company-wide view'),
      qualityCard('Snapshot', 'Verified', snapshot.provenance.source_snapshot_id.slice(0, 18) + '…'),
      qualityCard('History', 'Unavailable', 'No stage transition ledger')
    );
  }

  function recommendationCard(priority, index) {
    var card = element('article', 'recommendation-card');
    var meta = element('div', 'recommendation-meta');
    meta.append(element('span', '', 'Priority ' + (index + 1)), element('span', '', titleCase(priority.impact)), element('span', '', 'Evidence backed'));
    card.append(meta, element('h3', '', priority.title), element('p', '', priority.rationale));
    var button = element('button', 'evidence-button', 'Inspect evidence');
    button.type = 'button';
    button.addEventListener('click', function () { openEvidence(priority.title, priority.rationale, priority.evidence); });
    card.append(button);
    return card;
  }

  function renderRecommendations(snapshot) {
    var target = id('recommendation-list');
    clear(target);
    if (!snapshot.recommendations.length) {
      target.append(element('div', 'empty-state', 'No recommendation was derived because the current snapshot contains no matching warning evidence.'));
      return;
    }
    snapshot.recommendations.forEach(function (priority, index) {
      target.append(recommendationCard(priority, index));
    });
  }

  function commandCard(label, value, note) {
    var card = element('article', 'command-card');
    card.append(element('small', '', label), element('strong', '', titleCase(value)), element('span', '', note));
    return card;
  }

  function renderCommandDeck(snapshot) {
    var deck = snapshot.command_deck;
    id('command-notice').textContent = deck.notice;
    id('command-reason').textContent = deck.reason;
    var target = id('command-state-grid');
    clear(target);
    target.append(
      commandCard('Authority', deck.authority, 'Cockpit presentation contract'),
      commandCard('Approval inbox', deck.approval_state, 'No approval adapter mounted'),
      commandCard('Execution', deck.execution_state, 'No route to command transport'),
      commandCard('Canonical receipt', deck.receipt_state, 'Success cannot be implied'),
      commandCard('Rollback', deck.rollback_state, 'No executed action to reverse'),
      commandCard('Kill switch', deck.kill_switch_state, 'Unknown is not reported as safe')
    );
  }

  function renderContext(entries) {
    var target = id('context-list');
    clear(target);
    if (!entries.length) {
      target.append(element('div', 'empty-state', 'No durable CEO context has been recorded yet.'));
      return;
    }
    entries.slice(0, 8).forEach(function (entry) {
      var card = element('article', 'context-item');
      card.append(element('small', '', entry.kind), element('strong', '', entry.key), element('p', '', entry.content));
      target.append(card);
    });
  }

  function renderFreshness(snapshot) {
    var status = snapshot.freshness.status;
    var chip = id('freshness-chip');
    chip.className = 'state-chip ' + (status === 'fresh' ? 'state-fresh' : 'state-stale');
    chip.lastChild.textContent = titleCase(status);
    var direction = snapshot.freshness.age_seconds < 0 ? 'Source is ahead of cutoff by ' : 'Source age: ';
    id('freshness-copy').textContent = direction + formatAge(snapshot.freshness.age_seconds) + ' · target ' + formatAge(snapshot.freshness.target_seconds);
  }

  function renderSnapshot(snapshot) {
    state.snapshot = snapshot;
    id('tenant-label').textContent = snapshot.tenant.display_name + ' · ' + snapshot.tenant.key;
    renderFreshness(snapshot);
    renderHeadline(snapshot);
    renderPriorities(snapshot);
    renderTruth(snapshot);
    renderLimitations(snapshot);
    renderFunnel(snapshot);
    renderSources(snapshot);
    renderQuality(snapshot);
    renderRecommendations(snapshot);
    renderCommandDeck(snapshot);
    renderContext(state.context);
    id('business-evidence-button').onclick = function () {
      openEvidence('Business evidence chain', 'The exact provenance attached to this cockpit snapshot.', [
        { label: 'Source system', value: snapshot.provenance.source_system },
        { label: 'Source snapshot', value: snapshot.provenance.source_snapshot_id },
        { label: 'Intelligence run', value: snapshot.provenance.intelligence_run_id },
        { label: 'Formula version', value: snapshot.provenance.formula_version },
        { label: 'Engine version', value: snapshot.provenance.source_engine_version },
        { label: 'As of', value: snapshot.as_of }
      ]);
    };
  }

  async function loadCockpit() {
    if (state.requestController) state.requestController.abort();
    state.requestController = new AbortController();
    announce('Loading verified cockpit evidence.');
    setConnectionChip('Connecting', 'state-stale');
    var tenant = encodeURIComponent(state.tenant);
    var results = await Promise.allSettled([
      api('/v1/tenants/' + tenant + '/cockpit', { signal: state.requestController.signal }),
      api('/v1/tenants/' + tenant + '/context', { signal: state.requestController.signal })
    ]);
    if (results[0].status === 'rejected') throw results[0].reason;
    state.context = results[1].status === 'fulfilled' && Array.isArray(results[1].value.entries)
      ? results[1].value.entries : [];
    renderSnapshot(results[0].value);
    setHidden(id('connection-chamber'), true);
    setHidden(id('cockpit-workspace'), false);
    enableWorkspace(true);
    setConnectionChip('Connected', 'state-fresh');
    showView(state.activeView, false);
    announce(results[1].status === 'fulfilled'
      ? 'Cockpit evidence loaded.'
      : 'Cockpit evidence loaded; CEO context is temporarily unavailable.');
  }

  function appendUserMessage(question) {
    var empty = document.querySelector('.conversation-empty');
    if (empty) empty.remove();
    var message = element('article', 'message message-user');
    var header = element('header');
    header.append(element('strong', '', 'You'), element('span', '', 'Question'));
    message.append(header, element('p', '', question));
    id('conversation-log').append(message);
    message.scrollIntoView({
      block: 'nearest',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    });
  }

  function progressiveText(target, text) {
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var words = String(text).split(/\s+/);
    if (reduced || words.length < 5) {
      target.textContent = text;
      return;
    }
    target.textContent = '';
    var index = 0;
    function reveal() {
      var end = Math.min(index + 4, words.length);
      target.textContent += (index === 0 ? '' : ' ') + words.slice(index, end).join(' ');
      index = end;
      if (index < words.length) window.setTimeout(reveal, 28);
    }
    reveal();
  }

  function answerSection(title, statements) {
    if (!Array.isArray(statements) || statements.length === 0) return null;
    var section = element('section');
    section.append(element('h4', '', title));
    var list = element('ul');
    statements.forEach(function (statement) { list.append(element('li', '', statement.statement)); });
    section.append(list);
    return section;
  }

  async function sendFeedback(runId, rating, buttons) {
    buttons.forEach(function (button) { button.disabled = true; });
    try {
      await api('/v1/tenants/' + encodeURIComponent(state.tenant) + '/feedback', {
        method: 'POST', body: JSON.stringify({ runId: runId, rating: rating })
      });
      announce('Feedback recorded.');
      buttons.forEach(function (button) { button.textContent = button.dataset.rating === rating ? 'Recorded' : button.textContent; });
    } catch (error) {
      announce(friendlyError(error));
      buttons.forEach(function (button) { button.disabled = false; });
    }
  }

  function appendAdvisorMessage(output) {
    var answer = output.message.answer;
    var message = element('article', 'message message-advisor');
    var header = element('header');
    header.append(element('strong', '', 'LeozOps · verified'), element('span', '', output.replayed ? 'Replayed evidence' : 'Validated now'));
    var summary = element('p');
    message.append(header, summary);
    ['facts', 'inferences', 'recommendations', 'limitations'].forEach(function (name) {
      var section = answerSection(name, answer[name]);
      if (section) message.append(section);
    });
    var citations = element('div', 'citation-row');
    output.citations.forEach(function (citation) {
      var button = element('button', 'citation-button', citation.label || citation.evidence_key);
      button.type = 'button';
      button.addEventListener('click', function () {
        openEvidence(citation.label || 'Advisor citation', 'Citation stored with the validated answer.', [
          { label: 'Evidence key', value: citation.evidence_key },
          { label: 'Source type', value: citation.source_type },
          { label: 'Source ID', value: citation.source_id },
          { label: 'Source path', value: citation.source_path },
          { label: 'Value hash', value: citation.value_hash }
        ]);
      });
      citations.append(button);
    });
    if (output.citations.length) message.append(citations);
    var feedback = element('div', 'feedback-row');
    var useful = element('button', 'feedback-button', 'Useful');
    var notUseful = element('button', 'feedback-button', 'Not useful');
    useful.type = notUseful.type = 'button';
    useful.dataset.rating = 'useful';
    notUseful.dataset.rating = 'not_useful';
    var buttons = [useful, notUseful];
    useful.addEventListener('click', function () { sendFeedback(output.run.id, 'useful', buttons); });
    notUseful.addEventListener('click', function () { sendFeedback(output.run.id, 'not_useful', buttons); });
    feedback.append(useful, notUseful);
    message.append(feedback);
    id('conversation-log').append(message);
    progressiveText(summary, answer.summary.statement);
    message.scrollIntoView({
      block: 'nearest',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    });
  }

  async function ensureConversation() {
    if (state.conversationId) return state.conversationId;
    var output = await api('/v1/tenants/' + encodeURIComponent(state.tenant) + '/conversations', {
      method: 'POST', body: JSON.stringify({ title: 'Founder cockpit' })
    });
    state.conversationId = output.conversation.id;
    return state.conversationId;
  }

  function idempotencyKey() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    var bytes = new Uint32Array(4);
    window.crypto.getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (value) { return value.toString(16); }).join('-');
  }

  async function ask(question) {
    var conversationId = await ensureConversation();
    return api('/v1/tenants/' + encodeURIComponent(state.tenant) + '/conversations/' + encodeURIComponent(conversationId) + '/messages', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey() },
      body: JSON.stringify({ question: question })
    });
  }

  id('connection-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var tenant = id('tenant-key').value.trim().toLowerCase();
    var token = id('read-token').value.trim();
    setError(id('connection-error'), '');
    if (!/^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/.test(tenant)) {
      setError(id('connection-error'), 'Enter a valid tenant key using lowercase letters, numbers, hyphens, or underscores.');
      id('tenant-key').focus();
      return;
    }
    if (!token || token.length > 2048) {
      setError(id('connection-error'), 'Enter a valid read credential.');
      id('read-token').focus();
      return;
    }
    state.tenant = tenant;
    state.token = token;
    id('read-token').value = '';
    setBusy(id('connect-button'), true, 'Opening verified realm…', 'Open read-only cockpit');
    try {
      await loadCockpit();
    } catch (error) {
      resetWorkspace(friendlyError(error));
    } finally {
      setBusy(id('connect-button'), false, 'Opening verified realm…', 'Open read-only cockpit');
    }
  });

  id('refresh-button').addEventListener('click', async function () {
    id('refresh-button').disabled = true;
    try {
      await loadCockpit();
    } catch (error) {
      if (error.status === 401 || error.status === 403) resetWorkspace(friendlyError(error));
      else announce(friendlyError(error));
    } finally {
      if (state.token) id('refresh-button').disabled = false;
    }
  });

  id('disconnect-button').addEventListener('click', function () { resetWorkspace('Credential cleared from page memory.'); });

  all('[data-view]').forEach(function (button) {
    button.addEventListener('click', function () { showView(button.dataset.view, true); });
    button.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      var enabled = all('[data-view]').filter(function (item) { return !item.disabled; });
      var current = enabled.indexOf(button);
      var direction = event.key === 'ArrowRight' ? 1 : -1;
      var next = enabled[(current + direction + enabled.length) % enabled.length];
      next.focus();
      showView(next.dataset.view, false);
      event.preventDefault();
    });
  });

  id('ask-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var questionField = id('advisor-question');
    var question = questionField.value.trim();
    if (!question) return;
    setError(id('ask-error'), '');
    appendUserMessage(question);
    questionField.value = '';
    id('ask-button').disabled = true;
    announce('LeozOps is validating an evidence-grounded answer.');
    try {
      var output = await ask(question);
      appendAdvisorMessage(output);
      announce('Validated advisor answer ready with ' + output.citations.length + ' citation(s).');
    } catch (error) {
      questionField.value = question;
      setError(id('ask-error'), friendlyError(error));
      if (error.status === 401 || error.status === 403) resetWorkspace(friendlyError(error));
    } finally {
      if (state.token) id('ask-button').disabled = false;
    }
  });

  id('evidence-close').addEventListener('click', function () { id('evidence-dialog').close(); });
  id('evidence-dialog').addEventListener('click', function (event) {
    if (event.target === id('evidence-dialog')) id('evidence-dialog').close();
  });
  document.addEventListener('keydown', function (event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k' && state.token) {
      event.preventDefault();
      showView('ask', false);
      id('advisor-question').focus();
    }
  });
  window.addEventListener('offline', function () {
    setConnectionChip('Offline', 'state-stale');
    announce('Network connection lost. Existing evidence remains visible.');
  });
  window.addEventListener('online', function () {
    if (state.token) setConnectionChip('Connected', 'state-fresh');
    announce('Network connection restored. Refresh when ready.');
  });
  window.addEventListener('pagehide', function () { state.token = ''; });
})();
`;
