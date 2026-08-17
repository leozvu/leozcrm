export const COCKPIT_SCRIPT = String.raw`
(function () {
  'use strict';

  var state = {
    token: '',
    tenant: '',
    snapshot: null,
    context: [],
    alerts: [],
    deliveries: [],
    goals: [],
    plans: [],
    hand: null,
    preferences: null,
    evaluation: null,
    readiness: null,
    voiceQuality: null,
    dataRequests: [],
    conversationId: null,
    activeView: 'today',
    requestController: null,
    recognition: null,
    voiceSessionId: null,
    voicePeer: null,
    voiceChannel: null,
    voiceStream: null,
    voiceAudio: null,
    voiceLifecycle: 'off',
    voiceEventQueue: Promise.resolve(),
    voiceHandledCalls: {},
    voiceTurnGeneration: 0,
    voiceConnecting: false,
    voiceConsentGranted: false,
    lastVoiceSessionId: null,
    pendingQuestion: '',
    deferredInstall: null
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
    if (error && error.code === 'voice_provider_disabled') return 'Talking Mode is installed but the Realtime provider is disabled on this deployment.';
    if (error && error.code === 'voice_provider_timeout') return 'The secure voice provider timed out before a session could start.';
    if (error && error.code === 'voice_session_rate_limited') return 'Talking Mode start limit reached. Wait one minute before retrying.';
    if (error && /^voice_provider_/.test(error.code || '')) return 'Talking Mode could not obtain a secure short-lived session. Retry later.';
    if (error && error.code === 'voice_webrtc_failed') return 'The secure WebRTC voice connection could not be established.';
    if (error && error.code === 'voice_privacy_consent_required') return 'Talking Mode requires explicit consent to the current voice privacy notice.';
    if (error && error.code === 'voice_review_requires_terminal_session') return 'The voice session is still closing. Wait a moment and rate it again.';
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
    id('talking-mode-button').disabled = !enabled;
  }

  function resetWorkspace(message) {
    stopTalkingMode(true);
    state.token = '';
    state.tenant = '';
    state.snapshot = null;
    state.context = [];
    state.alerts = [];
    state.deliveries = [];
    state.goals = [];
    state.plans = [];
    state.hand = null;
    state.preferences = null;
    state.evaluation = null;
    state.readiness = null;
    state.voiceQuality = null;
    state.dataRequests = [];
    state.conversationId = null;
    state.pendingQuestion = '';
    state.lastVoiceSessionId = null;
    setHidden(id('voice-session-feedback'), true);
    if (state.recognition) state.recognition.abort();
    state.recognition = null;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
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
      planner: ['The goal-aware planner', 'Versioned intent, explicit conflicts, and advisory scenarios.'],
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

  function alertDelivery(alertId) {
    return state.deliveries.find(function (delivery) { return delivery.alert_id === alertId; }) || null;
  }

  function alertEvidence(alert) {
    var items = Object.keys(alert.evidence || {}).map(function (keyValue) {
      return { label: titleCase(keyValue), value: alert.evidence[keyValue] };
    });
    items.push({ label: 'Evidence hash', value: alert.evidence_hash });
    var delivery = alertDelivery(alert.id);
    if (delivery) {
      items.push({ label: 'Delivery kind', value: titleCase(delivery.kind) });
      items.push({ label: 'Delivery status', value: titleCase(delivery.status) });
      items.push({ label: 'Available at', value: formatDate(delivery.available_at) });
      items.push({ label: 'Receipt', value: delivery.receipt_id || 'Unavailable' });
    }
    return items;
  }

  async function mutateAlert(alert, action, button) {
    var original = button.textContent;
    button.disabled = true;
    button.textContent = action === 'acknowledgements' ? 'Acknowledging…' : 'Snoozing…';
    setError(id('alert-error'), '');
    try {
      var body = action === 'snoozes'
        ? JSON.stringify({ until: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString() })
        : JSON.stringify({});
      await api('/v1/tenants/' + encodeURIComponent(state.tenant) + '/alerts/' + encodeURIComponent(alert.id) + '/' + action, {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey() },
        body: body
      });
      await loadAlertState();
      announce(action === 'acknowledgements' ? 'Alert acknowledged in LeozOps.' : 'Alert snoozed for four hours in LeozOps.');
    } catch (error) {
      setError(id('alert-error'), friendlyError(error));
      button.disabled = false;
      button.textContent = original;
    }
  }

  async function rateAlert(alert, outcome, buttons) {
    buttons.forEach(function (button) { button.disabled = true; });
    setError(id('alert-error'), '');
    try {
      await api('/v1/tenants/' + encodeURIComponent(state.tenant) + '/alerts/' + encodeURIComponent(alert.id) + '/outcomes', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey() },
        body: JSON.stringify({ outcome: outcome })
      });
      await loadAlertState();
      announce(outcome === 'useful' ? 'Alert marked useful for the shadow baseline.' : 'Alert marked as a false positive for the shadow baseline.');
    } catch (error) {
      setError(id('alert-error'), friendlyError(error));
      buttons.forEach(function (button) { button.disabled = false; });
    }
  }

  function renderAlerts() {
    var target = id('alert-list');
    clear(target);
    var active = state.alerts.filter(function (alert) { return alert.state !== 'resolved'; });
    id('alert-count').textContent = String(active.length);
    if (!active.length) {
      target.append(element('div', 'empty-state', 'No active signal has passed the freshness, completeness, change, cooldown, and snooze gates.'));
      return;
    }
    active.forEach(function (alert) {
      var card = element('article', 'alert-card alert-' + alert.severity);
      var meta = element('div', 'alert-meta');
      meta.append(
        element('span', 'alert-severity', alert.severity),
        element('span', 'alert-state', titleCase(alert.state)),
        element('time', '', formatDate(alert.created_at))
      );
      if (alert.outcome) meta.insertBefore(element('span', 'alert-outcome', titleCase(alert.outcome)), meta.lastChild);
      var copy = element('div', 'alert-copy');
      copy.append(
        element('h3', '', alert.title),
        element('p', '', alert.rationale),
        element('strong', '', 'Recommended review'),
        element('p', '', alert.recommendation)
      );
      if (alert.state === 'snoozed' && alert.snoozed_until) {
        copy.append(element('small', 'alert-snooze-copy', 'Snoozed until ' + formatDate(alert.snoozed_until)));
      }
      var actions = element('div', 'alert-actions');
      var evidence = element('button', 'evidence-button', 'Inspect evidence');
      evidence.type = 'button';
      evidence.addEventListener('click', function () {
        openEvidence(alert.title, 'Trigger → fact → recommendation → delivery evidence.', alertEvidence(alert));
      });
      var acknowledge = element('button', 'feedback-button', alert.state === 'acknowledged' ? 'Acknowledged' : 'Acknowledge');
      acknowledge.type = 'button';
      acknowledge.disabled = alert.state === 'acknowledged';
      acknowledge.addEventListener('click', function () { mutateAlert(alert, 'acknowledgements', acknowledge); });
      var snooze = element('button', 'feedback-button', alert.state === 'snoozed' ? 'Snoozed' : 'Snooze 4h');
      snooze.type = 'button';
      snooze.disabled = alert.state === 'snoozed';
      snooze.addEventListener('click', function () { mutateAlert(alert, 'snoozes', snooze); });
      actions.append(evidence, acknowledge, snooze);
      if (alert.state === 'acknowledged' || alert.outcome) {
        var useful = element('button', 'feedback-button', alert.outcome === 'useful' ? 'Useful recorded' : 'Useful signal');
        var falsePositive = element('button', 'feedback-button', alert.outcome === 'false_positive' ? 'False positive recorded' : 'False positive');
        useful.type = 'button';
        falsePositive.type = 'button';
        useful.disabled = Boolean(alert.outcome);
        falsePositive.disabled = Boolean(alert.outcome);
        useful.addEventListener('click', function () { rateAlert(alert, 'useful', [useful, falsePositive]); });
        falsePositive.addEventListener('click', function () { rateAlert(alert, 'false_positive', [useful, falsePositive]); });
        actions.append(useful, falsePositive);
      }
      card.append(meta, copy, actions);
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

  function plannerMetric(plan) {
    var unit = plan.metric && plan.metric.unit;
    var baseline = plan.baseline_value === null ? 'Unavailable'
      : unit === 'basis_points' ? (Number(plan.baseline_value) / 100).toFixed(1) + '%' : formatNumber(plan.baseline_value);
    var target = unit === 'basis_points' ? (Number(plan.target_value) / 100).toFixed(1) + '%' : formatNumber(plan.target_value);
    return titleCase(plan.metric.key) + ': ' + baseline + ' → ' + target;
  }

  async function inspectPlan(plan, button) {
    button.disabled = true;
    setError(id('planner-error'), '');
    try {
      var detail = await api('/v1/tenants/' + encodeURIComponent(state.tenant) + '/plans/' + encodeURIComponent(plan.id));
      var items = [
        { label: 'Plan hash', value: detail.plan.plan_hash },
        { label: 'Goal manifest', value: detail.goal.manifest_hash },
        { label: 'Source snapshot', value: detail.evidence.source_snapshot_id },
        { label: 'Intelligence run', value: detail.evidence.intelligence_run_id },
        { label: 'Evidence hash', value: detail.evidence.hash },
        { label: 'Steps', value: detail.steps.map(function (step) { return step.ordinal + '. ' + step.title + ' [' + step.action_boundary.execution_state + ']'; }).join(' · ') },
        { label: 'Conflicts', value: detail.conflicts.length ? detail.conflicts.map(function (row) { return row.severity + ': ' + row.key; }).join(' · ') : 'None' },
        { label: 'Simulations', value: detail.simulations.map(function (row) { return row.scenario + ': ' + row.feasibility + ' (' + row.progress_basis_points + ' bp progress)'; }).join(' · ') }
      ];
      openEvidence(plan.goal_title, 'Immutable goal, evidence, plan, conflict, and simulation fingerprints.', items);
    } catch (error) {
      setError(id('planner-error'), friendlyError(error));
    } finally {
      button.disabled = false;
    }
  }

  async function decidePlan(plan, decision, buttons) {
    buttons.forEach(function (button) { button.disabled = true; });
    setError(id('planner-error'), '');
    try {
      await api('/v1/tenants/' + encodeURIComponent(state.tenant) + '/plans/' + encodeURIComponent(plan.id) + '/decisions', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey() },
        body: JSON.stringify({
          decision: decision,
          reason_code: decision === 'accepted' ? 'founder_cockpit_accept' : 'founder_cockpit_reject'
        })
      });
      await loadPlannerState();
      announce(decision === 'accepted'
        ? 'Plan accepted as advisory intent. No action authority was granted.'
        : 'Plan rejected. The immutable decision was recorded.');
    } catch (error) {
      setError(id('planner-error'), error && error.code === 'plan_has_blocking_conflicts'
        ? 'Resolve the recorded blocking conflicts by creating a new goal or plan version before acceptance.'
        : friendlyError(error));
      buttons.forEach(function (button) { button.disabled = false; });
    }
  }

  function renderPlanner() {
    var summary = id('planner-summary');
    var target = id('planner-list');
    clear(summary);
    clear(target);
    var currentGoals = state.goals.filter(function (item) { return item.current; }).length;
    var blocked = state.plans.filter(function (item) { return item.conflict_status === 'blocking'; }).length;
    var accepted = state.plans.filter(function (item) { return item.latest_decision === 'accepted'; }).length;
    summary.append(
      commandCard('Current goals', currentGoals, 'Append-only goal ledger'),
      commandCard('Plan versions', state.plans.length, 'Evidence-bound and reproducible'),
      commandCard('Blocked plans', blocked, 'Cannot be accepted'),
      commandCard('Accepted intent', accepted, 'Grants no action authority')
    );
    if (!state.plans.length) {
      target.append(element('div', 'empty-state', state.goals.length
        ? 'Goals exist, but no evidence-bound plan version has been generated yet.'
        : 'No durable goal or plan version has been recorded yet. Use the tenant Planner API to define the first goal.'));
      return;
    }
    state.plans.forEach(function (plan) {
      var card = element('article', 'planner-card realm-panel planner-' + plan.conflict_status);
      var meta = element('div', 'planner-meta');
      meta.append(
        element('span', '', titleCase(plan.strategy)),
        element('span', '', 'Version ' + plan.version),
        element('span', 'planner-conflict', titleCase(plan.conflict_status)),
        element('span', '', plan.latest_decision ? titleCase(plan.latest_decision) : 'Awaiting decision')
      );
      var copy = element('div', 'planner-copy');
      copy.append(
        element('h3', '', plan.goal_title),
        element('p', '', plannerMetric(plan)),
        element('small', '', 'Plan ' + plan.plan_key + ' · ' + plan.checkpoint_count + ' checkpoint(s)')
      );
      var boundary = element('p', 'planner-authority', 'Advisory only · action authority: none');
      var actions = element('div', 'planner-actions');
      var inspect = element('button', 'evidence-button', 'Inspect plan');
      var accept = element('button', 'feedback-button', plan.latest_decision === 'accepted' ? 'Accepted' : 'Accept intent');
      var reject = element('button', 'feedback-button', plan.latest_decision === 'rejected' ? 'Rejected' : 'Reject');
      inspect.type = accept.type = reject.type = 'button';
      accept.disabled = plan.conflict_status === 'blocking' || plan.latest_decision === 'accepted';
      reject.disabled = plan.latest_decision === 'rejected';
      inspect.addEventListener('click', function () { inspectPlan(plan, inspect); });
      accept.addEventListener('click', function () { decidePlan(plan, 'accepted', [accept, reject]); });
      reject.addEventListener('click', function () { decidePlan(plan, 'rejected', [accept, reject]); });
      actions.append(inspect, accept, reject);
      card.append(meta, copy, boundary, actions);
      target.append(card);
    });
  }

  function commandCard(label, value, note) {
    var card = element('article', 'command-card');
    card.append(element('small', '', label), element('strong', '', titleCase(value)), element('span', '', note));
    return card;
  }

  function renderCommandDeck(snapshot) {
    var deck = snapshot.command_deck;
    var hand = state.hand;
    id('command-notice').textContent = deck.notice;
    id('command-reason').textContent = hand && hand.blockers.length
      ? 'Execution remains blocked by ' + hand.blockers.length + ' explicit qualification or release gate(s).'
      : deck.reason;
    var target = id('command-state-grid');
    clear(target);
    if (!hand) {
      target.append(
        commandCard('Authority', deck.authority, 'Cockpit presentation contract'),
        commandCard('Approval inbox', deck.approval_state, 'Supervised evidence unavailable'),
        commandCard('Execution', deck.execution_state, 'No route to command transport'),
        commandCard('Canonical receipt', deck.receipt_state, 'Success cannot be implied'),
        commandCard('Rollback', deck.rollback_state, 'No executed action to reverse'),
        commandCard('Kill switch', deck.kill_switch_state, 'Unknown is not reported as safe')
      );
      id('command-contract-status').lastChild.textContent = 'Unavailable';
      id('command-contract-copy').textContent = 'Qualification evidence could not be loaded. No capability is inferred.';
      clear(id('command-blocker-list'));
      id('command-blocker-list').append(element('li', '', 'supervised_hand_state_unavailable'));
      clear(id('command-record-list'));
      id('command-record-list').append(element('div', 'empty-state', 'No supervised hand evidence is available.'));
      return;
    }
    target.append(
      commandCard('Authority', hand.authority, 'HTTP execution remains unavailable'),
      commandCard('Approval inbox', hand.summary.awaiting_approval, 'Previewed proposals awaiting a decision'),
      commandCard('Execution receipts', hand.summary.succeeded, 'Only canonical successful outcomes'),
      commandCard('Incidents', hand.summary.incidents, 'Manual reconciliation required'),
      commandCard('G5 release', hand.gates.g5, 'Live trust gate'),
      commandCard('G6 policy', hand.gates.g6_policy, 'Command-specific release')
    );
    var contractStatus = id('command-contract-status');
    contractStatus.className = 'state-chip ' + (hand.status === 'ready' ? 'state-fresh' : 'state-blocked');
    contractStatus.lastChild.textContent = titleCase(hand.status);
    id('command-contract-copy').textContent = hand.source_contract.command_key + ' · pinned to '
      + hand.source_contract.repository + '@' + hand.source_contract.source_commit.slice(0, 8)
      + ' · source verdict ' + hand.source_contract.verdict + '.';
    var blockers = id('command-blocker-list');
    clear(blockers);
    if (!hand.blockers.length) blockers.append(element('li', 'command-pass', 'All repository qualification gates are recorded.'));
    hand.blockers.forEach(function (blocker) { blockers.append(element('li', '', titleCase(blocker))); });
    var records = id('command-record-list');
    clear(records);
    if (!hand.records.length) {
      records.append(element('div', 'empty-state', 'No G6 proposal exists for this tenant. Source qualification remains visible without implying approval.'));
      return;
    }
    hand.records.slice(0, 8).forEach(function (record) {
      var card = element('article', 'command-record');
      var meta = element('div', 'command-record-meta');
      meta.append(
        element('span', '', 'Approval: ' + titleCase(record.approval.state)),
        element('span', '', 'Execution: ' + titleCase(record.execution.state)),
        element('span', record.incident_state === 'none' ? '' : 'incident-label', 'Incident: ' + titleCase(record.incident_state))
      );
      card.append(
        meta,
        element('h4', '', record.command_key),
        element('p', '', titleCase(record.expected_impact_code) + ' · requested ' + formatDate(record.requested_at)),
        element('small', '', record.execution.receipt_id
          ? 'Receipt ' + record.execution.receipt_id + ' · ' + titleCase(record.execution.result_code)
          : 'No canonical execution receipt recorded · ' + record.event_count + ' audit event(s)')
      );
      records.append(card);
    });
  }

  async function downloadSanitizedExport(requestId) {
    try {
      var output = await api('/v1/tenants/' + encodeURIComponent(state.tenant) + '/jarvis/exports/' + encodeURIComponent(requestId));
      var blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = 'leozops-' + state.tenant + '-sanitized-export.json';
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      announce('Sanitized tenant export downloaded.');
    } catch (error) {
      setError(id('data-request-error'), friendlyError(error));
    }
  }

  function renderJarvisV1() {
    id('data-request-confirmation').placeholder = id('data-request-kind').value.toUpperCase() + ' ' + (state.tenant || 'tenant-key');
    var grid = id('jarvis-evaluation-grid');
    clear(grid);
    if (!state.evaluation) {
      grid.append(element('div', 'empty-state', 'Evaluation evidence is unavailable. No live readiness is inferred.'));
    } else {
      var evaluation = state.evaluation;
      grid.append(
        commandCard('Answer usefulness', evaluation.answers.useful_rate === null ? 'insufficient' : formatPercent(evaluation.answers.useful_rate), evaluation.answers.reviewed + ' reviewed answer(s)'),
        commandCard('Citation coverage', evaluation.answers.citation_coverage_rate === null ? 'insufficient' : formatPercent(evaluation.answers.citation_coverage_rate), evaluation.answers.completed + ' completed run(s)'),
        commandCard('Alert false positives', evaluation.alerts.false_positive_rate === null ? 'insufficient' : formatPercent(evaluation.alerts.false_positive_rate), evaluation.alerts.reviewed + ' reviewed alert(s)'),
        commandCard('Plan acceptance', evaluation.plans.acceptance_rate === null ? 'insufficient' : formatPercent(evaluation.plans.acceptance_rate), evaluation.plans.decisions + ' decision(s)'),
        commandCard('Advisor p95', evaluation.answers.latency_p95_ms + ' ms', evaluation.answers.cost_microunits + ' cost microunits'),
        commandCard('Safety', evaluation.safety.candidate_status, evaluation.safety.open_incidents + ' open incident(s)')
      );
    }
    if (state.voiceQuality) {
      var voice = state.voiceQuality;
      grid.append(
        commandCard('Voice qualification', titleCase(voice.candidate_status), voice.sessions.requested + ' session(s) · live acceptance not inferred'),
        commandCard('Grounded spoken turns', voice.turns.grounding_success_rate === null ? 'insufficient' : formatPercent(voice.turns.grounding_success_rate), voice.turns.grounding_completed + ' completed · ' + voice.turns.grounding_failed + ' failed'),
        commandCard('Audible response p95', voice.turns.response_latency_p95_ms + ' ms', voice.turns.audible_responses + ' audible response(s)'),
        commandCard('Voice CEO feedback', voice.reviews.useful_rate === null ? 'insufficient' : formatPercent(voice.reviews.useful_rate), voice.reviews.reviewed + ' review(s) · ' + voice.reviews.privacy_concerns + ' privacy concern(s)')
      );
    }
    var readiness = id('jarvis-readiness-status');
    readiness.className = 'state-chip state-blocked';
    readiness.lastChild.textContent = state.readiness ? titleCase(state.readiness.overall) : 'Unavailable';
    var checkpoints = id('jarvis-checkpoint-list');
    clear(checkpoints);
    if (!state.readiness) checkpoints.append(element('div', 'empty-state', 'J1–J8 readiness evidence is unavailable.'));
    else state.readiness.checkpoints.forEach(function (checkpoint) {
      var card = element('article', 'checkpoint-card');
      card.append(
        element('strong', '', checkpoint.checkpoint + ' · ' + checkpoint.name),
        element('span', '', titleCase(checkpoint.live_status)),
        element('p', '', checkpoint.blockers.map(titleCase).join(' · '))
      );
      checkpoints.append(card);
    });
    var requests = id('data-request-list');
    clear(requests);
    if (!state.dataRequests.length) requests.append(element('div', 'empty-state', 'No export or delete request has been recorded.'));
    state.dataRequests.forEach(function (request) {
      var card = element('article', 'data-request-card');
      card.append(
        element('strong', '', titleCase(request.kind) + ' · ' + titleCase(request.status)),
        element('p', '', request.limitation),
        element('small', '', formatDate(request.requested_at) + ' · ' + request.fingerprint)
      );
      if (request.kind === 'export' && request.status === 'ready_for_export') {
        var button = element('button', 'secondary-button', 'Download sanitized export');
        button.type = 'button';
        button.addEventListener('click', function () { downloadSanitizedExport(request.id); });
        card.append(button);
      }
      requests.append(card);
    });
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

  function renderPreferences(view) {
    var preferences = view && view.preferences ? view.preferences : {
      schema_version: 'leozops_ambient_jarvis_preferences_v1',
      locale: 'en', briefing_cadence: 'manual', timezone: 'UTC',
      quiet_hours: { start: '22:00', end: '07:00' }, voice_output: 'off'
    };
    state.preferences = preferences;
    id('preference-locale').value = preferences.locale;
    id('preference-cadence').value = preferences.briefing_cadence;
    id('preference-timezone').value = preferences.timezone;
    id('preference-voice').value = preferences.voice_output;
    id('preference-quiet-start').value = preferences.quiet_hours.start;
    id('preference-quiet-end').value = preferences.quiet_hours.end;
    id('preference-version').textContent = view && view.revision ? 'Revision ' + view.revision.version : 'Defaults';
    id('voice-input-button').disabled = !(window.SpeechRecognition || window.webkitSpeechRecognition);
    id('voice-input-button').title = id('voice-input-button').disabled
      ? 'Voice input is unavailable in this browser' : 'Push to talk; transcript only';
  }

  function preferencePayload() {
    return {
      schema_version: 'leozops_ambient_jarvis_preferences_v1',
      locale: id('preference-locale').value,
      briefing_cadence: id('preference-cadence').value,
      timezone: id('preference-timezone').value.trim(),
      quiet_hours: { start: id('preference-quiet-start').value, end: id('preference-quiet-end').value },
      voice_output: id('preference-voice').value
    };
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
    renderAlerts();
    renderFunnel(snapshot);
    renderSources(snapshot);
    renderQuality(snapshot);
    renderRecommendations(snapshot);
    renderPlanner();
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
      api('/v1/tenants/' + tenant + '/context', { signal: state.requestController.signal }),
      api('/v1/tenants/' + tenant + '/alerts', { signal: state.requestController.signal }),
      api('/v1/tenants/' + tenant + '/notification-deliveries', { signal: state.requestController.signal }),
      api('/v1/tenants/' + tenant + '/goals', { signal: state.requestController.signal }),
      api('/v1/tenants/' + tenant + '/plans', { signal: state.requestController.signal }),
      api('/v1/tenants/' + tenant + '/supervised-hand', { signal: state.requestController.signal }),
      api('/v1/tenants/' + tenant + '/jarvis/preferences', { signal: state.requestController.signal }),
      api('/v1/tenants/' + tenant + '/jarvis/evaluation?days=30', { signal: state.requestController.signal }),
      api('/v1/tenants/' + tenant + '/jarvis/readiness?days=30', { signal: state.requestController.signal }),
      api('/v1/tenants/' + tenant + '/jarvis/data-requests', { signal: state.requestController.signal }),
      api('/v1/tenants/' + tenant + '/jarvis/voice/quality?days=30', { signal: state.requestController.signal })
    ]);
    if (results[0].status === 'rejected') throw results[0].reason;
    state.context = results[1].status === 'fulfilled' && Array.isArray(results[1].value.entries)
      ? results[1].value.entries : [];
    state.alerts = results[2].status === 'fulfilled' && Array.isArray(results[2].value.alerts)
      ? results[2].value.alerts : [];
    state.deliveries = results[3].status === 'fulfilled' && Array.isArray(results[3].value.deliveries)
      ? results[3].value.deliveries : [];
    state.goals = results[4].status === 'fulfilled' && Array.isArray(results[4].value.goals)
      ? results[4].value.goals : [];
    state.plans = results[5].status === 'fulfilled' && Array.isArray(results[5].value.plans)
      ? results[5].value.plans : [];
    state.hand = results[6].status === 'fulfilled' ? results[6].value : null;
    renderPreferences(results[7].status === 'fulfilled' ? results[7].value : null);
    state.evaluation = results[8].status === 'fulfilled' ? results[8].value : null;
    state.readiness = results[9].status === 'fulfilled' ? results[9].value : null;
    state.dataRequests = results[10].status === 'fulfilled' && Array.isArray(results[10].value.requests)
      ? results[10].value.requests : [];
    state.voiceQuality = results[11].status === 'fulfilled' ? results[11].value : null;
    setError(id('alert-error'), results[2].status === 'fulfilled' ? '' : 'Proactive alert state is temporarily unavailable. Refresh to retry.');
    setError(id('planner-error'), results[4].status === 'fulfilled' && results[5].status === 'fulfilled'
      ? '' : 'Planner state is temporarily unavailable. Refresh to retry.');
    setError(id('command-error'), results[6].status === 'fulfilled'
      ? '' : 'Supervised hand evidence is temporarily unavailable. No command capability is inferred.');
    renderSnapshot(results[0].value);
    renderJarvisV1();
    setHidden(id('connection-chamber'), true);
    setHidden(id('cockpit-workspace'), false);
    enableWorkspace(true);
    setConnectionChip('Connected', 'state-fresh');
    showView(state.activeView, false);
    var partials = [];
    if (results[1].status === 'rejected') partials.push('CEO context');
    if (results[2].status === 'rejected') partials.push('proactive alerts');
    if (results[3].status === 'rejected') partials.push('delivery evidence');
    if (results[4].status === 'rejected') partials.push('goal ledger');
    if (results[5].status === 'rejected') partials.push('planner state');
    if (results[6].status === 'rejected') partials.push('supervised hand evidence');
    if (results[7].status === 'rejected') partials.push('ambient preferences');
    if (results[8].status === 'rejected') partials.push('Jarvis evaluation');
    if (results[9].status === 'rejected') partials.push('J1–J8 readiness');
    if (results[10].status === 'rejected') partials.push('data governance requests');
    announce(partials.length ? 'Cockpit evidence loaded; ' + partials.join(', ') + ' temporarily unavailable.' : 'Cockpit evidence loaded.');
  }

  async function loadAlertState() {
    var tenant = encodeURIComponent(state.tenant);
    var results = await Promise.allSettled([
      api('/v1/tenants/' + tenant + '/alerts'),
      api('/v1/tenants/' + tenant + '/notification-deliveries')
    ]);
    if (results[0].status === 'rejected') throw results[0].reason;
    state.alerts = Array.isArray(results[0].value.alerts) ? results[0].value.alerts : [];
    state.deliveries = results[1].status === 'fulfilled' && Array.isArray(results[1].value.deliveries)
      ? results[1].value.deliveries : [];
    renderAlerts();
  }

  async function loadPlannerState() {
    var tenant = encodeURIComponent(state.tenant);
    var results = await Promise.all([
      api('/v1/tenants/' + tenant + '/goals'),
      api('/v1/tenants/' + tenant + '/plans')
    ]);
    state.goals = Array.isArray(results[0].goals) ? results[0].goals : [];
    state.plans = Array.isArray(results[1].plans) ? results[1].plans : [];
    renderPlanner();
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
    if (state.preferences && state.preferences.voice_output === 'on_demand'
      && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window) {
      var speak = element('button', 'feedback-button', 'Read aloud');
      speak.type = 'button';
      speak.addEventListener('click', function () {
        window.speechSynthesis.cancel();
        var utterance = new SpeechSynthesisUtterance(answer.summary.statement);
        utterance.lang = state.preferences.locale === 'vi' ? 'vi-VN' : 'en-US';
        window.speechSynthesis.speak(utterance);
        announce('Reading the validated summary aloud.');
      });
      feedback.append(speak);
    }
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

  async function ask(question, voiceSessionId) {
    var conversationId = await ensureConversation();
    var headers = { 'Idempotency-Key': idempotencyKey() };
    if (voiceSessionId) headers['X-LeozOps-Voice-Session'] = voiceSessionId;
    return api('/v1/tenants/' + encodeURIComponent(state.tenant) + '/conversations/' + encodeURIComponent(conversationId) + '/messages', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ question: question })
    });
  }

  function actionShaped(question) {
    return /\b(create|delete|send|publish|schedule|assign|update|close|approve|execute|run|launch|email|call)\b|(?:^|\s)(tạo|xóa|xoá|gửi|đăng|lên lịch|giao|cập nhật|đóng|duyệt|thực thi|chạy|gọi)(?:\s|$)/i.test(question);
  }

  function setTalkingModeState(label, className, copy) {
    var chip = id('talking-mode-state');
    chip.className = 'state-chip ' + className;
    chip.lastChild.textContent = label;
    id('talking-mode-copy').textContent = copy;
    var button = id('talking-mode-button');
    var text = button.querySelector('span');
    if (text) text.textContent = state.voiceSessionId ? 'End Talking Mode' : 'Start Talking Mode';
  }

  function directVoiceEvent(sessionId, eventType) {
    if (!sessionId || !state.token) return Promise.resolve(null);
    return api('/v1/tenants/' + encodeURIComponent(state.tenant)
      + '/jarvis/voice/sessions/' + encodeURIComponent(sessionId) + '/events', {
      method: 'POST',
      body: JSON.stringify({
        schema_version: 'leozops_voice_session_event_v1',
        event_type: eventType,
        client_event_id: idempotencyKey()
      })
    });
  }

  function queueVoiceEvent(eventType) {
    var sessionId = state.voiceSessionId;
    if (!sessionId) return;
    state.voiceEventQueue = state.voiceEventQueue.then(function () {
      return directVoiceEvent(sessionId, eventType);
    }).then(function (output) {
      if (output && state.voiceSessionId === sessionId) state.voiceLifecycle = output.session.state;
    }).catch(function (error) {
      if (error && (error.status === 401 || error.status === 403)) stopTalkingMode(false);
    });
  }

  function cleanupTalkingMode() {
    var channel = state.voiceChannel;
    var peer = state.voicePeer;
    var stream = state.voiceStream;
    var audio = state.voiceAudio;
    state.voiceSessionId = null;
    state.voiceChannel = null;
    state.voicePeer = null;
    state.voiceStream = null;
    state.voiceAudio = null;
    state.voiceLifecycle = 'off';
    state.voiceHandledCalls = {};
    state.voiceTurnGeneration = 0;
    state.voiceConnecting = false;
    state.voiceConsentGranted = false;
    try { if (channel) channel.close(); } catch (_) { /* already closed */ }
    try { if (peer) peer.close(); } catch (_) { /* already closed */ }
    if (stream) stream.getTracks().forEach(function (track) { track.stop(); });
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      audio.remove();
    }
    id('talking-mode-button').disabled = !state.token;
    setTalkingModeState('Off', 'state-offline', 'Off · WebRTC audio is not retained by LeozOps.');
  }

  function stopTalkingMode(reportDisconnect) {
    var sessionId = state.voiceSessionId;
    if (reportDisconnect && sessionId && state.token) {
      directVoiceEvent(sessionId, 'disconnected').then(function () {
        if (!state.token) return;
        state.lastVoiceSessionId = sessionId;
        id('voice-privacy-concern').checked = false;
        setHidden(id('voice-session-feedback'), false);
      }).catch(function () { /* best-effort terminal evidence */ });
    }
    cleanupTalkingMode();
    if (sessionId) announce('Talking Mode ended. Microphone access and the short-lived session were released.');
  }

  async function submitVoiceReview(rating) {
    var sessionId = state.lastVoiceSessionId;
    if (!sessionId) return;
    var buttons = all('[data-voice-rating]');
    buttons.forEach(function (button) { button.disabled = true; });
    try {
      await api('/v1/tenants/' + encodeURIComponent(state.tenant)
        + '/jarvis/voice/sessions/' + encodeURIComponent(sessionId) + '/review', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey() },
        body: JSON.stringify({
          schema_version: 'leozops_voice_session_review_v1',
          rating: rating,
          privacy_concern: id('voice-privacy-concern').checked
        })
      });
      state.voiceQuality = await api('/v1/tenants/' + encodeURIComponent(state.tenant) + '/jarvis/voice/quality?days=30');
      state.lastVoiceSessionId = null;
      setHidden(id('voice-session-feedback'), true);
      renderJarvisV1();
      announce('Voice session review recorded without audio, transcript, or device metadata.');
    } catch (error) {
      setError(id('ask-error'), friendlyError(error));
    } finally {
      buttons.forEach(function (button) { button.disabled = false; });
    }
  }

  function voiceToolResult(channel, callId, output, createResponse) {
    if (!channel || channel.readyState !== 'open' || !callId) return;
    channel.send(JSON.stringify({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: callId, output: JSON.stringify(output) }
    }));
    if (createResponse !== false) {
      channel.send(JSON.stringify({ type: 'response.create', response: { tool_choice: 'none' } }));
    }
  }

  async function executeVoiceAdvisorTool(item) {
    var channel = state.voiceChannel;
    var sessionId = state.voiceSessionId;
    var turnGeneration = state.voiceTurnGeneration;
    var callId = item && typeof item.call_id === 'string' ? item.call_id : '';
    var raw;
    try { raw = JSON.parse(String(item.arguments || '{}')); } catch {
      voiceToolResult(channel, callId, { status: 'invalid_request', limitation: 'The spoken question could not be parsed.' });
      return;
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || Object.keys(raw).length !== 1 || typeof raw.question !== 'string') {
      voiceToolResult(channel, callId, { status: 'invalid_request', limitation: 'A single question is required.' });
      return;
    }
    var question = raw.question.trim().slice(0, 1000);
    if (!question) {
      voiceToolResult(channel, callId, { status: 'invalid_request', limitation: 'The spoken question was empty.' });
      return;
    }
    if (actionShaped(question)) {
      queueVoiceEvent('action_request_blocked');
      voiceToolResult(channel, callId, {
        status: 'blocked_requires_text_confirmation',
        limitation: 'Talking Mode has no action authority. Enter this request in the text composer and confirm its advisory-only boundary.'
      });
      announce('Action-shaped voice request blocked. Use the text confirmation path.');
      return;
    }
    announce('Talking Mode is grounding the question in LeozOps evidence.');
    queueVoiceEvent('advisor_grounding_started');
    appendUserMessage(question);
    try {
      await state.voiceEventQueue;
      var result = await ask(question, sessionId);
      if (sessionId !== state.voiceSessionId || turnGeneration !== state.voiceTurnGeneration) {
        voiceToolResult(channel, callId, {
          status: 'interrupted',
          limitation: 'This answer was superseded by a newer spoken turn.'
        }, false);
        return;
      }
      appendAdvisorMessage(result);
      var answer = result.message.answer;
      voiceToolResult(channel, callId, {
        status: 'grounded',
        answer: {
          summary: answer.summary,
          facts: answer.facts,
          inferences: answer.inferences,
          recommendations: answer.recommendations,
          limitations: answer.limitations
        },
        citations: result.citations.slice(0, 12).map(function (citation) {
          return {
            label: citation.label,
            evidence_key: citation.evidence_key,
            value_hash: citation.value_hash
          };
        }),
        authority: 'advisory_only'
      });
      announce('Grounded voice answer ready with ' + result.citations.length + ' citation(s).');
    } catch (error) {
      queueVoiceEvent('advisor_grounding_failed');
      voiceToolResult(channel, callId, {
        status: 'unavailable',
        limitation: friendlyError(error),
        authority: 'advisory_only'
      });
      setError(id('ask-error'), friendlyError(error));
    }
  }

  function handleRealtimeEvent(event) {
    if (!event || typeof event.type !== 'string') return;
    if (event.type === 'input_audio_buffer.speech_started') {
      var interrupted = state.voiceLifecycle === 'speaking' || state.voiceLifecycle === 'thinking';
      state.voiceTurnGeneration += 1;
      state.voiceLifecycle = interrupted ? 'interrupted' : 'listening';
      queueVoiceEvent('user_turn_started');
      setTalkingModeState(interrupted ? 'Interrupted' : 'Listening', 'state-stale',
        interrupted ? 'Barge-in detected · the prior response was interrupted.' : 'Listening · audio is streamed and not retained by LeozOps.');
      return;
    }
    if (event.type === 'input_audio_buffer.committed') {
      state.voiceLifecycle = 'thinking';
      queueVoiceEvent('user_turn_committed');
      setTalkingModeState('Thinking', 'state-stale', 'Grounding the spoken turn through the read-only Advisor.');
      return;
    }
    if ((event.type === 'output_audio_buffer.started' || event.type === 'response.output_audio.delta')
      && state.voiceLifecycle !== 'speaking') {
      state.voiceLifecycle = 'speaking';
      queueVoiceEvent('assistant_response_started');
      setTalkingModeState('Speaking', 'state-fresh', 'Speaking a grounded response · say something to interrupt.');
      return;
    }
    if ((event.type === 'output_audio_buffer.stopped' || event.type === 'response.done')
      && state.voiceLifecycle === 'speaking') {
      state.voiceLifecycle = 'listening';
      queueVoiceEvent('assistant_response_completed');
      setTalkingModeState('Listening', 'state-fresh', 'Ready for the next spoken question.');
      return;
    }
    if (event.type === 'response.function_call_arguments.done' && event.name === 'ask_leozops') {
      if (!state.voiceHandledCalls[event.call_id]) {
        state.voiceHandledCalls[event.call_id] = true;
        executeVoiceAdvisorTool({ call_id: event.call_id, name: event.name, arguments: event.arguments });
      }
      return;
    }
    if (event.type === 'response.output_item.done' && event.item
      && event.item.type === 'function_call' && event.item.name === 'ask_leozops') {
      if (!state.voiceHandledCalls[event.item.call_id]) {
        state.voiceHandledCalls[event.item.call_id] = true;
        executeVoiceAdvisorTool(event.item);
      }
      return;
    }
    if (event.type === 'error') {
      setError(id('ask-error'), 'Talking Mode reported a provider error. End the session and retry.');
    }
  }

  function configureVoiceChannel(channel) {
    channel.send(JSON.stringify({
      type: 'session.update',
      session: {
        type: 'realtime',
        tools: [{
          type: 'function',
          name: 'ask_leozops',
          description: 'Get a tenant-scoped, evidence-grounded, read-only LeozOps answer. This tool cannot approve or execute actions.',
          parameters: {
            type: 'object',
            properties: { question: { type: 'string', maxLength: 1000 } },
            required: ['question'],
            additionalProperties: false
          }
        }],
        tool_choice: 'required'
      }
    }));
  }

  async function startTalkingMode() {
    if (state.voiceSessionId || state.voiceConnecting) {
      stopTalkingMode(true);
      return;
    }
    if (!state.voiceConsentGranted) {
      id('voice-consent-check').checked = false;
      setError(id('voice-consent-error'), '');
      id('voice-consent-dialog').showModal();
      id('voice-consent-check').focus();
      return;
    }
    setError(id('ask-error'), '');
    if (!window.RTCPeerConnection || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError(id('ask-error'), 'Secure WebRTC microphone access is unavailable in this browser.');
      return;
    }
    state.voiceConnecting = true;
    state.lastVoiceSessionId = null;
    setHidden(id('voice-session-feedback'), true);
    id('talking-mode-button').disabled = true;
    setTalkingModeState('Authorizing', 'state-stale', 'Requesting microphone access and a short-lived tenant-scoped session.');
    var micStream = null;
    var sessionId = null;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false
      });
      var issued = await api('/v1/tenants/' + encodeURIComponent(state.tenant) + '/jarvis/voice/sessions', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey() },
        body: JSON.stringify({
          schema_version: 'leozops_voice_session_request_v2',
          locale: state.preferences && state.preferences.locale === 'vi' ? 'vi' : 'en',
          privacy_notice_version: 'jarvis_voice_privacy_v1',
          consent: true,
          capability_profile: 'webrtc_audio_barge_in_v1'
        })
      });
      if (!issued.client_secret || typeof issued.client_secret.value !== 'string'
        || typeof issued.client_secret.expires_at !== 'number'
        || issued.webrtc_url !== 'https://api.openai.com/v1/realtime/calls') {
        throw new Error('Invalid short-lived voice credential response');
      }
      sessionId = issued.session.id;
      state.voiceSessionId = sessionId;
      state.voiceLifecycle = 'connecting';
      state.voiceStream = micStream;
      var peer = new RTCPeerConnection();
      var channel = peer.createDataChannel('oai-events');
      var audio = document.createElement('audio');
      audio.autoplay = true;
      audio.hidden = true;
      document.body.append(audio);
      state.voicePeer = peer;
      state.voiceChannel = channel;
      state.voiceAudio = audio;
      peer.ontrack = function (event) { audio.srcObject = event.streams[0]; };
      micStream.getAudioTracks().forEach(function (track) { peer.addTrack(track, micStream); });
      channel.addEventListener('open', function () {
        configureVoiceChannel(channel);
        state.voiceLifecycle = 'listening';
        queueVoiceEvent('connected');
        setTalkingModeState('Listening', 'state-fresh', 'Live · ask a business question. Audio is not retained by LeozOps.');
        announce('Talking Mode is live. Speak naturally; business answers use the grounded Advisor.');
      });
      channel.addEventListener('message', function (message) {
        try { handleRealtimeEvent(JSON.parse(message.data)); } catch { /* malformed provider event is ignored */ }
      });
      peer.addEventListener('connectionstatechange', function () {
        if (peer.connectionState === 'failed' && state.voiceSessionId === sessionId) {
          directVoiceEvent(sessionId, 'connection_failed').catch(function () { /* evidence best effort */ });
          cleanupTalkingMode();
          setError(id('ask-error'), 'The secure WebRTC voice connection failed. Retry Talking Mode.');
        }
      });
      var offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      var controller = new AbortController();
      var timer = window.setTimeout(function () { controller.abort(); }, 15000);
      var ephemeralKey = issued.client_secret.value;
      var response;
      try {
        response = await fetch(issued.webrtc_url, {
          method: 'POST',
          body: offer.sdp,
          headers: { Authorization: 'Bearer ' + ephemeralKey, 'Content-Type': 'application/sdp' },
          credentials: 'omit',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          signal: controller.signal
        });
      } finally {
        ephemeralKey = '';
        window.clearTimeout(timer);
      }
      if (!response.ok) {
        var webrtcError = new Error('Realtime WebRTC rejected');
        webrtcError.code = 'voice_webrtc_failed';
        throw webrtcError;
      }
      var answerSdp = await response.text();
      if (!answerSdp || answerSdp.length > 512 * 1024) throw new Error('Invalid Realtime SDP response');
      await peer.setRemoteDescription({ type: 'answer', sdp: answerSdp });
      state.voiceConnecting = false;
      id('talking-mode-button').disabled = false;
      if (channel.readyState !== 'open') {
        setTalkingModeState('Connecting', 'state-stale', 'Secure media negotiated · waiting for the voice channel.');
      }
    } catch (error) {
      if (sessionId && state.token) {
        directVoiceEvent(sessionId, 'connection_failed').catch(function () { /* evidence best effort */ });
      }
      if (!state.voiceSessionId && micStream) micStream.getTracks().forEach(function (track) { track.stop(); });
      cleanupTalkingMode();
      setError(id('ask-error'), friendlyError(error));
    }
  }

  async function sendQuestion(question) {
    var questionField = id('advisor-question');
    setError(id('ask-error'), '');
    appendUserMessage(question);
    questionField.value = '';
    id('ask-button').disabled = true;
    id('voice-input-button').disabled = true;
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
      if (state.token) {
        id('ask-button').disabled = false;
        id('voice-input-button').disabled = !(window.SpeechRecognition || window.webkitSpeechRecognition);
      }
    }
  }

  function startVoiceInput() {
    var Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setError(id('ask-error'), 'Push-to-talk is unavailable in this browser. You can still type your question.');
      return;
    }
    if (state.recognition) {
      state.recognition.stop();
      return;
    }
    var recognition = new Recognition();
    state.recognition = recognition;
    recognition.lang = state.preferences && state.preferences.locale === 'vi' ? 'vi-VN' : 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    id('voice-input-button').classList.add('voice-listening');
    id('voice-input-button').setAttribute('aria-label', 'Stop voice input');
    announce('Listening. Speech will fill the question field only.');
    recognition.onresult = function (event) {
      var transcript = event.results && event.results[0] && event.results[0][0]
        ? String(event.results[0][0].transcript || '').trim() : '';
      if (!transcript) return;
      var field = id('advisor-question');
      var combined = (field.value.trim() + ' ' + transcript).trim();
      field.value = combined.slice(0, 1000);
      field.focus();
      announce('Voice transcript added. Review it before sending.');
    };
    recognition.onerror = function () {
      setError(id('ask-error'), 'Voice input ended without a transcript. No question was sent.');
    };
    recognition.onend = function () {
      state.recognition = null;
      id('voice-input-button').classList.remove('voice-listening');
      id('voice-input-button').setAttribute('aria-label', 'Start push-to-talk voice input');
    };
    recognition.start();
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
    if (actionShaped(question)) {
      state.pendingQuestion = question;
      id('advisory-confirmation-dialog').showModal();
      id('advisory-confirmation-send').focus();
      return;
    }
    await sendQuestion(question);
  });

  id('voice-input-button').addEventListener('click', startVoiceInput);
  id('talking-mode-button').addEventListener('click', startTalkingMode);
  all('[data-voice-rating]').forEach(function (button) {
    button.addEventListener('click', function () { submitVoiceReview(button.dataset.voiceRating); });
  });

  function closeVoiceConsent() {
    state.voiceConsentGranted = false;
    id('voice-consent-dialog').close();
    id('talking-mode-button').focus();
  }
  id('voice-consent-close').addEventListener('click', closeVoiceConsent);
  id('voice-consent-cancel').addEventListener('click', closeVoiceConsent);
  id('voice-consent-start').addEventListener('click', function () {
    if (!id('voice-consent-check').checked) {
      setError(id('voice-consent-error'), 'Confirm the current privacy notice before opening the microphone.');
      return;
    }
    state.voiceConsentGranted = true;
    id('voice-consent-dialog').close();
    startTalkingMode();
  });

  id('preference-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    setError(id('preference-error'), '');
    setBusy(id('preference-save'), true, 'Saving…', 'Save preferences');
    try {
      var output = await api('/v1/tenants/' + encodeURIComponent(state.tenant) + '/jarvis/preferences', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey() },
        body: JSON.stringify(preferencePayload())
      });
      renderPreferences(output.view);
      announce(output.replayed ? 'Preferences already matched this revision.' : 'Ambient preferences saved as a new immutable revision.');
    } catch (error) {
      setError(id('preference-error'), friendlyError(error));
    } finally {
      if (state.token) setBusy(id('preference-save'), false, 'Saving…', 'Save preferences');
    }
  });

  id('data-request-kind').addEventListener('change', function () {
    var prefix = id('data-request-kind').value === 'delete' ? 'DELETE ' : 'EXPORT ';
    id('data-request-confirmation').placeholder = prefix + (state.tenant || 'tenant-key');
  });
  id('data-request-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    setError(id('data-request-error'), '');
    var kind = id('data-request-kind').value;
    var confirmation = id('data-request-confirmation').value.trim();
    var expected = kind.toUpperCase() + ' ' + state.tenant;
    if (confirmation !== expected) {
      setError(id('data-request-error'), 'Type exactly “' + expected + '” to create this request.');
      return;
    }
    setBusy(id('data-request-submit'), true, 'Recording…', 'Create request');
    try {
      var output = await api('/v1/tenants/' + encodeURIComponent(state.tenant) + '/jarvis/data-requests', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey() },
        body: JSON.stringify({ kind: kind, scope: 'tenant_leozops_data', confirmation: confirmation })
      });
      state.dataRequests.unshift(output.request);
      id('data-request-confirmation').value = '';
      renderJarvisV1();
      announce(kind === 'delete'
        ? 'Delete request recorded. No data was deleted; policy and operator review remain required.'
        : 'Sanitized export request is ready to download.');
    } catch (error) {
      setError(id('data-request-error'), friendlyError(error));
    } finally {
      if (state.token) setBusy(id('data-request-submit'), false, 'Recording…', 'Create request');
    }
  });

  function closeAdvisoryConfirmation() {
    state.pendingQuestion = '';
    id('advisory-confirmation-dialog').close();
    id('advisor-question').focus();
  }
  id('advisory-confirmation-close').addEventListener('click', closeAdvisoryConfirmation);
  id('advisory-confirmation-cancel').addEventListener('click', closeAdvisoryConfirmation);
  id('advisory-confirmation-send').addEventListener('click', async function () {
    var question = state.pendingQuestion;
    state.pendingQuestion = '';
    id('advisory-confirmation-dialog').close();
    if (question) await sendQuestion(question);
  });

  id('evidence-close').addEventListener('click', function () { id('evidence-dialog').close(); });
  id('evidence-dialog').addEventListener('click', function (event) {
    if (event.target === id('evidence-dialog')) id('evidence-dialog').close();
  });
  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    state.deferredInstall = event;
    id('install-button').hidden = false;
  });
  id('install-button').addEventListener('click', async function () {
    if (!state.deferredInstall) return;
    state.deferredInstall.prompt();
    await state.deferredInstall.userChoice;
    state.deferredInstall = null;
    id('install-button').hidden = true;
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
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/cockpit/sw.js', { scope: '/cockpit/' }).catch(function () {
        announce('Installable offline shell is unavailable; authenticated APIs remain network-only.');
      });
    });
  }
  window.addEventListener('pagehide', function () {
    stopTalkingMode(true);
    state.token = '';
    if (state.recognition) state.recognition.abort();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  });
})();
`;
