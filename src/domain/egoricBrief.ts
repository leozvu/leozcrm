import type { EgoricLeadStage } from './businessMemory';

export const EGORIC_BRIEF_FORMULA_VERSION = 'egoric_ceo_brief_v1' as const;
export const EGORIC_FRESHNESS_TARGET_SECONDS = 30 * 60;

export interface EgoricBriefStage {
  stage: EgoricLeadStage;
  kind: 'active' | 'terminal';
  count: number;
  estimated_value: number;
  owner_assigned: number;
  overdue_expected_close: number;
}

export interface EgoricBriefObservation {
  code: string;
  severity: 'info' | 'warning';
  summary: string;
  evidence: Record<string, number | string | null>;
}

export interface EgoricBriefLimitation {
  code: string;
  message: string;
}

export interface EgoricCeoBrief {
  tenant: {
    key: string;
    display_name: string;
  };
  as_of: string;
  generated_at: string;
  source_snapshot_id: string;
  intelligence_run_id: string;
  formula_version: typeof EGORIC_BRIEF_FORMULA_VERSION;
  source_engine_version: string;
  source: {
    system: 'egoric';
    tenant_key: string;
    schema_version: '1.0';
  };
  data_freshness: {
    source_generated_at: string;
    source_received_at: string;
    age_seconds: number;
    target_seconds: typeof EGORIC_FRESHNESS_TARGET_SECONDS;
    status: 'fresh' | 'stale' | 'future_source_timestamp';
  };
  funnel_definition: {
    id: 'egoric_sales_v1';
    active_stages: ['new', 'contacted', 'proposal', 'negotiation'];
    terminal_outcomes: ['won', 'lost'];
    historical_transitions_available: false;
  };
  headline: {
    total_leads: number;
    active_pipeline: number;
    won: number;
    lost: number;
    closed: number;
    win_rate: number | null;
    active_estimated_value: number;
    estimated_value_currency: null;
    active_owner_coverage: number | null;
    overdue_expected_close: number;
  };
  stages: EgoricBriefStage[];
  sources: Array<{ source: string | null; count: number }>;
  quality: {
    records: number;
    missing_source: number;
    missing_created_at: number;
    client_attribution: 'unavailable';
  };
  observations: EgoricBriefObservation[];
  known_limitations: EgoricBriefLimitation[];
  advisory_only: true;
}
