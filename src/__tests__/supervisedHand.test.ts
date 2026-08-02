import fs from 'node:fs';
import path from 'node:path';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import knexFactory from 'knex';
import config from '../../knexfile';
import qualificationInput from '../../config/phase14.repositoryrealms-task-create.audit.json';
import {
  REPOSITORYREALMS_TASK_CREATE_COMMAND,
  buildRepositoryRealmsTaskCreateEnvelope,
  supervisedHandEnvelopeFingerprint,
  validateRepositoryRealmsTaskCreatePayload,
  validateSupervisedHandQualification,
} from '../domain/supervisedHand';
import { createApp } from '../http/app';
import { signTenantReadToken } from '../http/integrationReadAuth';
import { buildActionAdapterRegistry } from '../integrations/actions/buildActionAdapterRegistry';
import { BusinessMemoryRepository } from '../repositories/businessMemoryRepository';
import { SupervisedHandRepository } from '../repositories/supervisedHandRepository';
import { SupervisedHandService } from '../services/supervisedHandService';
import { evaluateSupervisedHandPreflight } from '../supervisedHandPreflight';
import { seedEgoricMemory } from './support/egoricMemoryScenario';
import {
  OPERATOR_CREDENTIAL,
  createSupervisedActionScenario,
  proposePreviewApprove,
} from './support/supervisedActionScenario';

const db = knexFactory(config.test);
const AUTH = { secret: 'phase14-read-secret', adminKey: 'phase14-admin-key' };

before(async () => { await db.migrate.latest(); });
after(async () => { await db.destroy(); });

test('pinned RepositoryRealms task.create audit is exact and honestly blocked', () => {
  const result = validateSupervisedHandQualification(qualificationInput);
  assert.equal(result.value.repository, 'leozvu/repositoryrealms');
  assert.equal(result.value.source_commit, '98c0eca01330cbf101bca8ff93de38cdd8ec4045');
  assert.equal(result.value.action, 'task.create');
  assert.equal(result.value.endpoint_path, '/api/ceo/v1/commands');
  assert.equal(result.value.receipt_path, '/api/ceo/v1/commands/receipts');
  assert.equal(result.value.verdict, 'blocked');
  assert.deepEqual(result.blockers, [
    'source_dedicated_leozops_command_endpoint_missing',
    'source_zero_mutation_preview_missing',
    'source_separately_approved_rollback_missing',
    'production_adapter_registry_empty',
  ]);
  assert.match(result.fingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.throws(
    () => validateSupervisedHandQualification({ ...qualificationInput, surprise: true }),
    (error: any) => error.code === 'invalid_hand_qualification',
  );
  const dishonest = structuredClone(qualificationInput) as any;
  dishonest.verdict = 'qualified';
  assert.throws(
    () => validateSupervisedHandQualification(dishonest),
    (error: any) => error.code === 'invalid_hand_qualification',
  );
});

test('candidate payload is unassigned, PII-minimized, exact, and maps to the source envelope', () => {
  const payload = validateRepositoryRealmsTaskCreatePayload({
    title: 'Review accepted pipeline evidence',
    note: 'Check the current source snapshot before the next planning checkpoint.',
    due_date: '2026-08-04',
    priority: 'high',
    estimated_hours: 2,
  });
  const envelope = buildRepositoryRealmsTaskCreateEnvelope({
    payload,
    targetEntityId: 'egoric-agency',
    actorSubject: 'ceo_global_subject',
    idempotencyKey: 'leozops-task-create-0001',
    correlationId: 'leozops-correlation-0001',
  });
  assert.deepEqual(envelope.payload, {
    title: payload.title,
    note: payload.note,
    assigneeEmail: null,
    projectId: null,
    dueDate: payload.due_date,
    priority: 'high',
    estHours: 2,
  });
  assert.match(supervisedHandEnvelopeFingerprint(envelope), /^sha256:[0-9a-f]{64}$/);
  assert.throws(() => validateRepositoryRealmsTaskCreatePayload({ title: 'Valid task', assignee_email: 'person@example.test' }));
  assert.throws(() => validateRepositoryRealmsTaskCreatePayload({ title: 'Email person@example.test today' }));
  assert.throws(() => validateRepositoryRealmsTaskCreatePayload({ title: 'Call +1 (212) 555-0123 today' }));
  assert.throws(() => validateRepositoryRealmsTaskCreatePayload({ title: 'x' }));
  assert.throws(() => validateRepositoryRealmsTaskCreatePayload({ title: 'Valid task', estimated_hours: 1.5 }));
});

test('static preflight fails closed and production adapter composition stays empty', () => {
  const registry = buildActionAdapterRegistry();
  const result = evaluateSupervisedHandPreflight(qualificationInput, registry.size());
  assert.equal(registry.size(), 0);
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.blockers, [
    'source_dedicated_leozops_command_endpoint_missing',
    'source_zero_mutation_preview_missing',
    'source_separately_approved_rollback_missing',
    'production_adapter_registry_empty',
    'live_g5_go_not_verified_by_static_preflight',
    'command_specific_g6_release_not_verified_by_static_preflight',
  ]);
});

test('tenant projection distinguishes accepted G6 evidence, receipts, and incidents without payloads', async () => {
  const scenario = await createSupervisedActionScenario(db, 'phase14', {
    commandKey: REPOSITORYREALMS_TASK_CREATE_COMMAND,
    adapterId: 'repositoryrealms-task-create-test-adapter',
  });
  const prepared = await proposePreviewApprove(scenario, 'phase140000000001');
  const executed = await scenario.service.execute({
    proposalId: prepared.proposal.id,
    operator: 'Leoz',
    operatorCredential: OPERATOR_CREDENTIAL,
  });
  assert.equal(executed.attempt.status, 'succeeded');
  const service = new SupervisedHandService(
    new BusinessMemoryRepository(db, () => new Date(scenario.clock.now)),
    new SupervisedHandRepository(db),
    () => new Date(scenario.clock.now),
  );
  const state = await service.state('phase14-tenant');
  assert.equal(state.status, 'blocked', 'source preview/rollback gaps still block the real hand');
  assert.equal(state.gates.g5, 'go');
  assert.equal(state.gates.g6_policy, 'accepted');
  assert.equal(state.summary.proposals, 1);
  assert.equal(state.summary.succeeded, 1);
  assert.equal(state.records[0].command_key, REPOSITORYREALMS_TASK_CREATE_COMMAND);
  assert.equal(state.records[0].approval.state, 'approved');
  assert.equal(state.records[0].execution.state, 'succeeded');
  assert.equal(state.records[0].execution.receipt_id, 'request_0001');
  assert.equal(state.records[0].incident_state, 'none');
  const serialized = JSON.stringify(state);
  assert.equal(serialized.includes('Review priority opportunity phase140000000001'), false);
  assert.equal(serialized.includes('payload_json'), false);
  assert.equal(serialized.includes(scenario.seeded.tenant.id), false);
});

test('an unrelated tenant G6 policy cannot qualify the selected supervised hand', async () => {
  const scenario = await createSupervisedActionScenario(db, 'phase14-unrelated');
  await proposePreviewApprove(scenario, 'unrelated0000001');
  const service = new SupervisedHandService(
    new BusinessMemoryRepository(db, () => new Date(scenario.clock.now)),
    new SupervisedHandRepository(db),
    () => new Date(scenario.clock.now),
  );
  const state = await service.state('phase14-unrelated-tenant');
  assert.equal(state.gates.g5, 'go');
  assert.equal(state.gates.g6_policy, 'missing_or_inactive');
  assert.equal(state.summary.proposals, 0);
  assert.ok(state.blockers.includes('command_specific_g6_policy_missing_or_inactive'));
});

test('authenticated HTTP surface is tenant-scoped, sanitized, read-only, and fail-closed', async () => {
  const seeded = await seedEgoricMemory(db, { tenantKey: 'hand-http', sourceTenantKey: 'hand-http-source' });
  const other = await seedEgoricMemory(db, { tenantKey: 'hand-other', sourceTenantKey: 'hand-other-source' });
  const app = createApp({ profile: 'egoric-readonly', knex: db, integrationReadAuth: AUTH });
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server address unavailable');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const pathName = '/v1/tenants/hand-http/supervised-hand';
    assert.equal((await fetch(base + pathName)).status, 401);
    const token = signTenantReadToken('hand-http', AUTH.secret);
    const response = await fetch(base + pathName, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json() as any;
    assert.equal(body.tenant.key, 'hand-http');
    assert.equal(body.status, 'blocked');
    assert.equal(body.authority, 'no_http_execution_authority');
    assert.equal(JSON.stringify(body).includes(seeded.tenant.id), false);
    assert.equal(JSON.stringify(body).includes(seeded.connection.id), false);
    assert.equal((await fetch(base + '/v1/tenants/hand-other/supervised-hand', {
      headers: { Authorization: `Bearer ${token}` },
    })).status, 403);
    assert.equal((await fetch(base + pathName, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ execute: true }),
    })).status, 404);
    assert.notEqual(seeded.tenant.id, other.tenant.id);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('Phase 14 composition contains no command credential, transport, or registered adapter capability', () => {
  const root = path.resolve(__dirname, '..');
  const files = [
    'domain/supervisedHand.ts',
    'repositories/supervisedHandRepository.ts',
    'services/supervisedHandService.ts',
    'http/routes/supervisedHand.ts',
    'supervisedHandPreflight.ts',
  ];
  const source = files.map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  assert.doesNotMatch(source, /Authorization\s*:\s*['"`]|LEOZOPS_ACTION_COMMAND_CREDENTIAL|\.execute\s*\(|fetch\s*\(|https\.request|child_process|setInterval/);
  const registry = fs.readFileSync(path.join(root, 'integrations/actions/buildActionAdapterRegistry.ts'), 'utf8');
  assert.match(registry, /return new ActionAdapterRegistry\(\)/);
  assert.doesNotMatch(registry, /RepositoryRealmsTask|task\.create/);
});
