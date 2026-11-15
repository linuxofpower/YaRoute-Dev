# Personal-exclusive private Pro Rclone: operator acceptance gate

Status: **PRE-DEPLOYMENT, READ ONLY**. The original eight private Rclone remotes belong only to the approved Personal OAuth identity; the Primary public account must not inherit or discover any of them.

Tracked by [Issue #122](https://github.com/linuxofpower/YaRoute-Dev/issues/122).

## Immutable evidence checked 2026-11-15

- Dev [PR #127](https://github.com/linuxofpower/YaRoute-Dev/pull/127) merged at `584e3bdf2156ac95a418b7bc5b5d20fb2a703c7d`.
- Tester source promotion recorded at `4e876f0968a556bcf0245bb89a344fb9472ba537`; independently checked `src/connectors/private-pro-virtual-connections.ts` exists on Tester at the same blob SHA as Dev.
- Private NestNyxPro inventory lists **six Google Drive plus two MEGA** names, all merely `configured_not_live_verified`.
- DevNestNyx Primary has two independently enrolled public MEGA connections; Personal's public storage list remains empty.
- On 2026-11-15, Personal attempts to list both Primary MEGA connection UUIDs returned `TENANT_RCLONE_CONNECTION_FORBIDDEN`.
- Neither live Heroku service has an attested exact deployed SHA for PR #127. Private owner link and eight live remotes through Dev are **not verified**.

## Exact private remote allowlist (private Pro only)

```text
linuxofpower
ya.moroz.yaroslav
yaroslav.moroz.a
yaroslav.moroz.b
yaroslav.moroz.c
yaroslav.moroz.d
linuxofpower_mega
ya.moroz.yaro_mega
```

Only these eight should enter `NYX_PRIVATE_BROKER_ALLOWED_REMOTES`. A frontend selected tab, connection display name, or supplied email is **not** an authorization signal.

## Operator deployment gates

1. Attest exact **public** Heroku deployed source corresponds to reviewed Tester; attest exact **private** Pro deployed source contains the reviewed broker. A GitHub merge alone is not deployment evidence.
2. Use operator-protected Heroku configuration. Public must enable its OAuth owner-link and broker client only after independent identity verification; private must have the distinct broker server, exact eight remote names, private area allowlist, independent database, and matching short-lived delegation HMAC key. **Never post config values** to tickets, chats or Git history.
3. Public startup MUST reject process-global `RCLONE_CONFIG*` and `NYX_SHARED_ROOTS_JSON`; private service keeps its existing private Rclone credentials. Never mirror them into public Heroku or the tenant PostgreSQL/Neon vault.
4. Verify configured approved immutable MCP subject is the **Personal** subject on each service, and private allowlist is singleton. Complete independent Personal Google OIDC sign-in callback; do not trust email text or client-side tab selection.
5. Confirm Dev Personal `nyx_storage_connections_list` returns exactly eight **virtual** broker descriptors; the same routed list-files and test-active tools must independently pass a real root-read for **each** of eight remotes. An inventory record does not count as read verification.
6. Confirm Dev Primary still sees only its two public MEGA connections, sees no private descriptors, and cannot use Personal virtual UUIDs. Repeat foreign principal, missing/expired/replayed delegation, wrong audience/subject and path traversal denial tests.
7. Verify independent audit receipts, rate limiting, rollback and service restarts; only then consider limited live read acceptance.

### Safe CLI evidence collection (no config-value printing)

Heroku supports `heroku config --json --app APP` and `heroku releases --json --app APP`. Run under the operator's authenticated local CLI; do not pipe raw config output to the terminal or share it.

```bash
heroku releases --json --app dev-nest-nyx | jq '.[0] | {version,created_at}'
heroku releases --json --app nest-nyx-pro | jq '.[0] | {version,created_at}'
heroku config --json --app dev-nest-nyx | jq 'keys | map(select(test("^(NYX_PRIVATE_|NYX_DEPLOYMENT_MODE|RCLONE_CONFIG|NYX_SHARED_ROOTS_JSON)")))'
heroku config --json --app nest-nyx-pro | jq 'keys | map(select(test("^(NYX_PRIVATE_|NYX_DEPLOYMENT_MODE)")))'
```

The release version and presence of keys are **not** sufficient to attest a commit SHA or a properly completed Personal OIDC link. Keep values private, use a local protected compare/check of **values** before enabling, then perform real A/B tests.

## Writes remain a separate reviewed change

There are **no** private broker write routes in the merged v1.1 PR. Follow-up code must use typed per-remote operations, independently checked owner/capability/root and path, non-clobber/race defenses, per-provider trash semantics, bounded content transfer, audit receipts and disposable fixtures. Negative Primary/foreign-user tests are mandatory for every write type. Permanently deleting a live MEGA file and permanently deleting one selected trash node are **separate**, default-off work in [Issue #123](https://github.com/linuxofpower/YaRoute-Dev/issues/123). Neither generic Rclone shell nor mass trash cleanup is allowed.

## Rollback

Disable `NYX_PRIVATE_BROKER_CLIENT_ENABLED` on the public app and `NYX_PRIVATE_BROKER_SERVER_ENABLED` on the private app through approved local Heroku administration. Keep existing private credentials where they are. Rollback never grants additional rights and cannot undo completed destructive writes.

**Scope of this documentation change:** no live deployment, Heroku configuration, OAuth grant, broker capability, private remote, Head/Body/Footer, or user file was modified.
