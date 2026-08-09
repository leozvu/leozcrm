import type {
  EgoricBriefLimitation,
  EgoricBriefStage,
} from './egoricBrief';

export const COCKPIT_SNAPSHOT_VERSION = 'leozops_cockpit_v1' as const;

export interface CockpitEvidenceItem {
  key: string;
  label: string;
  value: number | string | null;
}

export interface CockpitPriority {
  id: string;
  severity: 'info' | 'warning';
  title: string;
  rationale: string;
  confidence: 'evidence_backed';
  impact: 'pipeline_hygiene' | 'data_quality' | 'decision_quality';
  status: 'advisory_only';
  evidence: CockpitEvidenceItem[];
}

export interface CockpitSnapshot {
  version: typeof COCKPIT_SNAPSHOT_VERSION;
  tenant: { key: string; display_name: string };
  as_of: string;
  generated_at: string;
  advisory_only: true;
  freshness: {
    status: 'fresh' | 'stale' | 'future_source_timestamp';
    source_generated_at: string;
    source_received_at: string;
    age_seconds: number;
    target_seconds: number;
  };
  today: {
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
    changes: {
      status: 'unavailable';
      reason: string;
    };
    attention_count: number;
    priorities: CockpitPriority[];
  };
  business: {
    stages: EgoricBriefStage[];
    sources: Array<{ source: string | null; count: number }>;
    quality: {
      records: number;
      missing_source: number;
      missing_created_at: number;
      client_attribution: 'unavailable';
    };
  };
  recommendations: CockpitPriority[];
  limitations: EgoricBriefLimitation[];
  provenance: {
    source_system: 'egoric';
    source_snapshot_id: string;
    intelligence_run_id: string;
    formula_version: 'egoric_ceo_brief_v1';
    source_engine_version: string;
  };
  command_deck: {
    authority: 'read_only';
    approval_state: 'not_connected';
    execution_state: 'blocked';
    receipt_state: 'not_available';
    rollback_state: 'not_available';
    incident_state: 'not_available';
    kill_switch_state: 'not_exposed';
    notice: 'Approval is not execution.';
    reason: string;
  };
}
