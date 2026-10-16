# Historical third-instance plan — superseded

**Superseded:** This file's original instructions proposed an additional development Heroku application and custom MCP connection. That is not the current project architecture. Do **not** create an extra application or ChatGPT connection from this historical plan.

The actual two environments are:

| Existing app | Purpose | Branding | Source |
| --- | --- | --- | --- |
| **DevNestNyx** | Development and tests | Blue icon | the existing development repository |
| **NestNyx** | Production | Purple icon | `yaMorozYaroslav/YaRoute` |

## Corrected rollout rules

- **Reuse the existing** DevNestNyx and NestNyx services. No third app or `DevProNestNyx` product.
- Keep distinct OAuth client IDs, redirect URIs, resource audiences, encryption keys and databases for each existing environment. Do not copy DEV tokens or credentials into production.
- Development uses `NYX_SERVICE_NAME=DevNestNyx` and `NYX_BRAND_VARIANT=development`; production uses `NYX_SERVICE_NAME=NestNyx` and `NYX_BRAND_VARIANT=production`, once the reviewed branding code is actually deployed.
- Keep legacy Rclone credentials and private configuration untouched while multi-user Google Drive and MEGA storage access is tested in an isolated DEV setting. Never presume that passing unit tests means real production OAuth is working.
- Promote code from DEV to PROD only through reviewed production changes with owner approval. Do not enable public multi-tenant storage or change dynos/billing by implication.
- Secrets belong in the respective Heroku configuration or managed secret storage, never in tracked GitHub files or ChatGPT messages.
- Refer to `docs/oauth-production-rollout.md` for the detailed production OAuth, branding, MEGA 2FA and runtime configuration procedure.

The filename is retained solely as a historical pointer; its original third-instance deployment plan is no longer valid.
