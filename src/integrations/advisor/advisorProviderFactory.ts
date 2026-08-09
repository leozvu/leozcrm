import type { AdvisorModelProvider } from '../../domain/advisorConversation';
import { DeterministicAdvisorProvider } from './deterministicAdvisorProvider';
import {
  OPENAI_ADVISOR_MAX_OUTPUT_TOKENS,
  OpenAIResponsesAdvisorProvider,
} from './openaiResponsesAdvisorProvider';

export type AdvisorProviderEnvironment = Record<string, string | undefined>;

function optionalInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  if (!/^\d+$/.test(value.trim())) throw new Error(`${name} must be an integer`);
  const parsed = Number(value.trim());
  if (!Number.isSafeInteger(parsed)) throw new Error(`${name} must be a safe integer`);
  return parsed;
}

/**
 * Composition stays deterministic unless the operator explicitly selects the
 * reviewed OpenAI adapter and supplies its secret out of band.
 */
export function buildAdvisorProviderFromEnv(
  env: AdvisorProviderEnvironment = process.env,
): AdvisorModelProvider {
  const selected = (env.LEOZOPS_ADVISOR_PROVIDER ?? 'deterministic').trim().toLowerCase();
  if (selected === 'deterministic') return new DeterministicAdvisorProvider();
  if (selected !== 'openai') {
    throw new Error('LEOZOPS_ADVISOR_PROVIDER must be deterministic or openai');
  }
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('OPENAI_API_KEY is required when LEOZOPS_ADVISOR_PROVIDER=openai');
  }
  return new OpenAIResponsesAdvisorProvider({
    apiKey,
    maxOutputTokens: optionalInteger(
      env.LEOZOPS_OPENAI_MAX_OUTPUT_TOKENS,
      'LEOZOPS_OPENAI_MAX_OUTPUT_TOKENS',
    ) ?? OPENAI_ADVISOR_MAX_OUTPUT_TOKENS,
  });
}
