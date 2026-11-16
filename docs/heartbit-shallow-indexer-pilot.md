# HeartBit read-only shallow indexing lane — DEV draft

Tracking: #130. Stacked on draft PRs #131 and #135.

## Explicit user intent

A NestNyx-connected Drive/MEGA provider should be independently usable by the backend after ChatGPT closes, *if its provider grant remains valid*. ChatGPT's own Drive connector is not NestNyx's credential source. OAuth provider grants must remain owner-scoped, revocable, and separately authorized. Google authorization already requests `drive.readonly`, `access_type=offline`, and stores a refresh token in the AES-GCM credential vault. Durable refresh token rotation/writeback across isolated rclone subprocesses is NOT proven by this branch. MEGA session recovery also needs live failure tests. Never promise indefinite unattended access.

## Branch deliverable (OFF by default)

- Reviewed SQL migration in `migrations/20261116_tenant_shallow_index_v1.sql` for the existing **free Neon nestnyx-dev** database (test on isolated Neon branch first).
- `ShallowIndexService`: authenticated **per-owner per-active-connection per-root explicit opt-in**, status and opt-out. Provider read is restricted to the existing isolated `TenantRcloneService`.
- One-off CLI `node dist/indexing/worker-once.js`: claim one lease at a time, validate connection authorization on each run, collect **root-only** listing, encrypt cached paths and HMAC path keys, persist only verified complete listing (maximum 100 entries), return JSON counts, exit.
- Disabled by default, requires `NYX_TENANT_SHALLOW_INDEX_ENABLED=true`, public tenant flags, existing vault key, and SQL schema. No loop/always-on dyno and no private global rclone fallback.
- No automatic opt-in on connection. The user must knowingly enable background metadata indexing for an active root; a ChatGPT app OAuth login by itself does NOT authorize provider indexing.
- Known limitation: directory listings over 100 entries have no pagination. They are `BLOCKED_TRUNCATED` and the job is disabled rather than falsely marked complete. Recursive normal/deep modes are NOT enabled in this MVP.
- No provider changes/copies/moves/deletes, no content download, no AI analysis, no Work mode, no outgoing mail.

## Security gates before a release

1. Review branch-specific build, test and production `npm audit`. This PR cannot be merged merely because the narrow unit tests pass.
2. On isolated Neon DEV review branch, apply the migration with **direct**, non-pooler connection, validate schema and a transaction rollback. Production Neon unchanged.
3. Wire and exercise the new MCP opt-in/opt-out/status commands under separately authenticated owner A/B. Independently verify no cross-owner job visibility or arbitrary owner IDs.
4. Verify storage disconnect/revoke erases its cached rows and stops running jobs; actual provider OAuth revocation and token refresh/rotation should be exercised with consent.
5. Deploy reviewed code to DEV; compare exact deployed SHA, then test one explicit user-authorized MEGA root manually with `heroku run -a dev-nest-nyx -- node dist/indexing/worker-once.js`.
6. **Only later:** install/configure Heroku Scheduler and run the above command hourly. Scheduler can skip/repeat; Postgres lease and idempotent writes are mandatory.
7. Normal/deep modes require provider pagination and resumable per-directory cursors; private Pro and unactivated Drive connections remain excluded.

## Eco dyno design

No permanent additional worker formation dyno. Existing `web.1` stays unchanged. Temporary one-off process claims one eligible job and exits; total monthly usage counts toward shared Eco 1,000-hour quota. The GitHub PR does not change deployed formation, config vars, add-ons, or pricing.
