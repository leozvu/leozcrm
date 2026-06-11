import { DashboardView, DashboardLeadView } from '../domain/dashboard';
import { Client } from '../domain/types';

/**
 * Pure HTML renderers for the Executive Dashboard v0 (Milestone #5).
 *
 * These are presentation-only, deterministic functions of their typed inputs —
 * the dashboard analogue of `renderBriefText`. They never fetch, mutate, or
 * invent data: every value comes from the `DashboardView` (which is assembled
 * verbatim from the live API layers). Where the underlying data is empty, the
 * renderer emits an explicit "no data" state instead of a placeholder value.
 *
 * The output is a self-contained, read-only HTML document (inline CSS, no
 * scripts, no forms, no mutation controls) so it adds no client-side build step
 * or new dependency.
 */

/** Escape text so free-form CRM strings (names, sources) can't break markup. */
function esc(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Render a 0..1 rate as a percentage, or an explicit em-dash when undefined. */
function pct(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

const STYLE = `
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; padding: 2rem; max-width: 960px; }
  h1 { font-size: 1.4rem; margin: 0 0 .25rem; }
  h2 { font-size: 1.1rem; margin: 2rem 0 .5rem; border-bottom: 1px solid #8884; padding-bottom: .25rem; }
  .muted { color: #8889; }
  .meta { font-size: .85rem; color: #8889; margin-bottom: 1rem; }
  table { border-collapse: collapse; width: 100%; font-size: .9rem; }
  th, td { text-align: left; padding: .35rem .6rem; border-bottom: 1px solid #8883; }
  th { font-weight: 600; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .nodata { padding: .75rem 1rem; background: #8881; border-radius: 6px; color: #8889; }
  .badge { display: inline-block; padding: .05rem .4rem; border-radius: 4px; font-size: .75rem; border: 1px solid #8886; }
  .sev-critical { border-color: #c00; color: #c00; }
  .sev-warning { border-color: #c80; color: #c80; }
  .sev-info { border-color: #08c; color: #08c; }
  .pri-high { border-color: #c00; color: #c00; }
  .pri-medium { border-color: #c80; color: #c80; }
  .pri-low { border-color: #888; color: #888; }
  .rec { margin: .6rem 0; }
  .rec .title { font-weight: 600; }
  .barcell { width: 50%; }
  .bar { display: inline-block; height: .8rem; min-width: 1px; background: #08c; border-radius: 2px; }
  ul { margin: .25rem 0; padding-left: 1.25rem; }
  a { color: inherit; }
`;

/** Wrap section markup in a complete, standalone HTML document. */
function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}</style>
</head>
<body>
${body}
</body>
</html>`;
}

/** Funnel Health: per-stage current count, cumulative reach, step conversion. */
function renderFunnel(view: DashboardView): string {
  const rows = view.funnel.stages
    .map(
      (s) => `<tr>
      <td class="num">${s.position}</td>
      <td>${esc(s.name)}</td>
      <td class="num">${s.count}</td>
      <td class="num">${s.reached}</td>
      <td class="num">${pct(s.conversion_from_previous)}</td>
    </tr>`,
    )
    .join('\n');

  const empty = view.has_data
    ? ''
    : `<p class="nodata">No leads yet for this client — the funnel is empty.</p>`;

  return `<h2>Funnel Health</h2>
  ${empty}
  <table>
    <thead><tr><th class="num">#</th><th>Stage</th><th class="num">At stage</th><th class="num">Reached</th><th class="num">Step conv.</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>`;
}

/**
 * Lead-volume trend: daily new-lead counts over time (the `/metrics/trends`
 * KPI), drawn as a simple proportional bar per day. This is the funnel's
 * conversion/acquisition history alongside the current-snapshot stage table.
 */
function renderTrend(view: DashboardView): string {
  const points = view.trends.by_day;
  if (!points.length) {
    return `<h2>Lead Volume Trend</h2>
    <p class="nodata">No lead activity recorded yet.</p>`;
  }

  // Scale bars to the busiest day so the trend is readable at any volume.
  const max = points.reduce((m, p) => Math.max(m, p.count), 0);
  const rows = points
    .map((p) => {
      const width = max > 0 ? Math.round((p.count / max) * 100) : 0;
      return `<tr>
      <td>${esc(p.date)}</td>
      <td class="num">${p.count}</td>
      <td class="barcell"><span class="bar" style="width:${width}%"></span></td>
    </tr>`;
    })
    .join('\n');

  return `<h2>Lead Volume Trend</h2>
  <p class="muted">New leads per day · ${view.trends.total_leads} total</p>
  <table>
    <thead><tr><th>Day</th><th class="num">New leads</th><th>Trend</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>`;
}

/** CEO Brief viewer: headline, acquisition delta, anomalies, recommended actions. */
function renderBrief(view: DashboardView): string {
  const b = view.brief;
  const h = b.headline;
  const d = b.delta;
  const arrow = d.direction === 'up' ? '▲' : d.direction === 'down' ? '▼' : '—';

  const anomalies = b.anomalies.length
    ? `<ul>${b.anomalies
        .map(
          (a) =>
            `<li><span class="badge sev-${esc(a.severity)}">${esc(a.severity)}</span> ${esc(a.message)}</li>`,
        )
        .join('')}</ul>`
    : `<p class="nodata">No anomalies detected.</p>`;

  const actions = b.recommended_actions.length
    ? `<ul>${b.recommended_actions
        .map((a) => `<li><strong>${esc(a.title)}</strong> — ${esc(a.rationale)}</li>`)
        .join('')}</ul>`
    : `<p class="nodata">No recommended actions.</p>`;

  return `<h2>CEO Brief</h2>
  <p>
    <strong>${h.total_leads}</strong> leads — ${h.open} open, ${h.won} won, ${h.lost} lost ·
    win rate ${pct(h.win_rate)} · overall conversion ${pct(h.overall_conversion_rate)}
  </p>
  <p class="muted">Acquisition (last ${d.window_days}d): ${d.recent_leads} new ${arrow}
    (prev ${d.previous_leads}, change ${d.change >= 0 ? '+' : ''}${d.change})</p>
  <h3>Anomalies</h3>
  ${anomalies}
  <h3>Recommended actions</h3>
  ${actions}`;
}

/** Recommendations panel: prioritised advisory recommendations. */
function renderRecommendations(view: DashboardView): string {
  const recs = view.recommendations.recommendations;
  if (!recs.length) {
    return `<h2>Recommendations</h2>
    <p class="nodata">No recommendations — no funnel activity to advise on yet.</p>`;
  }

  const items = recs
    .map(
      (r) => `<div class="rec">
      <span class="badge pri-${esc(r.priority)}">${esc(r.priority)}</span>
      <span class="muted">${esc(r.category)}${r.related_stage ? ` · ${esc(r.related_stage)}` : ''}</span>
      <div class="title">${esc(r.title)}</div>
      <div>${esc(r.rationale)}</div>
    </div>`,
    )
    .join('\n');

  return `<h2>Recommendations</h2>
${items}`;
}

/** Lead list & stage view: every lead with its current funnel stage. */
function renderLeads(view: DashboardView): string {
  if (!view.leads.length) {
    return `<h2>Leads</h2>
    <p class="nodata">No leads yet for this client.</p>`;
  }

  const row = (l: DashboardLeadView) => `<tr>
      <td>${l.name ? esc(l.name) : '<span class="muted">(unnamed)</span>'}</td>
      <td>${l.email ? esc(l.email) : '<span class="muted">—</span>'}</td>
      <td>${l.source ? esc(l.source) : '<span class="muted">—</span>'}</td>
      <td>${esc(l.status)}</td>
      <td>${l.stage_name ? esc(l.stage_name) : '<span class="muted">(unknown stage)</span>'}</td>
      <td>${esc(l.created_at.slice(0, 10))}</td>
    </tr>`;

  return `<h2>Leads</h2>
  <table>
    <thead><tr><th>Name</th><th>Email</th><th>Source</th><th>Status</th><th>Stage</th><th>Created</th></tr></thead>
    <tbody>
${view.leads.map(row).join('\n')}
    </tbody>
  </table>`;
}

/** Render the full executive dashboard for one client. */
export function renderDashboardHtml(view: DashboardView): string {
  const body = `
  <p class="meta"><a href="/dashboard">← All clients</a></p>
  <h1>${esc(view.client.name)}</h1>
  <p class="meta">${esc(view.client.email)} · as of ${esc(view.as_of)}</p>
  ${renderFunnel(view)}
  ${renderTrend(view)}
  ${renderBrief(view)}
  ${renderRecommendations(view)}
  ${renderLeads(view)}`;
  return page(`Dashboard — ${view.client.name}`, body);
}

/** Landing page: pick a client to view. */
export function renderClientPicker(clients: Client[]): string {
  const body = clients.length
    ? `<h1>Executive Dashboard</h1>
    <p class="meta">Select a client.</p>
    <ul>
${clients
  .map((c) => `      <li><a href="/dashboard?clientId=${encodeURIComponent(c.id)}">${esc(c.name)}</a> <span class="muted">${esc(c.email)}</span></li>`)
  .join('\n')}
    </ul>`
    : `<h1>Executive Dashboard</h1>
    <p class="nodata">No clients yet. Seed data with <code>npm run seed</code>.</p>`;
  return page('Executive Dashboard', body);
}

/** Explicit not-found / bad-request page (read-only, no data). */
export function renderNotFound(message: string): string {
  return page(
    'Not found',
    `<h1>Dashboard</h1>
    <p class="nodata">${esc(message)}</p>
    <p class="meta"><a href="/dashboard">← All clients</a></p>`,
  );
}
