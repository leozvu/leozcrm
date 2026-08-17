import {
  JARVIS_EXPORT_SCHEMA,
  JARVIS_RETENTION_POLICY,
  JarvisV1Error,
  jarvisV1Hash,
  validateJarvisDataRequest,
} from '../domain/jarvisV1';
import { AmbientJarvisRepository } from '../repositories/ambientJarvisRepository';
import { BusinessMemoryRepository } from '../repositories/businessMemoryRepository';
import { JarvisV1Repository } from '../repositories/jarvisV1Repository';
import { defaultAmbientJarvisPreferences, parseAmbientJarvisPreferenceRecord } from '../domain/ambientJarvis';
import { VoiceSessionRepository } from '../repositories/voiceSessionRepository';

export class JarvisV1Service {
  constructor(
    private readonly repository: JarvisV1Repository,
    private readonly memory: BusinessMemoryRepository,
    private readonly preferences: AmbientJarvisRepository,
    private readonly clock: () => Date = () => new Date(),
    private readonly voice?: VoiceSessionRepository,
  ) {}

  private async tenant(tenantKey: string) {
    const tenant = await this.memory.findTenantByKey(tenantKey);
    if (!tenant) throw new JarvisV1Error('tenant_not_found', 'tenant was not found', 404);
    return tenant;
  }

  async evaluation(tenantKey: string, days = 30) {
    const tenant = await this.tenant(tenantKey);
    return this.repository.evaluation(tenant.id, days);
  }

  async readiness(tenantKey: string, days = 30) {
    const tenant = await this.tenant(tenantKey);
    const [evaluation, voiceQuality] = await Promise.all([
      this.repository.evaluation(tenant.id, days),
      this.voice ? this.voice.quality(tenant.id, days) : Promise.resolve(null),
    ]);
    const voiceBlockers = voiceQuality?.candidate_status === 'meets_candidate_thresholds'
      ? [] : ['voice_candidate_quality_not_met'];
    const checkpoints = [
      ['J1', 'Grounded conversation', [...voiceBlockers, 'live_model_credential_and_revocation_not_evidenced', 'privacy_and_live_eval_not_accepted', 'production_slo_not_accepted']],
      ['J2', 'Evidence cockpit', ['named_deployment_founder_usability_run_absent', 'live_J1_and_G5_required']],
      ['J3', 'Trustworthy alerts', ['named_scheduler_and_channel_absent', 'genuine_20_review_baseline_not_accepted', 'live_J1_J2_G5_required']],
      ['J4', 'Live Observer', ['named_deployment_and_real_G5_go_absent', 'elapsed_shadow_and_live_drills_absent']],
      ['J5', 'Reproducible plans', ['named_deployment_founder_review_absent', 'product_owner_live_acceptance_absent']],
      ['J6', 'Supervised hand', ['source_revision_not_canonical_merged_main', 'exact_live_G6_release_and_history_absent', 'production_adapter_not_registered']],
      ['J7', 'Bounded canary', ['real_supervised_history_absent', 'G7_release_canary_and_live_recovery_absent']],
      ['J8', 'Jarvis v1', ['J1_through_J7_not_live_accepted', '30_day_live_report_absent', 'security_privacy_recovery_acceptance_absent']],
    ].map(([checkpoint, name, blockers]) => ({
      checkpoint,
      name,
      repository_candidate: true,
      live_status: 'blocked_external',
      blockers,
    }));
    const readiness = {
      schema_version: 'leozops_jarvis_readiness_v1',
      generated_at: this.clock().toISOString(),
      overall: 'blocked_external',
      grants_action_authority: false,
      evaluation_hash: evaluation.evaluation_hash,
      voice_quality_hash: voiceQuality?.quality_hash ?? null,
      voice_candidate_status: voiceQuality?.candidate_status ?? 'unavailable',
      checkpoints,
      retention_policy: JARVIS_RETENTION_POLICY,
      operator_truth: {
        can_inspect_repository_evidence: true,
        can_request_sanitized_export: true,
        can_request_delete: true,
        automatic_delete_enabled: false,
        production_restore_proven: false,
        external_action_registry_enabled_by_default: false,
        voice_action_authority: 'none',
        raw_audio_or_transcript_retained: false,
      },
    };
    return { ...readiness, readiness_hash: jarvisV1Hash(readiness) };
  }

  async requestData(tenantKey: string, raw: unknown, idempotencyKey: string) {
    const tenant = await this.tenant(tenantKey);
    const request = validateJarvisDataRequest(raw, tenantKey);
    const output = await this.repository.createDataRequest({
      tenantId: tenant.id,
      kind: request.kind,
      confirmationHash: request.confirmationHash,
      idempotencyKey,
    });
    return { request: this.requestView(output.record), replayed: output.replayed };
  }

  async listDataRequests(tenantKey: string) {
    const tenant = await this.tenant(tenantKey);
    return (await this.repository.listDataRequests(tenant.id)).map((record) => this.requestView(record));
  }

  async export(tenantKey: string, requestId: string) {
    const tenant = await this.tenant(tenantKey);
    const request = await this.repository.exportRequest(tenant.id, requestId);
    const [evaluation, inventory, preferenceRecord] = await Promise.all([
      this.repository.evaluation(tenant.id, 30),
      this.repository.inventory(tenant.id),
      this.preferences.current(tenant.id),
    ]);
    const exportedAt = this.clock().toISOString();
    const core = {
      schema_version: JARVIS_EXPORT_SCHEMA,
      exported_at: exportedAt,
      tenant: { tenant_key: tenant.tenant_key, display_name: tenant.display_name },
      authorized_by_request: { id: request.id, fingerprint: request.request_fingerprint, requested_at: request.requested_at },
      retention_policy: JARVIS_RETENTION_POLICY,
      exclusions: [
        'raw_source_payload_json', 'credentials_and_secret_references', 'command_payload_json',
        'provider_request_and_response_bodies', 'cross_tenant_data',
      ],
      preferences: preferenceRecord ? parseAmbientJarvisPreferenceRecord(preferenceRecord) : defaultAmbientJarvisPreferences(),
      evaluation,
      record_inventory: inventory,
    };
    return { ...core, export_hash: jarvisV1Hash(core) };
  }

  retentionPolicy() { return this.repository.retentionPolicy(); }

  private requestView(record: Awaited<ReturnType<JarvisV1Repository['exportRequest']>>) {
    return {
      id: record.id,
      schema_version: record.schema_version,
      kind: record.kind,
      scope: record.scope,
      status: record.status,
      requested_by: record.requested_by,
      requested_at: record.requested_at,
      fingerprint: record.request_fingerprint,
      limitation: record.kind === 'delete'
        ? 'No data was deleted. An accepted retention policy and explicit operator review are required.'
        : 'Export excludes raw source, credentials, provider bodies, and command payloads.',
    };
  }
}
