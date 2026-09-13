# Human session entry — F14

Status: repository implementation; external issuer and live SSO acceptance are not configured or claimed.

The founder can use a trusted workspace identity instead of pasting a tenant
read token. This adds human authentication to `egoric-readonly`; it grants no
Egoric write access, generic CRUD path, command adapter, or G5/G6/G7/J1–J8
acceptance. Business Memory remains tenant-shared according to the existing
CEO product contract. The session identifies the human user and its allowed
capabilities; this change does not turn existing tenant-level advisory records
into private per-user mailboxes.

## Receiver and issuer contract

1. The data-free Cockpit reads `GET /auth/human/session`. Without
   `LEOZOPS_HUMAN_SSO_CONFIG`, it displays “Workspace sign-in is not configured”
   and disables the sign-in button. The separate advanced service-token entry
   remains available for existing local/operator workflows, in page memory only.
2. A same-origin `POST /auth/human/start` with `X-Leozops-Login: 1` creates a
   120-second, one-use browser challenge in an HttpOnly cookie. Its response is
   an exact configured issuer URL with `audience`, random `nonce`, and fixed
   `redirect_uri=<configured-origin>/cockpit/`. No tenant is selected by the browser.
3. The issuer authenticates the human in its own system and independently
   checks its audience/redirect allowlist and tenant membership. It returns a
   maximum-120-second Ed25519-signed JWT in the redirect **fragment**:
   `<redirect_uri>#handoff=<compact-JWT>`. Do not put it in a query parameter,
   log, local/session storage, or a long-lived cookie. The public key is pinned;
   `jku`, remote discovery, symmetric JWT algorithms and unknown fields are rejected.
4. Cockpit clears the fragment with `history.replaceState` before posting the
   handoff to same-origin `/auth/human/exchange`. The receiver validates its
   signature, issuer, audience, nonce, dates, exact scope and explicit identity
   mapping. The challenge is consumed and the session created in one transaction.
   A unique hashed issuer/JTI prevents replay, including concurrent requests.
5. The browser receives an opaque HttpOnly, `SameSite=Strict`, `Path=/` cookie.
   HTTPS uses the `__Host-leozops-human` name and `Secure`; production requires
   HTTPS. Only a SHA-256 digest of the opaque session value is stored. No shared
   service credential is returned to JavaScript. Session metadata provides an
   in-memory CSRF proof for cookie-authenticated writes.

JWT protected header (exact fields):

```json
{ "alg": "EdDSA", "typ": "leozops-human-handoff+jwt", "kid": "issuer-key-1" }
```

JWT claims (exact fields):

```json
{
  "schema_version": "leozops_human_handoff_v1",
  "iss": "approved-issuer-id",
  "aud": "leozops-cockpit",
  "sub": "opaque-issuer-human-id",
  "source_tenant": "approved-source-tenant",
  "nonce": "echo-the-43-character-start-nonce-exactly",
  "jti": "fresh-32-to-96-character-base64url-identifier",
  "iat": 0,
  "exp": 0,
  "scopes": ["cockpit:read", "advisory:write"]
}
```

The timestamps above are illustrative placeholders; the receiver rejects them.
`iat` and `exp` are integer Unix seconds, `exp > now`, maximum lifetime 120
seconds, at most five seconds of future clock skew. `nonce`/`jti` accept 32–96
base64url characters. The issuer must generate a new unpredictable JTI per handoff.

## Exact deployment configuration

`LEOZOPS_HUMAN_SSO_CONFIG` is a JSON object, provided server-side by the operator:

```text
enabled: true
origin: exact HTTPS LeozOps origin, no path/query/credentials
audience: exact registered audience identifier
sessionSeconds: 300–3600 (900 recommended)
issuer:
  id: exact issuer identifier
  authorizeUrl: exact HTTPS issuer authorization endpoint, no query/fragment
  keys: { exact-key-id: SPKI PEM Ed25519 PUBLIC key }
bindings:
  - id: stable binding identifier
    subject: exact issuer human subject (opaque, not an inferred email match)
    sourceTenant: exact source tenant identifier
    tenantKey: existing LeozOps tenant key
    userId: explicit opaque LeozOps human identity
    scopes: [cockpit:read, advisory:write]
```

No issuer private key belongs in this configuration or in LeozOps. Up to three
public keys support explicit rotation. Removing a key or changing a binding,
scope, user, origin, audience, or session lifetime invalidates affected sessions
when the server reloads that configuration. There is no automatic provisioning,
email/domain matching, Egoric Client-to-tenant mapping or Directory copy.

For isolated tests/development only, `allowLocalHttp: true` permits loopback
HTTP origins and issuer URLs. This is rejected in production; local cookies
have distinct names. No localhost issuer is silently enabled. The tests generate
an ephemeral issuer keypair in memory, never production credentials.

Apply the additive `20260908120000_create_human_sessions` migration to the
independent **LeozOps** database before enabling this configuration. The normal
production manifest, provider, source and service-auth gates still apply.
Invalid supplied configuration fails startup; absent configuration disables SSO.

## Authorization, logout and revocation

- `cockpit:read` grants existing tenant-scoped reads, never admin scope.
- `advisory:write` additionally permits only the existing LeozOps-owned
  advisory/context/planning/preference endpoints. Their existing validations
  and action gates remain in force.
- `voice:use` is additionally required for voice POST endpoints; provider and
  consent gates are still required independently.
- Cookie-authenticated writes require the exact configured `Origin` and
  `X-Leozops-CSRF` from session metadata. Bearer/API-key service callers retain
  their separate authentication and never fall back to ambient cookies on a
  bad explicit token.
- `POST /auth/human/logout` requires origin/CSRF, revokes the durable session
  before clearing the cookie, and is used by Cockpit sign-out. Closing a tab
  clears in-page data; the bounded cookie permits reopening until expiry.
- An authorized operator can run
  `npm run human:revoke -- <exact-tenant-key> <exact-human-user-id>` in the
  configured LeozOps environment. It revokes existing sessions for that exact
  identity; it does not remove the binding or forbid a later fresh sign-in.
  Remove the binding to disable future sign-in, then reload the server.
- The start route caps attempts per direct peer address. Deployments behind a
  proxy should enforce their own reviewed edge rate limit; the application
  does not trust arbitrary forwarding headers.

Expired challenges are removed on a later start. Used session/JTI records remain
for replay defense and revocation history; there is no automatic retention job.
This auth metadata is separate from immutable business evidence. Follow the
deployment's accepted access and retention policy before adding cleanup.

## Readiness boundary

Repository tests prove signature and input rejection, one-time challenge/replay,
SQLite transaction rollback, restart persistence, user/tenant/capability checks,
cookie flags, origin/CSRF, expiry, logout, revocation, configuration changes,
data-free shell and no browser credential persistence. They use an in-memory
issuer and isolated database. They do not prove a real upstream identity provider,
real issuer membership, named HTTPS deployment, browser cross-site integration,
operational SSO monitoring or live founder acceptance.

An actual issuer endpoint matching this contract still needs separate exact
configuration and integration review. The existing RepositoryRealms CEO SSO
contract is not assumed compatible, and no ERP endpoint was added in this cut.

Verification on 2026-09-08: focused human-session/Cockpit/profile suite **18/18
PASS**; complete repository suite **389/389 PASS**; strict TypeScript and build
**PASS**. This cut exercised the additive migration on isolated SQLite only,
not a named PostgreSQL deployment. The test issuer keypair stayed in memory.
