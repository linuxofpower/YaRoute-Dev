# Restricted Git CLI + GitHub CLI pilot

Status: **Dev review only. No Pro rollout, no unrestricted `gh` or Git shell.**

This extension adds two separately displayed controls to a verified **GitHub** connection in the Connections panel:

- **Add Git CLI (read-only)** — one exact owner/repository with `git ls-remote --heads` only.
- **Add gh CLI (read-only)** — one exact owner/repository with `gh api repos/owner/repo --method GET` only.

The buttons are *read-only proof-of-access actions*, not software installers, operating-system account connections, persistent owner grants, or general command interpreters. They are visible only if the separately reviewed public pilot is enabled. Failure is reported; never claim the CLI is connected if a probe fails.

## Deployment and installation

* Opt-in flag: `NYX_GITHUB_CLI_PILOT_ENABLED=true`, **only** on an isolated public Dev/Tester app after reviewed CI. Private Pro remains off. If disabled, no CLI MCP tool is registered and UI controls are hidden.
* Install `gh` at **build time** using `node scripts/install-gh.mjs` from the trusted build. The pinned version is 2.105.0, Linux x64/arm64. Installer verifies official release tarball SHA-256 against compiled-in constants, installs to `.bin/gh` and writes a local SHA-256 attestation manifest.
* Runtime always recomputes binary SHA-256; it refuses a missing/unattested/modified `gh` binary. The host's `git` must be installed at `/usr/bin/git` or `/bin/git`, checked at runtime. Do not install binaries via app-user click, accept arbitrary source URLs, or permit user-supplied executable paths.
* Ensure the build/install flag and runtime flag agree: a runtime flag without a pinned binary fails closed.
* Explicit per-GitHub-connection authorization is required. The connected OAuth owner must have an active GitHub App installation, an allowed repository resource, and provider grants for `repository:metadata` (gh) or `resources:read` (Git). No PAT storage.
* Connections panel buttons execute one bounded read-only probe, not a global opt-in or write grant. An existing GitHub connection is still the authorization identity.
* Keep all generic `git:*` capabilities **disabled**; no `git push`, `gh pr ready`, `gh pr merge`, workflow dispatch, extension execution, or shell.
* PR-ready is the **separate** `nyx_connection_github_pr_ready_to_ref` reviewed API workflow, not an effect of CLI installation.

## Execution isolation

The helper constructs argv server-side; no raw command lines are accepted. It uses a disposable HOME, XDG config and minimal PATH, 12s timeout, 128 KiB output ceiling, never returns stderr, and blocks Git protocols other than HTTPS. A short-lived one-repo GitHub App token travels only through the isolated child environment, never process arguments, remote URLs, log output, Git config files, app responses, stored database rows or web UI. Runtime parsing returns minimal repo or branch data only.

The process is **not an OS container**. Future Git writes, clone/build/checkout, submodules, extensions and arbitrary Git CLI will require a separate sandboxed worker and canonical policy review. This pilot does not authorize them.

## Release checklist

1. Review this PR's code, CI and security checks. Verify the exact built `gh` release and host `git`.
2. Ensure the two GitHub App connections each have explicit repository metadata + resource-read grants. Test both in read-only mode, plus rejection of cross-owner ID and a repo outside each connection's selection.
3. Confirm the existing PR list no longer fails for a repo with many open PRs; verify bounded pagination fallback when GitHub response exceeds 250 KB.
4. Independently finish reviewed PR-ready changes (Dev PR #166 (merged), Tester PR #110 (merged); superseded review PR #104) and exact missing MCP registration source; never mark PR #104 ready before its complete source, CI and human review.
5. Roll out in Dev only, with the pilot flag off by default. Do not deploy or enable publicly before Tester security and owner isolation evidence.
6. Remove the flag to disable all CLI tool registration without changing per-account GitHub grants.

Git CLI and gh CLI are not a replacement for canonical Head/CLI authority. This is a standalone source-code proposal until accepted and promoted.
