import { randomUUID } from 'node:crypto';
import {
  VOICE_SESSION_REQUEST_SCHEMA,
  VoiceSessionError,
  voiceSafetyIdentifier,
  voiceSessionHash,
  validateVoiceClientEventRequest,
  validateVoiceSessionRequest,
} from '../domain/voiceSession';
import { VoiceClientSecretProvider } from '../integrations/voice/realtimeClientSecretProvider';
import { BusinessMemoryRepository } from '../repositories/businessMemoryRepository';
import { VoiceSessionRepository, VoiceSessionViewRecord } from '../repositories/voiceSessionRepository';

export class VoiceSessionService {
  constructor(
    private readonly repository: VoiceSessionRepository,
    private readonly memory: BusinessMemoryRepository,
    private readonly provider: VoiceClientSecretProvider,
    private readonly clock: () => Date = () => new Date(),
    private readonly uuid: () => string = randomUUID,
  ) {}

  private async tenant(tenantKey: string) {
    const tenant = await this.memory.findTenantByKey(tenantKey);
    if (!tenant) throw new VoiceSessionError('tenant_not_found', 'tenant was not found', 404);
    return tenant;
  }

  private present(view: VoiceSessionViewRecord) {
    const last = view.events.at(-1);
    const expired = this.clock().getTime() >= Date.parse(view.session.session_deadline_at);
    return {
      schema_version: view.session.schema_version,
      id: view.session.id,
      state: view.state,
      locale: view.session.locale,
      provider: view.session.provider,
      model: view.session.model,
      voice: view.session.voice,
      transport: view.session.transport,
      created_at: view.session.created_at,
      session_deadline_at: view.session.session_deadline_at,
      expired,
      event_count: view.events.length,
      last_event_at: last?.occurred_at ?? null,
      policy: {
        action_authority: view.session.action_authority,
        raw_audio_retention: view.session.raw_audio_retention,
        business_tool: 'ask_leozops_read_only',
        action_shaped_voice_requests: 'blocked_requires_text_confirmation',
      },
      fingerprint: view.session.session_fingerprint,
    };
  }

  async create(tenantKey: string, raw: unknown, idempotencyKey: string) {
    const tenant = await this.tenant(tenantKey);
    const request = validateVoiceSessionRequest(raw);
    const configuration = this.provider.configuration();
    const created = await this.repository.create({
      tenantId: tenant.id,
      locale: request.locale,
      provider: configuration.provider,
      idempotencyKey,
      requestHash: voiceSessionHash({
        schema_version: VOICE_SESSION_REQUEST_SCHEMA,
        locale: request.locale,
        provider: configuration.provider,
        model: configuration.model,
        voice: configuration.voice,
      }),
    });
    const before = await this.repository.view(tenant.id, created.record.id);
    if (before.state !== 'authorizing' && before.state !== 'connecting') {
      throw new VoiceSessionError('voice_session_terminal', 'voice session cannot issue another credential', 409);
    }
    if (this.clock().getTime() >= Date.parse(before.session.session_deadline_at)) {
      throw new VoiceSessionError('voice_session_expired', 'voice session has expired', 409);
    }
    if (created.replayed && before.events.some((event) => event.event_type === 'credential_reissued')) {
      throw new VoiceSessionError(
        'voice_credential_reissue_exhausted',
        'the one permitted voice credential recovery has already been used',
        409,
      );
    }
    let clientSecret;
    try {
      clientSecret = await this.provider.issue({
        locale: request.locale,
        safetyIdentifier: voiceSafetyIdentifier(tenant.id),
      });
    } catch (error) {
      const providerError = error instanceof VoiceSessionError
        ? error
        : new VoiceSessionError('voice_provider_unavailable', 'voice provider is unavailable', 503);
      try {
        await this.repository.appendEvent({
          tenantId: tenant.id,
          sessionId: created.record.id,
          eventKey: `server-provider-failed-${this.uuid()}`,
          eventType: 'provider_failed',
          source: 'server',
          failureCode: providerError.code,
        });
      } catch {
        // Preserve the sanitized provider failure. No credential or provider body is logged.
      }
      throw providerError;
    }
    await this.repository.appendEvent({
      tenantId: tenant.id,
      sessionId: created.record.id,
      eventKey: `server-credential-${this.uuid()}`,
      eventType: before.state === 'authorizing' ? 'credential_issued' : 'credential_reissued',
      source: 'server',
      providerCredentialExpiresAt: new Date(clientSecret.expires_at * 1000).toISOString(),
    });
    const view = await this.repository.view(tenant.id, created.record.id);
    return {
      session: this.present(view),
      client_secret: clientSecret,
      webrtc_url: 'https://api.openai.com/v1/realtime/calls',
      replayed: created.replayed,
    };
  }

  async get(tenantKey: string, sessionId: string) {
    const tenant = await this.tenant(tenantKey);
    return { session: this.present(await this.repository.view(tenant.id, sessionId)) };
  }

  async recordClientEvent(tenantKey: string, sessionId: string, raw: unknown) {
    const tenant = await this.tenant(tenantKey);
    const event = validateVoiceClientEventRequest(raw);
    const current = await this.repository.view(tenant.id, sessionId);
    if (this.clock().getTime() >= Date.parse(current.session.session_deadline_at)
      && event.event_type !== 'disconnected') {
      throw new VoiceSessionError('voice_session_expired', 'voice session has expired', 409);
    }
    const appended = await this.repository.appendEvent({
      tenantId: tenant.id,
      sessionId,
      eventKey: event.client_event_id,
      eventType: event.event_type,
      source: 'browser',
      failureCode: event.event_type === 'connection_failed' ? 'browser_connection_failed' : undefined,
    });
    return {
      session: this.present(await this.repository.view(tenant.id, sessionId)),
      replayed: appended.replayed,
    };
  }
}
