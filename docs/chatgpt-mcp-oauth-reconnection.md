# ChatGPT MCP OAuth reconnection — Dev hardening

Scope: `DevNestNyx` and `NestNyxPro` ChatGPT-facing MCP sessions, **not** Google
Drive/MEGA Rclone provider sessions. This source repository is Dev only; it
does not modify the production service or the OAuth issuer configuration.

## Authentication boundary

ChatGPT is the OAuth client. The external identity provider issues and refreshes
tokens. NestNyx is a resource server: it verifies the JWT issuer, audience,
signature, expiration and scopes. **NestNyx cannot refresh a ChatGPT-owned token
or extend its lifetime**, and it must never receive or persist a ChatGPT refresh
token through MCP tool arguments.

## Implemented fail-closed behavior

- Invalid, expired or missing bearer tokens still produce `401` with the
  OAuth `WWW-Authenticate` resource challenge.
- Unknown signing-key IDs remain `401`. They are not treated as a temporary
  outage, and the service never accepts an unverifiable token.
- Only recognized JWKS lookup transport failures, rate limits or provider 5xx
  responses produce `503 temporarily_unavailable` with `Retry-After: 15` and
  **no** `WWW-Authenticate` challenge. The same token may be tried again after
  the issuer recovers. This does not bypass signature checks.
- Private-owner allowlists and granted scopes remain enforced after recovery.

## Diagnose an approximately monthly reconnect

1. Record the affected plugin, the date/time, the ChatGPT error and whether
   both plugins expire together. Do not copy OAuth tokens into tickets or logs.
2. In the OAuth provider's administrative UI, inspect the **actual OAuth client**
   used by each plugin, its access-token lifetime, refresh-token availability,
   refresh-token rotation and absolute/idle session policy. Check whether the
   registered client persists across deployments. The active issuer is supplied
   privately by `NYX_OAUTH_ISSUER`; do not place its secrets in this repository.
3. Check the provider's OAuth discovery document for supported refresh grants,
   and test automatic token renewal before expiry. If the policy intentionally
   forces a new login monthly, keep that policy unless the owner reviews and
   changes it in the provider's admin UI.
4. Distinguish `invalid_client`, `invalid_grant`, expired JWT, bad audience,
   unknown `kid`, and transient JWKS/network failures. A temporary outage must
   not be classified as revocation. Never retry a known invalid grant forever.
5. Test the isolated Dev plugin through a real ChatGPT session and record a
   successful refresh over the provider's configured access-token lifetime.
   A green unit test does **not** prove monthly renewal.
6. Only after Dev tests and the correct provider configuration are verified,
   propose the reviewed change through the Tester/production release workflow.

Provider-side refresh/session policy is the likely remaining diagnosis for
monthly prompts; the code change in this repository handles the separate issue
of false reauthorization on temporary JWKS failures. No token duration has been
weakened, and no refresh or signing credentials have been copied into Dev.

References:

- https://developers.openai.com/plugins/build/auth
- https://developers.openai.com/plugins/deploy/troubleshooting
