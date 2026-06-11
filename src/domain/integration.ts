/**
 * Integration adapter contracts for the placeholder connector layer (Milestone #6).
 *
 * This layer establishes the *shape* of future channel integrations — social
 * posting (Facebook / TikTok / Instagram), email, and AI media generation —
 * WITHOUT any real behaviour. Every adapter in this milestone is a safe no-op:
 *
 *   - no real external API calls, no network I/O
 *   - no OAuth, no credentials, no secrets
 *   - no publishing, no writes, no CRM mutation
 *   - no background jobs, no autonomous execution
 *
 * The no-op nature is pinned at the type level the same way the recommendation
 * layer pins `advisory_only: true`: an action result always carries
 * `performed: false` and `no_op: true`, and an adapter's `mode` is always
 * `'placeholder'`. When real publishing arrives (M8) it will define its own
 * contract; nothing here executes in the meantime.
 */

/** Channels the placeholder layer models. Stable machine keys. */
export type IntegrationChannel = 'facebook' | 'tiktok' | 'instagram' | 'email' | 'ai_media';

/** Capabilities a channel could perform once real (all inert in M6). */
export type IntegrationCapability = 'publish_post' | 'send_email' | 'generate_media';

/**
 * Operating mode of an adapter. Always `'placeholder'` in M6 — the type has a
 * single member so the no-op guarantee is enforced by the compiler.
 */
export type IntegrationMode = 'placeholder';

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
  /** Always `'placeholder'` in M6. */
  mode: IntegrationMode;
  /** Always `false` — nothing left the system. */
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
  /** Always `'placeholder'`. */
  mode: IntegrationMode;
  /** Always `true` — this layer never triggers an automated/real action. */
  advisory_only: true;
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
  /** Always `'placeholder'`. */
  readonly mode: IntegrationMode;
  /** Serialisable metadata for listing/inspection. */
  info(): IntegrationAdapterInfo;
  /** Whether this adapter declares the given capability. */
  supports(capability: IntegrationCapability): boolean;
  /** Acknowledge an action WITHOUT performing it. No network, no writes. */
  execute(request: IntegrationActionRequest): IntegrationActionResult;
}
