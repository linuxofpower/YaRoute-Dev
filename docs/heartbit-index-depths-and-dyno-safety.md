# HeartBit/NestNyx storage index — three depth modes (Phase B policy)

Tracking: #130, layered on draft PR #131. This branch adds a **pure traversal policy**. No Heroku formation dyno, queue, database migration, provider crawl, scheduler, or OAuth authority is created by this PR.

## Observed 2026-11-16

- Canonical local `n_paths.json` states Head H32 / Body B28 / Footer F102. NestNyxPro deployment's older H31/B27/F97 cache is not canonical authority.
- On 2026-11-15 user observed only `web.1` Eco and valid `/mcp` Bearer 401 challenge; this is historical telemetry, not an up-to-the-minute Heroku formation check.
- Live DevNestNyx Primary storage inventory: two **active MEGA** connections, one **pending** Google Drive connection; Personal inventory empty. No connection outside an authenticated owner's activated roots may be indexed. The private Pro broker remains gated. A ChatGPT-connected Google Drive grant is not a NestNyx backend grant.
- `TenantRcloneService.listAuthorizedRoot` returns at most **100 entries** for **one** directory, includes `truncated`. It has no pagination cursor. Any truncated directory blocks an honest complete traversal until a paging/continuation-capable adapter exists.

## Mode semantics

| Mode | Traversal maxDepth | Per-invocation max directories | Per-invocation max entries | Runtime budget |
| --- | ---: | ---: | ---: | ---: |
| shallow | 1 (the authorized root only) | 1 | 100 | 30 s |
| normal | 3 (root + 2 descendant directory levels) | 24 | 1,200 | 90 s |
| deep | 64 (bounded recursion, not limitless) | 48 | 4,000 | 120 s |

Note: maxDepth=64 is a safety guard; any hierarchy deeper than 64 is intentionally **not complete**. This policy currently has no mechanism for certification of root completeness beyond its own depth cap and no approved deployment. Later code must explicitly distinguish `DEPTH_LIMIT_REACHED`, `PARTIAL`, and `COMPLETE` in persisted receipts. Do not describe a normal/deep index as globally complete if some directories were truncated or depth-limited.

Policy can advance one directory at a time. Every step returns the next scoped pending queue and a strictly bounded, read-only metadata batch; it refuses foreign owner/connection/root, malformed paths, unbounded entries, invalid checkpoints, and duplicate directories. Neither the scope hash nor the traversal checkpoint is an authentication credential.

## Deploy shape (not yet implemented)

- Keep the existing `web.1` Eco dyno unchanged.
- Implement `indexer: node dist/indexing/worker-once.js` only after that file truly exists and is integration-tested; do not add a broken Procfile entry.
- Persist owner- and connection-bound job consent, scope, mode, queue, checkpoints, and rows in **free Neon Postgres**. Back end must obtain OAuth owner only from verified ChatGPT/NestNyx claims, and rerun provider authorization checks at each job.
- Claim jobs with a unique transaction-safe/lease key and refuse duplicate same-owner same-root concurrent runs. Add explicit consent to index file metadata, controls to pause, revoke, clear and search. On disconnect erase/revoke relevant entries.
- Manual `heroku run` one-off first. For unattended operation choose a free Heroku Scheduler one-off after review; skip/duplicate jobs are possible and require idempotence. Never enable a permanent second Eco `worker.1` blindly.
- Do not cache raw OAuth access/refresh tokens in the index table, log sensitive paths, read file contents, follow symlinks outside an authorized root, or automatically expand permissions to pending/other accounts.

## Budget

Heroku Eco is 1,000 **shared** dyno-hours per month for the $5 plan. Two continuously active dynos would use ~1,440 hours in a 30-day month and can exhaust the entire account pool; Eco worker sleeping is linked to web idleness and is not reliable for scheduled tasks. One-off scheduler dynos incur only their run duration. Maintain room for web.1 and other apps.

## Additional acceptance gates

1. Exact live dyno formation/commit, branch-specific CI, and current production audit.
2. Page/cursor-capable source adapter for directory listing >100 entries; deep mode must be resumable and accurate.
3. Free Neon dev branch, schema migration, indexer job engine, server-sourced immutable identity, retry recovery, confidential metadata management and isolation tests.
4. Two real opted-in tenants, with one live MEGA root and independent cross-owner deny. Google Drive follows after separate OAuth activation.
5. First two actual manual one-off runs with receipts; only then review recurring schedules and whether to run normal/deep.
6. No ChatGPT Work mode, no core generations, no private legacy Rclone side access; respect all excluded FileFilter/media maintenance tasks.
