# NYX staging mirror contract

## Repository authorities

- **YaRoute-Dev `main`**: authoritative reviewed and tested development code.
- **YaRoute `tester`**: staging mirror only; not a location for feature development.
- **YaRoute `master`**: protected production. This process never updates it.
- **Development Heroku**: should use the staging `tester` branch and must gate automatic deployment on passing staging CI.

## Promotion gates

1. Feature work, tests and reviews happen in YaRoute-Dev first.
2. The required branch-contract change (development PR #26) must be merged through the protected development-branch approval rules.
3. The **exact** current development `main` SHA must have successful `CI` and `Public repository security audit` runs.
4. Run `bash scripts/promote-yaroute-tester.sh --plan`. Verify proposed code and asset changes. Running this command creates no GitHub commits.
5. Run `bash scripts/promote-yaroute-tester.sh --apply`. This reads the same reviewed source again, verifies that both refs have not changed, commits a non-forced `tester` update, and records the source SHA in `.nyx/staging-source.json`.
6. Staging GitHub Actions checks must pass on the resulting `tester` SHA. Do **not** deploy on failure. Any production promotion remains a separately approved PR into `master`.

A staging `tester` update is not proof of deployment. Check Heroku's running release commit and its `/health` endpoint separately.

## Staging-only tracked paths

Only these tracked files can differ intentionally from the development source:

| Path | Why |
| --- | --- |
| `.github/CODEOWNERS` | Production repository reviewer ownership |
| `.github/workflows/ci.yml` | CI branch triggers for `tester` and `master` |
| `.github/workflows/security-audit.yml` | Branch triggers for the staging/production repository |
| `README.md` | Repository-specific instructions |
| `app.json` | Heroku app / instance declarations |
| `.nyx/staging-source.json` | Verifiable promotion provenance: exact source SHA, timestamp, overrides |

All other tracked application code, assets, tests and docs must match development `main` byte-for-byte. The script stages additions, modifications and deletions, checks parity, and refuses to force-push.

**Environment secrets, OAuth identities, external storage destinations and Heroku config vars are runtime settings, never copied from development git history.** Keep credentials out of this repository and avoid automatically changing Heroku app settings during code promotion.

## Known baseline drift

Before this policy there were 19 differing tracked paths across source and staging. Relevant application drift included branding, the NestJS module wiring, health/auth display naming, the connections panel, and tests. This contract deliberately does not classify these as staging exceptions; reviewed development is authoritative.

The staging build previously failed during `npm ci` because the Rclone installer timed out while downloading dependencies. Do not confuse this with a passed build. Retry or correct the upstream build reproducibly in development, then promote and verify staging CI.

## Safety and automation boundary

The script requires the normal authenticated GitHub CLI with write access to `tester`; its invocation is currently **manual**. GitHub App repository authorization and automatic Heroku deployment are separate capabilities. Do not store a reusable GitHub App private key or broad PAT in this repository solely to automate promotion. A future NYX promoter should use short-lived installation tokens, keep the same source CI/ownership/parity checks, and never bypass protected branches.
