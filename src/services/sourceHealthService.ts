import {
  OperatorAccessGuard,
  SourceHealth,
  SourceOperationsError,
  sha256Fingerprint,
} from '../domain/sourceOperations';
import { SourceOperationsRepository } from '../repositories/sourceOperationsRepository';
import { SourcePollStateRepository } from '../repositories/sourcePollStateRepository';

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const millis = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
}

/** Authenticated, sanitized operator projection. It exposes no HTTP route. */
export class SourceHealthService {
  constructor(
    private readonly access: OperatorAccessGuard,
    private readonly operations: Pick<
      SourceOperationsRepository,
      'findContext' | 'latestReconciliation'
    >,
    private readonly pollStates: Pick<SourcePollStateRepository, 'findState'>,
    private readonly staleAfterMs: number,
    private readonly clock: () => Date = () => new Date(),
  ) {
    if (
      !Number.isInteger(staleAfterMs)
      || staleAfterMs < 60_000
      || staleAfterMs > 7 * 24 * 60 * 60 * 1_000
    ) {
      throw new SourceOperationsError(
        'invalid_stale_policy',
        'stale threshold is outside the supported range',
      );
    }
  }

  async get(input: {
    operatorToken: string;
    tenantId: string;
    sourceConnectionId: string;
  }): Promise<SourceHealth> {
    this.access.assertAuthorized(input.operatorToken);
    const context = await this.operations.findContext(input.tenantId, input.sourceConnectionId);
    if (!context) {
      throw new SourceOperationsError(
        'unknown_source_connection',
        'source connection does not exist for tenant',
      );
    }
    const [poll, reconciliation] = await Promise.all([
      this.pollStates.findState(input.tenantId, input.sourceConnectionId),
      this.operations.latestReconciliation(input.tenantId, input.sourceConnectionId),
    ]);

    const sourceGeneratedAt = iso(context.stored?.snapshot.generated_at);
    const ageMs = sourceGeneratedAt === null
      ? null
      : this.clock().getTime() - Date.parse(sourceGeneratedAt);
    const freshnessStatus = ageMs === null
      ? 'uninitialized' as const
      : ageMs < 0
        ? 'future_source_timestamp' as const
        : ageMs > this.staleAfterMs
          ? 'stale' as const
          : 'fresh' as const;

    return {
      tenant_id: input.tenantId,
      source_connection_id: input.sourceConnectionId,
      connection_status: context.connection.status,
      last_success_at: iso(context.connection.last_success_at),
      source_generated_at: sourceGeneratedAt,
      source_age_seconds: ageMs === null ? null : Math.floor(ageMs / 1_000),
      freshness_status: freshnessStatus,
      etag_fingerprint: context.connection.last_etag === null
        ? null
        : sha256Fingerprint(context.connection.last_etag),
      circuit_state: poll?.circuit_state ?? 'uninitialized',
      consecutive_failures: poll?.consecutive_failures ?? 0,
      next_attempt_at: poll?.next_attempt_at ?? null,
      last_failure_code: poll?.last_error_code ?? null,
      last_http_status: poll?.last_http_status ?? null,
      reconciliation: reconciliation
        ? {
            id: reconciliation.id,
            business_date: reconciliation.business_date,
            checked_at: reconciliation.checked_at,
            status: reconciliation.status,
            failure_code: reconciliation.failure_code,
          }
        : null,
    };
  }
}
