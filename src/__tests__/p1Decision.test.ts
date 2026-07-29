import test from 'node:test';
import assert from 'node:assert/strict';
import {
  P1_DECISION_SCHEMA_VERSION,
  p1DecisionSummary,
  validateP1Decision,
} from '../domain/p1Decision';

function validManifest(): Record<string, any> {
  return {
    schema_version: P1_DECISION_SCHEMA_VERSION,
    decision_id: 'P1-2026-07-28-001',
    status: 'approved',
    approved_by: 'Leoz',
    approved_at: '2026-07-28T21:00:00-04:00',
    runtime: {
      provider: 'example-runtime',
      test: { project_id: 'leozops-test', plan: 'starter', region: 'us-east', owner: 'Leoz' },
      production: { project_id: 'leozops-production', plan: 'starter', region: 'us-east', owner: 'Leoz' },
    },
    database: {
      provider: 'example-postgres',
      test: {
        project_id: 'leozops-db-test',
        database_id: 'leozops_test',
        plan: 'basic',
        region: 'us-east',
        owner: 'Leoz',
        connection_secret_ref: 'secret://leozops-test/database-url',
        backup_enabled: true,
        backup_retention_days: 7,
      },
      production: {
        project_id: 'leozops-db-production',
        database_id: 'leozops_production',
        plan: 'basic',
        region: 'us-east',
        owner: 'Leoz',
        connection_secret_ref: 'secret://leozops-production/database-url',
        backup_enabled: true,
        backup_retention_days: 30,
      },
    },
    egoric: {
      test: {
        project_id: 'egoric-test',
        base_url: 'https://egoric-test.example.com',
        tenant_key: 'egoric-test',
        owner: 'Leoz',
        source_flag: 'LEOZOPS_SOURCE_ENABLED',
        source_key_secret_ref: 'secret://egoric-test/leozops-source-key',
      },
      production: {
        project_id: 'egoric-production',
        base_url: 'https://erp-egoric.example.com',
        tenant_key: 'egoric',
        owner: 'Leoz',
        source_flag: 'LEOZOPS_SOURCE_ENABLED',
        source_key_secret_ref: 'secret://egoric-production/leozops-source-key',
      },
    },
    operations: {
      business_timezone: 'America/New_York',
      business_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      business_start_local: '09:00',
      business_end_local: '18:00',
      director_reviewer: 'Leoz',
      brief_access_method: 'authenticated_read_api',
      brief_access_test_secret_ref: 'secret://leozops-test/director-read-token',
      brief_access_production_secret_ref: 'secret://leozops-production/director-read-token',
      alert_channel: 'platform_native',
      alert_test_destination_ref: 'platform://leozops-test/operations',
      alert_production_destination_ref: 'platform://leozops-production/operations',
      on_call_owner: 'Leoz',
    },
    poll_policy: {
      cadenceMs: 900_000,
      requestTimeoutMs: 10_000,
      maxRetries: 2,
      baseDelayMs: 1_000,
      maxDelayMs: 10_000,
      jitterRatio: 0.2,
      circuitFailureThreshold: 3,
      circuitOpenMs: 900_000,
      leaseMs: 120_000,
      staleAfterMs: 1_800_000,
    },
    retention: {
      source_snapshot_days: 90,
      reconciliation_days: 365,
      access_roles: ['leozops_service', 'founder_reviewer'],
    },
    budget: {
      currency: 'USD',
      monthly_limit: 100,
      owner: 'Leoz',
    },
  };
}

test('accepts a complete solo-founder P1 decision and emits a secret-free summary', () => {
  const result = validateP1Decision(validManifest());
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
  assert.ok(result.manifest);
  const summary = JSON.stringify(p1DecisionSummary(result.manifest));
  assert.equal(summary.includes('secret://'), false);
  assert.equal(summary.includes('database-url'), false);
  assert.match(summary, /P1_DECISION_APPROVED/);
});

test('fails closed while the Product Owner decision is pending or placeholder-filled', () => {
  const manifest = validManifest();
  manifest.decision_id = 'P1-REPLACE_ME';
  manifest.status = 'pending';
  manifest.approved_at = 'pending';
  manifest.runtime.provider = 'TBD';
  const result = validateP1Decision(manifest);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes('decision_id')));
  assert.ok(result.issues.includes('manifest.status must equal approved'));
  assert.ok(result.issues.some((issue) => issue.includes('approved_at')));
  assert.ok(result.issues.some((issue) => issue.includes('runtime.provider')));
});

test('rejects raw credentials, credential-bearing URLs, and unknown fields', () => {
  const manifest = validManifest();
  manifest.database.test.connection_secret_ref = 'postgresql://user:password@db.example.com/app';
  manifest.egoric.test.base_url = 'https://user:password@egoric-test.example.com';
  manifest.egoric.production.base_url = 'https://erp-egoric.example.com?token=raw-secret';
  manifest.operations.alert_test_destination_ref = 'https://hooks.example.com/raw-secret';
  manifest.operations.raw_token = 'must-never-be-accepted';
  const result = validateP1Decision(manifest);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes('connection_secret_ref')));
  assert.ok(result.issues.some((issue) => issue.includes('credential-free external HTTPS URL')));
  assert.ok(result.issues.some((issue) => issue.includes('alert_test_destination_ref')));
  assert.ok(result.issues.includes('manifest.operations.raw_token is not allowed'));
});

test('requires independent test and production identities', () => {
  const manifest = validManifest();
  manifest.runtime.production.project_id = manifest.runtime.test.project_id;
  manifest.database.production.database_id = manifest.database.test.database_id;
  manifest.egoric.production.base_url = manifest.egoric.test.base_url;
  manifest.operations.brief_access_production_secret_ref = manifest.operations.brief_access_test_secret_ref;
  manifest.operations.alert_production_destination_ref = manifest.operations.alert_test_destination_ref;
  const result = validateP1Decision(manifest);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes('manifest.runtime.project_id')));
  assert.ok(result.issues.some((issue) => issue.includes('manifest.database.database_id')));
  assert.ok(result.issues.some((issue) => issue.includes('manifest.egoric.base_url')));
  assert.ok(result.issues.some((issue) => issue.includes('manifest.operations.brief_access_secret_ref')));
  assert.ok(result.issues.some((issue) => issue.includes('manifest.operations.alert_destination_ref')));
});

test('reuses the bounded poll-policy contract and enforces a two-interval stale window', () => {
  const manifest = validManifest();
  manifest.poll_policy.cadenceMs = 1;
  manifest.poll_policy.leaseMs = 1_000;
  manifest.poll_policy.staleAfterMs = 900_000;
  const result = validateP1Decision(manifest);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes('poll_policy is invalid')));
  assert.ok(result.issues.some((issue) => issue.includes('at least two polling intervals')));
});

test('rejects invalid calendars and broad evidence access', () => {
  const manifest = validManifest();
  manifest.operations.business_timezone = 'Not/A-Timezone';
  manifest.operations.business_days = ['monday', 'monday', 'funday'];
  manifest.operations.business_end_local = '09:00';
  manifest.retention.access_roles = ['public'];
  manifest.retention.source_snapshot_days = 365;
  manifest.retention.reconciliation_days = 90;
  manifest.approved_at = '2026-07-28';
  manifest.budget.currency = 'EUR';
  manifest.budget.monthly_limit = -1;
  const result = validateP1Decision(manifest);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.includes('IANA timezone')));
  assert.ok(result.issues.some((issue) => issue.includes('invalid weekday')));
  assert.ok(result.issues.some((issue) => issue.includes('duplicates')));
  assert.ok(result.issues.some((issue) => issue.includes('zero-length')));
  assert.ok(result.issues.some((issue) => issue.includes('broad/public access')));
  assert.ok(result.issues.some((issue) => issue.includes('cannot be shorter')));
  assert.ok(result.issues.some((issue) => issue.includes('explicit timezone')));
  assert.ok(result.issues.some((issue) => issue.includes('budget.currency')));
  assert.ok(result.issues.some((issue) => issue.includes('budget.monthly_limit')));
});
