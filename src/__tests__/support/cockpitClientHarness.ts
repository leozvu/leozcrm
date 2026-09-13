import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { COCKPIT_SCRIPT } from '../../http/cockpitScript';
import { renderCockpitHtml } from '../../http/cockpitView';

// Execute the shipped script with a small DOM/media/transport test double.
// This proves client lifecycle behavior, not browser layout, SSO or live audio.
export class TestNode {
  private content = '';
  children: TestNode[] = [];
  parent: TestNode | null = null;
  readonly listeners = new Map<string, Array<(event: any) => any>>();
  attributes = new Map<string, string>();
  dataset: Record<string, string> = {};
  value = '';
  hidden = false;
  disabled = false;
  open = false;
  checked = false;
  className = '';
  isConnected = true;
  onclick: unknown = null;
  classList = { add() {}, remove() {} };
  style = { setProperty() {} };
  constructor(readonly tag = 'div') {}
  get textContent(): string { return this.content + this.children.map((node) => node.textContent).join(''); }
  set textContent(value: string) { this.replaceChildren(); this.content = value; }
  get lastChild(): TestNode { return this.children[this.children.length - 1] ?? this; }
  append(...nodes: TestNode[]) { nodes.forEach((node) => { node.parent = this; node.isConnected = this.isConnected; this.children.push(node); }); }
  replaceChildren(...nodes: TestNode[]) {
    const detach = (node: TestNode) => { node.isConnected = false; node.children.forEach(detach); };
    this.children.forEach(detach); this.children = []; this.content = ''; this.append(...nodes);
  }
  remove() { this.isConnected = false; if (this.parent) this.parent.children = this.parent.children.filter((node) => node !== this); }
  insertBefore(node: TestNode) { this.append(node); }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  querySelector(selector: string): TestNode | null { return this.children.find((node) => node.tag === selector) ?? null; }
  addEventListener(event: string, handler: (event: any) => any) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), handler]);
  }
  async dispatch(event: string, data: any = {}) {
    for (const handler of this.listeners.get(event) ?? []) await handler({ preventDefault() {}, target: this, ...data });
  }
  focus() {}
  scrollIntoView() {}
  reset() { this.value = ''; }
  close() { this.open = false; }
  showModal() { this.open = true; }
  pause() {}
}

export function deferred<T = any>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, headers: new Headers({ 'content-type': 'application/json' }), json: async () => body };
}

export async function flushClient() { await new Promise<void>((resolve) => setImmediate(resolve)); }

export function clientHarness(fetcher?: (path: string, options: any) => Promise<any>) {
  const nodes = new Map<string, TestNode>();
  const html = renderCockpitHtml();
  for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const node = new TestNode(match[1]);
    node.hidden = /\bhidden\b/.test(match[0]);
    nodes.set(match[2], node);
  }
  const node = (name: string): TestNode => {
    const found = nodes.get(name);
    assert.ok(found, `Script references missing production HTML id: ${name}`);
    return found;
  };
  const select = (selector: string) => {
    if (selector === '#cockpit-workspace form') return ['ask-form', 'preference-form', 'data-request-form'].map(node);
    if (selector === '#cockpit-workspace .form-error') return [...nodes].filter(([name]) => name.endsWith('-error') && name !== 'connection-error').map(([, value]) => value);
    if (selector === '[data-panel]') return ['today', 'ask', 'business', 'planner', 'command'].map((name) => {
      const panel = node('view-' + name); panel.dataset.panel = name; return panel;
    });
    return [];
  };
  const windowEvents = new TestNode();
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let timerId = 0;
  const requests: Array<{ path: string; options: any }> = [];
  const fetch = async (path: string, options: any) => {
    requests.push({ path, options });
    return fetcher ? fetcher(path, options) : jsonResponse({ enabled: false, authenticated: false });
  };
  const navigator: any = { onLine: true };
  const window: any = {
    location: { hash: '', pathname: '/cockpit/', search: '', assign() {} },
    history: { replaceState() {} },
    crypto: { randomUUID },
    setTimeout(callback: () => void, delay: number) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id: number) { timers.delete(id); },
    matchMedia: () => ({ matches: true }),
    addEventListener: windowEvents.addEventListener.bind(windowEvents),
  };
  const document = {
    getElementById: node,
    querySelectorAll: select,
    querySelector: () => null,
    createElement: (tag: string) => new TestNode(tag),
    addEventListener() {},
    body: new TestNode('body'),
  };
  const context: any = { window, document, navigator, fetch, Headers, AbortController, URLSearchParams, URL, Intl, Uint32Array };
  const exported = ['state', 'api', 'loadCockpit', 'resetWorkspace', 'sendQuestion', 'ensureConversation', 'startVoiceInput', 'startTalkingMode', 'queueVoiceEvent', 'friendlyError'];
  const marker = '  restoreHumanSession();\n})();';
  assert.ok(COCKPIT_SCRIPT.includes(marker));
  const script = COCKPIT_SCRIPT.replace(marker, `  globalThis.client = { ${exported.join(', ')} };\n${marker}`);
  runInNewContext(script, context, { filename: 'cockpit.js' });
  return {
    client: context.client as any, node, window, navigator, requests, timers,
    setPeer(Peer: any) { window.RTCPeerConnection = Peer; context.RTCPeerConnection = Peer; },
    pageEvent: windowEvents.dispatch.bind(windowEvents),
    expire(delay: number) {
      for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.callback(); }
    },
    connect(tenant = 'tenant-a') {
      context.client.resetWorkspace();
      context.client.state.tenant = tenant;
      context.client.state.token = 'fixture-' + tenant;
    },
  };
}

export function cockpitFixture(tenant: string, total = 3) {
  return {
    version: 'leozops_cockpit_v1', tenant: { key: tenant, display_name: tenant }, as_of: '2026-09-12T12:00:00Z',
    freshness: { status: 'fresh', age_seconds: 10, target_seconds: 1800 },
    today: { headline: { total_leads: total, active_pipeline: total, win_rate: null, overdue_expected_close: 0 }, attention_count: 0, priorities: [], changes: { reason: 'No history available' } },
    business: { stages: [], sources: [], quality: { records: total, missing_source: 0, missing_created_at: 0, client_attribution: 'unavailable' } },
    recommendations: [], limitations: [],
    provenance: { source_system: 'egoric', source_snapshot_id: 'fixture-snapshot-' + tenant, intelligence_run_id: 'fixture-run', formula_version: 'fixture-formula' },
    command_deck: { notice: 'Approval is not execution.', reason: 'Fixture sealed', authority: 'read_only', approval_state: 'not_connected', execution_state: 'blocked', receipt_state: 'not_available', rollback_state: 'not_available', kill_switch_state: 'not_exposed' },
  };
}

export function cockpitResponse(path: string, tenant = 'tenant-a', total = 3) {
  if (path === '/auth/human/session') return jsonResponse({ enabled: false, authenticated: false });
  if (path.endsWith('/cockpit')) return jsonResponse(cockpitFixture(tenant, total));
  if (path.endsWith('/context')) return jsonResponse({ entries: [] });
  if (path.endsWith('/alerts')) return jsonResponse({ alerts: [] });
  if (path.endsWith('/notification-deliveries')) return jsonResponse({ deliveries: [] });
  if (path.endsWith('/goals')) return jsonResponse({ goals: [] });
  if (path.endsWith('/plans')) return jsonResponse({ plans: [] });
  if (path.endsWith('/jarvis/data-requests')) return jsonResponse({ requests: [] });
  return jsonResponse({ code: 'fixture_unavailable' }, 503);
}
