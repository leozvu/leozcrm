import type { CheckpointBEvidence, P2DecisionManifest } from '../../domain/phase2Proof';
import {
  CHECKPOINT_B_SCHEMA_VERSION,
  P2_DECISION_SCHEMA_VERSION,
  evidenceFingerprint,
  p1DecisionFingerprint,
} from '../../domain/phase2Proof';
import type { P1DecisionManifest } from '../../domain/p1Decision';

export function validP1Decision(): P1DecisionManifest {
  return {
    schema_version: 'leozops_p1_decision_v1',
    decision_id: 'P1-PHASE2-TEST',
    status: 'approved',
    approved_by: 'Leoz',
    approved_at: '2026-07-29T12:00:00.000Z',
    runtime: {
      provider: 'render',
      test: { project_id: 'runtime-test', plan: 'starter', region: 'oregon', owner: 'Leoz' },
      production: { project_id: 'runtime-prod', plan: 'starter', region: 'oregon', owner: 'Leoz' },
    },
    database: {
      provider: 'render',
      test: {
        project_id: 'db-project-test',
        database_id: 'database-test',
        plan: 'basic',
        region: 'oregon',
        owner: 'Leoz',
        connection_secret_ref: 'secret://render/database-test',
        backup_enabled: true,
        backup_retention_days: 3,
      },
      production: {
        project_id: 'db-project-prod',
        database_id: 'database-prod',
        plan: 'basic',
        region: 'oregon',
        owner: 'Leoz',
        connection_secret_ref: 'secret://render/database-prod',
        backup_enabled: true,
        backup_retention_days: 7,
      },
    },
    egoric: {
      test: {
        project_id: 'egoric-test',
        base_url: 'https://egoric-test.example',
        tenant_key: 'egoric-test',
        owner: 'Leoz',
        source_flag: 'LEOZOPS_SOURCE_ENABLED',
        source_key_secret_ref: 'secret://egoric/test-source-read',
      },
      production: {
        project_id: 'egoric-production',
        base_url: 'https://erp-egoric.example',
        tenant_key: 'egoric',
        owner: 'Leoz',
        source_flag: 'LEOZOPS_SOURCE_ENABLED',
        source_key_secret_ref: 'secret://egoric/production-source-read',
      },
    },
    operations: {
      business_timezone: 'America/New_York',
      business_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
      business_start_local: '09:00',
      business_end_local: '18:00',
      director_reviewer: 'Leoz',
      brief_access_method: 'authenticated_read_api',
      brief_access_test_secret_ref: 'secret://leozops/test-output-read',
      brief_access_production_secret_ref: 'secret://leozops/production-output-read',
      alert_channel: 'platform_native',
      alert_test_destination_ref: 'platform://render/test-alerts',
      alert_production_destination_ref: 'platform://render/production-alerts',
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
    budget: { currency: 'USD', monthly_limit: 25, owner: 'Leoz' },
  };
}

export function validCheckpointB(p1 = validP1Decision()): CheckpointBEvidence {
  const check = (name: string) => ({ status: 'pass' as const, evidence_ref: `artifact://${name}` });
  return {
    schema_version: CHECKPOINT_B_SCHEMA_VERSION,
    evidence_id: 'CHECKPOINT-B-TEST-001',
    environment: 'test',
    recorded_by: 'Leoz',
    started_at: '2026-07-29T13:00:00.000Z',
    completed_at: '2026-07-29T14:00:00.000Z',
    p1_decision_id: p1.decision_id,
    p1_decision_fingerprint: p1DecisionFingerprint(p1),
    deployment: {
      runtime_project_id: p1.runtime.test.project_id,
      database_id: p1.database.test.database_id,
      egoric_project_id: p1.egoric.test.project_id,
      revision: 'git-abcdef1',
      config_fingerprint: evidenceFingerprint({ safe: 'config' }),
    },
    checks: {
      source_disabled_boot: check('source-disabled-boot'),
      public_health: check('public-health'),
      output_auth_denial: check('output-auth-denial'),
      migrations_current: check('migrations-current'),
      postgres_rollback: check('postgres-rollback'),
      network_200: check('network-200'),
      network_304: check('network-304'),
      exact_reconciliation: check('exact-reconciliation'),
      pii_scan: check('pii-scan'),
      cross_instance_denial: check('cross-instance-denial'),
      malformed_method_denial: check('malformed-method-denial'),
      latency_error_comparison: check('latency-error-comparison'),
      key_rotation: check('key-rotation'),
      source_flag_shutdown: check('source-flag-shutdown'),
      deployment_rollback: check('deployment-rollback'),
      secret_scan: check('secret-scan'),
    },
    source_request_methods: ['GET'],
    source_request_bodies: 0,
    source_mutation_count: 0,
    secret_findings: 0,
    pii_findings: 0,
    rollback_required_source_restore: false,
    verdict: 'pass',
  };
}

export function validP2Decision(
  p1 = validP1Decision(),
  checkpoint = validCheckpointB(p1),
): P2DecisionManifest {
  return {
    schema_version: P2_DECISION_SCHEMA_VERSION,
    decision_id: 'P2-PHASE2-TEST',
    status: 'approved',
    approved_by: 'Leoz',
    approved_at: '2026-07-29T15:00:00.000Z',
    p1_decision_id: p1.decision_id,
    p1_decision_fingerprint: p1DecisionFingerprint(p1),
    checkpoint_b_evidence_id: checkpoint.evidence_id,
    checkpoint_b_fingerprint: evidenceFingerprint(checkpoint),
    production: {
      runtime_project_id: p1.runtime.production.project_id,
      database_id: p1.database.production.database_id,
      egoric_project_id: p1.egoric.production.project_id,
      source_tenant_key: p1.egoric.production.tenant_key,
    },
    scope: 'company_ceo_brief_readonly',
    poll_schedule_minutes: 15,
    shadow_business_days: 10,
    verdict: 'approved',
  };
}
