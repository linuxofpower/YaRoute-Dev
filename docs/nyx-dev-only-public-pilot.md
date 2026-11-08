# Dev/Tester public-pilot development without changing Pro

## Agreed scope (2026-11-07)

- Work in the approved Dev repository and the dedicated Tester branch only.
- Do not touch nest-nyx-pro live settings, protected master/main, or private Rclone credentials.
- Keep Heroku CLI administration with the existing ya.moroz.yaroslav login; connect or delegate an independent Heroku integration later.
- Public pilot target remains the EXISTING Dev app using free nestnyx-public Neon and a separate tenant key.
- The two test users will separately authorize their own Google Drive and MEGA accounts after the public runtime has passed live isolation checks.

## Offline Dev-only planning

Use a sanitized audit from the existing read-only tool:

    node scripts/nyx-heroku-two-app-audit.mjs > ~/nestnyx-sanitized-audit.json || test $? -eq 2
    node scripts/nyx-dev-public-plan.mjs --audit-file ~/nestnyx-sanitized-audit.json

The second script opens a local JSON report only. It calls neither Heroku nor Pro, never prints credentials, and makes no modifications. Exit code 2 means Dev preparation has outstanding configuration gates. Do not provide it with raw Heroku configuration.

The existing guarded --plan / --apply cutover contract is **unchanged** and may block on Pro requirements. These requirements are not being disabled; this offline tool is for software preparation, not deployment authorization.

## Until live readiness

Build/tests in Dev and promote via the existing CI-gated Tester branch. Simulate two independent tenants with synthetic credentials and prove provider routing, root containment, no global config fallback, encryption isolation, revocation, and a safe restart. Do not invite the real second user while Dev still has legacy private remotes.

A green configuration report is **not** live authorization proof. Live readiness additionally requires independent key/database review, runtime tenant endpoint inventory, missing legacy remotes, anonymous 401, cross-tenant 403, two separate provider consents, and restart/revocation checks. These must be verified before account onboarding. Pro changes are deferred to a distinct future release, not silently bundled with Dev.

## Opt-in Dev-only live cutover (Pro unchanged)

There is a separate opt-in mode on the existing guarded Termux cutover tool:

    node scripts/nyx-termux-public-cutover.mjs --dev-only-plan

The Dev-only plan READS both Heroku applications to compare origins, the current
private baseline, separate databases and authorized operator account. It does
NOT require enabling the Pro singleton-owner lock. The original --plan and
--apply commands retain strict Pro-singleton requirements.

After independently confirming the private Pro is operable and Dev credentials
have a recoverable source, the operator can use:

    node scripts/nyx-termux-public-cutover.mjs --dev-only-apply

This mode never PATCHes Pro and never writes to protected master. It
interactively accepts the existing FREE public Neon connection (not a
Heroku add-on) and the Drive-specific Google OAuth web client, generates a
fresh encryption key, and seals the existing Dev configuration to a
mode-0600 encrypted local recovery file before ONE Dev-only config PATCH.
The recovery passphrase must be at least 16 characters and stored
separately by the operator. Never paste raw Heroku config, database URL,
OAuth client secret, recovery passphrase, or encrypted backup into chat
or a repository. Keep the encrypted recovery file somewhere private.

Verify Google OAuth redirect URI:
    https://dev-nest-nyx-0df80c227630.herokuapp.com/connect/google/callback
Use the separate existing free public Neon project, preserving the former
private Dev Neon for recovery.

Stop if the post-cutover read-only audit still reports private Dev remotes,
mismatched database host/key, or public flags disabled. Verify deployed
health commit, public tenant MCP tool inventory, anonymous 401, legacy
tool denial, and cross-owner 403 before inviting any second user.
Config-only PASS does not establish live Auth0 identity, provider consent,
token refresh, restart persistence or revocation.

Pro remains unchanged during this pilot. Public Dev must keep all private
broker linking OFF, NO inherited global Rclone credentials, and NO private
owner allowlist.

## Safe automatic upload of Dev-only preflight reports

The existing v001 capture kit was manual, and the later v002 global capture hook
was never verified installed. Avoid suggesting users manually paste CLI output.

From a current Dev checkout on an authenticated Termux machine with the
existing private Rclone remote, run this single command:

    node scripts/nyx-termux-dev-preflight-capture.mjs

It runs the read-only Dev-only cutover plan and separately reads only Heroku
Dev formation type, size and quantity. It writes a sanitized JSON report to
the private Termux folder under ~/NYXCaptures/termux/nestnyx-dev-preflight.
The script automatically uploads the JSON into the historical
Documents/Nyxpad/CommandOutputs/termux/nestnyx-dev-preflight Drive archive
and downloads it again to check the SHA-256 before reporting success.

It never uploads Heroku access tokens, raw Heroku configuration, process
environment, rclone.conf, private OAuth fields, full stdout or stderr.
Error code 2 means the sanitized evidence uploaded successfully but
the read-only cutover plan remains blocked. Error code 3 means the
capture or upload was not verified; local evidence is retained.

The NON_ECO_DYNO_PRESENT condition signals an active Heroku dyno size
outside the operator tool's budget allowlist. Inspect the actual active
size before changing a plan, purchasing a dyno or considering exceptions.
No CLI command here changes Heroku, Pro, Neon, OAuth or any storage.


## RclonePnP public OAuth client and the legacy client

The user created a NEW Google OAuth Web application client named RclonePnP
under the existing Google Cloud project. The client name is public metadata,
NOT the client ID. Exact client ID/secret are provided only interactively to
the Dev-only apply tool; never commit or upload either.

Public Dev uses one shared OAuth Web *client application* (NYX_GOOGLE_CLIENT_ID,
NYX_GOOGLE_CLIENT_SECRET) for both users' independent Google Drive grants.
Each tenant's tokens, roots, refresh and access controls remain separate.
Do not import any old rclone.conf or tokens into the public tenant vault.
The cutover now rejects the newly entered client ID if it equals a detectable
legacy Dev/Pro Rclone or Google OAuth client ID. Inaccessible local config files
cannot be inferred or read by this check.

The existing legacy Rclone OAuth client is reserved for the separate historical
ya.moroz.yaroslav environment, as requested. That is the desired future account
boundary, not proof of current token ownership or a request to modify Pro.
Existing Pro and local Rclone configs are NOT changed in this Dev phase.
Do not revoke any existing account tokens or rename remotes automatically.

The Web client needs exactly this redirect:
https://dev-nest-nyx-0df80c227630.herokuapp.com/connect/google/callback
The user-shared hyperlink may be truncated; do not assume Google's registered
redirect has been verified by backend or provider until the consent callback
succeeds. Heroku's OAuth login/administrator account is a separate identity.

## Immediate Nyxpad capture convention

For Dev/Tester operator diagnostics, always provide the existing safe
capturing command rather than raw command output copy/paste:

    node scripts/nyx-termux-dev-preflight-capture.mjs

This runs the guarded read-only Dev-only plan and sanitized two-app audit,
records each allowlisted command name and outcome, inspects only active Dev
Heroku formation, writes a single privacy-filtered local report, immediately
uploads to Documents/Nyxpad/CommandOutputs/termux/nestnyx-dev-preflight,
and verifies the uploaded SHA-256 before reporting verified success.

When the user later says 'done', SEARCH the actual Drive Nyxpad folder for the
latest report and READ it. Do not ask for raw terminal output if the uploaded
report is available. If no new uploaded file exists, accurately report that
the capture/upload is missing or failed and use the local fallback.

This applies to explicit privacy-reviewed command capture, not an unverified
always-on shell hook. Never auto-upload Heroku config exports, Google OAuth
secrets, passwords, tokens, recovery/2FA codes, full terminal history, or
the encrypted Dev rollback artifact.

## Release-source safety gate before public Dev switching

Before applying public Dev config, the operator-only cutover now makes a
read-only HTTPS request to the EXISTING Dev `/health` endpoint and compares
its reported Git source commit against the checked-out Dev repository HEAD.
If the release commit is absent, mismatched, or health is unavailable,
`--dev-only-apply` stops with `CUTOVER_STOPPED: DEV_DEPLOYED_RELEASE_NOT_CURRENT`
BEFORE any new credential prompts or Heroku mutations. The strict default
production cutover remains unchanged; Pro and protected master remain untouched.

The normal safe Nyxpad capture also reads this public health endpoint and
saves only its sanitized status and commits in its regular SHA-256-verified
command-output report. A green configuration preflight without a verified
deployed source is **not** authorization for a live cutover. If the deployment
is older, use the approved existing Dev-only Heroku deployment process,
verify its new health commit, and rerun the safe capture. Do not touch Pro
or pay for additional dynos/addons. Do not paste raw release or Heroku config.
