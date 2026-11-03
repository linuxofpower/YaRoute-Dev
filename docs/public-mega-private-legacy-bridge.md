# Public MEGA + owner-only legacy Rclone: implementation contract

Status: **Dev policy groundwork only; not deployed, not an authorization bridge**.
The public plugin may be installed by any authenticated user. Only the operator's
two separately verified Google identities may reach the existing private Rclone
service. Other users may enroll their **own** MEGA accounts in isolated storage.

## Existing code that should be reused
- Public, owner-scoped MEGA enrollment: `TenantMegaEnrollmentService`,
  `TenantRcloneService`, `nyx_storage_connection_*` MCP tools.
- Read-only permissions, selected MEGA root, 2FA and one-time browser handoff.
- AES-GCM encrypted pending/active credential records with per-invocation private
  Rclone config and existing cross-tenant tests.
- `preparePublicRcloneEnvironment` fails startup if legacy operator Rclone
  config is inherited. **Do not remove or bypass that guard.**
- Existing private service retains the operator's old Rclone config. Never copy
  operator passwords, rclone.conf, refresh tokens or private root inventories
  into the public runtime, source control, ChatGPT messages or diagnostic logs.

## Architecture and gates
1. **Public front end:** OAuth-authenticated MCP service. Every caller has a
   server-verified issuer and immutable subject. All users can create MEGA
   connections they own, with read-only root-scoped permissions initially.
2. **Google account linking:** Use a server-side Google OIDC authorization-code
   flow with state, PKCE, nonce and exact redirect URI. Verify ID token
   signature, issuer, audience, nonce and expiry; read a verified Google
   `sub`, `email` and `email_verified`. Bind those to the current verified
   MCP issuer+subject, using encrypted or otherwise protected server-side
   ownership records. Never accept identity fields from caller tool arguments.
3. **Private owner registry:** Provision exactly the two operator-approved
   Google subjects/emails through a protected administrative process.
   Do not put the real addresses or subject IDs in this public repository.
   A changed email, new Google subject, revoked link, or mismatched MCP subject
   must fail closed pending fresh verification.
4. **Legacy broker:** Keep existing operator Rclone credentials in an isolated
   private service. Do not publish raw storage endpoints. The public service
   may call a narrow broker only after the owner eligibility policy is checked
   using freshly verified server-side identities. The broker must independently
   verify signed short-lived, audience-bound delegation and the allowed
   operator identity; allow only explicit root-bound read operations in V1.
   Use mutually authenticated transport or equivalently strong private service
   authentication, one-use/replay protection and rate limits. Never accept
   caller-chosen remote names, arbitrary filesystem paths or generic Rclone
   commands. Do not forward global Rclone credentials.
5. **Tenant path:** Ordinary users must never reach the broker. They use the
   existing isolated `nyx_storage_connection_*` endpoints and their own MEGA
   credentials, not a shared global Rclone profile.
6. **Revocation and evidence:** Linked-Google access can be independently
   revoked; disconnect never deletes owner legacy data. Keep non-secret audit
   events for deny, grant, revoke and failed delegated access.

## Release sequence
- Review the current Dev implementation and security tests. The new
  `private-legacy-access.policy.ts` is only a pure predicate and MUST NOT be
  used as proof that a Google login has been authenticated.
- Implement and review Google account linking, durable owner registry,
  signed delegation and an independent legacy broker before exposing any
  `private_legacy_*` MCP tools.
- Deploy a separate **public pilot** with new database/key, not on the
  existing private Dev or Production service. The public pilot MUST NOT have
  inherited `RCLONE_CONFIG*`, `NYX_SHARED_ROOTS_JSON`, or a legacy file.
- Confirm public feature flags: `NYX_DEPLOYMENT_MODE=public`,
  `NYX_PUBLIC_CONNECTORS_ENABLED=true`,
  `NYX_MULTIUSER_RCLONE_ENABLED=true`. Test through real Google and MEGA
  sign-ins, never credentials in ChatGPT.
- Run two authorized-owner, two unrelated-user, anonymous-user and mixed
  subject/Google-sub tests against *both* public and broker endpoints.
  Unauthorized requests must return 403 without revealing operator remotes.
- Test foreign-owner list, connection probe, credentials, revoke, root traversal,
  token replay, expired delegation, wrong broker audience and concurrency.
  Test restart, key rotation/rollback and absence of credential leakage.
- Promote Dev -> Tester -> Production only after exact SHA/build/tests,
  manual provider acceptance and separately approved release. Existing
  private remotes remain online and unchanged throughout.

## Scope of this Dev patch
- Adds a fail-closed pure policy that requires matching trusted MCP issuer/sub,
  Google issuer/sub and verified email, against at most two configured links.
- Adds synthetic negative and positive unit tests.
- Does **not** implement Google account linking, bridge transport, broker tools,
  live MEGA enrollment, tenant deployment or cross-user production verification.
- Does **not** modify any NYX Head, Body, Footer or operator credentials.

The legacy private integration is intentionally blocked until every above
security condition is independently verified.
