// Local QA only: existing workspace Playwright, compiled production shell,
// intercepted fixture APIs. No application server or external provider.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { chromium } = createRequire(path.resolve('../CRMegoric-Realm-3D/package.json'))('playwright');
const { renderCockpitHtml } = require('../../dist/src/http/cockpitView');
const { COCKPIT_SCRIPT } = require('../../dist/src/http/cockpitScript');
const { COCKPIT_STYLES } = require('../../dist/src/http/cockpitStyles');
const { cockpitResponse } = require('../../dist/src/__tests__/support/cockpitClientHarness');

const origin = 'http://127.0.0.1:3431';
const results = [];
const browserErrors = [];
const releases = [];
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }
const answer = {
  run: { id: 'fixture-run' }, replayed: false,
  message: { answer: { summary: { statement: 'Private answer for tenant alpha.' }, facts: [], inferences: [], recommendations: [], limitations: [] } },
  citations: [{ label: 'Tenant alpha evidence', evidence_key: 'fixture', source_type: 'snapshot', source_id: 'alpha-only', source_path: '/fixture', value_hash: 'fixture-hash' }],
};

async function serve(context, control) {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    assert.equal(url.origin, origin, 'No external origin is allowed in this smoke');
    const pathname = url.pathname;
    const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    if (pathname === '/cockpit/') return route.fulfill({ contentType: 'text/html', body: renderCockpitHtml() });
    if (pathname.endsWith('/cockpit.js')) return route.fulfill({ contentType: 'application/javascript', body: COCKPIT_SCRIPT });
    if (pathname.endsWith('/cockpit.css')) return route.fulfill({ contentType: 'text/css', body: COCKPIT_STYLES });
    if (pathname.endsWith('.webp')) return route.fulfill({ contentType: 'image/webp', body: fs.readFileSync(path.join('assets/cockpit', path.basename(pathname))) });
    if (pathname.startsWith('/auth/')) {
      if (control.restore) {
        await control.restore.promise;
        return json({ authenticated: true, enabled: true, tenantKey: 'tenant-alpha', csrfToken: 'fixture-csrf', scopes: ['cockpit:read'] }).catch(() => {});
      }
      return json({ enabled: false, authenticated: false });
    }
    if (pathname.endsWith('/conversations')) return json({ conversation: { id: 'fixture-conversation' } });
    if (pathname.endsWith('/messages')) {
      control.messageCount += 1;
      if (control.answerGate) await control.answerGate.promise;
      return json(answer).catch(() => {});
    }
    if (pathname.startsWith('/v1/')) {
      if (control.expired) return json({ code: 'session_expired' }, 401);
      const tenant = pathname.split('/')[3];
      const response = cockpitResponse(pathname + url.search, tenant);
      return json(await response.json(), response.status).catch(() => {});
    }
    return route.fulfill({ status: 204, body: '' });
  });
}

async function connect(page, tenant) {
  await page.locator('#service-connection').evaluate((node) => { node.hidden = false; node.open = true; });
  await page.locator('#tenant-key').fill(tenant);
  await page.locator('#read-token').fill('fixture-service-credential');
  await page.locator('#connect-button').click();
  await page.locator('#cockpit-workspace').waitFor({ state: 'visible' });
  assert.match(await page.locator('#tenant-label').textContent(), new RegExp(tenant));
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block', reducedMotion: 'reduce' });
      const control = { messageCount: 0 };
      await serve(context, control);
      const page = await context.newPage();
      page.on('pageerror', (error) => browserErrors.push(error.message));
      await page.goto(origin + '/cockpit/');
      await connect(page, 'tenant-alpha');
      await page.locator('[data-view="ask"]').click();
      await page.locator('#advisor-question').fill('What needs my attention?');
      await page.locator('#ask-button').click();
      await page.getByText('Private answer for tenant alpha.', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Tenant alpha evidence', exact: true }).click();
      assert.equal(await page.locator('#evidence-dialog').evaluate((node) => node.open), true);
      await page.locator('#evidence-close').click();
      results.push({ profile: name, scenario: 'Connect, ask, and inspect actual dialog', status: 'PASS' });
      control.answerGate = deferred();
      releases.push(control.answerGate);
      await page.locator('#advisor-question').fill('A second private question');
      await page.locator('#ask-button').click();
      await page.waitForFunction(() => document.querySelector('#ask-button').disabled);
      await page.locator('#disconnect-button').click();
      await page.locator('#connection-chamber').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#conversation-log').textContent().then((value) => value.includes('Private answer')), false);
      assert.equal(await page.locator('#evidence-items').textContent(), '');
      await connect(page, 'tenant-beta');
      control.answerGate.resolve();
      control.answerGate = null;
      await page.locator('[data-view="ask"]').click();
      assert.equal(await page.locator('#advisor-question').inputValue(), '');
      assert.equal(await page.locator('#conversation-log').textContent().then((value) => value.includes('tenant alpha')), false);
      assert.equal(await page.locator('#ask-button').isEnabled(), true);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(__dirname, name + '-reconnected.png'), fullPage: true });
      results.push({ profile: name, scenario: 'Disconnect pending answer and reconnect without old content', status: 'PASS' });
      control.expired = true;
      await page.locator('#refresh-button').click();
      await page.locator('#connection-chamber').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#headline-metrics').textContent(), '');
      assert.equal(await page.locator('#cockpit-workspace').isVisible(), false);
      results.push({ profile: name, scenario: 'Expired credential clears rendered workspace', status: 'PASS' });
      await context.close();
    }
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const control = { messageCount: 0, restore: deferred() };
    releases.push(control.restore);
    await serve(context, control);
    const page = await context.newPage();
    page.on('pageerror', (error) => browserErrors.push(error.message));
    await page.goto(origin + '/cockpit/');
    await connect(page, 'tenant-beta');
    control.restore.resolve();
    assert.match(await page.locator('#tenant-label').textContent(), /tenant-beta/);
    results.push({ profile: 'desktop', scenario: 'Pending automatic sign-in cannot replace manual tenant', status: 'PASS' });
    await context.close();
    assert.deepEqual(browserErrors, []);
    fs.writeFileSync(path.join(__dirname, 'browser-results.json'), JSON.stringify({ evidence: 'Chromium with intercepted fixture APIs; no live SSO/provider', results, browserErrors }, null, 2) + '\n');
    console.log(JSON.stringify({ pass: results.length, browserErrors }, null, 2));
  } finally {
    releases.forEach((release) => release.resolve());
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
