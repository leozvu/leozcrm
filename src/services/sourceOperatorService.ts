import type { SourcePollState } from '../domain/pollReliability';
import {
  OperatorAccessGuard,
  SourceHealth,
  SourceReconciliation,
} from '../domain/sourceOperations';
import { SourcePollStateRepository } from '../repositories/sourcePollStateRepository';
import { SourcePollCoordinator, SourcePollCycleResult } from './sourcePollCoordinator';
import { SourceHealthService } from './sourceHealthService';
import { SourceReconciliationService } from './sourceReconciliationService';

/** Authenticated one-shot commands for an in-process operator/CLI boundary. */
export class SourceOperatorService {
  constructor(
    private readonly access: OperatorAccessGuard,
    private readonly states: Pick<
      SourcePollStateRepository,
      'makeDueForOperator' | 'disableForOperator' | 'recoverForOperator'
    >,
    private readonly healthService: Pick<SourceHealthService, 'get'>,
    private readonly reconciliation: Pick<SourceReconciliationService, 'run'>,
    private readonly pollCoordinator: () => Pick<SourcePollCoordinator, 'runOnce'>,
  ) {}

  async health(input: {
    operatorToken: string;
    tenantId: string;
    sourceConnectionId: string;
  }): Promise<SourceHealth> {
    return this.healthService.get(input);
  }

  async poll(input: {
    operatorToken: string;
    tenantId: string;
    sourceConnectionId: string;
    bearerToken: string;
    engineVersion: string;
  }): Promise<SourcePollCycleResult> {
    this.access.assertAuthorized(input.operatorToken);
    await this.states.makeDueForOperator(input.tenantId, input.sourceConnectionId);
    return this.pollCoordinator().runOnce({
      tenantId: input.tenantId,
      sourceConnectionId: input.sourceConnectionId,
      bearerToken: input.bearerToken,
      engineVersion: input.engineVersion,
    });
  }

  async reconcile(input: {
    operatorToken: string;
    tenantId: string;
    sourceConnectionId: string;
    businessDate: string;
    businessTimezone: string;
  }): Promise<SourceReconciliation> {
    this.access.assertAuthorized(input.operatorToken);
    return this.reconciliation.run(input);
  }

  async disable(input: {
    operatorToken: string;
    tenantId: string;
    sourceConnectionId: string;
  }): Promise<SourcePollState> {
    this.access.assertAuthorized(input.operatorToken);
    return this.states.disableForOperator(input.tenantId, input.sourceConnectionId);
  }

  async recover(input: {
    operatorToken: string;
    tenantId: string;
    sourceConnectionId: string;
  }): Promise<SourcePollState> {
    this.access.assertAuthorized(input.operatorToken);
    return this.states.recoverForOperator(input.tenantId, input.sourceConnectionId);
  }
}
