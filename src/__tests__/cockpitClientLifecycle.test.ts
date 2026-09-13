import test from 'node:test';
import assert from 'node:assert/strict';
import { clientHarness, cockpitResponse, deferred, flushClient, jsonResponse } from './support/cockpitClientHarness';

const superseded = (error: any) => error.code === 'workspace_superseded';

test('disconnect aborts every pending read and late ignored-abort responses cannot reopen the workspace', async () => {
  const late = deferred();
  const harness = clientHarness(async (path) => path.startsWith('/auth/') ? jsonResponse({ enabled: false }) : late.promise);
  await flushClient();
  harness.connect();
  const loading = harness.client.loadCockpit();
  const rejected = assert.rejects(loading, superseded);
  assert.equal(harness.client.state.requests.size, 12);
  harness.client.resetWorkspace('Disconnected');
  await rejected;
  assert.equal(harness.client.state.requests.size, 0);
  assert.ok(harness.requests.filter((row) => row.path.startsWith('/v1/')).every((row) => row.options.signal.aborted));
  late.resolve(jsonResponse({ tenant: { key: 'tenant-a' } }));
  await flushClient();
  assert.equal(harness.client.state.snapshot, null);
  assert.equal(harness.node('cockpit-workspace').hidden, true);
  assert.equal(harness.node('connection-error').textContent, 'Disconnected');
  assert.equal(harness.timers.size, 0);
});

test('a newer refresh wins even when the earlier transport later returns a 401', async () => {
  const late = deferred();
  let first = true;
  const harness = clientHarness(async (path) => path.startsWith('/auth/') ? jsonResponse({ enabled: false })
    : first ? late.promise : cockpitResponse(path, 'tenant-a', 17));
  await flushClient();
  harness.connect();
  const old = harness.client.loadCockpit();
  const ignored = assert.rejects(old, superseded);
  first = false;
  await harness.client.loadCockpit();
  late.resolve(jsonResponse({ code: 'expired' }, 401));
  await ignored;
  await flushClient();
  assert.equal(harness.client.state.snapshot.today.headline.total_leads, 17);
  assert.equal(harness.client.state.token, 'fixture-tenant-a');
  assert.equal(harness.node('cockpit-workspace').hidden, false);
  assert.match(harness.node('headline-metrics').textContent, /17/);
});

test('late automatic SSO restoration cannot overwrite a newer manual connection', async () => {
  const session = deferred();
  const harness = clientHarness(async (path) => path.startsWith('/auth/') ? session.promise : cockpitResponse(path, 'tenant-b'));
  harness.node('tenant-key').value = 'tenant-b';
  harness.node('read-token').value = 'fixture-manual-token';
  await harness.node('connection-form').dispatch('submit');
  session.resolve(jsonResponse({ authenticated: true, tenantKey: 'tenant-a', csrfToken: 'fixture-csrf', scopes: ['cockpit:read'] }));
  await flushClient();
  assert.equal(harness.client.state.tenant, 'tenant-b');
  assert.equal(harness.client.state.humanSession, null);
  assert.equal(harness.client.state.snapshot.tenant.key, 'tenant-b');
  assert.ok(harness.requests.filter((row) => row.path.startsWith('/v1/')).every((row) => row.path.startsWith('/v1/tenants/tenant-b/')));
  assert.equal(harness.node('read-token').value, '');
});

test('pagehide clears rendered business evidence, conversation, drafts, dialogs and old evidence callback', async () => {
  const harness = clientHarness(async (path) => cockpitResponse(path));
  await flushClient();
  harness.connect();
  await harness.client.loadCockpit();
  for (const name of ['conversation-log', 'context-list', 'evidence-items', 'evidence-title', 'headline-metrics']) {
    harness.node(name).textContent = 'PRIVATE TENANT A';
  }
  harness.node('evidence-dialog').open = true;
  harness.node('advisor-question').value = 'PRIVATE QUESTION';
  harness.node('data-request-confirmation').value = 'EXPORT tenant-a';
  await harness.pageEvent('pagehide');
  for (const name of ['conversation-log', 'context-list', 'evidence-items', 'evidence-title', 'headline-metrics']) {
    assert.equal(harness.node(name).textContent.includes('PRIVATE'), false, name);
  }
  assert.equal(harness.node('advisor-question').value, '');
  assert.equal(harness.node('data-request-confirmation').value, '');
  assert.equal(harness.node('evidence-dialog').open, false);
  assert.equal(harness.node('business-evidence-button').onclick, null);
  assert.equal(harness.client.state.tenant, '');
  assert.equal(harness.client.state.snapshot, null);
});

test('duplicate Ask events send one request; an old answer and finally cannot alter a new session composer', async () => {
  const answer = deferred();
  const harness = clientHarness(async (path) => path.endsWith('/messages') ? answer.promise : jsonResponse({ enabled: false }));
  await flushClient();
  harness.connect();
  harness.client.state.conversationId = 'conversation-a';
  const sending = harness.client.sendQuestion('private question from a');
  await harness.client.sendQuestion('duplicate submit');
  await flushClient();
  assert.equal(harness.requests.filter((row) => row.path.endsWith('/messages')).length, 1);
  harness.connect('tenant-b');
  harness.client.state.questionPending = true;
  harness.node('ask-button').disabled = true;
  harness.node('advisor-question').value = 'new tenant draft';
  answer.resolve(jsonResponse({ message: { answer: { summary: { statement: 'PRIVATE ANSWER' } } }, citations: [] }));
  await sending;
  assert.equal(harness.node('advisor-question').value, 'new tenant draft');
  assert.equal(harness.node('ask-button').disabled, true);
  assert.equal(harness.client.state.questionPending, true);
  assert.equal(harness.node('conversation-log').textContent.includes('PRIVATE'), false);
  assert.equal(harness.node('ask-error').textContent, '');
});

test('text and voice share one pending conversation and cannot assign an old conversation after switching', async () => {
  const conversation = deferred();
  const harness = clientHarness(async (path) => path.endsWith('/conversations') ? conversation.promise : jsonResponse({ enabled: false }));
  await flushClient();
  harness.connect();
  const a = harness.client.ensureConversation();
  const b = harness.client.ensureConversation();
  const checks = [assert.rejects(a, superseded), assert.rejects(b, superseded)];
  assert.equal(harness.requests.filter((row) => row.path.endsWith('/conversations')).length, 1);
  harness.connect('tenant-b');
  conversation.resolve(jsonResponse({ conversation: { id: 'old-conversation' } }));
  await Promise.all(checks);
  assert.equal(harness.client.state.conversationId, null);
  assert.equal(harness.client.state.conversationPending, null);
});

test('read deadline includes a body reader that ignores abort, releases tracking, and never retries', async () => {
  const body = deferred();
  const harness = clientHarness(async (path) => path.startsWith('/auth/') ? jsonResponse({ enabled: false })
    : { ...jsonResponse({}), json: () => body.promise });
  await flushClient();
  harness.connect();
  const reading = harness.client.api('/v1/tenants/tenant-a/context');
  const rejected = assert.rejects(reading, (error: any) => error.code === 'request_timeout' && !error.uncertain);
  await flushClient();
  harness.expire(20000);
  await rejected;
  assert.equal(harness.client.state.requests.size, 0);
  assert.equal(harness.timers.size, 0);
  body.resolve({ entries: ['late private body'] });
  await flushClient();
  assert.equal(harness.requests.filter((row) => row.path.endsWith('/context')).length, 1);
});

test('timed-out and malformed writes are uncertain and never automatically resubmitted', async () => {
  const pending = deferred();
  let malformed = false;
  const harness = clientHarness(async (path) => path.startsWith('/auth/') ? jsonResponse({ enabled: false })
    : malformed ? jsonResponse([]) : pending.promise);
  await flushClient();
  harness.connect();
  const write = harness.client.api('/v1/tenants/tenant-a/feedback', { method: 'POST', body: '{}' });
  const rejected = assert.rejects(write, (error: any) => {
    assert.match(harness.client.friendlyError(error), /may already have been saved/);
    return error.code === 'request_timeout' && error.uncertain === true;
  });
  harness.expire(90000);
  await rejected;
  malformed = true;
  await assert.rejects(harness.client.api('/v1/tenants/tenant-a/feedback', { method: 'POST', body: '{}' }), (error: any) => error.uncertain === true);
  assert.equal(harness.requests.filter((row) => row.path.endsWith('/feedback')).length, 2);
  assert.equal(harness.timers.size, 0);
});

test('late microphone permission is released without starting a session in the new tenant', async () => {
  const microphone = deferred();
  const harness = clientHarness();
  await flushClient();
  harness.connect();
  harness.window.RTCPeerConnection = function () {};
  harness.navigator.mediaDevices = { getUserMedia: () => microphone.promise };
  harness.client.state.voiceConsentGranted = true;
  const opening = harness.client.startTalkingMode();
  harness.connect('tenant-b');
  let stops = 0;
  microphone.resolve({ getTracks: () => [{ stop() { stops += 1; } }] });
  await opening;
  assert.equal(stops, 1);
  assert.equal(harness.requests.filter((row) => row.path.includes('/voice/sessions')).length, 0);
  assert.equal(harness.client.state.voiceStream, null);
  assert.equal(harness.client.state.voiceSessionId, null);
});

test('queued voice events and recognition callbacks cannot act on another tenant', async () => {
  const queue = deferred();
  const harness = clientHarness();
  await flushClient();
  harness.connect();
  let recognition: any;
  harness.window.SpeechRecognition = function (this: any) {
    recognition = this;
    this.start = () => {};
    this.abort = () => {};
  };
  harness.client.startVoiceInput();
  harness.client.state.voiceSessionId = 'voice-a';
  harness.client.state.voiceEventQueue = queue.promise;
  harness.client.queueVoiceEvent('user_turn_started');
  const queued = harness.client.state.voiceEventQueue;
  harness.connect('tenant-b');
  harness.node('advisor-question').value = 'tenant b';
  queue.resolve(null);
  await queued;
  recognition.onresult({ results: [[{ transcript: 'private tenant a' }]] });
  recognition.onerror();
  recognition.onend();
  assert.equal(harness.node('advisor-question').value, 'tenant b');
  assert.equal(harness.node('ask-error').textContent, '');
  assert.equal(harness.requests.filter((row) => row.path.startsWith('/v1/tenants/tenant-b/')).length, 0);
});

test('API keeps explicit tenant and cookie/CSRF isolation', async () => {
  const harness = clientHarness();
  await flushClient();
  harness.connect();
  await assert.rejects(harness.client.api('/v1/tenants/tenant-b/context'), superseded);
  await harness.client.api('/v1/tenants/tenant-a/context');
  const bearer = harness.requests[harness.requests.length - 1];
  assert.equal(bearer.options.credentials, 'omit');
  assert.equal(bearer.options.headers.get('Authorization'), 'Bearer fixture-tenant-a');
  harness.client.state.token = '';
  harness.client.state.humanSession = { scopes: ['cockpit:read', 'advisory:write'] };
  harness.client.state.csrf = 'fixture-csrf';
  await harness.client.api('/v1/tenants/tenant-a/feedback', { method: 'POST', body: '{}' });
  const human = harness.requests[harness.requests.length - 1];
  assert.equal(human.options.credentials, 'same-origin');
  assert.equal(human.options.headers.has('Authorization'), false);
  assert.equal(human.options.headers.get('X-Leozops-CSRF'), 'fixture-csrf');
});

test('a current 401 closes the workspace and clears private evidence on any API route', async () => {
  const harness = clientHarness(async (path) => path.startsWith('/auth/') ? jsonResponse({ enabled: false }) : jsonResponse({ code: 'session_expired' }, 401));
  await flushClient();
  harness.connect();
  harness.node('context-list').textContent = 'private context';
  harness.node('evidence-dialog').open = true;
  await assert.rejects(harness.client.api('/v1/tenants/tenant-a/context'), (error: any) => error.status === 401);
  assert.equal(harness.client.state.token, '');
  assert.equal(harness.node('context-list').textContent, '');
  assert.equal(harness.node('evidence-dialog').open, false);
  assert.equal(harness.node('cockpit-workspace').hidden, true);
  assert.match(harness.node('connection-error').textContent, /credential was rejected/);
});

test('the WebRTC deadline covers a hanging SDP body and releases the microphone and peer', async () => {
  const sdp = deferred();
  let stops = 0;
  let closes = 0;
  let remoteDescriptions = 0;
  const harness = clientHarness(async (path) => {
    if (path.startsWith('/auth/')) return jsonResponse({ enabled: false });
    if (path.endsWith('/voice/sessions')) return jsonResponse({ session: { id: 'fixture-voice' }, client_secret: { value: 'fixture-ephemeral', expires_at: 1 }, webrtc_url: 'https://api.openai.com/v1/realtime/calls' });
    if (path.startsWith('https:')) return { ok: true, text: () => sdp.promise };
    return jsonResponse({ session: { state: 'failed' } });
  });
  await flushClient();
  harness.connect();
  harness.setPeer(class {
    createDataChannel() { return { readyState: 'connecting', addEventListener() {}, close() {} }; }
    addTrack() {}
    addEventListener() {}
    async createOffer() { return { sdp: 'fixture-offer' }; }
    async setLocalDescription() {}
    async setRemoteDescription() { remoteDescriptions += 1; }
    close() { closes += 1; }
  });
  const track = { stop() { stops += 1; } };
  harness.navigator.mediaDevices = { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) };
  harness.client.state.voiceConsentGranted = true;
  const opening = harness.client.startTalkingMode();
  await flushClient();
  harness.expire(15000);
  await opening;
  assert.equal(stops, 1);
  assert.equal(closes, 1);
  assert.equal(harness.client.state.voiceStream, null);
  assert.equal(harness.client.state.voiceSessionId, null);
  assert.match(harness.node('ask-error').textContent, /WebRTC/);
  sdp.resolve('late answer');
  await flushClient();
  assert.equal(remoteDescriptions, 0);
});
