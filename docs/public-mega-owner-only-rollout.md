# Public NestNyx rollout: operator Rclone + everyone else's MEGA

Status: Dev-only staged code. **Not** evidence of deployment, authentication
by the designated Google account, or a successful live two-user isolation test.

## Desired authorization split

| Caller | Private operator Rclone | Independent MEGA |
| --- | --- | --- |
| Verified designated Google owner (separate Google OIDC proof + bound MCP identity) | Read-only allowlisted roots through isolated broker | May connect own MEGA |
| Any other OAuth-authenticated user | DENIED, including private remote inventory | Own MEGA connections only |
| No valid OAuth access token | DENIED | DENIED |

- Existing operator Rclone credentials remain on the **private** service.
  Local Termux and Arch Linux Rclone files are not copied or exposed.
- Public users get isolated `mega` credentials encrypted under their owner ID
  and connection ID, with independently selected MEGA root and read-only listing.
- The public service MUST NOT receive `RCLONE_CONFIG*`, an operator
  `rclone.conf`, or `NYX_SHARED_ROOTS_JSON`.
- Owner-only broker functionality remains behind separate flags and linked
  verified identity, with one-use signed delegation, exact roots and rate limits.
- Existing Google Drive tenant connections may be revoked after switching,
  but no further credential staging, testing, listing or activation is allowed.

## MEGA-only public switch

In the separate public pilot, with independently configured database,
key and OAuth settings, enable:

```text
NYX_DEPLOYMENT_MODE=public
NYX_PUBLIC_CONNECTORS_ENABLED=true
NYX_MULTIUSER_RCLONE_ENABLED=true
NYX_PUBLIC_TENANT_MEGA_ONLY=true
```

The last switch is checked in the connection metadata service, the
Rclone tenant credential executor, Google Drive OAuth enrollment/callback,
and the Connections panel. It does not change the private service.

The private legacy bridge has its own independent keys and flags in
`docs/public-legacy-broker-v1.md`. Do not turn it on until the designated
Google owner's immutable subject is verified and linked. Public MEGA
onboarding does not require the private bridge to be enabled.

## Acceptance before enabling on a shared plugin

1. Dev PR exact SHA CI/build/security checks PASS; no credentials committed.
2. Deploy a new isolated, budget-approved public pilot; keep private Dev/Pro
   Rclone service untouched, including its existing Heroku config.
3. Anonymous MCP request is rejected with 401; two signed-in users have
   independently scoped PostgreSQL connections.
4. User A and B each enroll distinct MEGA accounts via first-party HTTPS,
   including any 2FA, activate their own selected roots, read-only list,
   then cannot access or revoke each other's connections.
5. Attempt to create, authorize, probe, activate and list a Google Drive
   tenant in MEGA-only mode: all DENIED. An older Google tenant can still
   revoke and erase its own credentials.
6. Other users and a wrong Google identity cannot see the private broker
   or query its remotes, including with altered MCP arguments or replay.
7. Designated owner completes the separately verified Google identity link
   and reads only server-allowlisted private roots from the isolated broker.
8. Check restart, session expiry, token replay, non-secret audit receipts
   and rollback. No writes/deletes/copies may be available initially.

## Non-production GitHub approval policy

The project operator delegates Dev and unprotected Tester integration after
**verified CI, security checks, exact branch/head SHA and safe diff**. Use the
connected GitHub merge action when authorized; verify merge commit and
destination branch. Do **not** ask the operator to click a Dev or Tester merge.

Only changes targeting `yaMorozYaroslav/YaRoute:master` are the
operator's manual approval gate. This policy is not a blanket permission
to bypass repository rules, skip failed tests, change credentials, deploy
cloud services, or merge into protected production.
If permission or CI blocks non-production integration, stop with the
concrete failing receipt rather than inventing completion.
