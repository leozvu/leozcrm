/**
 * Client onboarding service tests (Milestone #10). Run against an in-memory
 * SQLite database: prove a tenant is provisioned cleanly, platform readiness is
 * reported, malformed/duplicate input is rejected, and readiness flips to
 * not-ready on an unseeded database.
 *
 * Run: npm test
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import knexFactory from 'knex';
import config from '../../knexfile';
import { seedFunnelStages } from '../db/fixtures';
import { ClientRepository } from '../repositories/clientRepository';
import { FunnelStageRepository } from '../repositories/funnelStageRepository';
import { OnboardingService } from '../services/onboardingService';
import { ValidationError } from '../errors';

const db = knexFactory(config.test);
let service: OnboardingService;

const isValidation = (status: number, code: string) => (err: unknown) =>
  err instanceof ValidationError && err.status === status && err.code === code;

before(async () => {
  await db.migrate.latest();
  await seedFunnelStages(db);
  service = new OnboardingService(new ClientRepository(db), new FunnelStageRepository(db));
});

after(async () => {
  await db.destroy();
});

test('onboard provisions a tenant and reports platform readiness', async () => {
  const result = await service.onboard({ name: 'Pilot Co', email: 'pilot@example.com', company: 'Pilot' });
  assert.ok(result.client.id);
  assert.equal(result.client.name, 'Pilot Co');
  assert.equal(result.client.email, 'pilot@example.com');
  assert.equal(result.client.company, 'Pilot');
  assert.equal(result.readiness.funnel_stages, 9);
  assert.equal(result.readiness.funnel_ready, true);
});

test('onboard requires both name and email (clean 400)', async () => {
  await assert.rejects(service.onboard({ email: 'x@example.com' }), isValidation(400, 'invalid_onboarding'));
  await assert.rejects(service.onboard({ name: 'No Email' }), isValidation(400, 'invalid_onboarding'));
});

test('onboard rejects a malformed email at the repository boundary (400)', async () => {
  await assert.rejects(service.onboard({ name: 'Bad', email: 'not-an-email' }), isValidation(400, 'invalid_email'));
});

test('onboard refuses to duplicate an existing tenant email (409)', async () => {
  await service.onboard({ name: 'First', email: 'dup@example.com' });
  await assert.rejects(service.onboard({ name: 'Second', email: 'dup@example.com' }), isValidation(409, 'client_exists'));
});

test('readiness reports not-ready on a migrated-but-unseeded database', async () => {
  const bare = knexFactory(config.test);
  try {
    await bare.migrate.latest(); // migrate only — funnel stages NOT seeded
    const svc = new OnboardingService(new ClientRepository(bare), new FunnelStageRepository(bare));
    const result = await svc.onboard({ name: 'Bare', email: 'bare@example.com' });
    assert.equal(result.readiness.funnel_stages, 0);
    assert.equal(result.readiness.funnel_ready, false);
  } finally {
    await bare.destroy();
  }
});
