# NYX bot-authored Tester -> Master release review

## Goal
Resolve the protected-master self-approval deadlock **without removing approval
or weakening CODEOWNERS**, and without automatically merging/deploying multi-user
MEGA work to production.

Development remains:
- Dev repository main (Dev)
- yaMorozYaroslav/YaRoute/tester (Tester, can be promoted automatically)
- yaMorozYaroslav/YaRoute/master (protected production)

## Release-review procedure (not an automatic production release)
1. Validate the exact Tester commit: tests, security checks, and its corresponding
   deployed public-mode test service. Green unit CI and /health are insufficient
   for multi-user MEGA acceptance.
2. Perform an **isolated two-owner MEGA acceptance test**, including successful
   HTTPS enrollment with optional 2FA, independent roots, denied cross-owner
   read/activation, restart/reconnect, revocation, replacement and rollback.
3. Once explicitly accepted, open the Dev repository Actions workflow named
   "NYX bot-authored Tester to Master draft (never merge)" and supply the exact
   40-character current Tester SHA.
4. The workflow uses the existing short-lived, target-repository GitHub App
   installation token to create a **bot-pushed release branch**. The attestation
   commit has exactly the same Git tree as Tester and one parent (Tester SHA).
   The App opens a **draft**, bot-authored PR into master. No source edits.
5. The actual yaMorozYaroslav code owner verifies the diff, marks the PR ready,
   and approves it from that independent account. The author/last pusher should
   be the GitHub App (not yaMorozYaroslav), so the existing last-pusher rule can
   be satisfied without self-approval. GitHub rules are the final authority.
6. Master merge, deployment, and exact running-commit acceptance are separate
   reviewed actions. This workflow does not merge or deploy.

## Fail-closed restrictions
- Refuses non-current Tester SHA, unprotected master, changed repository identity,
  divergent history, incomplete or non-green status checks, unknown release
  branch, bot identity mismatch, and moving refs.
- Refuses to create a new release while any existing Tester -> master or
  bot release PR is still open. **PR #28 is currently an older, user-authored,
  unapproved release proposal and must be reviewed/closed separately first.**
  Do not merge that 50-file PR just to unblock automatic tests.
- Never changes master, branch rules, CODEOWNERS, credentials, private Rclone
  configuration, canonical Head/Body/Footer, or Heroku settings.
- On an API failure after branch creation, the review branch might remain.
  Inspect the SHA and branch rather than blindly overwriting or retrying.
- Requires the existing GitHub App installation to have repository-scoped
  Contents and Pull Requests write grants. No personal OAuth token is used.

## Multi-user MEGA readiness
The current Dev/Tester tests include owner isolation, 2FA/session capture,
exact-root binding and cross-tenant denial. Unit tests are necessary but do not
attest real MEGA provider behavior or safe multi-user deployment. Use a separate
public test app/database and independent user identities; never reuse production
operator Rclone credentials. Do not enable writes or promote to master before
the complete acceptance matrix is verified.
