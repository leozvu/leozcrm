import { randomUUID } from 'node:crypto';
import { safeSourceOperationsCode } from '../domain/sourceOperations';
import { Phase2Environment, SourcePollRun } from '../domain/shadowTrust';
import { SourceOperationsRepository } from '../repositories/sourceOperationsRepository';
import { ShadowTrustRepository } from '../repositories/shadowTrustRepository';
import { SourcePollCoordinator, SourcePollCycleResult } from './sourcePollCoordinator';

/**
 * One command-and-exit worker invocation. The hosting scheduler may invoke it,
 * but the HTTP process never mounts or starts it. Every outcome is reduced to
 * immutable, non-PII evidence and the source method/body invariant is fixed to
 * GET/no-body by the adapter contract.
 */
export class SourceShadowWorker {
  constructor(
    private readonly coordinator: () => Pick<SourcePollCoordinator, 'runOnce'>,
    private readonly operations: Pick<SourceOperationsRepository, 'findContext'>,
    private readonly evidence: Pick<ShadowTrustRepository, 'recordPollRun'>,
    private readonly clock: () => Date = () => new Date(),
    private readonly uuid: () => string = randomUUID,
  ) {}

  async runOnce(input: {
    tenantId: string;
    sourceConnectionId: string;
    bearerToken: string;
    engineVersion: string;
    environment: Phase2Environment;
    authorizationId: string;
  }): Promise<{ result: SourcePollCycleResult; evidence: SourcePollRun }> {
    const startedAt = this.clock().toISOString();
    let result: SourcePollCycleResult;
    try {
      result = await this.coordinator().runOnce({
        tenantId: input.tenantId,
        sourceConnectionId: input.sourceConnectionId,
        bearerToken: input.bearerToken,
        engineVersion: input.engineVersion,
      });
    } catch (error) {
      const finishedAt = this.clock().toISOString();
      try {
        await this.evidence.recordPollRun({
          tenant_id: input.tenantId,
          source_connection_id: input.sourceConnectionId,
          environment: input.environment,
          authorization_id: input.authorizationId,
          correlation_id: this.uuid(),
          started_at: startedAt,
          finished_at: finishedAt,
          latency_ms: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
          outcome: 'failed',
          attempt_count: 1,
          http_status: null,
          error_code: error && typeof error === 'object' && 'code' in error
            ? safeSourceOperationsCode(String(error.code))
            : 'internal_error',
          request_method: 'GET',
          request_body_present: false,
          snapshot_id: null,
          intelligence_run_id: null,
          record_count: null,
          source_generated_at: null,
          confirmed_fresh_at: null,
          source_mutation_count: 0,
        });
      } catch {
        // Database outage can prevent both the poll and its evidence write.
        // The scheduler exit remains failed and no source success is claimed.
      }
      throw error;
    }

    const finishedAt = this.clock().toISOString();
    const context = await this.operations.findContext(input.tenantId, input.sourceConnectionId);
    const stored = context?.stored;
    const correlationId = result.kind === 'skipped' ? this.uuid() : result.correlation_id;
    const evidence = await this.evidence.recordPollRun({
      tenant_id: input.tenantId,
      source_connection_id: input.sourceConnectionId,
      environment: input.environment,
      authorization_id: input.authorizationId,
      correlation_id: correlationId,
      started_at: startedAt,
      finished_at: finishedAt,
      latency_ms: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
      outcome: result.kind === 'succeeded' ? result.outcome : result.kind,
      attempt_count: result.kind === 'skipped' ? 0 : result.attempts,
      http_status: result.kind === 'failed'
        ? result.http_status
        : result.kind === 'succeeded'
          ? result.outcome === 'accepted' ? 200 : 304
          : null,
      error_code: result.kind === 'failed' ? safeSourceOperationsCode(result.error_code) : null,
      request_method: result.kind === 'skipped' ? null : 'GET',
      request_body_present: false,
      snapshot_id: stored?.snapshot.snapshot_id ?? null,
      intelligence_run_id: stored?.run.id ?? null,
      record_count: stored?.snapshot.record_count ?? null,
      source_generated_at: stored?.snapshot.generated_at ?? null,
      confirmed_fresh_at: context?.connection.last_success_at ?? null,
      source_mutation_count: 0,
    });
    return { result, evidence };
  }
}
