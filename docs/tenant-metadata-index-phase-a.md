# Tenant-isolated background storage indexing — Phase A

Tracking: GitHub issue #130. This is an **inert, read-only contract layer**, not a running worker. It does not modify Heroku, Neon, OAuth, provider contents, ChatGPT tasks, or the canonical Head/Body/Footer.

## Confirmed boundaries (2026-11-15)

- Public multiuser deployment disables the legacy `JobWorkerService` global-index lane. **Never turn it on for public tenants.**
- `TenantRcloneService.listAuthorizedRoot` already accepts a server-derived OAuth owner and checks that owner's connection, provider, selected root and read permission. It returns at most 100 entries from one directory plus `truncated` and `readOnly`.
- `prepareAuthorizedMetadataBatch` is only an internal formatter for that authorized return value. It **cannot authorize a request by itself**: the caller must obtain owner identity from validated OAuth and must call the existing authorized provider adapter first.
- A capped directory list is never treated as proof that the entire drive or root is indexed. `directoryComplete` describes **only that directory**. No missing-item deletion is authorized.
- No private-global Rclone configuration or cross-owner fallback is allowed; all paths, connection IDs and item sizes are bounded and fail closed.
- Branch/PR may run static tests but must never deploy or dispatch.

## Phased delivery

1. **Phase A (this draft):** validate scope, canonical paths, one-directory 100-item cap, partial flags, and tenant-safe batch keys; tests.
2. **Phase B:** add an authenticated MCP opt-in for one connection and one authorized root, storing a server-created job request in **free Neon** with unique owner/connection/root/slot, consent and revocation controls. Never accept an owner ID from MCP arguments.
3. **Phase C:** implement a manual-only, short-lived `index:once` process that claims one authorized job with transaction-safe lease; list bounded directories from `TenantRcloneService`, checkpoint partial runs and write owner-scoped metadata in free Neon. Invalidate stale index on disconnect. Concurrency and repeated one-offs must remain safe.
4. **Phase D:** use an opt-in single-root **MEGA** pilot (existing DEV Primary MEGA connections); test two independently observed runs, an unavailable-provider failure, and a second OAuth user seeing zero foreign metadata. Ensure budget and storage limits.
5. **Phase E:** introduce Google Drive only after it has its **own** authorized DEV storage connection. ChatGPT Google Drive connector credentials cannot be shared implicitly. Enable Heroku Scheduler only after explicit owner approval and a duplicate/skip test.

## Safety and acceptance

- No file content, secret, provider token, mutation, copy/delete, broad private scan, or unbounded recursion.
- No production deploy or public feature enablement until the production dependency audit is reviewed and all CI gates pass.
- No new permanent worker dyno and no ChatGPT Work mode.
- The existing ChatGPT HeartBit coordinator remains the owner of its workflow; this index lane is separate from draft PR #119.
- The MVP provides a persistent index only **after** Phase C succeeds on a verified Dev release. Phase A alone does not populate Neon or run unattended.
