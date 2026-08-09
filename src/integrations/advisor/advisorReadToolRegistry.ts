import { AdvisorEvidenceItem, AdvisorEvidencePack } from '../../domain/advisorConversation';

export type AdvisorReadToolId =
  | 'pipeline_summary'
  | 'funnel_state'
  | 'source_mix'
  | 'freshness'
  | 'limitations'
  | 'business_context';

export interface AdvisorReadToolDescriptor {
  id: AdvisorReadToolId;
  description: string;
  exact_keys: readonly string[];
  key_prefixes: readonly string[];
}

const TOOLS: readonly AdvisorReadToolDescriptor[] = [
  {
    id: 'pipeline_summary',
    description: 'Current deterministic headline metrics from the accepted CEO Brief.',
    exact_keys: [
      'brief.headline.total_leads',
      'brief.headline.active_pipeline',
      'brief.headline.won',
      'brief.headline.lost',
      'brief.headline.closed',
      'brief.headline.win_rate',
      'brief.headline.active_estimated_value',
      'brief.headline.active_owner_coverage',
      'brief.headline.overdue_expected_close',
    ],
    key_prefixes: [],
  },
  {
    id: 'funnel_state',
    description: 'Current stage counts and attributes; no historical transitions.',
    exact_keys: [],
    key_prefixes: ['brief.stage.'],
  },
  {
    id: 'source_mix',
    description: 'Presentation-safe current source counts.',
    exact_keys: [],
    key_prefixes: ['brief.source.'],
  },
  {
    id: 'freshness',
    description: 'Source freshness and generated-time evidence.',
    exact_keys: [],
    key_prefixes: ['brief.freshness.'],
  },
  {
    id: 'limitations',
    description: 'Known limitations attached to the deterministic brief.',
    exact_keys: [],
    key_prefixes: ['brief.limitation.'],
  },
  {
    id: 'business_context',
    description: 'Founder-recorded active goals, constraints, and decisions.',
    exact_keys: [],
    key_prefixes: ['context.'],
  },
] as const;

/** Fixed evidence projection only: no SQL, HTTP, filesystem, or action tool. */
export class AdvisorReadToolRegistry {
  list(): readonly AdvisorReadToolDescriptor[] {
    return TOOLS;
  }

  read(toolId: AdvisorReadToolId, evidence: AdvisorEvidencePack): AdvisorEvidenceItem[] {
    const tool = TOOLS.find((candidate) => candidate.id === toolId);
    if (!tool) throw new Error('unsupported Advisor read tool');
    const exact = new Set(tool.exact_keys);
    return evidence.items.filter((item) =>
      exact.has(item.key) || tool.key_prefixes.some((prefix) => item.key.startsWith(prefix)));
  }
}
