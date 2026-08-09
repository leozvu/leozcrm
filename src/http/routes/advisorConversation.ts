import express, { Request, Response, Router } from 'express';
import { AdvisorAnswer } from '../../domain/advisorConversation';
import { AdvisorAskResponse, AdvisorConversationService } from '../../services/advisorConversationService';
import { asyncHandler } from '../asyncHandler';
import { enforceTenantReadScope } from '../integrationReadAuth';

function body(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function hasOnly(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function conversation(row: { id: string; title: string | null; created_at: string }) {
  return { id: row.id, title: row.title, created_at: row.created_at };
}

function answerMessage(row: {
  id: string;
  sequence: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  answer?: AdvisorAnswer;
}) {
  return row.role === 'assistant'
    ? { id: row.id, sequence: row.sequence, role: row.role, answer: row.answer, created_at: row.created_at }
    : { id: row.id, sequence: row.sequence, role: row.role, content: row.content, created_at: row.created_at };
}

function askResponse(output: AdvisorAskResponse) {
  return {
    run: {
      id: output.run.id,
      provider_key: output.run.provider_key,
      provider_version: output.run.provider_version,
      started_at: output.run.started_at,
      status: output.result.status,
      completed_at: output.result.completed_at,
      usage: {
        input_units: output.result.input_units,
        output_units: output.result.output_units,
        cost_microunits: output.result.cost_microunits,
      },
    },
    message: answerMessage({ ...output.assistant_message, answer: output.answer }),
    citations: output.citations.map((citation) => ({
      evidence_key: citation.evidence_key,
      source_type: citation.source_type,
      source_id: citation.source_id,
      source_path: citation.source_path,
      value_hash: citation.value_hash,
      label: citation.label,
    })),
    replayed: output.replayed,
    advisory_only: true,
  };
}

export function createAdvisorConversationRouter(service: AdvisorConversationService): Router {
  const router = Router();
  const parseJson = express.json({ limit: '32kb', strict: true });

  router.post('/:tenantKey/conversations', parseJson, asyncHandler(async (req: Request, res: Response) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    const input = body(req.body);
    if (!hasOnly(input, ['title'])) {
      res.status(400).json({ error: 'request has unsupported fields', code: 'invalid_input' });
      return;
    }
    const created = await service.createConversation(tenantKey, input.title);
    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json({ conversation: conversation(created) });
  }));

  router.get('/:tenantKey/conversations/:conversationId', asyncHandler(async (req, res) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    const view = await service.getConversation(tenantKey, req.params.conversationId);
    res.setHeader('Cache-Control', 'private, no-cache');
    res.json({
      conversation: conversation(view.conversation),
      messages: view.messages.map(answerMessage),
    });
  }));

  router.post('/:tenantKey/conversations/:conversationId/messages', parseJson, asyncHandler(async (req, res) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    const input = body(req.body);
    if (!hasOnly(input, ['question', 'asOf'])) {
      res.status(400).json({ error: 'request has unsupported fields', code: 'invalid_input' });
      return;
    }
    const rawKey = req.header('Idempotency-Key');
    if (!rawKey) {
      res.status(400).json({ error: 'Idempotency-Key is required', code: 'missing_idempotency_key' });
      return;
    }
    const output = await service.ask(tenantKey, {
      conversationId: req.params.conversationId,
      idempotencyKey: rawKey,
      question: input.question,
      asOf: input.asOf,
    });
    res.setHeader('Cache-Control', 'no-store');
    res.status(output.replayed ? 200 : 201).json(askResponse(output));
  }));

  router.get('/:tenantKey/context', asyncHandler(async (req, res) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    const entries = await service.listContext(tenantKey);
    res.setHeader('Cache-Control', 'private, no-cache');
    res.json({
      entries: entries.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        key: entry.context_key,
        content: entry.content,
        replaces_entry_id: entry.replaces_entry_id,
        effective_at: entry.effective_at,
        created_at: entry.created_at,
      })),
    });
  }));

  router.post('/:tenantKey/context', parseJson, asyncHandler(async (req, res) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    const input = body(req.body);
    if (!hasOnly(input, ['kind', 'key', 'content', 'replacesEntryId', 'effectiveAt'])) {
      res.status(400).json({ error: 'request has unsupported fields', code: 'invalid_input' });
      return;
    }
    const entry = await service.appendContext(tenantKey, {
      kind: input.kind,
      contextKey: input.key,
      content: input.content,
      replacesEntryId: input.replacesEntryId,
      effectiveAt: input.effectiveAt,
    });
    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json({
      entry: {
        id: entry.id,
        kind: entry.kind,
        key: entry.context_key,
        content: entry.content,
        replaces_entry_id: entry.replaces_entry_id,
        effective_at: entry.effective_at,
        created_at: entry.created_at,
      },
    });
  }));

  router.post('/:tenantKey/feedback', parseJson, asyncHandler(async (req, res) => {
    const tenantKey = req.params.tenantKey;
    if (!enforceTenantReadScope(req, res, tenantKey)) return;
    const input = body(req.body);
    if (!hasOnly(input, ['runId', 'rating', 'note'])) {
      res.status(400).json({ error: 'request has unsupported fields', code: 'invalid_input' });
      return;
    }
    const feedback = await service.recordFeedback(tenantKey, {
      runId: typeof input.runId === 'string' ? input.runId : '',
      rating: input.rating,
      note: input.note,
    });
    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json({
      feedback: {
        id: feedback.id,
        run_id: feedback.run_id,
        rating: feedback.rating,
        note: feedback.note,
        created_at: feedback.created_at,
      },
    });
  }));

  return router;
}
