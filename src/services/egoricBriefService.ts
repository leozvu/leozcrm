import {
  EGORIC_ACTIVE_STAGES,
  EGORIC_SCHEMA_VERSION,
  EGORIC_STAGES,
  EGORIC_TERMINAL_OUTCOMES,
  EgoricSalesLead,
  EgoricSalesV1Snapshot,
  SourceSnapshot,
  Tenant,
  IntelligenceRun,
  validateEgoricSalesV1Snapshot,
} from '../domain/businessMemory';
import {
  EGORIC_BRIEF_FORMULA_VERSION,
  EGORIC_FRESHNESS_TARGET_SECONDS,
  EgoricBriefLimitation,
  EgoricBriefObservation,
  EgoricBriefStage,
  EgoricCeoBrief,
} from '../domain/egoricBrief';
import {
  BusinessMemoryRepository,
  SnapshotRun,
} from '../repositories/businessMemoryRepository';

const TENANT_KEY_RE = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
const SAFE_SOURCE_LABELS = new Map([
  'ads',
  'facebook',
  'tiktok',
  'website',
  'youtube',
  'zalo',
  'webinar',
  'livestream',
  'referral',
  'partner',
  'seo',
  'organic',
  'direct',
  'offline',
  'other',
].map((label) => [label, label[0].toUpperCase() + label.slice(1)]));

export class EgoricBriefError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: 400 | 404 | 409 | 500,
    message: string,
  ) {
    super(message);
    this.name = 'EgoricBriefError';
  }
}

function iso(value: string, code: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new EgoricBriefError(code, 409, 'stored brief provenance is invalid');
  }
  return date.toISOString();
}

/** Normalize a deterministic query cutoff; date-only means end of that UTC day. */
export function normalizeBriefAsOf(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const start = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(start.getTime()) || start.toISOString().slice(0, 10) !== value) {
      throw new EgoricBriefError('invalid_as_of', 400, 'asOf must be a valid UTC date or timestamp');
    }
    return `${value}T23:59:59.999Z`;
  }
  if (!/T/.test(value) || !/(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    throw new EgoricBriefError('invalid_as_of', 400, 'asOf must include an explicit timezone');
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new EgoricBriefError('invalid_as_of', 400, 'asOf must be a valid UTC date or timestamp');
  }
  return parsed.toISOString();
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function sum(leads: EgoricSalesLead[], select: (lead: EgoricSalesLead) => number): number {
  let total = 0;
  for (const lead of leads) {
    total += select(lead);
    if (!Number.isFinite(total)) {
      throw new EgoricBriefError('numeric_overflow', 409, 'stored values cannot be aggregated safely');
    }
  }
  return total;
}

function presentableSource(value: string | null): string | null {
  if (value === null) return null;
  return SAFE_SOURCE_LABELS.get(value.trim().toLowerCase()) ?? 'unclassified';
}

function ensureStoredIdentity(
  snapshotRow: SourceSnapshot,
  run: IntelligenceRun,
  snapshot: EgoricSalesV1Snapshot,
): void {
  if (
    snapshotRow.snapshot_id !== snapshot.snapshot_id
    || snapshotRow.schema_version !== snapshot.schema_version
    || snapshotRow.source_system !== snapshot.source.system
    || snapshotRow.source_tenant_key !== snapshot.source.tenant_key
    || snapshotRow.record_count !== snapshot.leads.length
    || run.source_snapshot_id !== snapshotRow.id
    || run.snapshot_id !== snapshot.snapshot_id
    || run.status !== 'accepted'
  ) {
    throw new EgoricBriefError(
      'business_memory_integrity_failure',
      409,
      'stored snapshot provenance does not reconcile',
    );
  }
}

export class EgoricBriefService {
  constructor(private readonly memory: BusinessMemoryRepository) {}

  async generate(tenantKey: string, requestedAsOf?: string): Promise<EgoricCeoBrief> {
    if (!TENANT_KEY_RE.test(tenantKey)) {
      throw new EgoricBriefError('invalid_tenant_key', 400, 'tenant key is invalid');
    }
    const tenant = await this.memory.findTenantByKey(tenantKey);
    if (!tenant) throw new EgoricBriefError('tenant_not_found', 404, 'tenant was not found');

    const cutoff = requestedAsOf === undefined ? undefined : normalizeBriefAsOf(requestedAsOf);
    const stored = await this.memory.findLatestSnapshotRunForTenant(tenant.id, cutoff);
    if (!stored) {
      throw new EgoricBriefError('brief_not_available', 404, 'no accepted snapshot is available');
    }

    return this.build(tenant, stored, cutoff);
  }

  private build(tenant: Tenant, stored: SnapshotRun, cutoff?: string): EgoricCeoBrief {
    let raw: unknown;
    try {
      raw = JSON.parse(stored.snapshot.payload_json);
    } catch {
      throw new EgoricBriefError('invalid_stored_snapshot', 409, 'stored snapshot is not valid JSON');
    }

    let snapshot: EgoricSalesV1Snapshot;
    try {
      snapshot = validateEgoricSalesV1Snapshot(raw, stored.snapshot.source_tenant_key);
    } catch {
      throw new EgoricBriefError('invalid_stored_snapshot', 409, 'stored snapshot failed validation');
    }
    ensureStoredIdentity(stored.snapshot, stored.run, snapshot);

    const asOf = cutoff ?? iso(stored.run.as_of, 'invalid_run_as_of');
    const generatedAt = iso(stored.run.created_at, 'invalid_run_created_at');
    const sourceGeneratedAt = iso(snapshot.generated_at, 'invalid_source_generated_at');
    const sourceReceivedAt = iso(stored.snapshot.received_at, 'invalid_source_received_at');
    const ageSeconds = Math.floor((Date.parse(asOf) - Date.parse(sourceGeneratedAt)) / 1_000);
    const freshnessStatus = ageSeconds < 0
      ? 'future_source_timestamp'
      : ageSeconds <= EGORIC_FRESHNESS_TARGET_SECONDS
        ? 'fresh'
        : 'stale';

    const activeSet = new Set<string>(EGORIC_ACTIVE_STAGES);
    const activeLeads = snapshot.leads.filter((lead) => activeSet.has(lead.stage));
    const won = snapshot.leads.filter((lead) => lead.stage === 'won').length;
    const lost = snapshot.leads.filter((lead) => lead.stage === 'lost').length;
    const closed = won + lost;
    const overdue = activeLeads.filter((lead) =>
      lead.expected_close_at !== null && Date.parse(lead.expected_close_at) < Date.parse(asOf)).length;
    const assignedActive = activeLeads.filter((lead) => lead.owner_assigned).length;

    const stages: EgoricBriefStage[] = EGORIC_STAGES.map((stage) => {
      const leads = snapshot.leads.filter((lead) => lead.stage === stage);
      return {
        stage,
        kind: activeSet.has(stage) ? 'active' : 'terminal',
        count: leads.length,
        estimated_value: sum(leads, (lead) => lead.estimated_value ?? 0),
        owner_assigned: leads.filter((lead) => lead.owner_assigned).length,
        overdue_expected_close: activeSet.has(stage)
          ? leads.filter((lead) =>
            lead.expected_close_at !== null && Date.parse(lead.expected_close_at) < Date.parse(asOf)).length
          : 0,
      };
    });

    const sourceCounts = new Map<string | null, number>();
    let unclassifiedSources = 0;
    for (const lead of snapshot.leads) {
      const source = presentableSource(lead.source);
      if (source === 'unclassified' && lead.source !== 'unclassified') unclassifiedSources += 1;
      sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
    }
    const sources = [...sourceCounts.entries()]
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count || (a.source ?? '').localeCompare(b.source ?? ''));

    const observations = this.observations({
      total: snapshot.leads.length,
      active: activeLeads.length,
      won,
      lost,
      overdue,
      unassignedActive: activeLeads.length - assignedActive,
      missingSource: snapshot.quality.missing_source,
      unclassifiedSources,
      freshnessStatus,
      ageSeconds,
    });
    const knownLimitations = this.limitations(snapshot, freshnessStatus, unclassifiedSources);

    return {
      tenant: { key: tenant.tenant_key, display_name: tenant.display_name },
      as_of: asOf,
      generated_at: generatedAt,
      source_snapshot_id: snapshot.snapshot_id,
      intelligence_run_id: stored.run.id,
      formula_version: EGORIC_BRIEF_FORMULA_VERSION,
      source_engine_version: stored.run.engine_version,
      source: {
        system: 'egoric',
        tenant_key: snapshot.source.tenant_key,
        schema_version: EGORIC_SCHEMA_VERSION,
      },
      data_freshness: {
        source_generated_at: sourceGeneratedAt,
        source_received_at: sourceReceivedAt,
        age_seconds: ageSeconds,
        target_seconds: EGORIC_FRESHNESS_TARGET_SECONDS,
        status: freshnessStatus,
      },
      funnel_definition: snapshot.funnel_definition,
      headline: {
        total_leads: snapshot.leads.length,
        active_pipeline: activeLeads.length,
        won,
        lost,
        closed,
        win_rate: closed === 0 ? null : round4(won / closed),
        active_estimated_value: sum(activeLeads, (lead) => lead.estimated_value ?? 0),
        estimated_value_currency: null,
        active_owner_coverage: activeLeads.length === 0
          ? null
          : round4(assignedActive / activeLeads.length),
        overdue_expected_close: overdue,
      },
      stages,
      sources,
      quality: snapshot.quality,
      observations,
      known_limitations: knownLimitations,
      advisory_only: true,
    };
  }

  private observations(input: {
    total: number;
    active: number;
    won: number;
    lost: number;
    overdue: number;
    unassignedActive: number;
    missingSource: number;
    unclassifiedSources: number;
    freshnessStatus: 'fresh' | 'stale' | 'future_source_timestamp';
    ageSeconds: number;
  }): EgoricBriefObservation[] {
    const rows: EgoricBriefObservation[] = [{
      code: 'current_pipeline_state',
      severity: 'info',
      summary: 'Current-state pipeline and outcomes from the accepted Egoric snapshot.',
      evidence: {
        total_leads: input.total,
        active_pipeline: input.active,
        won: input.won,
        lost: input.lost,
      },
    }];
    if (input.overdue > 0) rows.push({
      code: 'overdue_expected_close',
      severity: 'warning',
      summary: 'Active leads have an expected close time before the brief cutoff.',
      evidence: { leads: input.overdue },
    });
    if (input.unassignedActive > 0) rows.push({
      code: 'unassigned_active_leads',
      severity: 'warning',
      summary: 'Active leads are currently missing an assigned owner.',
      evidence: { leads: input.unassignedActive },
    });
    if (input.missingSource > 0) rows.push({
      code: 'missing_lead_source',
      severity: 'info',
      summary: 'Some lead source values are unavailable in the accepted snapshot.',
      evidence: { leads: input.missingSource },
    });
    if (input.unclassifiedSources > 0) rows.push({
      code: 'unclassified_lead_source',
      severity: 'warning',
      summary: 'Source labels outside the safe presentation format were withheld.',
      evidence: { leads: input.unclassifiedSources },
    });
    if (input.freshnessStatus !== 'fresh') rows.push({
      code: input.freshnessStatus,
      severity: 'warning',
      summary: input.freshnessStatus === 'stale'
        ? 'The source snapshot is older than the 30-minute freshness target.'
        : 'The source timestamp is later than the requested brief cutoff.',
      evidence: { age_seconds: input.ageSeconds },
    });
    if (input.won + input.lost === 0) rows.push({
      code: 'no_closed_outcomes',
      severity: 'info',
      summary: 'No won or lost outcomes are present, so win rate is undefined.',
      evidence: { closed: 0 },
    });
    return rows;
  }

  private limitations(
    snapshot: EgoricSalesV1Snapshot,
    freshnessStatus: 'fresh' | 'stale' | 'future_source_timestamp',
    unclassifiedSources: number,
  ): EgoricBriefLimitation[] {
    const rows: EgoricBriefLimitation[] = [
      {
        code: 'current_state_only',
        message: 'Egoric exposes current lead state without durable stage history; this brief makes no historical conversion claim.',
      },
      {
        code: 'client_attribution_unavailable',
        message: 'The source contract has no client attribution; this is a company-wide view.',
      },
      {
        code: 'campaign_and_spend_unavailable',
        message: 'Campaign delivery, spend, and attribution are not present in this source contract.',
      },
      {
        code: 'estimated_value_currency_unavailable',
        message: 'Estimated values have no currency metadata and must not be presented as a named currency.',
      },
    ];
    if (snapshot.quality.missing_created_at > 0) rows.push({
      code: 'missing_created_at',
      message: `${snapshot.quality.missing_created_at} lead record(s) have no created_at value.`,
    });
    if (snapshot.quality.missing_source > 0) rows.push({
      code: 'missing_source',
      message: `${snapshot.quality.missing_source} lead record(s) have no source value.`,
    });
    if (unclassifiedSources > 0) rows.push({
      code: 'unclassified_source',
      message: `${unclassifiedSources} source label(s) were withheld because they were unsafe to present.`,
    });
    if (freshnessStatus !== 'fresh') rows.push({
      code: freshnessStatus,
      message: freshnessStatus === 'stale'
        ? 'The snapshot is beyond the 30-minute freshness target.'
        : 'The snapshot source timestamp is later than the brief cutoff.',
    });
    return rows;
  }
}
