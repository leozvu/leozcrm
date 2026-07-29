import { v4 as uuidv4 } from 'uuid';
import { db, Knex } from '../db/knex';
import {
  BUSINESS_MEMORY_TABLES,
  IntelligenceRun,
  SourceConnection,
  SourceSnapshot,
  Tenant,
} from '../domain/businessMemory';
import {
  SOURCE_RECONCILIATION_TABLE,
  SourceOperationsError,
  SourceReconciliation,
  safeSourceOperationsCode,
  validateBusinessDate,
  validateBusinessTimezone,
} from '../domain/sourceOperations';

export interface SourceOperationsContext {
  tenant: Tenant;
  connection: SourceConnection;
  stored: null | {
    snapshot: SourceSnapshot;
    run: IntelligenceRun;
  };
}

export interface ReconciliationRecordInput {
  tenantId: string;
  sourceConnectionId: string;
  businessDate: string;
  businessTimezone: string;
  checkedAt: string;
  status: 'passed' | 'failed';
  evidenceKey: string;
  sourceSnapshotRowId: string | null;
  snapshotId: string | null;
  intelligenceRunId: string | null;
  formulaVersion: string;
  sourceTotal: number | null;
  snapshotTotal: number | null;
  briefTotal: number | null;
  snapshotFactsHash: string | null;
  briefFactsHash: string | null;
  failureCode: string | null;
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const millis = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
}

function normalizedReconciliation(row: SourceReconciliation | undefined): SourceReconciliation {
  if (!row) {
    throw new SourceOperationsError(
      'missing_reconciliation',
      'source reconciliation record does not exist',
    );
  }
  const checkedAt = iso(row.checked_at);
  const createdAt = iso(row.created_at);
  const counts = [row.source_total, row.snapshot_total, row.brief_total];
  const validCount = (value: number | null) => value === null
    || (Number.isInteger(value) && value >= 0);
  const validHash = (value: string | null) => value === null
    || /^sha256:[0-9a-f]{64}$/.test(value);
  let validCalendar = true;
  try {
    validateBusinessDate(row.business_date);
    validateBusinessTimezone(row.business_timezone);
  } catch {
    validCalendar = false;
  }
  if (
    checkedAt === null
    || createdAt === null
    || !validCalendar
    || (row.status !== 'passed' && row.status !== 'failed')
    || !/^sha256:[0-9a-f]{64}$/.test(row.evidence_key)
    || counts.some((value) => !validCount(value))
    || !validHash(row.snapshot_facts_hash)
    || !validHash(row.brief_facts_hash)
    || (row.snapshot_id !== null && !/^sha256:[0-9a-f]{64}$/.test(row.snapshot_id))
    || (row.failure_code !== null && safeSourceOperationsCode(row.failure_code) !== row.failure_code)
    || (
      row.status === 'passed'
      && (
        row.failure_code !== null
        || counts.some((value) => value === null)
        || row.source_total !== row.snapshot_total
        || row.source_total !== row.brief_total
        || row.snapshot_facts_hash === null
        || row.snapshot_facts_hash !== row.brief_facts_hash
        || row.source_snapshot_row_id === null
        || row.snapshot_id === null
        || row.intelligence_run_id === null
      )
    )
    || (row.status === 'failed' && row.failure_code === null)
  ) {
    throw new SourceOperationsError(
      'corrupt_reconciliation',
      'source reconciliation record failed validation',
    );
  }
  return { ...row, checked_at: checkedAt, created_at: createdAt };
}

function comparable(
  row: SourceReconciliation,
): Omit<SourceReconciliation, 'id' | 'checked_at' | 'created_at'> {
  const { id: _id, checked_at: _checkedAt, created_at: _createdAt, ...rest } = row;
  return rest;
}

/** Tenant-scoped persistence for immutable, non-PII reconciliation evidence. */
export class SourceOperationsRepository {
  constructor(
    private readonly knex: Knex = db,
    private readonly uuid: () => string = uuidv4,
  ) {}

  async findContext(
    tenantId: string,
    sourceConnectionId: string,
  ): Promise<SourceOperationsContext | undefined> {
    const connection = await this.knex<SourceConnection>(BUSINESS_MEMORY_TABLES.sourceConnections)
      .where({ id: sourceConnectionId, tenant_id: tenantId })
      .first();
    if (!connection) return undefined;
    const tenant = await this.knex<Tenant>(BUSINESS_MEMORY_TABLES.tenants)
      .where({ id: tenantId })
      .first();
    if (!tenant) {
      throw new SourceOperationsError('missing_tenant', 'source connection tenant does not exist');
    }

    const run = await this.knex<IntelligenceRun>(`${BUSINESS_MEMORY_TABLES.intelligenceRuns} as runs`)
      .join(
        `${BUSINESS_MEMORY_TABLES.sourceSnapshots} as snapshots`,
        'snapshots.id',
        'runs.source_snapshot_id',
      )
      .where({
        'runs.tenant_id': tenantId,
        'runs.status': 'accepted',
        'snapshots.tenant_id': tenantId,
        'snapshots.source_connection_id': sourceConnectionId,
      })
      .select('runs.*')
      .orderBy('runs.as_of', 'desc')
      .orderBy('runs.created_at', 'desc')
      .orderBy('runs.id', 'asc')
      .first();
    if (!run) return { tenant, connection, stored: null };

    const snapshot = await this.knex<SourceSnapshot>(BUSINESS_MEMORY_TABLES.sourceSnapshots)
      .where({ id: run.source_snapshot_id, tenant_id: tenantId, source_connection_id: sourceConnectionId })
      .first();
    if (!snapshot) {
      throw new SourceOperationsError(
        'missing_source_snapshot',
        'accepted run has no tenant-scoped source snapshot',
      );
    }
    return { tenant, connection, stored: { snapshot, run } };
  }

  async recordReconciliation(
    input: ReconciliationRecordInput,
  ): Promise<{ record: SourceReconciliation; created: boolean }> {
    const id = this.uuid();
    const row = {
      id,
      tenant_id: input.tenantId,
      source_connection_id: input.sourceConnectionId,
      business_date: input.businessDate,
      business_timezone: input.businessTimezone,
      checked_at: input.checkedAt,
      status: input.status,
      evidence_key: input.evidenceKey,
      source_snapshot_row_id: input.sourceSnapshotRowId,
      snapshot_id: input.snapshotId,
      intelligence_run_id: input.intelligenceRunId,
      formula_version: input.formulaVersion,
      source_total: input.sourceTotal,
      snapshot_total: input.snapshotTotal,
      brief_total: input.briefTotal,
      snapshot_facts_hash: input.snapshotFactsHash,
      brief_facts_hash: input.briefFactsHash,
      failure_code: input.failureCode === null ? null : safeSourceOperationsCode(input.failureCode),
      created_at: input.checkedAt,
    };
    await this.knex(SOURCE_RECONCILIATION_TABLE).insert(row)
      .onConflict(['tenant_id', 'source_connection_id', 'evidence_key'])
      .ignore();
    const stored = normalizedReconciliation(
      await this.knex<SourceReconciliation>(SOURCE_RECONCILIATION_TABLE)
        .where({
          tenant_id: input.tenantId,
          source_connection_id: input.sourceConnectionId,
          evidence_key: input.evidenceKey,
        })
        .first(),
    );
    const expected = normalizedReconciliation(row as SourceReconciliation);
    if (JSON.stringify(comparable(stored)) !== JSON.stringify(comparable(expected))) {
      throw new SourceOperationsError(
        'reconciliation_identity_conflict',
        'reconciliation evidence key already has different facts',
      );
    }
    return { record: stored, created: stored.id === id };
  }

  async latestReconciliation(
    tenantId: string,
    sourceConnectionId: string,
  ): Promise<SourceReconciliation | undefined> {
    const row = await this.knex<SourceReconciliation>(SOURCE_RECONCILIATION_TABLE)
      .where({ tenant_id: tenantId, source_connection_id: sourceConnectionId })
      .orderBy('checked_at', 'desc')
      .orderBy('id', 'asc')
      .first();
    return row ? normalizedReconciliation(row) : undefined;
  }
}
