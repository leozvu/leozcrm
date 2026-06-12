import {
  IntegrationAdapter,
  IntegrationActionRequest,
  IntegrationActionResult,
  IntegrationAdapterInfo,
  IntegrationCapability,
  IntegrationChannel,
  IntegrationMode,
} from '../../domain/integration';
import { EmailMessage, EmailFailureReason } from '../../domain/email';
import { isEmail } from '../../domain/validate';
import { ValidationError } from '../../errors';

/**
 * Extract and validate the address from a sender string, accepting either a bare
 * address (`a@b.com`) or a display form (`Name <a@b.com>`). Returns the address
 * when valid, else `null`. Used to enforce that a real sender is configured
 * before any provider call.
 */
export function senderEmail(from: string | undefined): string | null {
  if (typeof from !== 'string') return null;
  const match = from.match(/<([^>]+)>/);
  const addr = (match ? match[1] : from).trim();
  return isEmail(addr) ? addr : null;
}

/**
 * Live email adapter backed by Resend (Milestone #8A).
 *
 * It fits the existing `IntegrationAdapter` boundary (metadata + a no-op
 * `execute` ack — `execute` NEVER sends), and adds an async, single-attempt
 * `sendOnce` that performs the real provider call with a timeout. Retry/backoff
 * and spend guardrails live one level up in `EmailPublishService`; this class is
 * only the provider edge.
 *
 * The provider call goes through an injected `EmailTransport`, so tests drive a
 * sandbox transport and no real network is touched. The default transport uses
 * the built-in `fetch` (no new dependency, no Resend SDK).
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** What the provider edge returns for one attempt. */
export type ResendAttempt =
  | { kind: 'success'; id: string }
  | { kind: 'retryable'; reason: Extract<EmailFailureReason, 'timeout' | 'network_error' | 'provider_error'>; detail: string }
  | { kind: 'fatal'; reason: Extract<EmailFailureReason, 'provider_error' | 'invalid_message' | 'not_configured'>; detail: string };

export interface EmailTransportRequest {
  url: string;
  apiKey: string;
  body: { from: string; to: string[]; subject: string; html?: string; text?: string };
  signal: AbortSignal;
}

export interface EmailTransportResponse {
  /** HTTP status returned by the provider. */
  status: number;
  /** Parsed JSON body (e.g. `{ id }` on success, `{ message }` on error). */
  body: any;
}

/** Pluggable provider transport. The default calls Resend via `fetch`. */
export type EmailTransport = (req: EmailTransportRequest) => Promise<EmailTransportResponse>;

/** Default transport: a real Resend call over `fetch`. */
export const fetchEmailTransport: EmailTransport = async (req) => {
  const res = await fetch(req.url, {
    method: 'POST',
    headers: { authorization: `Bearer ${req.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(req.body),
    signal: req.signal,
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
};

export interface ResendConfig {
  apiKey?: string;
  /** Default sender, e.g. "LeozOps <noreply@leozops.ai>". */
  from?: string;
  transport?: EmailTransport;
  /** Per-attempt timeout in ms (default 10s). */
  timeoutMs?: number;
  /** Provider endpoint (override for sandbox/self-host). */
  endpoint?: string;
}

export class ResendEmailAdapter implements IntegrationAdapter {
  readonly channel: IntegrationChannel = 'email';
  readonly displayName = 'Email (Resend)';
  readonly capabilities: readonly IntegrationCapability[] = ['send_email'];
  readonly mode: IntegrationMode = 'live';

  private readonly apiKey?: string;
  private readonly from?: string;
  private readonly transport?: EmailTransport;
  private readonly timeoutMs: number;
  private readonly endpoint: string;

  constructor(config: ResendConfig = {}) {
    this.apiKey = config.apiKey;
    this.from = config.from;
    this.transport = config.transport;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.endpoint = config.endpoint ?? RESEND_ENDPOINT;
  }

  /**
   * Configured to actually send: requires an API key, a transport, AND a valid
   * sender (`EMAIL_FROM`). A missing/invalid sender makes the adapter report
   * "not configured" so the publish boundary refuses before any provider call.
   */
  isConfigured(): boolean {
    return Boolean(this.apiKey && this.transport && senderEmail(this.from));
  }

  info(): IntegrationAdapterInfo {
    return {
      channel: this.channel,
      display_name: this.displayName,
      capabilities: [...this.capabilities],
      mode: this.mode,
      // Live, but only via the explicit publish path — never autonomous.
      advisory_only: false,
    };
  }

  supports(capability: IntegrationCapability): boolean {
    return this.capabilities.includes(capability);
  }

  /**
   * No-op acknowledgement, exactly like the placeholder adapters: `execute`
   * never sends. Real delivery is `sendOnce`, reached only via the guarded,
   * explicitly-invoked publish service.
   */
  execute(request: IntegrationActionRequest): IntegrationActionResult {
    if (!this.supports(request.capability)) {
      throw new ValidationError(
        400,
        `${this.displayName} adapter does not support capability "${request.capability}"`,
        'unsupported_capability',
      );
    }
    return {
      channel: this.channel,
      capability: request.capability,
      mode: this.mode,
      performed: false,
      no_op: true,
      detail: `${this.displayName} is live, but sending is performed only via the explicit POST /integrations/email/send endpoint — execute() never sends.`,
      request: { capability: request.capability, payload_keys: Object.keys(request.payload ?? {}) },
    };
  }

  /**
   * Perform ONE provider attempt with a timeout. Classifies the outcome as
   * success, retryable (caller may back off and retry), or fatal (stop). Does
   * not touch the spend guard or retry — that is the publish service's job.
   */
  async sendOnce(message: EmailMessage): Promise<ResendAttempt> {
    if (!this.apiKey || !this.transport) {
      return { kind: 'fatal', reason: 'not_configured', detail: 'Resend API key/transport not configured' };
    }

    // Resolve the sender: a caller `from` (already allowlisted by the publish
    // service when present) overrides the configured default. Never send with an
    // empty/invalid sender.
    const from = message.from ?? this.from;
    if (!senderEmail(from)) {
      return { kind: 'fatal', reason: 'not_configured', detail: 'no valid sender configured (set EMAIL_FROM)' };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.transport({
        url: this.endpoint,
        apiKey: this.apiKey,
        body: {
          from: from as string,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        },
        signal: controller.signal,
      });

      if (res.status >= 200 && res.status < 300) {
        const id = typeof res.body?.id === 'string' ? res.body.id : '';
        if (!id) {
          return { kind: 'retryable', reason: 'provider_error', detail: 'provider returned 2xx without a message id' };
        }
        return { kind: 'success', id };
      }
      if (res.status === 429 || res.status >= 500) {
        return { kind: 'retryable', reason: 'provider_error', detail: `provider responded ${res.status}` };
      }
      // Other 4xx: a bad request that retrying will not fix.
      const detail = typeof res.body?.message === 'string' ? res.body.message : `provider responded ${res.status}`;
      const reason: 'invalid_message' | 'provider_error' = res.status === 400 || res.status === 422 ? 'invalid_message' : 'provider_error';
      return { kind: 'fatal', reason, detail };
    } catch (err: any) {
      // Abort (timeout) vs any other transport failure (network).
      if (err?.name === 'AbortError' || controller.signal.aborted) {
        return { kind: 'retryable', reason: 'timeout', detail: `no response within ${this.timeoutMs}ms` };
      }
      return { kind: 'retryable', reason: 'network_error', detail: err?.message ?? 'transport error' };
    } finally {
      clearTimeout(timer);
    }
  }
}
