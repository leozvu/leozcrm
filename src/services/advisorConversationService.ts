import {
  AdvisorAnswer,
  AdvisorContextEntry,
  AdvisorContextKind,
  AdvisorConversation,
  AdvisorConversationView,
  AdvisorFeedback,
  AdvisorFeedbackRating,
  AdvisorModelProvider,
  AdvisorProviderUsage,
  AdvisorContractError,
  advisorHash,
  validateAdvisorAnswer,
} from '../domain/advisorConversation';
import { BusinessMemoryRepository } from '../repositories/businessMemoryRepository';
import {
  AdvisorConversationRepository,
  AdvisorRepositoryError,
  AdvisorRunResponse,
} from '../repositories/advisorConversationRepository';
import { AdvisorEvidenceService } from './advisorEvidenceService';

const TENANT_KEY_RE = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CONTEXT_KEY_RE = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const SAFE_FAILURE_RE = /^[a-z0-9][a-z0-9_:-]{0,127}$/;

export interface AdvisorServiceLimits {
  maxQuestionChars: number;
  maxContextChars: number;
  maxEvidenceItems: number;
  maxInputUnits: number;
  maxOutputUnits: number;
  maxCostMicrounits: number;
  maxOutputChars: number;
  providerTimeoutMs: number;
}

export const DEFAULT_ADVISOR_LIMITS: AdvisorServiceLimits = {
  maxQuestionChars: 1_000,
  maxContextChars: 2_000,
  maxEvidenceItems: 128,
  maxInputUnits: 16_000,
  maxOutputUnits: 4_000,
  maxCostMicrounits: 50_000,
  maxOutputChars: 12_000,
  providerTimeoutMs: 8_000,
};

export class AdvisorServiceError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: 400 | 404 | 409 | 413 | 422 | 429 | 500 | 502 | 503 | 504,
    message: string,
  ) {
    super(message);
    this.name = 'AdvisorServiceError';
  }
}

export interface AdvisorAskResponse extends AdvisorRunResponse {
  replayed: boolean;
}

function cleanText(value: unknown, path: string, max: number): string {
  if (typeof value !== 'string') {
    throw new AdvisorServiceError('invalid_input', 400, `${path} must be text`);
  }
  const clean = value.trim();
  if (!clean || clean.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(clean)) {
    throw new AdvisorServiceError('invalid_input', 400, `${path} is invalid`);
  }
  return clean;
}

function containsSensitiveValue(value: string): boolean {
  const phoneLike = value.match(/(?:\+?\d[\d .()-]{8,}\d)/g)
    ?.some((candidate) => {
      const digits = candidate.replace(/\D/g, '');
      const separators = candidate.match(/[-.]/g)?.length ?? 0;
      return digits.length >= 10 && (/[+() ]/.test(candidate) || separators >= 2);
    }) ?? false;
  return /\b(?:api[_ -]?key|secret|password|private[_ -]?key|access[_ -]?token)\s*[:=]/i.test(value)
    || /\bBearer\s+[A-Za-z0-9._~+\/-]{8,}/i.test(value)
    || /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value)
    || phoneLike;
}

function ensureSafeUserText(value: string, path: string): void {
  if (containsSensitiveValue(value)) {
    throw new AdvisorServiceError(
      'sensitive_input_rejected',
      400,
      `${path} appears to contain a credential or unsupported personal identifier`,
    );
  }
}

function validIso(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new AdvisorServiceError('invalid_input', 400, `${path} must be a timestamp with timezone`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AdvisorServiceError('invalid_input', 400, `${path} must be a valid timestamp`);
  }
  return date.toISOString();
}

function assertUsage(usage: AdvisorProviderUsage, limits: AdvisorServiceLimits): void {
  const values = [usage.input_units, usage.output_units, usage.cost_microunits];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new AdvisorServiceError('provider_usage_invalid', 502, 'provider returned invalid usage');
  }
  if (
    usage.input_units > limits.maxInputUnits
    || usage.output_units > limits.maxOutputUnits
    || usage.cost_microunits > limits.maxCostMicrounits
  ) {
    throw new AdvisorServiceError('provider_budget_exceeded', 422, 'advisor provider exceeded the run budget');
  }
}

function mapRepositoryError(error: AdvisorRepositoryError): AdvisorServiceError {
  return new AdvisorServiceError(error.code, error.status, error.message);
}

export class AdvisorConversationService {
  constructor(
    private readonly memory: BusinessMemoryRepository,
    private readonly repository: AdvisorConversationRepository,
    private readonly evidence: AdvisorEvidenceService,
    private readonly provider: AdvisorModelProvider,
    private readonly limits: AdvisorServiceLimits = DEFAULT_ADVISOR_LIMITS,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private async tenant(tenantKey: string) {
    if (!TENANT_KEY_RE.test(tenantKey)) {
      throw new AdvisorServiceError('invalid_tenant_key', 400, 'tenant key is invalid');
    }
    const tenant = await this.memory.findTenantByKey(tenantKey);
    if (!tenant) throw new AdvisorServiceError('tenant_not_found', 404, 'tenant was not found');
    return tenant;
  }

  async createConversation(tenantKey: string, rawTitle?: unknown): Promise<AdvisorConversation> {
    const tenant = await this.tenant(tenantKey);
    const title = rawTitle === undefined || rawTitle === null
      ? null
      : cleanText(rawTitle, 'title', 160);
    if (title) ensureSafeUserText(title, 'title');
    return this.repository.createConversation(tenant.id, title);
  }

  async getConversation(tenantKey: string, conversationId: string): Promise<AdvisorConversationView> {
    const tenant = await this.tenant(tenantKey);
    if (!UUID_RE.test(conversationId)) {
      throw new AdvisorServiceError('invalid_conversation_id', 400, 'conversation id is invalid');
    }
    try {
      return await this.repository.getConversationView(tenant.id, conversationId);
    } catch (error) {
      if (error instanceof AdvisorRepositoryError) throw mapRepositoryError(error);
      if (error instanceof AdvisorContractError) {
        throw new AdvisorServiceError(error.code, 500, 'stored advisor conversation is invalid');
      }
      throw error;
    }
  }

  async appendContext(tenantKey: string, input: {
    kind: unknown;
    contextKey: unknown;
    content: unknown;
    replacesEntryId?: unknown;
    effectiveAt?: unknown;
  }): Promise<AdvisorContextEntry> {
    const tenant = await this.tenant(tenantKey);
    if (input.kind !== 'goal' && input.kind !== 'constraint' && input.kind !== 'decision') {
      throw new AdvisorServiceError('invalid_context_kind', 400, 'context kind is invalid');
    }
    if (typeof input.contextKey !== 'string' || !CONTEXT_KEY_RE.test(input.contextKey)) {
      throw new AdvisorServiceError('invalid_context_key', 400, 'context key is invalid');
    }
    const content = cleanText(input.content, 'content', this.limits.maxContextChars);
    ensureSafeUserText(content, 'content');
    let replacesEntryId: string | undefined;
    if (input.replacesEntryId !== undefined) {
      if (typeof input.replacesEntryId !== 'string' || !UUID_RE.test(input.replacesEntryId)) {
        throw new AdvisorServiceError('invalid_context_id', 400, 'replacement context id is invalid');
      }
      replacesEntryId = input.replacesEntryId;
    }
    const effectiveAt = input.effectiveAt === undefined
      ? this.clock().toISOString()
      : validIso(input.effectiveAt, 'effectiveAt');
    try {
      return await this.repository.appendContext({
        tenantId: tenant.id,
        kind: input.kind as AdvisorContextKind,
        contextKey: input.contextKey,
        content,
        replacesEntryId,
        effectiveAt,
      });
    } catch (error) {
      if (error instanceof AdvisorRepositoryError) throw mapRepositoryError(error);
      throw error;
    }
  }

  async listContext(tenantKey: string): Promise<AdvisorContextEntry[]> {
    const tenant = await this.tenant(tenantKey);
    return this.repository.listActiveContext(tenant.id);
  }

  async ask(tenantKey: string, input: {
    conversationId: string;
    idempotencyKey: string;
    question: unknown;
    asOf?: unknown;
  }): Promise<AdvisorAskResponse> {
    const tenant = await this.tenant(tenantKey);
    if (!UUID_RE.test(input.conversationId)) {
      throw new AdvisorServiceError('invalid_conversation_id', 400, 'conversation id is invalid');
    }
    if (!IDEMPOTENCY_RE.test(input.idempotencyKey)) {
      throw new AdvisorServiceError('invalid_idempotency_key', 400, 'idempotency key is invalid');
    }
    const question = cleanText(input.question, 'question', this.limits.maxQuestionChars);
    ensureSafeUserText(question, 'question');
    if (input.asOf !== undefined && typeof input.asOf !== 'string') {
      throw new AdvisorServiceError('invalid_as_of', 400, 'asOf must be a date or timestamp');
    }
    const requestedAsOf = input.asOf as string | undefined;
    const requestHash = advisorHash({
      tenant_key: tenantKey,
      conversation_id: input.conversationId,
      question,
      as_of: requestedAsOf ?? null,
      provider_key: this.provider.key,
      provider_version: this.provider.version,
    });

    let claim;
    try {
      claim = await this.repository.claimQuestion({
        tenantId: tenant.id,
        conversationId: input.conversationId,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        question,
        providerKey: this.provider.key,
        providerVersion: this.provider.version,
      });
    } catch (error) {
      if (error instanceof AdvisorRepositoryError) throw mapRepositoryError(error);
      throw error;
    }
    if (claim.state === 'replay') return { ...claim.response, replayed: true };
    if (claim.state === 'in_progress') {
      throw new AdvisorServiceError(
        'advisor_run_in_progress',
        409,
        'an advisor run already owns this idempotency key',
      );
    }

    let evidencePackHash: string | undefined;
    try {
      const evidencePack = await this.evidence.build(tenantKey, requestedAsOf);
      evidencePackHash = evidencePack.hash;
      if (evidencePack.items.length > this.limits.maxEvidenceItems) {
        throw new AdvisorServiceError('evidence_budget_exceeded', 422, 'evidence pack exceeds the item budget');
      }
      const estimatedInput = Math.ceil((question.length + JSON.stringify(evidencePack).length) / 4);
      if (estimatedInput > this.limits.maxInputUnits) {
        throw new AdvisorServiceError('input_budget_exceeded', 422, 'advisor input exceeds the run budget');
      }

      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new AdvisorServiceError('provider_timeout', 504, 'advisor provider timed out'));
        }, this.limits.providerTimeoutMs);
      });
      let providerResult;
      try {
        providerResult = await Promise.race([
          this.provider.answer({
            question,
            evidence: evidencePack,
            instruction: 'answer_only_from_structured_evidence',
          }, controller.signal),
          timeout,
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      assertUsage(providerResult.usage, this.limits);
      const evidenceKeys = new Set(evidencePack.items.map((item) => item.key));
      const validated = validateAdvisorAnswer(
        providerResult.answer,
        evidenceKeys,
        this.limits.maxOutputChars,
      );
      if (containsSensitiveValue(JSON.stringify(validated))) {
        throw new AdvisorServiceError(
          'provider_sensitive_output',
          502,
          'advisor provider returned unsupported sensitive output',
        );
      }
      const response = await this.repository.completeRun({
        tenantId: tenant.id,
        runId: claim.run.id,
        evidencePackHash: evidencePack.hash,
        answer: validated,
        evidenceItems: evidencePack.items,
        usage: providerResult.usage,
      });
      return { ...response, replayed: false };
    } catch (error) {
      const failureCode = error instanceof AdvisorServiceError
        ? error.code
        : error instanceof AdvisorContractError
          ? 'provider_contract_failure'
          : 'provider_failure';
      await this.repository.failRun({
        tenantId: tenant.id,
        runId: claim.run.id,
        failureCode: SAFE_FAILURE_RE.test(failureCode) ? failureCode : 'provider_failure',
        evidencePackHash,
      });
      if (error instanceof AdvisorServiceError) throw error;
      if (error instanceof AdvisorContractError) {
        throw new AdvisorServiceError(
          'provider_contract_failure',
          502,
          'advisor provider returned an invalid grounded-answer contract',
        );
      }
      if (error instanceof AdvisorRepositoryError) throw mapRepositoryError(error);
      throw new AdvisorServiceError('provider_failure', 503, 'advisor provider failed safely');
    }
  }

  async recordFeedback(tenantKey: string, input: {
    runId: string;
    rating: unknown;
    note?: unknown;
  }): Promise<AdvisorFeedback> {
    const tenant = await this.tenant(tenantKey);
    if (!UUID_RE.test(input.runId)) {
      throw new AdvisorServiceError('invalid_run_id', 400, 'run id is invalid');
    }
    if (input.rating !== 'useful' && input.rating !== 'not_useful') {
      throw new AdvisorServiceError('invalid_feedback_rating', 400, 'feedback rating is invalid');
    }
    let note: string | null = null;
    if (input.note !== undefined && input.note !== null) {
      note = cleanText(input.note, 'note', 1_000);
      ensureSafeUserText(note, 'note');
    }
    try {
      return await this.repository.recordFeedback({
        tenantId: tenant.id,
        runId: input.runId,
        rating: input.rating as AdvisorFeedbackRating,
        note,
      });
    } catch (error) {
      if (error instanceof AdvisorRepositoryError) throw mapRepositoryError(error);
      throw error;
    }
  }
}
