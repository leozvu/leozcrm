/**
 * Integration adapter contracts for the connector layer (Milestone #6, extended
 * in #8A).
 *
 * The layer models channel integrations — social posting (Facebook / TikTok /
 * Instagram), email, and AI media generation. Social and AI media remain safe
 * **placeholders** (no-op, advisory-only). As of M8A the **email** channel is a
 * real, `'live'` adapter (Resend-backed); its actual sending happens through a
 * separate, explicitly-invoked, guardrailed publish path (see
 * `src/integrations/email/`), NOT through `execute`.
 *
 * `execute` is, for EVERY adapter, a safe no-op acknowledgement: it performs no
 * network I/O, no publishing, and no writes, and always returns
 * `performed: false` / `no_op: true`. Real email delivery is never triggered by
 * `execute` — only by the dedicated email publish service when an operator
 * explicitly invokes it. Placeholder adapters additionally report
 * `advisory_only: true`; the live email adapter reports `advisory_only: false`
 * because it *can* act (via that separate path).
 */

/** Channels the connector layer models. Stable machine keys. */
export type IntegrationChannel = 'facebook' | 'tiktok' | 'instagram' | 'email' | 'ai_media';

/** Capabilities a channel can perform. */
export type IntegrationCapability = 'publish_post' | 'send_email' | 'generate_media';

/**
 * Operating mode of an adapter: a no-op `'placeholder'` (social / AI media) or a
 * real `'live'` connector (email, M8A).
 */
export type IntegrationMode = 'placeholder' | 'live';

/** A request to perform a channel action. Inert: never sent anywhere in M6. */
export interface IntegrationActionRequest {
  capability: IntegrationCapability;
  /**
   * Free-form, channel-specific payload (caption, recipient, prompt, …). In
   * placeholder mode it is NEVER transmitted; only its key names are echoed back
   * for traceability so no credential/secret values are retained.
   */
  payload?: Record<string, unknown>;
}

/**
 * The result of asking an adapter to act. In placeholder mode this is always a
 * no-op acknowledgement: the request was understood but intentionally not
 * executed.
 */
export interface IntegrationActionResult {
  channel: IntegrationChannel;
  capability: IntegrationCapability;
  /** The adapter's mode (`'placeholder'` or `'live'`). */
  mode: IntegrationMode;
  /** Always `false` — `execute` never sends; nothing left the system. */
  performed: false;
  /** Always `true` — the action was acknowledged but deliberately not executed. */
  no_op: true;
  /** Human-readable explanation of why nothing happened. */
  detail: string;
  /** Echo of the request for traceability — key names only, never values. */
  request: { capability: IntegrationCapability; payload_keys: string[] };
}

/** Public, serialisable description of an adapter (safe to expose read-only). */
export interface IntegrationAdapterInfo {
  channel: IntegrationChannel;
  display_name: string;
  capabilities: IntegrationCapability[];
  /** `'placeholder'` (no-op) or `'live'` (email, M8A). */
  mode: IntegrationMode;
  /**
   * `true` for placeholder adapters (never act). `false` for the live email
   * adapter, which can act — but only via the separate, explicitly-invoked
   * publish path, never autonomously and never through `execute`.
   */
  advisory_only: boolean;
}

/**
 * The adapter interface every channel implements. Implementations are pure and
 * side-effect-free in M6: `execute` returns a no-op result synchronously and
 * touches no network, filesystem, or database.
 */
export interface IntegrationAdapter {
  readonly channel: IntegrationChannel;
  readonly displayName: string;
  readonly capabilities: readonly IntegrationCapability[];
  /** `'placeholder'` (no-op) or `'live'` (email, M8A). */
  readonly mode: IntegrationMode;
  /** Serialisable metadata for listing/inspection. */
  info(): IntegrationAdapterInfo;
  /** Whether this adapter declares the given capability. */
  supports(capability: IntegrationCapability): boolean;
  /** Acknowledge an action WITHOUT performing it. No network, no writes. */
  execute(request: IntegrationActionRequest): IntegrationActionResult;
}
