# Mobile-approved production releases for NestNyx

**Status:** PROPOSED CONFIGURATION — not yet activated.  
**Authority:** implementation workflow only; not a canonical Head/Body/Footer update.  
**Owner:** production operator approves release from GitHub mobile.  
**Safety rule:** no Heroku credentials, OAuth secrets, Rclone configurations or private source identifiers in GitHub.

## Target outcome

1. Development changes are prepared, reviewed by automated tests and staged on the independent development repository.
2. An authorized non-production author pushes the reviewed change into a **non-default branch inside** the production repository and opens a PR against its `master`.
3. The production account reviews the diff on GitHub mobile and **approves** the PR.
4. With repository auto-merge enabled, GitHub merges *only when required review(s) and checks pass*. Without auto-merge the operator must tap **Merge** separately.
5. Heroku GitHub Integration watches the production repository's `master` and **automatically builds and deploys only a successful merge commit**, after all commit statuses pass.
6. No extra dynos are created and no dyno plan/tier is changed as a side effect of a release.

This is an intended setup. Currently we have NOT proven end-to-end production PR write access, protected-branch enforcement, Heroku GitHub auto-deploy configuration, or a live production release receipt.

## One-time production GitHub settings (operator-only)

In the production repository's **Settings → Branches** (or Rules → Rulesets), protect `master`:

- Require a pull request before merging and at least one approval from a different person/account.
- Require the existing **CI / build** status check to pass. Include **Security Audit** if its check is available and successful. Verify the real job names in GitHub before making a rule; do not guess check names.
- Block force-pushes and deletions; require conversation resolution if practical.
- Dismiss stale approvals on new pushes; do not grant contributors admin/bypass rights.
- Enable repository **Allow auto-merge**, only after those branch rules are enabled.

Author identity: production operator reviews as the production account; production PR should be created from a *different author identity* (e.g., restricted development collaborator or dedicated GitHub App bot) so review is valid and independent. An author cannot supply the required independent approval for their own PR.

The production GitHub App currently returned HTTP 403 on branch creation and PR creation even though GitHub user metadata indicates admin. Do NOT equate the user's admin flag with the integration token's permissions. Safest solution: grant **one selected production repo only** to a limited contributor/bot with Contents: write and Pull requests: write, **after branch protection**. Alternatively the operator may manually stage PR until integration is repaired. Do not broadly share the entire production account or all repositories.

## One-time Heroku dashboard settings (operator-only)

In the *existing production Heroku app*, open **Deploy → Deployment method → GitHub**:

1. Connect the **production GitHub identity** with repository admin rights, not a broad development identity.
2. Select the canonical implementation repository `yaMorozYaroslav/YaRoute`.
3. Select automatic deployment branch `master` (never any feature or development branch).
4. Enable **Wait for CI to pass before deploy**.
5. Verify a normal PR merge triggers exactly one successful release and no release is triggered merely by opening/approving a PR.
6. Confirm health endpoint and logs after deployment, and document the previous known-good release for rollback.

Heroku uses one linked GitHub identity per Heroku account; its linked identity can connect to selected repositories for which it has the necessary access. Do not store Heroku deploy tokens in GitHub workflows. Existing CI intentionally rejects Heroku deployment credentials/actions in GitHub Actions; retain that guard. GitHub CI is for verification; Heroku integration performs the actual release.

## Eco resource constraints and scaling policy

- Eco subscription provides 1,000 shared dyno-hours/month for all Eco dynos in the **same Heroku personal account**; 1 Eco web dyno can sleep after inactivity.
- Eco supports a maximum of **two concurrently running dynos per app** and one per process type. Two 24/7 dynos would exceed the shared monthly Eco budget before month end.
- Existing Procfile defines only `web: npm run start:prod`; worker/clock are **not** implemented as distinct processes.
- The normal code deployment updates the running application release, **not** its dyno count. No scale-up privileges needed to enable automatic deployment.
- Never increase production process count, change dyno tier, provision addons or trigger extra paid services without operator approval. For hourly scheduling, separately evaluate Scheduler one-offs and idempotent durable work queue; no unverified overlapping timers.

## Verification and staged activation checklist

- [ ] Production `master` truly protected by mandatory PR + independent review + verified required CI.
- [ ] A *restricted non-production author* can open a review PR against protected `master` without force-push/admin.
- [ ] A production owner can approve the PR on mobile and approval counts toward the branch rule.
- [ ] GitHub auto-merge is enabled, or operator deliberately merges after approval.
- [ ] Heroku auto-deploy explicitly points to the *production* repository's `master`, waits for CI.
- [ ] Merge SHA and Heroku release SHA/build source are reconciled; app health succeeds.
- [ ] Rollback procedure and deploy failure notifications verified.
- [ ] No increased dyno count, billing, credentials exposure, or unintended DEV-to-production deploy.
- [ ] Older outstanding migration and security-audit warnings reviewed before including dependent code.

### References

- Heroku Dev Center: GitHub Integration / automatic deploys.
- Heroku Dev Center: Eco Dyno Hours and Dyno Scaling/Process Limits.
- GitHub Docs: protected branches; required approvals; automatically merging a pull request.

---
Last edited: 2026-10-13 Europe/Warsaw
Edited by: ChatGPT (user-requested)
