import {
  EGORIC_STAGES,
  EgoricSalesV1Snapshot,
  SnapshotContractError,
  canonicalStringify,
  validateEgoricSalesV1Snapshot,
} from '../domain/businessMemory';
import { EGORIC_BRIEF_FORMULA_VERSION, EgoricCeoBrief } from '../domain/egoricBrief';
import {
  SourceOperationsAlertSink,
  SourceOperationsError,
  SourceReconciliation,
  safeSourceOperationsCode,
  sha256Fingerprint,
  validateBusinessDate,
  validateBusinessTimezone,
} from '../domain/sourceOperations';
import {
  SourceOperationsContext,
  SourceOperationsRepository,
} from '../repositories/sourceOperationsRepository';
import {
  EgoricBriefError,
  EgoricBriefService,
  presentableEgoricSource,
} from './egoricBriefService';

interface ReconciliationFacts {
  total: number;
  stages: Array<{ stage: string; count: number }>;
  sources: Array<{ source: string | null; count: number }>;
}

function safeSources(values: Array<string | null>): Array<{ source: string | null; count: number }> {
  const counts = new Map<string | null, number>();
  for (const value of values) {
    const source = presentableEgoricSource(value);
    counts.set(source, (counts.get(source) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => (a.source ?? '').localeCompare(b.source ?? ''));
}

function snapshotFacts(snapshot: EgoricSalesV1Snapshot): ReconciliationFacts {
  return {
    total: snapshot.leads.length,
    stages: EGORIC_STAGES.map((stage) => ({
      stage,
      count: snapshot.leads.filter((lead) => lead.stage === stage).length,
    })),
    sources: safeSources(snapshot.leads.map((lead) => lead.source)),
  };
}

function briefFacts(brief: EgoricCeoBrief): ReconciliationFacts {
  return {
    total: brief.headline.total_leads,
    stages: EGORIC_STAGES.map((stage) => ({
      stage,
      count: brief.stages.find((item) => item.stage === stage)?.count ?? -1,
    })),
    sources: [...brief.sources]
      .map((source) => ({ source: source.source, count: source.count }))
      .sort((a, b) => (a.source ?? '').localeCompare(b.source ?? '')),
  };
}

function factHash(facts: ReconciliationFacts): string {
  return sha256Fingerprint(canonicalStringify(facts));
}

function iso(value: unknown): string | null {
  const millis = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
}

function evidenceKey(input: {
  tenantId: string;
  sourceConnectionId: string;
  businessDate: string;
  businessTimezone: string;
  snapshotRowId: string | null;
  runId: string | null;
}): string {
  return sha256Fingerprint(canonicalStringify({
    tenant_id: input.tenantId,
    source_connection_id: input.sourceConnectionId,
    business_date: input.businessDate,
    business_timezone: input.businessTimezone,
    source_snapshot_row_id: input.snapshotRowId,
    intelligence_run_id: input.runId,
    formula_version: EGORIC_BRIEF_FORMULA_VERSION,
  }));
}

function contextFailure(context: SourceOperationsContext): string | null {
  const stored = context.stored;
  if (!stored) return 'no_accepted_snapshot';
  if (
    stored.snapshot.tenant_id !== context.tenant.id
    || stored.snapshot.source_connection_id !== context.connection.id
    || stored.run.tenant_id !== context.tenant.id
    || stored.run.source_snapshot_id !== stored.snapshot.id
    || stored.run.snapshot_id !== stored.snapshot.snapshot_id
    || stored.run.status !== 'accepted'
  ) return 'stored_provenance_mismatch';
  return null;
}

/**
 * One explicitly invoked reconciliation. It never polls or repairs the source;
 * it independently derives safe facts from immutable source evidence and the
 * accepted brief, then records an immutable pass/fail row.
 */
export class SourceReconciliationService {
  constructor(
    private readonly operations: Pick<
      SourceOperationsRepository,
      'findContext' | 'recordReconciliation'
    >,
    private readonly briefs: Pick<EgoricBriefService, 'generate'>,
    private readonly alerts: SourceOperationsAlertSink,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async run(input: {
    tenantId: string;
    sourceConnectionId: string;
    businessDate: string;
    businessTimezone: string;
  }): Promise<SourceReconciliation> {
    const businessDate = validateBusinessDate(input.businessDate);
    const businessTimezone = validateBusinessTimezone(input.businessTimezone);
    const checkedAt = this.clock().toISOString();
    const context = await this.operations.findContext(input.tenantId, input.sourceConnectionId);
    if (!context) {
      throw new SourceOperationsError(
        'unknown_source_connection',
        'source connection does not exist for tenant',
      );
    }

    const stored = context.stored;
    let failureCode = contextFailure(context);
    let sourceTotal: number | null = null;
    let snapshotTotal: number | null = stored?.snapshot.record_count ?? null;
    let briefTotal: number | null = null;
    let snapshotFactsHash: string | null = null;
    let briefFactsHash: string | null = null;

    if (stored && failureCode === null) {
      let snapshot: EgoricSalesV1Snapshot | null = null;
      try {
        snapshot = validateEgoricSalesV1Snapshot(
          JSON.parse(stored.snapshot.payload_json),
          context.connection.source_tenant_key,
        );
      } catch (error) {
        failureCode = error instanceof SnapshotContractError
          ? safeSourceOperationsCode(error.code)
          : 'invalid_stored_snapshot';
      }

      if (snapshot) {
        sourceTotal = snapshot.leads.length;
        snapshotFactsHash = factHash(snapshotFacts(snapshot));
        if (
          snapshot.snapshot_id !== stored.snapshot.snapshot_id
          || snapshot.source.tenant_key !== stored.snapshot.source_tenant_key
          || snapshot.schema_version !== stored.snapshot.schema_version
          || sourceTotal !== snapshotTotal
        ) {
          failureCode = 'stored_snapshot_mismatch';
        }

        let brief: EgoricCeoBrief | null = null;
        if (failureCode === null) {
          const asOf = iso(stored.run.as_of);
          if (asOf === null) {
            failureCode = 'invalid_run_as_of';
          } else {
            try {
              brief = await this.briefs.generate(context.tenant.tenant_key, asOf);
            } catch (error) {
              failureCode = error instanceof EgoricBriefError
                ? safeSourceOperationsCode(error.code)
                : 'brief_generation_failed';
            }
          }
        }

        if (brief) {
          briefTotal = brief.headline.total_leads;
          briefFactsHash = factHash(briefFacts(brief));
          if (
            brief.source_snapshot_id !== stored.snapshot.snapshot_id
            || brief.intelligence_run_id !== stored.run.id
            || brief.formula_version !== EGORIC_BRIEF_FORMULA_VERSION
          ) {
            failureCode = 'brief_provenance_mismatch';
          } else if (
            sourceTotal !== snapshotTotal
            || sourceTotal !== briefTotal
            || snapshotFactsHash !== briefFactsHash
          ) {
            failureCode = 'reconciliation_mismatch';
          }
        }
      }
    }

    const safeFailure = failureCode === null ? null : safeSourceOperationsCode(failureCode);
    const storedResult = await this.operations.recordReconciliation({
      tenantId: input.tenantId,
      sourceConnectionId: input.sourceConnectionId,
      businessDate,
      businessTimezone,
      checkedAt,
      status: safeFailure === null ? 'passed' : 'failed',
      evidenceKey: evidenceKey({
        tenantId: input.tenantId,
        sourceConnectionId: input.sourceConnectionId,
        businessDate,
        businessTimezone,
        snapshotRowId: stored?.snapshot.id ?? null,
        runId: stored?.run.id ?? null,
      }),
      sourceSnapshotRowId: stored?.snapshot.id ?? null,
      snapshotId: stored?.snapshot.snapshot_id ?? null,
      intelligenceRunId: stored?.run.id ?? null,
      formulaVersion: EGORIC_BRIEF_FORMULA_VERSION,
      sourceTotal,
      snapshotTotal,
      briefTotal,
      snapshotFactsHash,
      briefFactsHash,
      failureCode: safeFailure,
    });

    if (storedResult.created && storedResult.record.status === 'failed') {
      try {
        await this.alerts.emit({
          code: storedResult.record.failure_code ?? 'reconciliation_failed',
          tenant_id: input.tenantId,
          source_connection_id: input.sourceConnectionId,
          business_date: businessDate,
          reconciliation_id: storedResult.record.id,
        });
      } catch {
        throw new SourceOperationsError(
          'alert_delivery_failed',
          'reconciliation failure was recorded but alert delivery failed',
        );
      }
    }
    return storedResult.record;
  }
}
