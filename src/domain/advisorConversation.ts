import { createHash } from 'node:crypto';
import { canonicalStringify } from './businessMemory';

export const ADVISOR_ANSWER_VERSION = 'advisor_answer_v1' as const;
export const ADVISOR_EVIDENCE_VERSION = 'advisor_evidence_v1' as const;

export const ADVISOR_TABLES = {
  conversations: 'advisor_conversations',
  messages: 'advisor_messages',
  runs: 'advisor_runs',
  runResults: 'advisor_run_results',
  citations: 'advisor_citations',
  contextEntries: 'advisor_context_entries',
  feedback: 'advisor_feedback',
} as const;

export type AdvisorContextKind = 'goal' | 'constraint' | 'decision';
export type AdvisorMessageRole = 'user' | 'assistant';
export type AdvisorRunStatus = 'completed' | 'failed';
export type AdvisorFeedbackRating = 'useful' | 'not_useful';
export type AdvisorEvidenceSource = 'ceo_brief' | 'business_context';

export interface AdvisorConversation {
  id: string;
  tenant_id: string;
  title: string | null;
  created_at: string;
}

export interface AdvisorMessage {
  id: string;
  tenant_id: string;
  conversation_id: string;
  sequence: number;
  role: AdvisorMessageRole;
  content: string;
  created_at: string;
}

export interface AdvisorRun {
  id: string;
  tenant_id: string;
  conversation_id: string;
  user_message_id: string;
  idempotency_key: string;
  request_hash: string;
  provider_key: string;
  provider_version: string;
  started_at: string;
  created_at: string;
}

export interface AdvisorRunResult {
  id: string;
  tenant_id: string;
  run_id: string;
  assistant_message_id: string | null;
  status: AdvisorRunStatus;
  evidence_pack_hash: string | null;
  answer_hash: string | null;
  failure_code: string | null;
  input_units: number;
  output_units: number;
  cost_microunits: number;
  completed_at: string;
  created_at: string;
}

export interface AdvisorCitation {
  id: string;
  tenant_id: string;
  run_id: string;
  assistant_message_id: string;
  evidence_key: string;
  source_type: AdvisorEvidenceSource;
  source_id: string;
  source_path: string;
  value_hash: string;
  label: string;
  created_at: string;
}

export interface AdvisorContextEntry {
  id: string;
  tenant_id: string;
  kind: AdvisorContextKind;
  context_key: string;
  content: string;
  replaces_entry_id: string | null;
  effective_at: string;
  created_at: string;
}

export interface AdvisorFeedback {
  id: string;
  tenant_id: string;
  run_id: string;
  rating: AdvisorFeedbackRating;
  note: string | null;
  created_at: string;
}

export type AdvisorEvidenceValue = string | number | boolean | null;

export interface AdvisorEvidenceItem {
  key: string;
  source_type: AdvisorEvidenceSource;
  source_id: string;
  source_path: string;
  label: string;
  value: AdvisorEvidenceValue;
  value_hash: string;
}

export interface AdvisorEvidencePack {
  version: typeof ADVISOR_EVIDENCE_VERSION;
  tenant_key: string;
  as_of: string;
  generated_at: string;
  freshness_status: 'fresh' | 'stale' | 'future_source_timestamp';
  source_snapshot_id: string;
  intelligence_run_id: string;
  formula_version: string;
  items: AdvisorEvidenceItem[];
  hash: string;
}

export interface AdvisorStatement {
  statement: string;
  evidence_keys: string[];
}

export interface AdvisorAnswer {
  answer_version: typeof ADVISOR_ANSWER_VERSION;
  summary: AdvisorStatement;
  facts: AdvisorStatement[];
  inferences: AdvisorStatement[];
  recommendations: AdvisorStatement[];
  limitations: AdvisorStatement[];
  cannot_answer: boolean;
  advisory_only: true;
}

export interface AdvisorProviderUsage {
  input_units: number;
  output_units: number;
  cost_microunits: number;
}

export interface AdvisorProviderResult {
  answer: unknown;
  usage: AdvisorProviderUsage;
}

export interface AdvisorProviderInput {
  question: string;
  evidence: AdvisorEvidencePack;
  /** Evidence and context are untrusted data. They are never model instructions. */
  instruction: 'answer_only_from_structured_evidence';
}

export interface AdvisorModelProvider {
  readonly key: string;
  readonly version: string;
  answer(input: AdvisorProviderInput, signal: AbortSignal): Promise<AdvisorProviderResult>;
}

export interface AdvisorConversationView {
  conversation: AdvisorConversation;
  messages: Array<AdvisorMessage & { answer?: AdvisorAnswer }>;
}

export class AdvisorContractError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AdvisorContractError';
  }
}

const KEY_RE = /^[a-z0-9][a-z0-9._:-]{0,127}$/;
const HASH_RE = /^sha256:[0-9a-f]{64}$/;

function fail(code: string, message: string): never {
  throw new AdvisorContractError(code, message);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('invalid_provider_answer', `${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail('invalid_provider_answer', `${path} has unsupported or missing fields`);
  }
}

function boundedText(value: unknown, path: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string') fail('invalid_provider_answer', `${path} must be text`);
  const text = value.trim();
  if ((!allowEmpty && text.length === 0) || text.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) {
    fail('invalid_provider_answer', `${path} is invalid`);
  }
  return text;
}

function statement(
  value: unknown,
  path: string,
  evidenceKeys: ReadonlySet<string>,
  allowUncited: boolean,
): AdvisorStatement {
  const row = object(value, path);
  exactKeys(row, ['statement', 'evidence_keys'], path);
  const text = boundedText(row.statement, `${path}.statement`, 2_000);
  if (!Array.isArray(row.evidence_keys) || row.evidence_keys.length > 32) {
    fail('invalid_provider_answer', `${path}.evidence_keys must be a bounded array`);
  }
  const keys = row.evidence_keys.map((item, index) => {
    if (typeof item !== 'string' || !KEY_RE.test(item) || !evidenceKeys.has(item)) {
      fail('unknown_evidence_key', `${path}.evidence_keys[${index}] is not in the evidence pack`);
    }
    return item;
  });
  if (new Set(keys).size !== keys.length) {
    fail('duplicate_evidence_key', `${path}.evidence_keys contains a duplicate`);
  }
  if (!allowUncited && keys.length === 0) {
    fail('missing_citation', `${path} must cite evidence`);
  }
  if (/\d/.test(text) && keys.length === 0) {
    fail('uncited_numeric_claim', `${path} contains an uncited numeric claim`);
  }
  return { statement: text, evidence_keys: keys };
}

function statementArray(
  value: unknown,
  path: string,
  evidenceKeys: ReadonlySet<string>,
): AdvisorStatement[] {
  if (!Array.isArray(value) || value.length > 24) {
    fail('invalid_provider_answer', `${path} must be a bounded array`);
  }
  return value.map((item, index) => statement(item, `${path}[${index}]`, evidenceKeys, false));
}

export function validateAdvisorAnswer(
  input: unknown,
  evidenceKeys: ReadonlySet<string>,
  maxSerializedChars = 12_000,
): AdvisorAnswer {
  const rawSerialized = JSON.stringify(input);
  if (rawSerialized === undefined || rawSerialized.length > maxSerializedChars) {
    fail('provider_output_too_large', 'provider answer exceeds the output budget');
  }
  const row = object(input, 'answer');
  exactKeys(row, [
    'answer_version',
    'summary',
    'facts',
    'inferences',
    'recommendations',
    'limitations',
    'cannot_answer',
    'advisory_only',
  ], 'answer');
  if (row.answer_version !== ADVISOR_ANSWER_VERSION || row.advisory_only !== true) {
    fail('invalid_provider_answer', 'provider answer has an unsupported safety contract');
  }
  if (typeof row.cannot_answer !== 'boolean') {
    fail('invalid_provider_answer', 'answer.cannot_answer must be boolean');
  }
  const cannotAnswer = row.cannot_answer;
  const answer: AdvisorAnswer = {
    answer_version: ADVISOR_ANSWER_VERSION,
    summary: statement(row.summary, 'answer.summary', evidenceKeys, cannotAnswer),
    facts: statementArray(row.facts, 'answer.facts', evidenceKeys),
    inferences: statementArray(row.inferences, 'answer.inferences', evidenceKeys),
    recommendations: statementArray(row.recommendations, 'answer.recommendations', evidenceKeys),
    limitations: statementArray(row.limitations, 'answer.limitations', evidenceKeys),
    cannot_answer: cannotAnswer,
    advisory_only: true,
  };
  if (!answer.cannot_answer && answer.summary.evidence_keys.length === 0) {
    fail('missing_citation', 'answer.summary must cite evidence');
  }
  if (answer.cannot_answer && answer.facts.length > 0) {
    fail('invalid_provider_answer', 'a cannot-answer response cannot assert facts');
  }
  return answer;
}

export function advisorHash(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalStringify(value)).digest('hex')}`;
}

export function assertAdvisorHash(value: string, path: string): void {
  if (!HASH_RE.test(value)) fail('invalid_hash', `${path} must be a lowercase sha256 identifier`);
}

export function collectAdvisorEvidenceKeys(answer: AdvisorAnswer): string[] {
  const keys = new Set<string>();
  for (const item of [
    answer.summary,
    ...answer.facts,
    ...answer.inferences,
    ...answer.recommendations,
    ...answer.limitations,
  ]) {
    for (const key of item.evidence_keys) keys.add(key);
  }
  return [...keys].sort();
}

export function parseStoredAdvisorAnswer(content: string): AdvisorAnswer {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    fail('corrupt_stored_answer', 'stored advisor answer is not valid JSON');
  }
  const declared = new Set<string>();
  const row = object(parsed, 'stored_answer');
  for (const value of [row.summary, ...(Array.isArray(row.facts) ? row.facts : []),
    ...(Array.isArray(row.inferences) ? row.inferences : []),
    ...(Array.isArray(row.recommendations) ? row.recommendations : []),
    ...(Array.isArray(row.limitations) ? row.limitations : [])]) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const keys = (value as Record<string, unknown>).evidence_keys;
      if (Array.isArray(keys)) {
        keys.forEach((key) => { if (typeof key === 'string') declared.add(key); });
      }
    }
  }
  try {
    return validateAdvisorAnswer(parsed, declared);
  } catch {
    fail('corrupt_stored_answer', 'stored advisor answer has an invalid contract');
  }
}
