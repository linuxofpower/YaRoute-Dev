# Public NestNyx owner-only legacy broker V1

Status: feature OFF by default; code-only Dev candidate. No live deployment or publication.

Goal: NestNyx becomes publicly installable. All signed-in users add independent Google Drive, MEGA and GitHub connections stored in PostgreSQL with encrypted per-owner credentials. Only the separately verified operator Google identity, bound to one immutable MCP subject, may request private legacy rclone reads. Public app never inherits RCLONE_CONFIG_B64, RCLONE_CONFIG_PATH, RCLONE_CONFIG, or NYX_SHARED_ROOTS_JSON.

## Isolated public deployment settings

- NYX_DEPLOYMENT_MODE=public
- NYX_PUBLIC_CONNECTORS_ENABLED=true
- NYX_MULTIUSER_RCLONE_ENABLED=true
- NYX_PRIVATE_OWNER_LINK_ENABLED=true
- NYX_PRIVATE_BROKER_CLIENT_ENABLED=true
- NYX_PRIVATE_BROKER_URL: exact HTTPS origin of private Heroku service.
- NYX_PRIVATE_BROKER_SHARED_KEY_B64: separate random 32-byte key configured securely in both services.
- Existing approved Google-owner email, MCP subject, Google OAuth client ID/secret, issuer, public URL, PostgreSQL URL and vault key.
- NEVER provide any existing private Rclone configuration or secret in public runtime.

## Private legacy service settings

- NYX_DEPLOYMENT_MODE=private
- NYX_PRIVATE_BROKER_SERVER_ENABLED=true
- NYX_PRIVATE_BROKER_EXPECTED_PUBLIC_URL: exact isolated public HTTPS origin.
- NYX_PRIVATE_BROKER_SHARED_KEY_B64: matching HMAC key.
- NYX_PRIVATE_BROKER_GOOGLE_SUBJECT: immutable verified Google subject.
- NYX_PRIVATE_LEGACY_OWNER_MCP_SUBJECT: exact linked OAuth subject.
- NYX_PRIVATE_OAUTH_SUBJECTS: exactly one distinct approved owner subject.
- NYX_PRIVATE_BROKER_ALLOWED_AREAS: 1-20 pre-approved legacy area aliases.
- NYX_OAUTH_ISSUER, NYX_PUBLIC_URL, DATABASE_URL.
- Existing private rclone credentials stay here. No public tenant storage runs here.

## Security contract

1. MCP always validates signed bearer token, issuer, audience and scopes before tools run.
2. Public owner-link database singleton verifies exact approved Google email, immutable subject and trusted MCP issuer/subject. Never trust caller-supplied email or identity fields.
3. Public client signs a 30-second HMAC delegation for roots/list. It binds exact public origin, private endpoint audience, two immutable identities, one-use random JTI and root/path. No credentials cross the bridge.
4. Private service verifies HMAC, expiry, issuer, audience, identities and exact area grant. PostgreSQL consumes the JTI once and limits to 20 requests/minute, across dynos.
5. Listing returns at most 100 sanitized entries under one approved root, with name, size and directory flag only. No writes, transfers, deletes, generic Rclone commands, provider tokens, hashes or raw config.

## Live acceptance (required before declaring ready)

- Dev CI, security audit, exact Tester SHA and full integration suite green.
- Verify public app has no legacy operator credentials or shared root configuration.
- Verify approved owner Google identity proof and MCP subject independently before enabling any gate.
- Approved owner obtains only allowlisted private roots. Two unrelated users can create their own Drive/MEGA grants; attempts to list, probe, revoke or link someone else's credential are denied.
- Anonymous /mcp gets 401. Wrong owner, issuer, audience, email, Google subject, expired delegation, replay, traversal, forgery and disallowed root all denied.
- Test restart, outage, concurrent replay, rate limiting, 0600 temp files, key rotation and rollback.
- Confirm cost before provisioning. Existing strict $5 Heroku Eco budget remains; no app, add-on, dyno, config or database was created by this patch.

Rollback: disable NYX_PRIVATE_BROKER_CLIENT_ENABLED publicly and NYX_PRIVATE_BROKER_SERVER_ENABLED privately. Private endpoint then returns 404, tenant encrypted connections and legacy credentials remain unchanged.

## V1.1 code-only Personal-owned Pro remote discovery (2026-11-15)

This section extends the existing **read-only** owner broker. It DOES NOT migrate
Rclone credentials into public Heroku or make the eight existing private remotes
available automatically. The original owner proof and private broker flags remain
mandatory, and this code has no general CLI, copy, upload, move, rename, trash
or permanent-delete capability.

- On the **private Pro** deployment, set `NYX_PRIVATE_BROKER_ALLOWED_REMOTES`
  to the exact comma-separated existing Rclone remote names approved for the
  sole authenticated owner (at most 20). It is an allowlist, not a credential.
  Any remote absent from the actual private Rclone inventory blocks discovery.
  Leave unset to disable direct remote discovery; this setting alone never
  enables the private bridge.
- Both public and private services retain independent `NYX_PRIVATE_BROKER_*`
  flags and a common **random** `NYX_PRIVATE_BROKER_SHARED_KEY_B64` set through
  protected environment configuration. The value MUST NOT be printed, written
  to GitHub, supplied in ChatGPT or re-used as an Rclone password.
- Only the public OAuth principal bound through the singleton, separately
  verified Google OIDC owner link can invoke broker `connections` or
  `remote-list`. Primary and any other user see only their own registered
  connections. No account label, frontend tab, email claim or request argument
  can change the authenticated owner.
- The existing public `nyx_storage_connections_list` tool returns additional
  **virtual** connections from the private broker, with stable owner-bound
  UUIDs and `source=private-pro-broker` only when the linked owner and broker
  are both live. The existing `nyx_storage_connection_list_files` and
  `nyx_storage_connection_test_active` tools route those UUIDs back through
  the allowlisted private server; the public database never stores Pro secrets.
- Virtual records deliberately report `providerCapabilities=[]`,
  `verification=configured_not_live_verified` and `status=pending` until
  tested. No broker inventory response alone proves actual provider access.
- The combined Primary/Personal panel uses separately authenticated snapshots,
  and shows the eight Pro remotes only after Personal's private link is live.
  It does not share connections with Primary.

**Live acceptance checklist:** verify exact Tester and private Pro release SHAs,
set flags and approved immutable subjects through the operator's protected
configuration, complete Personal's owner-link OIDC callback, verify all eight
individual remote root reads, verify Primary receives zero virtual remotes and
gets denied with all Personal UUIDs, verify missing broker and expired/replayed
delegations fail closed, then separately review any write operations. Do not
enable write/delete or reuse a global Rclone config in the public app.

For physical Arch/Termux `rclone.conf`, use a separately paired local agent:
this broker accesses only remotes configured inside the private Pro runtime,
not arbitrary files on the user's laptop/phone.
