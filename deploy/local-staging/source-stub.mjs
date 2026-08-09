import { createHash, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';

const path = '/api/integrations/leozops/v1/lead-snapshot';
const facts = {
  schema_version: '1.0',
  source: { system: 'egoric', tenant_key: 'egoric-local-staging' },
  funnel_definition: {
    id: 'egoric_sales_v1',
    active_stages: ['new', 'contacted', 'proposal', 'negotiation'],
    terminal_outcomes: ['won', 'lost'],
    historical_transitions_available: false,
  },
  leads: [],
  quality: { records: 0, missing_source: 0, missing_created_at: 0, client_attribution: 'unavailable' },
};

/** Keep this byte-for-byte compatible with businessMemory.canonicalStringify. */
export function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`,
  ).join(',')}}`;
}

export function buildFixtureSnapshot(generatedAt = new Date().toISOString()) {
  return {
    schema_version: facts.schema_version,
    source: facts.source,
    snapshot_id: `sha256:${createHash('sha256').update(canonicalStringify(facts)).digest('hex')}`,
    generated_at: generatedAt,
    funnel_definition: facts.funnel_definition,
    leads: facts.leads,
    quality: facts.quality,
  };
}

function equal(left, right) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

function json(response, status, value, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'private, no-cache, no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(JSON.stringify(value));
}

function startServer() {
  const requiredToken = process.env.LEOZOPS_SOURCE_BEARER_TOKEN || '';
  if (!requiredToken) throw new Error('source_stub_token_missing');
  const snapshot = buildFixtureSnapshot();
  const etag = `"${snapshot.snapshot_id}"`;
  const server = https.createServer({
    cert: fs.readFileSync('/certs/ca/source-cert.pem'),
    key: fs.readFileSync('/certs/server/source-key.pem'),
  }, (request, response) => {
  if (request.url === '/health' && request.method === 'GET') {
    json(response, 200, { ok: true, source: 'repositoryrealms-local-staging-fixture' });
    return;
  }
  if (request.url !== path) {
    json(response, 404, { error: 'not found' });
    return;
  }
  if (request.method !== 'GET') {
    json(response, 405, { error: 'method not allowed' }, { Allow: 'GET' });
    return;
  }
  const presented = request.headers.authorization?.startsWith('Bearer ')
    ? request.headers.authorization.slice(7).trim()
    : '';
  if (!equal(presented, requiredToken)) {
    json(response, 401, { error: 'unauthorized' });
    return;
  }
  if (request.headers['if-none-match'] === etag) {
    response.writeHead(304, { ETag: etag, 'Cache-Control': 'private, no-cache' });
    response.end();
    return;
  }
  json(response, 200, snapshot, { ETag: etag });
  });

  server.listen(3443, '0.0.0.0');

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}

if (process.argv[2] === '--print-snapshot') {
  console.log(JSON.stringify(buildFixtureSnapshot(process.argv[3])));
} else {
  startServer();
}
