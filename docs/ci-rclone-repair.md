# CI Rclone dependency repair — Dev validation

This document describes **runtime implementation evidence**, not canonical NYX Head/Body/Footer authority. Source-level changes here must be reviewed through the Dev → staging → protected production release path.

## Confirmed failure

On production-repository `tester` commit `04a229a6c017049da5dbfa4695239b4d26bb1015`, GitHub Actions CI run [39697675968](https://github.com/yaMorozYaroslav/YaRoute/actions/runs/39697675968) stopped at `npm ci`. The npm `postinstall` script attempted to download Rclone from `downloads.rclone.org`; outbound TCP/HTTPS attempts timed out (`ETIMEDOUT`) or had no IPv6 route (`ENETUNREACH`). This was **not** an established lockfile mismatch.

## Implemented on Dev repair branch

- `scripts/install-rclone.mjs`: skip its external binary download only if `NYX_SKIP_RCLONE_INSTALL=1`. When absent, runtime and Heroku installation behavior are unchanged.
- `.github/workflows/ci.yml`: sets this flag only for the `npm ci` step, then installs a real Rclone executable for integration tests and sets `RCLONE_BINARY` to its path.
- Tests still execute the actual Rclone binary. The successful GitHub runner installed Rclone v1.60.1-DEV, whereas a previous Heroku health report showed v1.75.2. These versions are **not verified to be equivalent**; runtime/version parity is a separate release check.

## Verification

- First repair CI run [40271428431](https://github.com/linuxofpower/YaRoute-Dev/actions/runs/40271428431) passed `npm ci`, security checks, and build, but failed one real-Rclone test due to the missing binary.
- Follow-up CI run [40271587347](https://github.com/linuxofpower/YaRoute-Dev/actions/runs/40271587347) passed install, security checks, NestJS build, Rclone installation, and **170/170 tests**.
- Review draft Dev [PR #30](https://github.com/linuxofpower/YaRoute-Dev/pull/30). Do not merge or promote without review.

## Release constraints

1. This branch belongs to `linuxofpower/YaRoute-Dev`; production repository `tester` is separate and has not received this fix.
2. A staging-port branch must start from **production `tester`**, not `master`. Reconcile only the intended two-file changes; do not wholesale replace tester with Dev.
3. NestNyx's currently exposed GitHub writer is restricted to `nyx/*` branches based on default HEAD and blocks workflow/CI file changes. Safe, reviewed branch-aware staging capabilities must be added and proven before an automated tester-port.
4. Protect every production `master` branch and require an approved PR and green checks for promotions.
5. For canonical NYX governance, treat Template/Subfooter work as immediate **pending evidence** until generated and verified with a new Footer/snapshot/diff. This note is not such a generation.

Do not put API keys, OAuth codes, Rclone remotes' secrets, private keys or Heroku configuration-variable values into this file.
