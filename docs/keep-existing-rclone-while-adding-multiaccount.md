# Preserve the existing NestNyx plugin and Rclone remotes during multi-account migration

**Owner priority:** "Keep old connection that I have now and build the rest on top so we never lose it completely even if anything, after tests we delete."

**Status:** Staging plan, not a production migration. No live app settings, Rclone credentials or provider authorizations were changed. Canonical Head/Body/Footer are not modified.

## Non-negotiable safe rollout

1. **Leave the existing NestNyx production Heroku app / connected ChatGPT plugin untouched.** Retain its current private operator-mode Rclone connection, API endpoint, OAuth identity, app name and stored remotes. Never auto-revoke, auto-convert, auto-replace or disconnect it when the new code ships.
2. **Create an independent staging Heroku app** only when the owner explicitly authorizes creation and any costs. Its own URL, OAuth audience/callback, database and encryption key must be distinct. It must not point to production-write storage during testing. Never switch `NYX_DEPLOYMENT_MODE` to `public` inside the existing production app as a migration shortcut.
3. **Back up current operator Rclone configuration privately and securely before testing**, outside GitHub, ChatGPT, PRs, logs and unencrypted Google Drive. Verify restore on a separate private machine/app without exposing secrets to assistants. Retain working deployment image/commit, app configuration names, key availability, and a rollback plan; record no credential values.
4. **Add independent Google Drive and MEGA connections** on staging via owner-bound OAuth / private HTTPS form. A single Rclone binary serves multiple accounts; each account retains separate scoped authorization and encrypted credentials.
5. **Test at least two accounts per provider on staging**. Test distinct user subjects, isolated data, independent account labels/IDs and reconnect persistence across app restart; validate rate/cap (6 MEGA and 9 Google Drive per user), simultaneous accounts, failure/retry and token refresh/session persistence. Verify no Rclone-global credential file is read in tenant mode.
6. **Verify read and write safely within disposable test folders**, and compare each account's permissions; never test deletion on real user files. The current development interface supports account onboarding/probes but full tenant Rclone copy/move/file operations are NOT implemented; do not report them ready.
7. **Do not remove or alter the old connector after tests just because CI passed.** The owner must confirm a successful separate live rollout and proven fallback first, and authorize the final retirement explicitly. Keep a versioned, recoverable encrypted backup for an agreed retention period after retirement.
8. **Only then** roll out the new multi-user plugin, reconnect ChatGPT to its new URL when needed, verify tool inventory and authorized accounts; preserve the original ChatGPT connection until the replacement has passed a complete real-world smoke test.

## Deployment and data boundaries

- Old **private operator mode** uses process-level `RCLONE_CONFIG_B64` or `RCLONE_CONFIG_PATH` and existing `RcloneService`. The existing config contains credentials and must never be printed, copied to public code, or shared with tenant users.
- New **public tenant mode** uses `TenantRcloneService` and owner-scoped encrypted database records. It is currently disabled by default, must have separate staging configuration, and never reads the legacy operator remotes.
- The two modes must run in **separate apps** during acceptance testing, not share an app with different config toggles. That way an outage or faulty rollout cannot overwrite the old configuration.
- A deploy is not equivalent to successful provisioning; the private operator runtime currently exposes only legacy inventory tools, and existing data might be stored in ephemeral dyno filesystem. Verify independent backing configuration and backup rather than assuming a Heroku dyno contains a persistent restore point.
- Never silently change subscription tier, dyno count, billing, OAuth scopes or connection ownership. Heroku remains operator-managed.

## Acceptance test checklist (staging only)

- [ ] Current production plugin continues returning expected legacy Rclone inventory across all tests.
- [ ] Restorable encrypted private backup of legacy configuration and required app settings verified.
- [ ] Independent staging service accessible, using non-production keys and database.
- [ ] Google Drive account #1 and account #2 authorized; connections listed separately.
- [ ] MEGA account #1 and account #2 authorized; connections listed separately.
- [ ] Distinct signed-in users cannot see/use/rename/delete one another's connections.
- [ ] 6 MEGA / 9 Google Drive per user caps enforced, including concurrent requests.
- [ ] Provider callbacks and tokens persist across staging restart without leaking values.
- [ ] Each connection's read and disposable-folder write tests pass.
- [ ] Different storage access methods select correct owner, provider, and path scope.
- [ ] No retroactive exposure of private operator remotes in public tool inventory.
- [ ] Disconnecting a staging test account leaves every other account and old private plugin unaffected.
- [ ] Two-app rollback plan proven; previous production deployment remains usable.
- [ ] Owner approves explicit old-plugin retirement **after** all above checks.

**As of this development proposal:** no tests with the owner's live accounts, no staging Heroku service and no production rollout have been performed.
