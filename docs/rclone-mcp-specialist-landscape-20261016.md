# NYX-owned Rclone MCP connection specialist — landscape and public gate
Date: 2026-10-16. **Research/architecture proposal only; no vendor code installed, no production deployment.**

## Our product boundaries

- Exactly **two** applications: blue **DevNestNyx** and purple **NestNyx**. No third Heroku app.
- NYX owns provider-independent user identity, provider consent, connection records, encryption, scoped authorization, job isolation, read-only inventory, and review-gated changes.
- Rclone is the storage engine, **not a trust boundary** and **not a public administrative API**.
- Native ChatGPT Google Drive remains separate from NestNyx's Google/MEGA Rclone connections.
- Existing private remotes stay untouched until proven safe migration. Planned connection ceilings from NoteFlow draft: six MEGA and nine Google Drive accounts per user, subject to design and rate-limit verification.

## Relevant upstream projects (checked 2026-10-16)

| Candidate | What it supplies | Licensing / fit | Explicit release caveat |
|---|---|---|---|
| https://github.com/rclone-ui/rclone-mcp | MCP bridge to Rclone Remote Control, advertised 98 auto-generated API tools, read-only flag and HTTP/stdio transports | MIT; examine *tool catalog/design* as a reference | Does not establish multi-tenant authorization. Never expose an unaudited RC daemon or all 98 commands publicly. |
| https://github.com/rclone/rclone-ui | Cross-platform Rclone remote/task GUI and remote instance management | Apache-2.0; connection UX ideas | A standalone UI isn't a secure public per-user MCP boundary. |
| https://github.com/rclone/rclone-web | Official lightweight web dashboard embedded by `rclone gui` | Browser UI design reference | Do not expose its underlying full RC API to tenants. |
| https://github.com/rclone/rclone-openapi | Typed OpenAPI 3.1 description of RC actions | MIT; use schema/types as allow-list development aid | Schemas don't enforce permissions, path boundaries or job limits. |
| https://github.com/hyunjae-labs/rclone-drive-mcp | Google Drive path-oriented MCP proof | Reference for path UX | Single-remote example, not verified multiuser security and MEGA support. |
| https://rclone.org/rc/ | Official remote-control API and security guidance | Authoritative security analysis | RC access can imply arbitrary commands/filesystem access. Treat RC like local shell access. |

## NYX Rclone MCP specialist design

1. ChatGPT/Claude/other model calls **NestNyx's authenticated MCP**, not `rclone rcd` directly. Owner comes exclusively from verified JWT/session. No model-supplied owner identity or reusable credential.
2. `list_connections`, `start_google_oauth`, `start_mega_enrollment`, `probe_connection`, `list_root`, `stat` first. Capability and root binding checked at every request. Keep writes disabled for initial public beta.
3. Each user owns separately encrypted provider credential profiles in Postgres; use temporary `0700` directories/`0600` configs per invocation, narrow environment, bounded outputs and timeouts. Redact secrets from logs, reports and AI traces.
4. Always resolve selected resource ownership and prefix before path normalization or provider requests. Deny other user connections and prevent remote or command injection.
5. No generic RC `core/command`, `config/create`, arbitrary `operations`, `sync`, mounts, local remotes, `rc/no-auth`, or OS shell. Prefer typed, explicitly coded Rclone commands over a shared RC administrative daemon.
6. For jobs and future copying: server-side quotas, bounded transfer sizes, idempotency, per-user rate/budget limits, review/confirmation for deletes and moves; copy -> verify checksum/owner -> separate delete after approval.
7. Public release requires two real independent user accounts with Google and MEGA consent, cross-tenant denial tests, revoke/rotate/expiry tests, restart and rollback verification, real provider permission checks, MEGA 2FA workflow and provider commercial terms review.
8. Cloud native: native ChatGPT Google Drive for file/document editing; NestNyx Rclone for MEGA, transfer, bulk metadata and future multicloud.

## GitHub permission diagnosis — production write blocked

A 2026-10-16 attempt to create `nyx/prod-branding-permission-review-20261016` in `yaMorozYaroslav/YaRoute` using the connected production GitHub identity returned HTTP 403 `Resource not accessible by integration`.

The production GitHub App installation exposed via the connector (installation 154945376) has **selected repositories**. Its installation inventory contained only `FloraDevClient-relocate-`, `FloraDevServer-relocate-`, `IdeaServDev-relocate-`, and `IdeaCliDev-relocate-` — **not YaRoute**. The user's own repository owner permissions are shown as push/admin, but a GitHub App also needs the repository selected in its installation and `Contents: read/write` for Git ref creation, and `Pull requests: read/write` to open pull requests. Adding the repo and permission is a manual approval action; no permission was changed.

Manual path: GitHub account Settings → Applications → Installed GitHub Apps → Configure the ChatGPT-connected App on the production account → select `YaRoute` and review requested Contents/Pull requests privileges. Keep default branch protected by process/review, never approve workflows/admin/secret access to solve a branch write.

## $5 Heroku Eco budget analysis

Heroku Eco currently costs $5/month for a **single pool of 1,000 Eco dyno hours across all personal apps**, not $5 per dyno or guaranteed 24/7 for multiple always-active instances. Two Eco web dynos always awake would consume ~1,440-1,488 hours/month, exceeding that pool. Eco web dynos sleep after 30 minutes idle and can cold-start; workers may consume continuously. If hours run out, Eco dynos sleep until next month. Heroku Postgres Essential-0 costs **another ~$5/month**, not included. Basic always-on dynos cost ~$7/month each.

Action: inspect actual Heroku subscription, all dynos/add-ons, estimated use and storage bills *before* approving a public rollout or creating costs. Do not increase dynos without explicit owner consent.

Sources:
- https://devcenter.heroku.com/articles/eco-dyno-hours
- https://devcenter.heroku.com/articles/usage-and-billing
- https://devcenter.heroku.com/articles/provisioning-heroku-postgres
- https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app
- https://docs.github.com/en/rest/using-the-rest-api/troubleshooting-the-rest-api

## Tracking

Manual actions added to the existing **NYX_TODO_WORKING_DRAFT_20261012** under a staged section. Because NoteFlow JSON owner and operational mirrors have not been reconciled, this is **not yet a canonical live Todo change**.

No production GitHub file, Heroku setting, Google OAuth project, MEGA credential, or legacy Rclone configuration was modified in this research.
