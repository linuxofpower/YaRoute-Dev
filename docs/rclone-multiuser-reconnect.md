# Multiple-user Rclone reconnect — isolated DEV (2026-10-15)

**Status: DEV draft PR; not deployed. Feature flag defaults OFF.**
**Never delete or rotate the legacy operator config before independently verified rollback.**

## Two separate authorization planes

- **Native ChatGPT Google Drive:** Google consent managed by the ChatGPT connector. Users connect it inside ChatGPT. Tokens are never shared with Rclone.
- **NestNyx Google Drive & MEGA through Rclone:** JWT-authenticated NestNyx owner -> separate immutable connection ID -> explicit provider authorization -> selected Drive folder or MEGA root -> read-only Rclone probe -> manual activation.
- The same Rclone executable can serve multiple users; one global credential file **cannot** safely serve unrelated users.

## Implemented in DEV

- `TenantRcloneService`: independent, encrypted PostgreSQL V2 credential records keyed by owner and immutable connection ID. Pending and active credentials coexist through tests. Every Rclone invocation creates a private `0600` config under a unique `0700` directory; legacy config and inherited credentials are not used.
- Per-tenant MCP tools: list/create Google/MEGA connections, select read-only `storage:list`, choose exact Drive folder ID or MEGA root, begin provider authorization, test pending credentials, activate after verification. New storage tools register only when the isolated public feature flag is enabled.
- `TenantGoogleOAuthService`: read-only Drive OAuth2 authorization code + PKCE, one-use hashed state, encrypted temporary verifier, 10-minute expiration, Google account verification, offline refresh token and no token returned to browser or ChatGPT.
- `TenantMegaEnrollmentService`: expiring, owner-scoped HTTPS setup link and first-party form. Password is never sent via GPT, command arguments, or URLs. Server runs `rclone obscure -` via standard input before encryption. Successful MEGA read probe is required before verified provider grant; temporary failure cannot replace active credentials.
- `RcloneService` refuses all legacy commands in public connector mode, but now allows bootstrapping the isolated public runtime without loading `RCLONE_CONFIG_B64`. `SharedRootsService` similarly hides legacy private roots from public tenants.
- Old private mode and existing production settings remain unchanged. All new code is behind the `NYX_MULTIUSER_RCLONE_ENABLED=true` switch.

## Explicit user configuration required in an ISOLATED DEV Heroku environment

1. Create a Google Cloud OAuth web client for the DEV NestNyx host, enable Google Drive API and configure the **exact** HTTPS authorized callback: `https://YOUR-DEV-HOST/connect/google/callback`.
2. Finish Google OAuth consent-screen requirements for requested `openid`, `email`, and Drive `drive.readonly` scopes. If Google requires verification or test-user approval, complete that with Google before offering the connector to others.
3. Configure separate DEV secrets, not in GitHub files or ChatGPT: `NYX_GOOGLE_CLIENT_ID`, `NYX_GOOGLE_CLIENT_SECRET`, `NYX_STORAGE_ENCRYPTION_KEY` (fresh random 32-byte base64 key), `DATABASE_URL`, `NYX_PUBLIC_URL`, and JWT/OIDC secrets/settings already required by NestNyx.
4. Only in the **independent DEV** deployment set `NYX_DEPLOYMENT_MODE=public`, `NYX_PUBLIC_CONNECTORS_ENABLED=true` and `NYX_MULTIUSER_RCLONE_ENABLED=true`; never activate this feature on the existing private production service. Do not copy the production operator Rclone config.
5. Connect two test users separately. For each, create an owner-specific storage connection, explicitly select a folder/root, begin Google OAuth or open the secure MEGA login link, then run a read-only probe and activate.
6. Prove cross-tenant access is denied and refresh/restart/rollback work. Do not enable storage writes/moves/deletes until separate risk gates and user-specific approval have been implemented.

## Limitations / release gates

- Native ChatGPT Google Drive consent remains separate; the code cannot create or authorize users' native ChatGPT connector sessions.
- The new read-only storage path is not a general file-management API yet. Write access is **not implemented**, even if Google or Rclone remote could write elsewhere.
- The current MEGA browser enrollment does **not** implement an additional MEGA 2FA challenge. Do **not** disable 2FA to use NestNyx.
- User-visible storage provider cards in the existing GitHub-only NestNyx connection UI still require dedicated UI work; the new backend MCP tools provide the staged onboarding.
- Live provider acceptance, cross-tenant integration tests and independent deployment tests have **not** been performed. CI/unit passing is not proof of provider access.
- Each provider may enforce additional consent or OAuth verification requirements. `storage:list` grants must be provider-verified, user-enabled and root-bound. A successful generic root probe does not prove any write permission.

## Rollback

Disable `NYX_MULTIUSER_RCLONE_ENABLED` in DEV, or revert this draft PR. No legacy Rclone remote, `RCLONE_CONFIG_B64`, `NYX_SHARED_ROOTS_JSON`, production storage credential, or Head/Body/Footer file has been altered by this PR. No old credential is deleted by V2 staging.


## Additional Dev hardening — 2026-10-26

- MEGA read verification now **requires exactly one selected MEGA root** per new
  pilot connection. Selecting a subfolder tests that subfolder itself; success at
  account root alone is no longer accepted as proof of subfolder authorization.
- A 10-minute MEGA enrollment state pins the root selected when the flow started.
  If connection permissions or the selected root change before submission, the
  pending probe fails closed. An explicit `MEGA_ROOT` selection probes the account
  root, with no implied access to other tenants.
- `nyx_storage_connection_test_active` provides an authenticated, read-only
  post-activation probe of the exact authorized root/subfolder. It delegates to
  `TenantRcloneService.probeAuthorizedRoot`, which checks owner identity,
  connection id, provider, capability and resource id and does not invoke the
  legacy/global Rclone config. The tool reports only connectivity status.
- Regression tests added in `tests/tenant-mega-root-security.test.cjs` and
  `tests/tenant-active-root.test.cjs`. They cover foreign-owner denial,
  selected-root mismatch, unavailable subfolder, root traversal, single-root
  selection, state handoff, and active-root authorization.
- **Existing live private endpoints tested independently**: both DevNestNyx and
  NestNyxPro successfully listed both legacy MEGA roots, resolved one item through
  `nyx_mega_stat` per account, and returned capacity for two MEGA accounts.
  A relative path traversal attempt was refused. Those checks do not exercise
  the new user-specific endpoints and do not justify enabling the feature on
  the existing private Heroku instances.
- Real two-user onboarding, distinct MEGA provider sign-ins, 2FA behavior,
  independently isolated hosting, restarts, rollback and user-visible
  provider integration **remain unverified**. Do not remove old storage
  configuration and do not flip public mode on an operating private plugin.

**Release gate:** use a dedicated isolated pilot deployment, review the changes
against current Dev `main`, and exercise two real independently authenticated
ChatGPT owners before enabling general onboarding. Grant storage:list only until
provider-scoped write operations and audit/recovery controls are developed.


## Parallel migration: keep private Rclone while launching public multi-user connectors (2026-10-26)

**Run separate app instances in parallel.** Keep the existing private DevNestNyx and
NestNyxPro instances and their legacy operator Rclone configuration unchanged.
For public MEGA and Google Drive onboarding use an **isolated new pilot app** with
an independent database, AES-256-GCM encryption key, OIDC validation settings,
and Google OAuth consent configuration. Never flip the existing private app
to public mode just to enable this pilot.

The pilot now includes owner-scoped storage connection creation, user-controlled
read-only grants, separate MEGA browser enrollment or Google OAuth/PKCE,
encrypted pending/active credentials, one-use per-invocation private Rclone
configs, exact selected-root verification, active root checks, and
`nyx_storage_connection_list_files`: bounded read-only folder listing through
the authenticated user's own credential and selected root. The connections UI
includes a plain-text, read-only browser for activated accounts. Public health
checks report the Rclone **binary** version without opening operator secrets.
Public connector capability discovery advertises the tenant tools only when
the relevant feature gates are on.

Public tenant mode now **rejects** `RCLONE_CONFIG_B64`, `RCLONE_CONFIG_PATH`,
`RCLONE_CONFIG`, and `NYX_SHARED_ROOTS_JSON` in its environment. Keep those
only in private legacy apps. Do not reuse the private app's database, storage
key, provider credential cache, or global Rclone config.

### New independent pilot deployment — not yet performed

Deploy the reviewed, reconciled Dev code to a **separate** HTTPS Heroku pilot
with distinct `DATABASE_URL`, `NYX_STORAGE_ENCRYPTION_KEY` (fresh random
32-byte base64 AES key), `NYX_PUBLIC_URL`, a properly scoped OIDC JWT issuer/
audience, and separate Google Drive OAuth client credentials/callback
(`https://PILOT_HOST/connect/google/callback`). Register Google Drive
read-only OAuth consent. Install Rclone binary, but do **not** configure
legacy shared remotes. Only on this pilot set:
`NYX_DEPLOYMENT_MODE=public`,
`NYX_PUBLIC_CONNECTORS_ENABLED=true`,
`NYX_MULTIUSER_RCLONE_ENABLED=true`.

### Required live acceptance before production or retiring legacy

Verify pilot `/health`, source commit and plugin discovery; connect two
distinct ChatGPT OAuth subjects with separate MEGA and Google Drive accounts;
test owner/root grants, provider callback, read-only pending and active
probes and bounded folder listings, denied cross-user access, restarting the
service with encrypted credentials, and isolated rollback. Existing private
MEGA/Drive endpoints must continue working during this test. MEGA accounts
requiring an additional 2FA prompt are not yet supported by the browser
enrollment; do not disable account 2FA to test. No new tenant write, move,
copy or delete operations are enabled. Retire private Rclone credentials only
in a **later, separately reviewed cutover** after independent proof.


## One Rclone engine, independently authenticated users — 2026-10-27

**Target architecture:** one public NestNyx backend with one installed Rclone
executable. A local Arch Linux Rclone setup is **not** required to connect users.
Multiple independent MEGA/Google Drive users are isolated by their authenticated
OAuth subject and immutable connection ID, not by sharing a global config.

On each operation the backend reads one encrypted user profile from its vault,
creates one short-lived private `rclone.conf` (mode 0600) in a unique temp
directory (0700), invokes that single installed Rclone binary with `--config`
pointing to that temp file and a sanitized environment, then deletes the temp
file. Concurrent users invoke the same executable with separate ephemeral
processes/configs; they NEVER share a live credential file or provider token.
This is not a single shared Rclone remote.

**Migration:** first run the public tenant model on DevNestNyx while
NestNyxPro remains private (separate app/binary only temporarily for rollback).
Do not remove Dev's current private config until the combined connector code,
backups, dedicated tenant database and rollback procedure are independently
verified. Then convert Dev in a single planned release: switch Dev to public
mode and remove process-global legacy Rclone config variables from Dev.
Immediately test two authenticated users' real provider enrollments; roll back
Dev if acceptance fails, keeping Pro's private remotes working throughout. The
production private Rclone configuration stays intact until its own separately
approved migration. Local Arch `~/.config/rclone/rclone.conf` is not needed by
Heroku if remote connections use their own encrypted tenant profiles; delete
local credentials only after all intended operations are verified, and retain
a safe off-site recovery path.

**Public rollout is not complete:** MEGA 2FA and Google provider consent remain
real-world blockers. Only `storage:list` is implemented; do not advertise
upload/move/delete until tenant-scoped authorization, proof, recoverable
deletion, rate limits and audit are implemented and tested.


## Accepted deployment intent — both private and public remain available until acceptance (2026-10-27)

This section supersedes any earlier wording that appears to demand deleting
the private Rclone credentials as a prerequisite for proving public access.

**Two existing Heroku apps; no third app and no new Google Cloud project:**
- `DevNestNyx` deploys only `yaMorozYaroslav/YaRoute:tester`.
  Its target during acceptance is a public, JWT-authenticated **tenant**
  connector pilot for MEGA and Google Drive. An isolated tenant's credentials
  are encrypted and materialized only into a per-request ephemeral config,
  passed to one installed Rclone executable.
- `NestNyxPro` deploys only `yaMorozYaroslav/YaRoute:master`.
  It keeps private operator-owned Rclone aliases and global configuration
  strictly private and operational as a **live rollback fallback**.

**No private credential retirement until acceptance.** Store the existing
private configuration in its authorized, protected location and preserve
a tested recovery copy before changing Dev's hosting environment. Converting
Dev to public mode requires REMOVING its legacy credential variables from the
*public process environment* because the prototype deliberately refuses
mixed-credential startup; this is a runtime isolation step, NOT permission
to destroy the underlying recovery copy or Pro's working private credentials.
The existing Pro private Rclone is not removed or disabled during pilot.
If preserving private operations in the SAME Dev process is required instead,
the current code does not support it; that would need a separately designed
and security-reviewed hybrid-authorization implementation.

**Public acceptance gate before retiring even one remaining private
credential:** Real provider sign-ins from two different authenticated ChatGPT
user subjects; distinct encrypted vault identities; MEGA and Drive read-only
listings under each selected root; cross-owner and cross-root denial;
logout/revocation and OAuth refresh; safe restarts; recoverability/rollback;
audit without secrets. MEGA accounts requiring separate 2FA need additional
enrollment support first. No public writes, move or delete until independent
permission, approval and recovery tests.

Retire old private operator credentials only in a separate approved,
reversible operation after all of the above. The Rclone executable remains
necessary as the backend storage engine; only shared credential files and
aliases are migration targets.

Source-to-runtime promotion remains: `YaRoute-Dev` review PR -> explicitly
reviewed `YaRoute:tester` -> DevNestNyx; protected `YaRoute:master` ->
NestNyxPro only on accepted production PR. Do not deploy the Dev repository's
main branch directly to Dev Heroku.


## Accepted release and credential-retirement gates — 2026-10-27

### Three review stages, only two Heroku apps

1. **YaRoute-Dev** (`YaRoute-Dev` repository): implement, review,
   build and inspect all changes in feature PRs and CI. This repository is
   a source/CI staging area, NOT a third Heroku instance or an automatic
   deployment. PR #19 must be reconciled and CI-tested together with
   the changes already merged from Dev PR #32.
2. **YaRoute/tester** (`YaRoute:tester`): promote only an
   accepted Dev candidate through an explicit verified promotion; deploy to
   the existing **DevNestNyx Heroku** application; verify its exact commit,
   runtime health, OAuth and two independently authenticated user accounts.
   The first public-user trial happens here, not in NestNyxPro.
3. **YaRoute/master** (`YaRoute:master`): promote only
   specifically accepted tester releases through a protected draft PR.
   Deploy to **NestNyxPro Heroku** after owner approval and production
   rollback verification. NOT every tester commit is a production release.

### Private fallback during public testing

The current code intentionally does NOT support serving public tenant traffic
and legacy private operator storage from the SAME process. This is an
authorization isolation control, not a requirement to permanently destroy the
operator credentials. On a planned DevNestNyx public rollout:

- First preserve a secure, access-restricted backup of the Dev private
  Rclone configuration outside the public runtime and verify recovery.
- Keep the existing NestNyxPro **private Rclone** functioning throughout the
  trial; no Pro app config or credentials are changed during tester experiments.
- Convert DevNestNyx in one controlled release to public connector mode with
  a separate tenant credential vault, fresh encryption key and no legacy Rclone
  env or default on-disk config. Public boot FAILS CLOSED if it detects any of
  `RCLONE_CONFIG_B64`, `RCLONE_CONFIG_PATH`, `RCLONE_CONFIG`,
  `NYX_SHARED_ROOTS_JSON` or a leftover `/tmp/rclone.conf`.
- Run two-user MEGA and Google Drive access probes, cross-owner denial,
  OAuth refresh, restart and rollback checks after deployment. If any fail,
  roll Dev back without affecting the private Pro fallback.
- Only after complete evidence, a separate explicit acceptance and a proven
  recovery plan may legacy operator credentials be **retired**. The single
  shared Rclone executable remains; each user gets only an ephemeral per-
  invocation config derived from their encrypted, owner-scoped vault record.

Never copy a private Rclone config into a public environment, put passwords
in ChatGPT/GitHub logs or pretend CI mocks are live provider verification.
No MEGA 2FA challenge handling, public writes or deletes are released yet.

**Implementation receipt:** `src/storage/public-rclone-isolation.ts`
defines the early fail-closed runtime guard, also called by
`RcloneService.onModuleInit`. The preflight guard does not read, modify,
export or delete credential files. `tests/public-rclone-isolation.test.cjs`
covers private-env detection, stale config detection and preserved private
startup. This Dev PR is not automatically deployed or promoted.


## DevNestNyx pilot with existing Heroku private config vars — transitional only (2026-10-27)

Deployment pipeline remains **YaRoute-Dev source and CI → reviewed YaRoute/tester → DevNestNyx Heroku**. NestNyxPro deploys only the separately approved YaRoute/master. Do not point the Dev Heroku app directly to the YaRoute-Dev repository.

The owner does NOT want to remove the old private Rclone configuration values from Heroku while the replacement is being tested. The public Dev process now has a deliberately explicit compatibility path:

1. Leave the existing Heroku *stored* private values available solely for rollback. Preserve a verified private recovery path and leave Pro's operator-owned Rclone unchanged.
2. Configure only Dev with an independent tenant PostgreSQL database, a new 32-byte base64 AES vault key, trusted JWT issuer/audience/JWKS, its exact \`NYX_PUBLIC_URL\`, read-only Google OAuth client with exact callback, and secure first-party MEGA setup page.
3. On Dev's planned public deployment, enable \`NYX_DEPLOYMENT_MODE=public\`, \`NYX_PUBLIC_CONNECTORS_ENABLED=true\`, \`NYX_MULTIUSER_RCLONE_ENABLED=true\`. The new entrypoint invokes \`preparePublicRcloneEnvironment\` **before dynamically importing AppModule and constructing Nest providers**. It clears process-local \`RCLONE_CONFIG*\` and \`NYX_SHARED_ROOTS_JSON\` while leaving the Heroku application's **stored** values untouched. Both the tenant vault and private Rclone service independently refuse unsanitized private settings. Public mode excludes all legacy global storage tools.
4. Startup fails closed if a private config is present on disk at a configured path, the old \`/tmp/rclone.conf\`, or the home Rclone default. It does not read, disclose, or delete these files. Test and resolve the file-access boundary before allowing public users.
5. Do **not** treat process-local scrubbing as a strong security boundary. A compromised Heroku configuration API token, control plane or privileged code could still recover the stored operator secrets. Never claim this design is ready for general untrusted users until the stored private credentials are removed from the public app or the private credentials are moved to an isolated service/account.
6. Test two unrelated ChatGPT OAuth subjects with distinct accounts in Dev only: MEGA and Google provider consent, expected scope/folder, no alternate-root or cross-owner access, session refresh, restart, revocation and separate Pro fallback. Never ask for provider secrets in ChatGPT. MEGA separate 2FA challenge remains unsupported.
7. Only after a separately accepted rollout should production be considered. Retirement of operator credentials requires another explicit accepted transaction. The *Rclone executable* remains installed: user-specific credentials exist only as encrypted records and temporary per-operation config files.

**Live readiness requires actual deployed \`YaRoute/tester\` commit verification, a successful HTTPS \`/health\`, authenticated \`nyx_storage_connection_create\` exposure, and real provider flows.** Mock CI passing in the Dev repo alone is not a live acceptance receipt.
