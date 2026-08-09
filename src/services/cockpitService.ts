import {
  COCKPIT_SNAPSHOT_VERSION,
  CockpitEvidenceItem,
  CockpitPriority,
  CockpitSnapshot,
} from '../domain/cockpit';
import type { EgoricBriefObservation, EgoricCeoBrief } from '../domain/egoricBrief';
import { EgoricBriefService } from './egoricBriefService';

const RECOMMENDATION_COPY: Readonly<Record<string, {
  title: string;
  impact: CockpitPriority['impact'];
}>> = Object.freeze({
  overdue_expected_close: {
    title: 'Review overdue expected-close dates',
    impact: 'pipeline_hygiene',
  },
  unassigned_active_leads: {
    title: 'Review ownership gaps in active pipeline',
    impact: 'pipeline_hygiene',
  },
  missing_lead_source: {
    title: 'Repair missing acquisition-source evidence',
    impact: 'data_quality',
  },
  unclassified_lead_source: {
    title: 'Review withheld acquisition-source labels',
    impact: 'data_quality',
  },
  stale: {
    title: 'Refresh source evidence before deciding',
    impact: 'decision_quality',
  },
  future_source_timestamp: {
    title: 'Reconcile the future-dated source timestamp',
    impact: 'decision_quality',
  },
});

function label(key: string): string {
  return key.replace(/_/g, ' ').replace(/^./, (character) => character.toUpperCase());
}

function priority(observation: EgoricBriefObservation): CockpitPriority | null {
  const copy = RECOMMENDATION_COPY[observation.code];
  if (!copy) return null;
  const evidence: CockpitEvidenceItem[] = Object.entries(observation.evidence).map(([key, value]) => ({
    key: `brief.observation.${observation.code}.${key}`,
    label: label(key),
    value,
  }));
  return {
    id: observation.code,
    severity: observation.severity,
    title: copy.title,
    rationale: observation.summary,
    confidence: 'evidence_backed',
    impact: copy.impact,
    status: 'advisory_only',
    evidence,
  };
}

function project(brief: EgoricCeoBrief): CockpitSnapshot {
  const priorityRank: Readonly<Record<string, number>> = Object.freeze({
    future_source_timestamp: 0,
    stale: 0,
    overdue_expected_close: 1,
    unassigned_active_leads: 2,
    missing_lead_source: 3,
    unclassified_lead_source: 3,
  });
  const recommendations = brief.observations
    .map(priority)
    .filter((row): row is CockpitPriority => row !== null)
    .sort((left, right) => (priorityRank[left.id] ?? 9) - (priorityRank[right.id] ?? 9))
    .slice(0, 3);
  return {
    version: COCKPIT_SNAPSHOT_VERSION,
    tenant: brief.tenant,
    as_of: brief.as_of,
    generated_at: brief.generated_at,
    advisory_only: true,
    freshness: { ...brief.data_freshness },
    today: {
      headline: { ...brief.headline },
      changes: {
        status: 'unavailable',
        reason: 'The approved source exposes current lead state without durable stage history.',
      },
      attention_count: recommendations.length,
      priorities: recommendations,
    },
    business: {
      stages: brief.stages.map((stage) => ({ ...stage })),
      sources: brief.sources.map((source) => ({ ...source })),
      quality: { ...brief.quality },
    },
    recommendations,
    limitations: brief.known_limitations.map((row) => ({ ...row })),
    provenance: {
      source_system: brief.source.system,
      source_snapshot_id: brief.source_snapshot_id,
      intelligence_run_id: brief.intelligence_run_id,
      formula_version: brief.formula_version,
      source_engine_version: brief.source_engine_version,
    },
    command_deck: {
      authority: 'read_only',
      approval_state: 'not_connected',
      execution_state: 'blocked',
      receipt_state: 'not_available',
      rollback_state: 'not_available',
      incident_state: 'not_available',
      kill_switch_state: 'not_exposed',
      notice: 'Approval is not execution.',
      reason: 'This cockpit has no route to an action adapter. Phase 3-8 gates remain authoritative.',
    },
  };
}

export class CockpitService {
  constructor(private readonly brief: EgoricBriefService) {}

  async snapshot(tenantKey: string, asOf?: string): Promise<CockpitSnapshot> {
    return project(await this.brief.generate(tenantKey, asOf));
  }
}
