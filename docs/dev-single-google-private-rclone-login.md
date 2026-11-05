# DevNestNyx private Rclone: require a single approved Google login

Status: **Dev-only opt-in code, not deployed or configured**.
This protects the existing **private** DevNestNyx endpoint that already has
operator-owned legacy Rclone credentials. It is not the multi-user public pilot,
does not make Termux/Arch Linux files accessible to Heroku, and must not copy
the operator's `rclone.conf` or provider secrets.

## Gate added to the MCP request path

After the existing MCP OAuth access token is verified (JWKS signature, issuer,
audience and scopes) and the existing private-subject allowlist is checked,
`McpAuthService` can also enforce a single Google-social subject when the
operator sets `NYX_PRIVATE_DEV_SINGLE_GOOGLE_OWNER=true`.

The trusted, signed access token `sub` must match **both** protected
`NYX_PRIVATE_OAUTH_SUBJECTS` (exactly one entry, no commas) and
`NYX_PRIVATE_LEGACY_OWNER_MCP_SUBJECT`. It must be in the
`google-oauth2|...` identity-provider subject namespace, with matching
signed issuer. This is only accepted for `NYX_SERVICE_NAME=DevNestNyx`
in `NYX_DEPLOYMENT_MODE=private`.

The prefix is an Auth0-style social-connection subject format, **not**
cryptographic proof of a Google email address. Before configuring the subject,
the operator must independently complete the intended Google OAuth sign-in
and verify which Google account it belongs to. A backend-authentication
provider MUST guarantee it creates `google-oauth2|...` identities only
from Google-authenticated sessions. Do not assume a matching email string
in a user-controlled request is authoritative.

## Protected Dev configuration (values are NOT stored in GitHub)

```text
NYX_DEPLOYMENT_MODE=private
NYX_SERVICE_NAME=DevNestNyx
NYX_OAUTH_ISSUER=<existing trusted HTTPS issuer>
NYX_PRIVATE_OAUTH_SUBJECTS=<verified sole Google-social MCP subject>
NYX_PRIVATE_LEGACY_OWNER_MCP_SUBJECT=<exact same verified MCP subject>
NYX_PRIVATE_DEV_SINGLE_GOOGLE_OWNER=true
```

Configure values through the Dev secret manager, never a shared public config
or repository file. The exact sole Google account intended by the operator is
defined by privately verifying its account-to-subject linkage. An unrelated
account, unauthenticated user, non-Google provider, wrong issuer or an ACL
listing two users must fail closed with HTTP 401 or 403.

## Required verification before enabling on the live Dev app

1. Confirm the currently authenticated Dev MCP owner subject and independently
   prove its Google email via the trusted identity-provider console or a
   separately verified Google OIDC login. Do not infer email from `sub`.
2. Review the existing private allowlist; remove other private OAuth subjects
   only after owner identity and rollback access are verified. Use a distinct
   operator maintenance route if necessary to avoid locking out recovery.
3. Set the protected values above on Dev only, and restart/redeploy Dev under
   the exact reviewed CI SHA. Keep the legacy Rclone configuration unmodified.
4. With the approved account, confirm valid MCP login, private Rclone
   read-only inventory and a permitted root listing.
5. With another authenticated Google account, assert **403** and no private
   tool/list/remotes. Assert **401** on missing/invalid bearer tokens.
6. Test a non-Google login, wrong issuer, a two-subject allowlist, an empty
   allowlist, expired JWT, refresh/reconnect and service restart; record only
   non-secret evidence. Test the public multi-user pilot separately.
7. Verify backend deployment SHA and feature flag names via protected operator
   tooling, NOT by assuming the GitHub main branch equals a running app.

The feature is **off by default**, so a green CI run alone does NOT
enforce this restriction on the live Dev instance.

## Important boundary

Existing Dev legacy Rclone remotes are credentials loaded **on the private
Dev backend**; they are not a remote control connection to the local Termux
Rclone process. Direct live access to Termux/Arch Linux would require a
separately authenticated, tightly scoped agent on that device.

For the intended future *public* plugin, continue using separate isolated
tenant MEGA connections plus verified private owner-link and broker delegation
from PR #71. Never move operator credentials into the public runtime.
