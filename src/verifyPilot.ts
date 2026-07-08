import * as dotenv from 'dotenv';

/**
 * Live pilot verification CLI (Milestone #10 deployment gate; Codex review
 * nice-to-have #1 made executable).
 *
 * Runs the FULL M10 launch-criterion flow against a deployed base URL and
 * prints a pass/fail table plus a copy-pasteable evidence block:
 *
 *   /health → /ready → POST /onboarding (admin) → tenant-token auth →
 *   campaign create → lead create + stage move → task create + status
 *   transition + audit trail → KPI funnel → brief → recommendations →
 *   integration metadata.
 *
 *   npm run verify:pilot -- --base-url https://crm.example.com \
 *       --admin-key $ADMIN_API_KEY [--name "Pilot Co"] [--email pilot@acme.com]
 *
 * Flags fall back to BASE_URL / ADMIN_API_KEY / ONBOARD_NAME / ONBOARD_EMAIL
 * env vars. Exits 0 only when every step passes. The created tenant + records
 * ARE the pilot evidence — they are intentionally left in place (re-running
 * with the same email is a 409; pass a fresh --email per run).
 */

dotenv.config();

interface StepResult {
  step: string;
  ok: boolean;
  detail: string;
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = 'true';
      }
    }
  }
  return out;
}

async function call(
  base: string,
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const base = (args['base-url'] ?? process.env.BASE_URL ?? '').replace(/\/+$/, '');
  const adminKey = args['admin-key'] ?? process.env.ADMIN_API_KEY;
  if (!base || !adminKey) {
    console.error('Usage: npm run verify:pilot -- --base-url <url> --admin-key <ADMIN_API_KEY> [--name …] [--email …]');
    process.exit(2);
  }
  const pilotName = args.name ?? process.env.ONBOARD_NAME ?? 'Pilot Verification Co';
  const pilotEmail = args.email ?? process.env.ONBOARD_EMAIL ?? `pilot-${Date.now()}@example.com`;

  const results: StepResult[] = [];
  const record = (step: string, ok: boolean, detail: string) => {
    results.push({ step, ok, detail });
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${step} — ${detail}`);
    if (!ok) throw new Error(`step failed: ${step}`);
  };

  let clientId = '';
  let readyBody: any = null;

  console.log(`Verifying pilot flow against ${base}\n`);
  try {
    // 1. Liveness + readiness (public probes).
    const health = await call(base, 'GET', '/health');
    record('GET /health', health.status === 200 && health.body?.ok === true, `HTTP ${health.status}`);

    const ready = await call(base, 'GET', '/ready');
    readyBody = ready.body;
    record(
      'GET /ready',
      ready.status === 200 && ready.body?.ok === true,
      `HTTP ${ready.status} ${JSON.stringify(ready.body?.checks ?? {})}`,
    );

    // 2. Onboard the pilot tenant (admin-only) and take its token.
    const onboarded = await call(base, 'POST', '/onboarding', {
      token: adminKey,
      body: { name: pilotName, email: pilotEmail },
    });
    record(
      'POST /onboarding (admin)',
      onboarded.status === 201 && Boolean(onboarded.body?.api_token),
      onboarded.status === 201 ? `HTTP 201 client_id=${onboarded.body.client.id}` : `HTTP ${onboarded.status} ${JSON.stringify(onboarded.body)}`,
    );
    clientId = onboarded.body.client.id;
    const token: string = onboarded.body.api_token;

    // 3. The tenant token authenticates and is scoped to its own record.
    const self = await call(base, 'GET', `/clients/${clientId}`, { token });
    record('GET /clients/:id (tenant token)', self.status === 200 && self.body?.id === clientId, `HTTP ${self.status}`);

    // 4. Funnel stages are readable (needed to place a lead).
    const stages = await call(base, 'GET', '/funnel-stages', { token });
    const stageList: any[] = Array.isArray(stages.body) ? stages.body : [];
    const leadStage = stageList.find((s) => s.key === 'lead');
    const qualStage = stageList.find((s) => s.key === 'qualification');
    record('GET /funnel-stages', stages.status === 200 && Boolean(leadStage && qualStage), `HTTP ${stages.status}, ${stageList.length} stages`);

    // 5. Campaign create.
    const campaign = await call(base, 'POST', '/campaigns', {
      token,
      body: { client_id: clientId, name: 'Pilot verification campaign', channel: 'other', status: 'active' },
    });
    record('POST /campaigns', campaign.status === 201, `HTTP ${campaign.status}`);

    // 6. Lead create + stage move.
    const lead = await call(base, 'POST', '/leads', {
      token,
      body: {
        client_id: clientId,
        funnel_stage_id: leadStage.id,
        campaign_id: campaign.body.id,
        name: 'Pilot Lead',
        email: `lead-${Date.now()}@example.com`,
        source: 'pilot-verification',
      },
    });
    record('POST /leads', lead.status === 201, `HTTP ${lead.status}`);

    const moved = await call(base, 'POST', `/leads/${lead.body.id}/move`, {
      token,
      body: { funnel_stage_id: qualStage.id },
    });
    record('POST /leads/:id/move', moved.status === 200 && moved.body?.funnel_stage_id === qualStage.id, `HTTP ${moved.status}`);

    // 7. Task create + audited status transition.
    const task = await call(base, 'POST', '/tasks', {
      token,
      body: { clientId, title: 'Pilot verification task', priority: 'high' },
    });
    record('POST /tasks', task.status === 201, `HTTP ${task.status}`);

    const transitioned = await call(base, 'POST', `/tasks/${task.body.id}/status`, {
      token,
      body: { status: 'in_progress', note: 'pilot verification transition' },
    });
    record('POST /tasks/:id/status', transitioned.status === 200 && transitioned.body?.status === 'in_progress', `HTTP ${transitioned.status}`);

    const events = await call(base, 'GET', `/tasks/${task.body.id}/events`, { token });
    const eventCount = Array.isArray(events.body) ? events.body.length : 0;
    record('GET /tasks/:id/events (audit trail)', events.status === 200 && eventCount >= 1, `HTTP ${events.status}, ${eventCount} events`);

    // 8. The read layer works for the tenant: KPIs, brief, recommendations.
    const funnel = await call(base, 'GET', `/metrics/funnel?clientId=${clientId}`, { token });
    record('GET /metrics/funnel', funnel.status === 200, `HTTP ${funnel.status}`);

    const brief = await call(base, 'GET', `/brief?clientId=${clientId}`, { token });
    record('GET /brief', brief.status === 200, `HTTP ${brief.status}`);

    const recs = await call(base, 'GET', `/recommendations?clientId=${clientId}`, { token });
    record(
      'GET /recommendations',
      recs.status === 200 && recs.body?.advisory_only === true,
      `HTTP ${recs.status} advisory_only=${recs.body?.advisory_only}`,
    );

    // 9. Integration metadata is visible (publishing stays explicit/opt-in).
    const integrations = await call(base, 'GET', '/integrations', { token });
    record('GET /integrations', integrations.status === 200, `HTTP ${integrations.status}`);
  } catch (err) {
    if (!(err instanceof Error) || !err.message.startsWith('step failed')) {
      console.error(`\nUnexpected error: ${err instanceof Error ? err.message : err}`);
      results.push({ step: 'unexpected error', ok: false, detail: String(err) });
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log('\n--- Pilot verification evidence -------------------------------');
  console.log(`Date (UTC):      ${new Date().toISOString()}`);
  console.log(`Base URL:        ${base}`);
  console.log(`Pilot client_id: ${clientId || '(onboarding did not complete)'}`);
  console.log(`/ready result:   ${JSON.stringify(readyBody)}`);
  console.log(`Steps:           ${passed} passed, ${failed} failed`);
  for (const r of results) console.log(`  [${r.ok ? 'PASS' : 'FAIL'}] ${r.step} — ${r.detail}`);
  console.log('----------------------------------------------------------------');
  console.log(failed === 0 ? 'LIVE PILOT VERIFICATION PASSED.' : 'LIVE PILOT VERIFICATION FAILED.');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
