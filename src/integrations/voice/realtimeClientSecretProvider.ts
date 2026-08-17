import {
  VOICE_SESSION_MODEL,
  VOICE_SESSION_VOICE,
  VoiceLocale,
  VoiceSessionError,
} from '../../domain/voiceSession';
import { runtimeSecretIsUsable } from '../../security/runtimeSecret';

export interface VoiceClientSecret {
  value: string;
  expires_at: number;
}

export interface VoiceProviderConfiguration {
  provider: 'disabled' | 'openai_realtime';
  model: typeof VOICE_SESSION_MODEL;
  voice: typeof VOICE_SESSION_VOICE;
}

export interface VoiceClientSecretProvider {
  configuration(): VoiceProviderConfiguration;
  issue(input: { locale: VoiceLocale; safetyIdentifier: string }): Promise<VoiceClientSecret>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const INSTRUCTIONS: Record<VoiceLocale, string> = {
  en: [
    'You are LeozOps Talking Mode, an evidence-bound operating partner for the CEO.',
    'Speak naturally and concisely.',
    'For every question about the business, metrics, changes, priorities, plans, recommendations, or RepositoryRealms, call ask_leozops before answering.',
    'Never invent business facts. Never claim an action happened.',
    'You have no action authority. For action-shaped requests, explain that the CEO must use the text confirmation and supervised Command Deck.',
  ].join(' '),
  vi: [
    'Bạn là Talking Mode của LeozOps, đối tác điều hành dựa trên bằng chứng dành cho CEO.',
    'Nói tự nhiên, ngắn gọn bằng tiếng Việt.',
    'Với mọi câu hỏi về doanh nghiệp, số liệu, thay đổi, ưu tiên, kế hoạch, khuyến nghị hoặc RepositoryRealms, phải gọi ask_leozops trước khi trả lời.',
    'Không được bịa dữ kiện kinh doanh và không được tuyên bố một hành động đã xảy ra.',
    'Bạn không có quyền thực thi. Với yêu cầu mang tính hành động, hãy yêu cầu CEO dùng xác nhận bằng văn bản và Command Deck có giám sát.',
  ].join(' '),
};

export class DisabledVoiceClientSecretProvider implements VoiceClientSecretProvider {
  configuration(): VoiceProviderConfiguration {
    return { provider: 'disabled', model: VOICE_SESSION_MODEL, voice: VOICE_SESSION_VOICE };
  }

  async issue(): Promise<VoiceClientSecret> {
    throw new VoiceSessionError(
      'voice_provider_disabled',
      'Talking Mode provider is not configured',
      503,
    );
  }
}

export interface OpenAIRealtimeClientSecretProviderOptions {
  apiKey: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

const OPENAI_REALTIME_CLIENT_SECRET_URL = 'https://api.openai.com/v1/realtime/client_secrets';
const MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024;
const SAFETY_IDENTIFIER = /^[0-9a-f]{64}$/;

async function boundedResponseText(response: Response, signal: AbortSignal): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const parsedLength = Number(contentLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > MAX_PROVIDER_RESPONSE_BYTES) {
      throw new VoiceSessionError('voice_provider_invalid_response', 'voice provider response exceeded the safe limit', 502);
    }
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let rejectAborted: ((reason: VoiceSessionError) => void) | undefined;
  const aborted = new Promise<never>((_, reject) => { rejectAborted = reject; });
  const abort = () => {
    rejectAborted?.(new VoiceSessionError('voice_provider_timeout', 'voice provider timed out', 504));
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_PROVIDER_RESPONSE_BYTES) {
        await reader.cancel();
        throw new VoiceSessionError('voice_provider_invalid_response', 'voice provider response exceeded the safe limit', 502);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    try { await reader.cancel(); } catch { /* response is already terminal */ }
    if (error instanceof VoiceSessionError) throw error;
    throw new VoiceSessionError('voice_provider_invalid_response', 'voice provider returned an invalid response body', 502);
  } finally {
    signal.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

export class OpenAIRealtimeClientSecretProvider implements VoiceClientSecretProvider {
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: OpenAIRealtimeClientSecretProviderOptions) {
    if (!runtimeSecretIsUsable(options.apiKey, { maxLength: 512 })) {
      throw new VoiceSessionError('voice_provider_misconfigured', 'OpenAI voice credential is missing or invalid', 503);
    }
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8_000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 500 || this.timeoutMs > 15_000) {
      throw new VoiceSessionError('voice_provider_misconfigured', 'OpenAI voice timeout is outside the safe range', 503);
    }
  }

  configuration(): VoiceProviderConfiguration {
    return { provider: 'openai_realtime', model: VOICE_SESSION_MODEL, voice: VOICE_SESSION_VOICE };
  }

  async issue(input: { locale: VoiceLocale; safetyIdentifier: string }): Promise<VoiceClientSecret> {
    if ((input.locale !== 'en' && input.locale !== 'vi') || !SAFETY_IDENTIFIER.test(input.safetyIdentifier)) {
      throw new VoiceSessionError('voice_provider_misconfigured', 'voice provider request identity is invalid', 503);
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new VoiceSessionError('voice_provider_timeout', 'voice provider timed out', 504));
      }, this.timeoutMs);
    });
    try {
      const response = await Promise.race([this.fetchImpl(OPENAI_REALTIME_CLIENT_SECRET_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'OpenAI-Safety-Identifier': input.safetyIdentifier,
        },
        body: JSON.stringify({
          session: {
            type: 'realtime',
            model: VOICE_SESSION_MODEL,
            instructions: INSTRUCTIONS[input.locale],
            audio: {
              input: {
                turn_detection: {
                  type: 'server_vad',
                  create_response: true,
                  interrupt_response: true,
                },
              },
              output: { voice: VOICE_SESSION_VOICE },
            },
          },
        }),
        signal: controller.signal,
      }), deadline]);
      const text = await boundedResponseText(response, controller.signal);
      if (!response.ok) {
        throw new VoiceSessionError('voice_provider_rejected', 'voice provider rejected the session request', 502);
      }
      const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
      if (contentType !== 'application/json') {
        throw new VoiceSessionError('voice_provider_invalid_response', 'voice provider returned an invalid content type', 502);
      }
      let raw: unknown;
      try { raw = JSON.parse(text); } catch {
        throw new VoiceSessionError('voice_provider_invalid_response', 'voice provider returned invalid JSON', 502);
      }
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new VoiceSessionError('voice_provider_invalid_response', 'voice provider returned an invalid credential', 502);
      }
      const value = (raw as Record<string, unknown>).value;
      const expiresAt = (raw as Record<string, unknown>).expires_at;
      if (typeof value !== 'string' || !/^ek_[A-Za-z0-9._-]{8,2040}$/.test(value)
        || typeof expiresAt !== 'number' || !Number.isInteger(expiresAt)
        || expiresAt * 1000 <= Date.now() + 5_000 || expiresAt * 1000 > Date.now() + 15 * 60_000) {
        throw new VoiceSessionError('voice_provider_invalid_response', 'voice provider returned an invalid credential', 502);
      }
      return { value, expires_at: expiresAt };
    } catch (error) {
      if (error instanceof VoiceSessionError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new VoiceSessionError('voice_provider_timeout', 'voice provider timed out', 504);
      }
      throw new VoiceSessionError('voice_provider_unavailable', 'voice provider is unavailable', 503);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export function buildVoiceClientSecretProviderFromEnv(): VoiceClientSecretProvider {
  const provider = process.env.LEOZOPS_VOICE_PROVIDER ?? 'disabled';
  if (provider === 'disabled') return new DisabledVoiceClientSecretProvider();
  if (provider !== 'openai_realtime') {
    throw new VoiceSessionError('voice_provider_misconfigured', 'LEOZOPS_VOICE_PROVIDER is unsupported', 503);
  }
  return new OpenAIRealtimeClientSecretProvider({
    apiKey: process.env.OPENAI_API_KEY ?? '',
    timeoutMs: process.env.LEOZOPS_OPENAI_REALTIME_TIMEOUT_MS
      ? Number(process.env.LEOZOPS_OPENAI_REALTIME_TIMEOUT_MS) : undefined,
  });
}
