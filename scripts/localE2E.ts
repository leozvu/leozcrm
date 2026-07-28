import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import knexFactory from 'knex';
import config from '../knexfile';
import { createApp } from '../src/http/app';
import { signTenantReadToken } from '../src/http/integrationReadAuth';
import { EGORIC_SCHEMA_VERSION } from '../src/domain/businessMemory';
import { EgoricSalesV1Adapter } from '../src/integrations/sources/egoricSalesV1Adapter';
import { SourceAdapterError } from '../src/integrations/sources/sourceAdapter';
import { BusinessMemoryRepository } from '../src/repositories/businessMemoryRepository';
import { SnapshotIngestionService } from '../src/services/snapshotIngestionService';

const SNAPSHOT_URL = 'http://localhost/api/integrations/leozops/v1/lead-snapshot';
const EXPECTED_REMOTE = 'https://github.com/leozvu/repositoryrealms.git';
const FIXED_NOW = Date.parse('2026-07-28T23:40:00.000Z');
const PII_FIXTURES = [
  'private@example.com',
  'second@example.com',
  '+1-555-0100',
  'private note',
  'Private Company',
  'employee-private-id',
];

interface SourceResult {
  status: number;
  headers: Record<string, string>;
  body: unknown | null;
}

function git(repo: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  }
  return value;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => error ? reject(error) : resolve()));
}

async function main(): Promise<void> {
  const egoricRepo = process.env.EGORIC_REPO_PATH;
  if (!egoricRepo) throw new Error('EGORIC_REPO_PATH is required');
  const resolvedRepo = path.resolve(egoricRepo);
  const remote = git(resolvedRepo, 'remote', 'get-url', 'origin');
  const branch = git(resolvedRepo, 'branch', '--show-current');
  const commit = git(resolvedRepo, 'rev-parse', 'HEAD');
  const originMain = git(resolvedRepo, 'rev-parse', 'origin/main');
  const dirty = git(resolvedRepo, 'status', '--porcelain');
  assert.equal(remote, EXPECTED_REMOTE, 'G4 must use the canonical RepositoryRealms remote');
  assert.equal(branch, 'main', 'G4 must use RepositoryRealms main');
  assert.equal(commit, originMain, 'local RepositoryRealms main must match origin/main');
  assert.equal(dirty, '', 'RepositoryRealms worktree must be clean');

  const handlerUrl = pathToFileURL(path.join(resolvedRepo, 'lib/leozops/handler.js')).href;
  const sourceModule = await import(handlerUrl) as {
    handleSnapshot: (
      request: Request,
      options: Record<string, unknown>,
    ) => Promise<SourceResult>;
  };
  assert.equal(typeof sourceModule.handleSnapshot, 'function');

  const rawLeads = deepFreeze([
    {
      id: 'e2e-new',
      name: 'PII must never cross',
      email: 'private@example.com',
      phone: '+1-555-0100',
      note: 'private note',
      company: 'Private Company',
      stage: 'new',
      source: 'Facebook',
      value: 100,
      ownerId: null,
      createdAt: '2026-07-28T20:00:00.000Z',
      expectedClose: '2026-07-29T20:00:00.000Z',
    },
    {
      id: 'e2e-proposal',
      name: 'PII two',
      email: 'second@example.com',
      stage: 'proposal',
      source: 'Referral',
      value: 300,
      ownerId: 'employee-private-id',
      createdAt: '2026-07-27T20:00:00.000Z',
      expectedClose: '2026-07-28T21:00:00.000Z',
    },
    {
      id: 'e2e-won',
      name: 'PII three',
      stage: 'won',
      source: 'Facebook',
      value: 500,
      ownerId: 'employee-private-id-2',
      createdAt: '2026-07-20T20:00:00.000Z',
      expectedClose: null,
    },
    {
      id: 'e2e-lost',
      name: 'PII four',
      stage: 'lost',
      source: null,
      value: 0,
      ownerId: null,
      createdAt: null,
      expectedClose: null,
    },
  ]);
  const before = JSON.stringify(rawLeads);
  const sourceKey = randomBytes(32).toString('base64url');
  const revokedReplacement = randomBytes(32).toString('base64url');
  const sourceEnv: Record<string, string> = {
    LEOZOPS_SNAPSHOT_ENABLED: 'false',
    LEOZOPS_READ_KEY_HASH: sha256(sourceKey),
  };
  const audits: string[] = [];
  let loadCalls = 0;
  const methods: string[] = [];
  const bodies: unknown[] = [];

  const invokeSource = async (request: Request): Promise<SourceResult> => {
    return sourceModule.handleSnapshot(request, {
      env: sourceEnv,
      loadLeads: async () => {
        loadCalls += 1;
        return rawLeads;
      },
      now: () => FIXED_NOW,
      uuid: () => '11111111-1111-4111-8111-111111111111',
      log: (line: string) => audits.push(line),
      rateLimit: { limit: 100, windowMs: 3_600_000 },
    });
  };

  const direct = async (token: string): Promise<SourceResult> => invokeSource(new Request(
    SNAPSHOT_URL,
    { method: 'GET', headers: { authorization: `Bearer ${token}` } },
  ));

  assert.equal((await direct(sourceKey)).status, 404, 'feature flag off must hide the route');
  sourceEnv.LEOZOPS_SNAPSHOT_ENABLED = 'true';
  assert.equal((await direct('wrong-key')).status, 401, 'bad source key must fail closed');
  assert.equal(loadCalls, 0, 'flag/auth denial must not read source data');

  const bridgeFetch: typeof fetch = async (input, init) => {
    methods.push(init?.method ?? 'GET');
    bodies.push(init?.body);
    const request = new Request(String(input), init);
    const result = await invokeSource(request);
    const headers = new Headers(result.headers);
    if (result.body !== null) headers.set('content-type', 'application/json');
    return new Response(
      result.body === null ? null : JSON.stringify(result.body),
      { status: result.status, headers },
    );
  };

  const db = knexFactory(config.test);
  let server: Server | undefined;
  try {
    await db.migrate.latest();
    const repository = new BusinessMemoryRepository(db, () => new Date(FIXED_NOW));
    const tenant = await repository.ensureTenant({ tenantKey: 'egoric-local-e2e', displayName: 'Egoric Local E2E' });
    const connection = await repository.ensureSourceConnection({
      tenantId: tenant.id,
      sourceSystem: 'egoric',
      sourceTenantKey: 'egoric',
      schemaVersion: EGORIC_SCHEMA_VERSION,
      endpointUrl: SNAPSHOT_URL,
    });
    const ingestion = new SnapshotIngestionService(
      repository,
      new EgoricSalesV1Adapter(bridgeFetch, () => '22222222-2222-4222-8222-222222222222'),
    );
    const pullInput = {
      tenantId: tenant.id,
      sourceConnectionId: connection.id,
      bearerToken: sourceKey,
      engineVersion: 'egoric_ingestion_v1',
      asOf: '2026-07-28T23:40:00.000Z',
    };
    const accepted = await ingestion.pullOnce(pullInput);
    assert.equal(accepted.kind, 'accepted');
    assert.equal((await ingestion.pullOnce(pullInput)).kind, 'not_modified');

    const snapshots = await repository.listSnapshotsForTenant(tenant.id);
    const runs = await repository.listRunsForTenant(tenant.id);
    assert.equal(snapshots.length, 1);
    assert.equal(runs.length, 1);
    assert.equal(snapshots[0].record_count, rawLeads.length);
    const serializedMemory = snapshots.map((snapshot) => snapshot.payload_json).join('\n');
    for (const pii of PII_FIXTURES) {
      assert.equal(serializedMemory.includes(pii), false, 'PII must not enter Business Memory');
    }

    sourceEnv.LEOZOPS_READ_KEY_HASH = sha256(revokedReplacement);
    await assert.rejects(
      ingestion.pullOnce(pullInput),
      (error: unknown) => error instanceof SourceAdapterError && error.code === 'source_auth_failed',
    );
    assert.equal(
      (await repository.findSourceConnectionForTenant(tenant.id, connection.id))?.status,
      'disabled',
    );
    sourceEnv.LEOZOPS_SNAPSHOT_ENABLED = 'false';
    assert.equal((await direct(sourceKey)).status, 404, 'flag off must hide the route after revocation');

    const outputSecret = randomBytes(32).toString('base64url');
    const app = createApp({
      profile: 'egoric-readonly',
      knex: db,
      integrationReadAuth: { secret: outputSecret },
    });
    server = app.listen(0);
    await new Promise<void>((resolve) => server?.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('local E2E server did not bind');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const outputToken = signTenantReadToken(tenant.tenant_key, outputSecret);
    const briefResponse = await fetch(`${baseUrl}/v1/tenants/${tenant.tenant_key}/brief`, {
      headers: { authorization: `Bearer ${outputToken}` },
    });
    assert.equal(briefResponse.status, 200);
    const brief = await briefResponse.json() as any;
    assert.equal(brief.headline.total_leads, rawLeads.length);
    assert.equal(brief.headline.active_pipeline, 2);
    assert.equal(brief.headline.won, 1);
    assert.equal(brief.headline.lost, 1);
    assert.equal(brief.headline.win_rate, 0.5);
    assert.deepEqual(brief.stages.map((row: any) => [row.stage, row.count]), [
      ['new', 1],
      ['contacted', 0],
      ['proposal', 1],
      ['negotiation', 0],
      ['won', 1],
      ['lost', 1],
    ]);
    assert.equal(brief.source_snapshot_id, snapshots[0].snapshot_id);
    const serializedBrief = JSON.stringify(brief);
    for (const pii of PII_FIXTURES) {
      assert.equal(serializedBrief.includes(pii), false, 'PII must not cross the full path');
    }
    const legacyWrite = await fetch(`${baseUrl}/clients`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad-json',
    });
    assert.equal(legacyWrite.status, 404);

    assert.deepEqual(methods, ['GET', 'GET', 'GET']);
    assert.ok(bodies.every((body) => body === undefined));
    assert.equal(JSON.stringify(rawLeads), before, 'source fixture must remain unchanged');
    assert.equal(loadCalls, 2, 'only authenticated 200/304 requests may read source facts');
    assert.ok(audits.length >= 4);
    for (const forbidden of [sourceKey, revokedReplacement, outputSecret, ...PII_FIXTURES]) {
      assert.equal(audits.some((line) => line.includes(forbidden)), false, 'audit must not contain a secret or PII');
    }
    assert.equal(git(resolvedRepo, 'rev-parse', 'HEAD'), commit, 'source commit must not change');
    assert.equal(git(resolvedRepo, 'status', '--porcelain'), '', 'source worktree must remain clean');

    const evidence = {
      verdict: 'PASS',
      canonical_source: {
        remote,
        branch,
        commit,
      },
      source_drill: {
        flag_off: 404,
        bad_key: 401,
        accepted: 200,
        not_modified: 304,
        revoked_key: 401,
        flag_off_after_revocation: 404,
        authenticated_source_reads: loadCalls,
        source_mutations: 0,
      },
      reconciliation: {
        source_records: rawLeads.length,
        stored_snapshots: snapshots.length,
        stored_runs: runs.length,
        brief_total: brief.headline.total_leads,
        stage_counts: brief.stages.map((row: any) => ({ stage: row.stage, count: row.count })),
      },
      egress: { methods, bodies_present: bodies.filter((body) => body !== undefined).length },
      profile: {
        brief_status: briefResponse.status,
        legacy_write_status: legacyWrite.status,
        formula_version: brief.formula_version,
        advisory_only: brief.advisory_only,
      },
    };
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    if (server) await close(server);
    await db.destroy();
  }
}

main().catch((error) => {
  console.error('Local E2E verification FAILED:', error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
});
