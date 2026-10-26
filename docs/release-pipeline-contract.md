# NYX release pipeline contract — development-first proposal

**Status:** Design and release-gate contract only. This document does not install a CI deployment job, configure Heroku, or authorize production merges. The authoritative NYX governance proposal lives in Template/Subfooter staging until separately generated and verified.

## Required code route

1. Implement and test in the development repository on a working branch. Merge into development `main` only after a reviewed PR and green CI.
2. Record immutable source SHA, expected staging-base SHA, file-level patch list, provenance and checksum. **Do not force-push or mirror the entire Dev repository into the production repository:** the two codebases can diverge.
3. Reapply the *approved patch* to a fresh, nonprotected branch based on the **production repository's existing `tester`**, not its default branch. Compare target and source file content and fail closed on unexpected changes.
4. Open a PR from that staging branch **to `tester`**. Require full CI, security tests, scope review and explicit approval.
5. Deploy verified `tester` commit to an isolated staging application using test/Dev-only configuration. Verify deployment/release SHA, smoke tests, provider account isolation, and rollback evidence.
6. Open reviewed PR **`tester` → protected production default** (currently `master`). Never write directly or auto-merge protected production default. Require the user's approval and green checks.
7. Deploy the approved production commit to production Heroku using production app's existing private configuration. Verify release SHA, health, regression checks and recorded rollback plan.

For additional paired projects, use the same sequence with their own repository/branch and isolation configuration.

## Heroku configuration rules

- Pipeline promotions transfer code/build artifacts; they **do not** transfer config vars, databases, credentials or add-ons between apps. Do not create a script that replaces Dev secret values with Pro secret values.
- Keep a development app, an isolated staging app (if available/approved), and a production app each with **distinct** environment-specific OAuth resource URL, callback, audience, private subject allowlist, database, encryption key, storage roots and Rclone credentials.
- Promote a prebuilt Heroku slug only after verifying no Dev-specific URL/secret/config value was baked into it. Otherwise rebuild the approved source in the target environment; ensure exact source commit provenance.
- Verify safe **presence and non-secret identity of required config keys**, not raw values. Heroku `app.json` is a declaration, not proof of deployed configuration.
- Heroku auto-deploy must use the intended branch and wait for required CI. A manual tester deploy can be overwritten by another configured auto-deploy branch.
- Existing runtime API keys, encrypted provider credentials and Heroku config values must not appear in commits, pull-request text, CI logs or Template/Subfooter records.

## NestNyx CLI / connector implementation gaps

Current advertised GitHub write tools can only create `nyx/*` branches from default HEAD, commit ordinary files to `nyx/*), and create draft PRs to default. They block CI/workflow/hosting credential files. These constraints mean a real staging-branch sync **is not implemented yet**.

Implement a separate reviewed workflow for:
- bounded SHA-guarded staging branch creation with selectable **nonprotected** base `tester`;
- patch preview/checksum and file-level allowlist (including separately approved workflow changes);
- staging PR creation with nondefault base `tester`;
- verified required-check gate and deployment read-only evidence;
- protected-default PR proposal only, with no automatic merge or deployment;
- fail-closed refusal for direct protected-default mutation, missing review, unknown source SHA or missing permissions.

Do not bypass the current safety controls while this capability is missing.

## CI contract and current repair

- Running `npm ci` must not depend on the external Rclone download service: use explicit CI-only skip for the postinstall downloader.
- Real Rclone integration tests must still get a real Rclone executable; validate binary version compatibility with staging/production.
- Before syncing anything, merge the separately reviewed Rclone dependency repair into Dev `main`, then port its exact approved diff through a staging PR. A successful Dev test does not prove the production `tester` branch has been repaired.

## History and contribution-safe cleanup

Do not delete any branches until their head SHAs, unique commits, merge-base with default, PR status, tags/releases, deployment references, and outstanding NYX sources have been checked. Classify each branch as active / fully merged and reachable / unmerged preserve / deployed or release reference / unknown.

Only fully merged, no-longer-referenced branches qualify for deletion after approval. Archive unique work in a verified ref/backup or integrate by reviewed merge first. Retaining a tag preserves history, **not necessarily contribution graph squares**. GitHub commit contributions generally require attribution and reachability on default or gh-pages; preserving separate account identity matters. Do not force-push, rewrite author history, rename production default, or delete `tester` for cosmetic cleanup.

## Definition of done — pending

- [ ] Branch-aware Nest sync from tester proven on an isolated test branch.
- [ ] Dev approved and green, with source commit recorded.
- [ ] Exact patch submitted as a reviewed PR to tester and CI green.
- [ ] Isolated staging deployment SHA and safe config validation proven.
- [ ] Approved tester-to-protected-default PR and production release SHA recorded.
- [ ] End-to-end rollback drill and provider permissions validated.
- [ ] History/contribution audit complete before any deletion.

**Authority:** Working implementation contract only. The canonical Head/Body/Footer state may be advanced solely through NYX's verified one-bundle-at-a-time generation, next Footer, transaction snapshot, and explicit diff process.
