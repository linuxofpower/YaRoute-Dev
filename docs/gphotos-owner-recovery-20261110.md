# `gphotos_yaro`: owner-private recovery diagnostics

## Scope

Opt-in, **read-only** diagnostics in the existing *private* Dev/Tester NestNyx
application. This implementation registers `nyx_gphotos_yaro_probe` and
`nyx_gphotos_yaro_list` only; it does not migrate credentials, upload, download,
copy, change account permissions, or modify Pro. Do **not** enable this bridge
on a public multi-user deployment; use individually verified tenant credentials
or a dedicated independent private broker instead.

## Owner-only rollout checklist

1. Verify the issuer-signed Auth0 Google-social MCP subject independently
   against the authenticated, operator-approved Google account.
   An email string in a configuration variable does not itself prove identity.
2. Ensure the single permitted subject in `NYX_PRIVATE_OAUTH_SUBJECTS` is that
   subject; `NYX_PRIVATE_LEGACY_OWNER_MCP_SUBJECT` must match. No secondary or
   tester account may share this identity.
3. Verify that the private app's current Rclone configuration contains **one**
   `[gphotos_yaro]` section with `type = google photos` and `read_only = true`.
   The config must not be committed, printed, pasted into chat, exported to
   logs, or passed to a public app. The backend refuses ambiguous configuration.
4. On **private Dev/Tester only**, provision the following owner-binding values
   through the respective platform's private configuration management:

   ```dotenv
   NYX_GPHOTOS_OWNER_READ_ENABLED=true
   NYX_GPHOTOS_OWNER_GOOGLE_EMAIL=<verified_owner_email>
   NYX_PRIVATE_LEGACY_OWNER_GOOGLE_EMAIL=<same_verified_owner_email>
   NYX_GPHOTOS_OWNER_MCP_SUBJECT=<independently_verified_google_oauth_subject>
   NYX_PRIVATE_LEGACY_OWNER_MCP_SUBJECT=<same_subject>
   NYX_PRIVATE_OAUTH_SUBJECTS=<same_subject>
   ```

5. Verify: the approved owner can call `nyx_gphotos_yaro_probe`, the second
   tester account receives access denied and cannot list/probe, arbitrary
   paths cannot escape `gphotos_yaro`, no credential values appear in results,
   and the app's public/Pro capability inventory lacks these tools.
6. Disable by unsetting `NYX_GPHOTOS_OWNER_READ_ENABLED`. Do not enable public
   mode while process-wide Rclone credentials remain configured.

### Recovery caveat

As of March 31, 2025, Google's Photos Library API only allows listing and
downloading media created by the client application. Rclone's Google Photos
backend cannot generally download an ordinary user's existing collection or
shared album. Therefore a successful probe is **not** evidence that the
October–November collection can be restored. Use Google Photos Picker with
explicit selection, browser download or Google Takeout for those photos.

For the subsequent recovery operation, stage files outside MAIN, verify actual
capture time independently of `ModTime`, compare SHA-256 against the canonical
`full_camera` baseline and current MAIN, copy only missing newer originals,
and verify destination hashes before marking them recovered. No older media,
duplicates, delete, `sync`, or `move` actions are authorized by this feature.

## Local verification

```bash
npm ci --ignore-scripts
npm run build
node --test tests/owner-google-photos.test.cjs
npm run security:check
```
