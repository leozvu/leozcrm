import { randomUUID } from 'node:crypto';
import type { Knex } from '../db/knex';
import { liveObserverFingerprint } from '../domain/liveObserver';
import { PHASE12_TABLES } from '../db/migrations/20260801210000_create_live_observer_control_plane';

export type LiveObserverEventType =
  | 'cycle_started'
  | 'source_poll_completed'
  | 'proactive_evaluation_completed'
  | 'cycle_completed'
  | 'cycle_failed';

export interface LiveObserverEventRecord {
  id: string;
  tenant_id: string;
  source_connection_id: string;
  cycle_id: string;
  sequence: number;
  invocation_key: string;
  event_type: LiveObserverEventType;
  outcome: 'started' | 'succeeded' | 'failed';
  reason_code: string;
  correlation_id: string;
  deployment_fingerprint: string;
  evidence_fingerprint: string;
  occurred_at: string;
  created_at: string;
}

export interface LiveRecoveryDrillRecord {
  id: string;
  drill_key: string;
  kind: 'backup' | 'restore';
  target_class: 'production_source' | 'disposable_restore_target';
  status: 'succeeded' | 'failed';
  artifact_sha256: string | null;
  artifact_bytes: number | null;
  tool_version: string;
  reason_code: string;
  deployment_fingerprint: string;
  evidence_fingerprint: string;
  started_at: string;
  completed_at: string;
  created_at: string;
}

const SAFE = /^[A-Za-z0-9][A-Za-z0-9._:-]{1,127}$/;

function safe(value: string, name: string): string {
  if (!SAFE.test(value)) throw new Error(`invalid_${name}`);
  return value;
}

export class LiveObserverRepository {
  constructor(
    private readonly knex: Knex,
    private readonly uuid: () => string = randomUUID,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async appendEvent(input: Omit<LiveObserverEventRecord, 'id' | 'evidence_fingerprint' | 'occurred_at' | 'created_at'>): Promise<LiveObserverEventRecord> {
    const occurredAt = this.clock().toISOString();
    const core = {
      tenant_id: input.tenant_id,
      source_connection_id: input.source_connection_id,
      cycle_id: input.cycle_id,
      sequence: input.sequence,
      invocation_key: safe(input.invocation_key, 'invocation_key'),
      event_type: input.event_type,
      outcome: input.outcome,
      reason_code: safe(input.reason_code, 'reason_code'),
      correlation_id: safe(input.correlation_id, 'correlation_id'),
      deployment_fingerprint: input.deployment_fingerprint,
      occurred_at: occurredAt,
    };
    const record: LiveObserverEventRecord = {
      id: this.uuid(),
      ...core,
      evidence_fingerprint: liveObserverFingerprint(core),
      created_at: occurredAt,
    };
    await this.knex(PHASE12_TABLES.events).insert(record);
    return record;
  }

  async listCycle(cycleId: string): Promise<LiveObserverEventRecord[]> {
    return this.knex<LiveObserverEventRecord>(PHASE12_TABLES.events)
      .where({ cycle_id: cycleId })
      .orderBy('sequence', 'asc');
  }

  async findInvocation(tenantId: string, invocationKey: string): Promise<LiveObserverEventRecord[]> {
    return this.knex<LiveObserverEventRecord>(PHASE12_TABLES.events)
      .where({ tenant_id: tenantId, invocation_key: safe(invocationKey, 'invocation_key') })
      .orderBy('sequence', 'asc');
  }

  async recordRecoveryDrill(input: Omit<LiveRecoveryDrillRecord, 'id' | 'evidence_fingerprint' | 'created_at'>): Promise<LiveRecoveryDrillRecord> {
    const core = {
      drill_key: safe(input.drill_key, 'drill_key'),
      kind: input.kind,
      target_class: input.target_class,
      status: input.status,
      artifact_sha256: input.artifact_sha256,
      artifact_bytes: input.artifact_bytes,
      tool_version: safe(input.tool_version, 'tool_version'),
      reason_code: safe(input.reason_code, 'reason_code'),
      deployment_fingerprint: input.deployment_fingerprint,
      started_at: input.started_at,
      completed_at: input.completed_at,
    };
    const record: LiveRecoveryDrillRecord = {
      id: this.uuid(),
      ...core,
      evidence_fingerprint: liveObserverFingerprint(core),
      created_at: input.completed_at,
    };
    await this.knex(PHASE12_TABLES.recoveryDrills).insert(record);
    return record;
  }
}
