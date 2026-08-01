import { v4 as uuidv4 } from 'uuid';
import { db, Knex } from '../db/knex';
import {
  ADVISOR_TABLES,
  AdvisorAnswer,
  AdvisorCitation,
  AdvisorContextEntry,
  AdvisorContextKind,
  AdvisorConversation,
  AdvisorConversationView,
  AdvisorFeedback,
  AdvisorFeedbackRating,
  AdvisorMessage,
  AdvisorRun,
  AdvisorRunResult,
  AdvisorProviderUsage,
  AdvisorEvidenceItem,
  advisorHash,
  collectAdvisorEvidenceKeys,
  parseStoredAdvisorAnswer,
} from '../domain/advisorConversation';
import { canonicalStringify } from '../domain/businessMemory';

export class AdvisorRepositoryError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: 400 | 404 | 409 | 500,
    message: string,
  ) {
    super(message);
    this.name = 'AdvisorRepositoryError';
  }
}

export interface AdvisorRunResponse {
  run: AdvisorRun;
  result: AdvisorRunResult;
  assistant_message: AdvisorMessage;
  answer: AdvisorAnswer;
  citations: AdvisorCitation[];
}

export type AdvisorClaimResult =
  | { state: 'claimed'; run: AdvisorRun; user_message: AdvisorMessage }
  | { state: 'in_progress'; run: AdvisorRun }
  | { state: 'replay'; response: AdvisorRunResponse };

function isPostgres(knex: Knex): boolean {
  const client = String(knex.client.config.client);
  return client === 'pg' || client.includes('postgres');
}

function normalizeResult(row: AdvisorRunResult): AdvisorRunResult {
  const normalized = {
    ...row,
    input_units: Number(row.input_units),
    output_units: Number(row.output_units),
    cost_microunits: Number(row.cost_microunits),
  };
  if (
    !Number.isSafeInteger(normalized.input_units)
    || !Number.isSafeInteger(normalized.output_units)
    || !Number.isSafeInteger(normalized.cost_microunits)
    || normalized.input_units < 0
    || normalized.output_units < 0
    || normalized.cost_microunits < 0
  ) {
    throw new AdvisorRepositoryError('corrupt_run_result', 500, 'advisor usage evidence is invalid');
  }
  return normalized;
}

function ensureMessageIntegrity(message: AdvisorMessage): void {
  if (
    (message.role !== 'user' && message.role !== 'assistant')
    || !Number.isSafeInteger(message.sequence)
    || message.sequence < 1
    || typeof message.content !== 'string'
    || message.content.length === 0
  ) {
    throw new AdvisorRepositoryError('corrupt_message', 500, 'stored advisor message is invalid');
  }
}

export class AdvisorConversationRepository {
  constructor(
    private readonly knex: Knex = db,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private now(): string {
    return this.clock().toISOString();
  }

  async createConversation(tenantId: string, title: string | null): Promise<AdvisorConversation> {
    const row: AdvisorConversation = {
      id: uuidv4(),
      tenant_id: tenantId,
      title,
      created_at: this.now(),
    };
    await this.knex(ADVISOR_TABLES.conversations).insert(row);
    return row;
  }

  async findConversation(
    tenantId: string,
    conversationId: string,
    connection: Knex | Knex.Transaction = this.knex,
  ): Promise<AdvisorConversation | undefined> {
    return connection<AdvisorConversation>(ADVISOR_TABLES.conversations)
      .where({ id: conversationId, tenant_id: tenantId })
      .first();
  }

  async getConversationView(
    tenantId: string,
    conversationId: string,
  ): Promise<AdvisorConversationView> {
    const conversation = await this.findConversation(tenantId, conversationId);
    if (!conversation) {
      throw new AdvisorRepositoryError('conversation_not_found', 404, 'conversation was not found');
    }
    const messages = await this.knex<AdvisorMessage>(ADVISOR_TABLES.messages)
      .where({ tenant_id: tenantId, conversation_id: conversationId })
      .orderBy('sequence', 'asc');
    messages.forEach(ensureMessageIntegrity);
    return {
      conversation,
      messages: messages.map((message) => message.role === 'assistant'
        ? { ...message, answer: parseStoredAdvisorAnswer(message.content) }
        : message),
    };
  }

  async appendContext(input: {
    tenantId: string;
    kind: AdvisorContextKind;
    contextKey: string;
    content: string;
    replacesEntryId?: string;
    effectiveAt: string;
  }): Promise<AdvisorContextEntry> {
    return this.knex.transaction(async (trx) => {
      if (isPostgres(this.knex)) {
        const tenant = await trx<{ id: string }>('tenants')
          .where({ id: input.tenantId })
          .forUpdate()
          .first();
        if (!tenant) {
          throw new AdvisorRepositoryError('tenant_not_found', 404, 'tenant was not found');
        }
      }
      if (input.replacesEntryId) {
        const previous = await trx<AdvisorContextEntry>(ADVISOR_TABLES.contextEntries)
          .where({ id: input.replacesEntryId, tenant_id: input.tenantId })
          .first();
        if (!previous) {
          throw new AdvisorRepositoryError('context_not_found', 404, 'context entry was not found');
        }
        if (previous.kind !== input.kind || previous.context_key !== input.contextKey) {
          throw new AdvisorRepositoryError(
            'context_replacement_mismatch',
            409,
            'context replacement must preserve kind and key',
          );
        }
        const alreadyReplaced = await trx<AdvisorContextEntry>(ADVISOR_TABLES.contextEntries)
          .where({ tenant_id: input.tenantId, replaces_entry_id: previous.id })
          .first();
        if (alreadyReplaced) {
          throw new AdvisorRepositoryError(
            'context_already_replaced',
            409,
            'context entry already has a newer version',
          );
        }
      } else {
        const active = await this.findActiveContextByIdentity(
          trx,
          input.tenantId,
          input.kind,
          input.contextKey,
        );
        if (active) {
          throw new AdvisorRepositoryError(
            'context_exists',
            409,
            'active context already exists; replace it explicitly',
          );
        }
      }

      const now = this.now();
      const row: AdvisorContextEntry = {
        id: uuidv4(),
        tenant_id: input.tenantId,
        kind: input.kind,
        context_key: input.contextKey,
        content: input.content,
        replaces_entry_id: input.replacesEntryId ?? null,
        effective_at: input.effectiveAt,
        created_at: now,
      };
      await trx(ADVISOR_TABLES.contextEntries).insert(row);
      return row;
    });
  }

  private async findActiveContextByIdentity(
    connection: Knex | Knex.Transaction,
    tenantId: string,
    kind: AdvisorContextKind,
    contextKey: string,
  ): Promise<AdvisorContextEntry | undefined> {
    const candidates = await connection<AdvisorContextEntry>(ADVISOR_TABLES.contextEntries)
      .where({ tenant_id: tenantId, kind, context_key: contextKey })
      .orderBy('created_at', 'desc');
    if (candidates.length === 0) return undefined;
    const replaced = new Set(
      (await connection<AdvisorContextEntry>(ADVISOR_TABLES.contextEntries)
        .select('replaces_entry_id')
        .where({ tenant_id: tenantId })
        .whereNotNull('replaces_entry_id'))
        .map((row) => row.replaces_entry_id)
        .filter((value): value is string => value !== null),
    );
    return candidates.find((row) => !replaced.has(row.id));
  }

  async listActiveContext(tenantId: string): Promise<AdvisorContextEntry[]> {
    const rows = await this.knex<AdvisorContextEntry>(ADVISOR_TABLES.contextEntries)
      .where({ tenant_id: tenantId })
      .orderBy('kind', 'asc')
      .orderBy('context_key', 'asc')
      .orderBy('created_at', 'desc');
    const replaced = new Set(rows
      .map((row) => row.replaces_entry_id)
      .filter((value): value is string => value !== null));
    return rows.filter((row) => !replaced.has(row.id));
  }

  async claimQuestion(input: {
    tenantId: string;
    conversationId: string;
    idempotencyKey: string;
    requestHash: string;
    question: string;
    providerKey: string;
    providerVersion: string;
  }): Promise<AdvisorClaimResult> {
    return this.knex.transaction(async (trx) => {
      let conversationQuery = trx<AdvisorConversation>(ADVISOR_TABLES.conversations)
        .where({ id: input.conversationId, tenant_id: input.tenantId });
      if (isPostgres(this.knex)) conversationQuery = conversationQuery.forUpdate();
      const conversation = await conversationQuery.first();
      if (!conversation) {
        throw new AdvisorRepositoryError('conversation_not_found', 404, 'conversation was not found');
      }

      const existing = await trx<AdvisorRun>(ADVISOR_TABLES.runs)
        .where({
          tenant_id: input.tenantId,
          conversation_id: input.conversationId,
          idempotency_key: input.idempotencyKey,
        })
        .first();
      if (existing) {
        if (existing.request_hash !== input.requestHash) {
          throw new AdvisorRepositoryError(
            'idempotency_conflict',
            409,
            'idempotency key was already used for a different question',
          );
        }
        const response = await this.loadRunResponse(trx, input.tenantId, existing);
        return response ? { state: 'replay', response } : { state: 'in_progress', run: existing };
      }

      const last = await trx<AdvisorMessage>(ADVISOR_TABLES.messages)
        .where({ tenant_id: input.tenantId, conversation_id: input.conversationId })
        .orderBy('sequence', 'desc')
        .first();
      const now = this.now();
      const userMessage: AdvisorMessage = {
        id: uuidv4(),
        tenant_id: input.tenantId,
        conversation_id: input.conversationId,
        sequence: (last?.sequence ?? 0) + 1,
        role: 'user',
        content: input.question,
        created_at: now,
      };
      const run: AdvisorRun = {
        id: uuidv4(),
        tenant_id: input.tenantId,
        conversation_id: input.conversationId,
        user_message_id: userMessage.id,
        idempotency_key: input.idempotencyKey,
        request_hash: input.requestHash,
        provider_key: input.providerKey,
        provider_version: input.providerVersion,
        started_at: now,
        created_at: now,
      };
      await trx(ADVISOR_TABLES.messages).insert(userMessage);
      await trx(ADVISOR_TABLES.runs).insert(run);
      return { state: 'claimed', run, user_message: userMessage };
    });
  }

  async completeRun(input: {
    tenantId: string;
    runId: string;
    evidencePackHash: string;
    answer: AdvisorAnswer;
    evidenceItems: AdvisorEvidenceItem[];
    usage: AdvisorProviderUsage;
  }): Promise<AdvisorRunResponse> {
    return this.knex.transaction(async (trx) => {
      let runQuery = trx<AdvisorRun>(ADVISOR_TABLES.runs)
        .where({ id: input.runId, tenant_id: input.tenantId });
      if (isPostgres(this.knex)) runQuery = runQuery.forUpdate();
      const run = await runQuery.first();
      if (!run) throw new AdvisorRepositoryError('run_not_found', 404, 'advisor run was not found');
      const existing = await this.loadRunResponse(trx, input.tenantId, run);
      if (existing) return existing;

      if (isPostgres(this.knex)) {
        const conversation = await trx<AdvisorConversation>(ADVISOR_TABLES.conversations)
          .where({ id: run.conversation_id, tenant_id: input.tenantId })
          .forUpdate()
          .first();
        if (!conversation) {
          throw new AdvisorRepositoryError('conversation_not_found', 404, 'conversation was not found');
        }
      }

      const last = await trx<AdvisorMessage>(ADVISOR_TABLES.messages)
        .where({ tenant_id: input.tenantId, conversation_id: run.conversation_id })
        .orderBy('sequence', 'desc')
        .first();
      const now = this.now();
      const serialized = canonicalStringify(input.answer);
      const assistant: AdvisorMessage = {
        id: uuidv4(),
        tenant_id: input.tenantId,
        conversation_id: run.conversation_id,
        sequence: (last?.sequence ?? 0) + 1,
        role: 'assistant',
        content: serialized,
        created_at: now,
      };
      await trx(ADVISOR_TABLES.messages).insert(assistant);

      const evidence = new Map(input.evidenceItems.map((item) => [item.key, item]));
      const usedKeys = new Set<string>();
      for (const section of [
        input.answer.summary,
        ...input.answer.facts,
        ...input.answer.inferences,
        ...input.answer.recommendations,
        ...input.answer.limitations,
      ]) {
        for (const key of section.evidence_keys) usedKeys.add(key);
      }
      const citations: AdvisorCitation[] = [...usedKeys].sort().map((key) => {
        const item = evidence.get(key);
        if (!item) {
          throw new AdvisorRepositoryError(
            'missing_evidence_item',
            500,
            'validated answer references missing evidence',
          );
        }
        return {
          id: uuidv4(),
          tenant_id: input.tenantId,
          run_id: run.id,
          assistant_message_id: assistant.id,
          evidence_key: item.key,
          source_type: item.source_type,
          source_id: item.source_id,
          source_path: item.source_path,
          value_hash: item.value_hash,
          label: item.label,
          created_at: now,
        };
      });
      if (citations.length > 0) await trx(ADVISOR_TABLES.citations).insert(citations);

      const result: AdvisorRunResult = {
        id: uuidv4(),
        tenant_id: input.tenantId,
        run_id: run.id,
        assistant_message_id: assistant.id,
        status: 'completed',
        evidence_pack_hash: input.evidencePackHash,
        answer_hash: advisorHash(input.answer),
        failure_code: null,
        input_units: input.usage.input_units,
        output_units: input.usage.output_units,
        cost_microunits: input.usage.cost_microunits,
        completed_at: now,
        created_at: now,
      };
      await trx(ADVISOR_TABLES.runResults).insert(result);
      return { run, result, assistant_message: assistant, answer: input.answer, citations };
    });
  }

  async failRun(input: {
    tenantId: string;
    runId: string;
    failureCode: string;
    evidencePackHash?: string;
    usage?: AdvisorProviderUsage;
  }): Promise<AdvisorRunResult> {
    return this.knex.transaction(async (trx) => {
      const run = await trx<AdvisorRun>(ADVISOR_TABLES.runs)
        .where({ id: input.runId, tenant_id: input.tenantId })
        .first();
      if (!run) throw new AdvisorRepositoryError('run_not_found', 404, 'advisor run was not found');
      const existing = await trx<AdvisorRunResult>(ADVISOR_TABLES.runResults)
        .where({ tenant_id: input.tenantId, run_id: run.id })
        .first();
      if (existing) return normalizeResult(existing);
      const now = this.now();
      const usage = input.usage ?? { input_units: 0, output_units: 0, cost_microunits: 0 };
      const result: AdvisorRunResult = {
        id: uuidv4(),
        tenant_id: input.tenantId,
        run_id: run.id,
        assistant_message_id: null,
        status: 'failed',
        evidence_pack_hash: input.evidencePackHash ?? null,
        answer_hash: null,
        failure_code: input.failureCode,
        input_units: usage.input_units,
        output_units: usage.output_units,
        cost_microunits: usage.cost_microunits,
        completed_at: now,
        created_at: now,
      };
      await trx(ADVISOR_TABLES.runResults).insert(result);
      return result;
    });
  }

  async getRunResponse(tenantId: string, runId: string): Promise<AdvisorRunResponse | undefined> {
    const run = await this.knex<AdvisorRun>(ADVISOR_TABLES.runs)
      .where({ id: runId, tenant_id: tenantId })
      .first();
    if (!run) return undefined;
    return this.loadRunResponse(this.knex, tenantId, run);
  }

  private async loadRunResponse(
    connection: Knex | Knex.Transaction,
    tenantId: string,
    run: AdvisorRun,
  ): Promise<AdvisorRunResponse | undefined> {
    const rawResult = await connection<AdvisorRunResult>(ADVISOR_TABLES.runResults)
      .where({ tenant_id: tenantId, run_id: run.id })
      .first();
    if (!rawResult) return undefined;
    const result = normalizeResult(rawResult);
    if (result.status === 'failed') {
      throw new AdvisorRepositoryError(
        result.failure_code ?? 'advisor_run_failed',
        409,
        'advisor run previously failed; submit a new idempotency key',
      );
    }
    if (!result.assistant_message_id || !result.answer_hash || !result.evidence_pack_hash) {
      throw new AdvisorRepositoryError('corrupt_run_result', 500, 'completed advisor run is incomplete');
    }
    const assistant = await connection<AdvisorMessage>(ADVISOR_TABLES.messages)
      .where({
        id: result.assistant_message_id,
        tenant_id: tenantId,
        conversation_id: run.conversation_id,
        role: 'assistant',
      })
      .first();
    if (!assistant) {
      throw new AdvisorRepositoryError('corrupt_run_result', 500, 'advisor result message is missing');
    }
    ensureMessageIntegrity(assistant);
    if (result.status !== 'completed') {
      throw new AdvisorRepositoryError('corrupt_run_result', 500, 'advisor result status is invalid');
    }
    const answer = parseStoredAdvisorAnswer(assistant.content);
    if (advisorHash(answer) !== result.answer_hash) {
      throw new AdvisorRepositoryError('corrupt_run_result', 500, 'advisor result hash does not reconcile');
    }
    const citations = await connection<AdvisorCitation>(ADVISOR_TABLES.citations)
      .where({ tenant_id: tenantId, run_id: run.id, assistant_message_id: assistant.id })
      .orderBy('evidence_key', 'asc');
    if (citations.some((citation) =>
      (citation.source_type !== 'ceo_brief' && citation.source_type !== 'business_context')
      || !/^sha256:[0-9a-f]{64}$/.test(citation.value_hash))) {
      throw new AdvisorRepositoryError('corrupt_run_result', 500, 'advisor citation evidence is invalid');
    }
    const expectedKeys = collectAdvisorEvidenceKeys(answer);
    if (
      expectedKeys.length !== citations.length
      || expectedKeys.some((key, index) => citations[index]?.evidence_key !== key)
    ) {
      throw new AdvisorRepositoryError('corrupt_run_result', 500, 'advisor citations do not reconcile');
    }
    return { run, result, assistant_message: assistant, answer, citations };
  }

  async recordFeedback(input: {
    tenantId: string;
    runId: string;
    rating: AdvisorFeedbackRating;
    note: string | null;
  }): Promise<AdvisorFeedback> {
    return this.knex.transaction(async (trx) => {
      let runQuery = trx<AdvisorRun>(ADVISOR_TABLES.runs)
        .where({ id: input.runId, tenant_id: input.tenantId });
      if (isPostgres(this.knex)) runQuery = runQuery.forUpdate();
      const run = await runQuery.first();
      if (!run) throw new AdvisorRepositoryError('run_not_found', 404, 'advisor run was not found');
      const response = await this.loadRunResponse(trx, input.tenantId, run);
      if (!response) {
        throw new AdvisorRepositoryError('run_in_progress', 409, 'advisor run has no completed answer');
      }
      const existing = await trx<AdvisorFeedback>(ADVISOR_TABLES.feedback)
        .where({ tenant_id: input.tenantId, run_id: input.runId })
        .first();
      if (existing) {
        if (existing.rating === input.rating && existing.note === input.note) return existing;
        throw new AdvisorRepositoryError(
          'feedback_conflict',
          409,
          'feedback already exists for this run',
        );
      }
      const row: AdvisorFeedback = {
        id: uuidv4(),
        tenant_id: input.tenantId,
        run_id: input.runId,
        rating: input.rating,
        note: input.note,
        created_at: this.now(),
      };
      await trx(ADVISOR_TABLES.feedback).insert(row);
      return row;
    });
  }
}
