import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import knexFactory from 'knex';
import type { Server } from 'node:http';
import config from '../../knexfile';
import { createApp } from '../http/app';
import { signTenantReadToken } from '../http/integrationReadAuth';
import { COCKPIT_SCRIPT } from '../http/cockpitScript';
import { COCKPIT_STYLES } from '../http/cockpitStyles';
import { COCKPIT_SNAPSHOT_VERSION, CockpitSnapshot } from '../domain/cockpit';
import { DeterministicAdvisorProvider } from '../integrations/advisor/deterministicAdvisorProvider';
import { BusinessMemoryRepository } from '../repositories/businessMemoryRepository';
import { CockpitService } from '../services/cockpitService';
import { EgoricBriefService } from '../services/egoricBriefService';
import { DEFAULT_EGORIC_LEADS, seedEgoricMemory } from './support/egoricMemoryScenario';

const db = knexFactory(config.test);
const AUTH = { secret: 'phase10-separate-output-secret', adminKey: 'phase10-admin-key' };

before(async () => {
  await db.migrate.latest();
});

after(async () => {
  await db.destroy();
});

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind TCP');
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}

test('cockpit projection is PII-minimized, evidence-backed, and action sealed', async () => {
  const seeded = await seedEgoricMemory(db, { tenantKey: 'cockpit-projection' });
  const snapshot = await new CockpitService(new EgoricBriefService(seeded.repository))
    .snapshot('cockpit-projection');

  assert.equal(snapshot.version, COCKPIT_SNAPSHOT_VERSION);
  assert.equal(snapshot.advisory_only, true);
  assert.equal(snapshot.freshness.status, 'fresh');
  assert.deepEqual(snapshot.recommendations.map((row) => row.id), [
    'overdue_expected_close',
    'unassigned_active_leads',
    'missing_lead_source',
  ]);
  assert.equal(snapshot.today.attention_count, 3);
  assert.equal(snapshot.today.changes.status, 'unavailable');
  assert.equal(snapshot.command_deck.authority, 'read_only');
  assert.equal(snapshot.command_deck.execution_state, 'blocked');
  assert.equal(snapshot.command_deck.kill_switch_state, 'not_exposed');
  assert.equal(snapshot.command_deck.notice, 'Approval is not execution.');

  const serialized = JSON.stringify(snapshot);
  for (const prohibited of ['external_id', 'email', 'phone', 'owner_id', 'name']) {
    assert.equal(serialized.includes(`"${prohibited}"`), false);
  }
});

test('freshness risk outranks pipeline warnings and no warning yields an honest empty queue', async () => {
  const stale = await seedEgoricMemory(db, { tenantKey: 'cockpit-stale' });
  const staleSnapshot = await new CockpitService(new EgoricBriefService(stale.repository))
    .snapshot('cockpit-stale', '2026-07-28');
  assert.equal(staleSnapshot.freshness.status, 'stale');
  assert.equal(staleSnapshot.recommendations[0].id, 'stale');

  const cleanLeads = [{
    ...DEFAULT_EGORIC_LEADS[0],
    source: 'Ads',
    owner_assigned: true,
    expected_close_at: '2026-07-30T12:00:00.000Z',
  }];
  const clean = await seedEgoricMemory(db, { tenantKey: 'cockpit-clean', leads: cleanLeads });
  const cleanSnapshot = await new CockpitService(new EgoricBriefService(clean.repository))
    .snapshot('cockpit-clean');
  assert.deepEqual(cleanSnapshot.recommendations, []);
  assert.equal(cleanSnapshot.today.attention_count, 0);
});

test('cockpit shell is data-free, CSP-hardened, responsive, and DOM-safe', async () => {
  await seedEgoricMemory(db, { tenantKey: 'cockpit-http', displayName: 'Cockpit HTTP' });
  const app = createApp({
    profile: 'egoric-readonly',
    knex: db,
    integrationReadAuth: AUTH,
    advisorProvider: new DeterministicAdvisorProvider(),
  });
  const server = app.listen(0);
  const base = await listen(server);
  try {
    const shellResponse = await fetch(`${base}/cockpit`);
    assert.equal(shellResponse.status, 200);
    assert.match(shellResponse.headers.get('content-type') ?? '', /^text\/html/);
    assert.equal(shellResponse.headers.get('cache-control'), 'no-store');
    const csp = shellResponse.headers.get('content-security-policy') ?? '';
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /connect-src 'self'/);
    assert.equal(csp.includes('unsafe-inline'), false);
    assert.equal(shellResponse.headers.get('referrer-policy'), 'no-referrer');
    const shell = await shellResponse.text();
    assert.match(shell, /id="connection-chamber"/);
    assert.match(shell, /role="tablist"/);
    assert.match(shell, />Today</);
    assert.match(shell, />Ask LeozOps</);
    assert.match(shell, />Business</);
    assert.match(shell, /ADVISORY INPUTS/);
    assert.match(shell, />Planner</);
    assert.match(shell, />Command Deck</);
    assert.equal(shell.includes('id="nav-recommendations"'), false);
    assert.match(shell, /Accept plan ≠ execute action/);
    assert.match(shell, /Approval is not execution\./);
    assert.match(shell, /PHASE 14 QUALIFICATION/);
    assert.match(shell, /Approval, receipt, and incident ledger/);
    assert.match(shell, /id="command-blocker-list"/);
    assert.match(shell, /Read only/);
    assert.match(shell, /href="#main-content"/);
    assert.equal(shell.includes('<style'), false);
    assert.equal(shell.includes('<script>'), false);
    assert.equal(shell.includes('cockpit-http'), false);

    const cssResponse = await fetch(`${base}/cockpit/assets/cockpit.css`);
    assert.equal(cssResponse.status, 200);
    const css = await cssResponse.text();
    assert.equal(css, COCKPIT_STYLES);
    assert.match(css, /--realm-gold:#c8a96b/);
    assert.match(css, /min-height:44px/);
    assert.match(css, /@media \(max-width:760px\)/);
    assert.match(css, /grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
    assert.equal(css.includes('grid-template-columns:repeat(6,minmax(0,1fr))'), false);
    assert.match(css, /\.hand-layout/);
    assert.match(css, /\.command-blocker-list/);
    assert.match(css, /@media \(max-width:390px\)/);
    assert.match(css, /prefers-reduced-motion:reduce/);
    assert.match(css, /prefers-contrast:more/);

    const scriptResponse = await fetch(`${base}/cockpit/assets/cockpit.js`);
    assert.equal(scriptResponse.status, 200);
    const script = await scriptResponse.text();
    assert.equal(script, COCKPIT_SCRIPT);
    assert.doesNotThrow(() => new Function(script));
    assert.equal(/localStorage|sessionStorage|\.innerHTML|eval\s*\(/.test(script), false);
    assert.match(script, /textContent/);
    assert.match(script, /Authorization/);
    assert.match(script, /credentials: 'omit'/);
    assert.match(script, /pagehide/);
    assert.match(script, /founder_cockpit_accept/);
    assert.match(script, /No action authority was granted/);
    assert.match(script, /\/supervised-hand/);
    assert.match(script, /No command capability is inferred/);
    assert.match(script, /prefers-reduced-motion/);
  } finally {
    await closeServer(server);
  }
});

test('cockpit API requires exact tenant auth and exposes no execution route', async () => {
  await seedEgoricMemory(db, { tenantKey: 'cockpit-api', displayName: 'Cockpit API' });
  const app = createApp({
    profile: 'egoric-readonly',
    knex: db,
    integrationReadAuth: AUTH,
    advisorProvider: new DeterministicAdvisorProvider(),
  });
  const server = app.listen(0);
  const base = await listen(server);
  try {
    const path = '/v1/tenants/cockpit-api/cockpit';
    assert.equal((await fetch(base + path)).status, 401);
    assert.equal((await fetch(base + path, {
      headers: { Authorization: `Bearer ${signTenantReadToken('another-tenant', AUTH.secret)}` },
    })).status, 403);

    const token = signTenantReadToken('cockpit-api', AUTH.secret);
    const response = await fetch(base + path, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-cache');
    const snapshot = await response.json() as CockpitSnapshot;
    assert.equal(snapshot.tenant.key, 'cockpit-api');
    assert.equal(snapshot.command_deck.execution_state, 'blocked');
    const serialized = JSON.stringify(snapshot);
    assert.equal(/external_id|email|phone|owner_id/.test(serialized), false);

    const post = await fetch(base + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'execute' }),
    });
    assert.equal(post.status, 404);
  } finally {
    await closeServer(server);
  }
});
