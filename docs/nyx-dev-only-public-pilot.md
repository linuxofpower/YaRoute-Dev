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
