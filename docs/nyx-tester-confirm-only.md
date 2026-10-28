# NYX Tester staging pipeline — confirmation-only merge

## Authority and scope
This pipeline can PREPARE a draft PR into the unprotected \`yaMorozYaroslav/YaRoute:tester\` branch after verified Dev CI. The user confirms whether to merge. It NEVER merges, rewrites, deletes or modifies \`master\` or \`main\`, changes branch protections, transfers private credentials, alters Heroku, or deploys. The default master must remain protected.

Dev and Tester are independent Git histories: stage only exact reviewed file content on a new branch based on current Tester commit. No cross-repository merge of history. All existing Tester-only files remain, including \`.github/CODEOWNERS\`, tester-specific \`app.json\`, \`Procfile\`, \`config/\`, workflows, \`scripts/\`, and Tester's \`tests/github-api-writes.test.cjs\`. The automatic source selection is limited to text files under \`src/\` and \`tests/\`, excluding branding assets/tests and DEV-only tests. The exact selected paths are SHA-pinned against source and target and published in the PR body as file count and source/destination commits.

## Required one-time GitHub App grant
The native ChatGPT GitHub tool currently returns HTTP 403 when creating branches in \`YaRoute\`, even when repository metadata shows push access. That is a provider App-scoped permission failure. Do NOT bypass it or store PATs in source.

Create or configure a GitHub App installed **only** on \`yaMorozYaroslav/YaRoute\`, with Contents: write and Pull requests: write. In **development repository** Actions settings, configure:
- GitHub repository variable \`NYX_TESTER_PROMOTION_APP_ID\` = this App ID.
- GitHub repository secret \`NYX_TESTER_PROMOTION_APP_PRIVATE_KEY\` = this App private key (never commit or echo it).

The workflow requests a short-lived token for the single target repository using \`actions/create-github-app-token@v2\` and does not grant write permissions to the Dev job's \`GITHUB_TOKEN\`. The token is not reused after the job. If this App config is missing, the job is intentionally skipped (not fully activated). This is a one-time installation/secret setup, not a per-merge manual workflow.

## Sequence
1. A Dev \`main\` push runs Dev CI (and the separate public-repository security audit). The staging workflow triggers only on successful CI whose event was a push to Dev \`main\`; it never executes against an arbitrary fork PR. A manual workflow_dispatch can run the same guarded staging after setup.
2. Run standalone pure tests for source-path policy, SHA pins and the Tester's GitHub schema compatibility.
3. Acquire the limited target App token and verify latest Dev source SHA, current unprotected Tester SHA, and protected master state. Fail closed on drift.
4. Reconcile eligible \`src/\` and \`tests/\` UTF-8 source files on a *new* \`nyx/promote-SOURCE-TARGET\` review branch whose parent is Tester. Preserve target-owned files. Convert general GitHub branch MCP schemas to Tester's short-name contract; preserve specialized \`nyx/\` staging restrictions. No raw cross-history merge.
5. Create one **draft** PR with base \`tester\`. Existing identical open PRs are returned without overwriting their branches.
6. Tester PR CI exercises the exact combined tree. The automation then examines CI/security results, reconciles failures, and presents the verified PR to the owner. Until the owner confirms, it stays draft and unmerged.
7. Once owner explicitly approves this exact PR/head SHA, use an authorized nondefault merge path if permitted, then read back both the PR and Tester branch SHA. Never treat a PR merge as Heroku deployment or as a Head/Body/Footer generation.

## Important limits
- The draft PR is a *candidate*, not a promise of passing tests. Existing Tester regression tests must stay. If Tester CI fails, repair on the review branch, rerun CI and repeat.
- Live Google OAuth, MEGA 2FA, two-user isolation, encrypted vault, revoke, private Rclone isolation, provider terms and hosting are additional security/production release gates not proven by unit CI.
- This source-only stage intentionally does **not** ship binary icons or adapt \`app.json\` automatically. Production identity, OAuth origins/audiences, database and secrets must remain target-specific; any asset or configuration migration requires separate reviewed changes.
- Branch deletion is **not currently exposed** by the connected GitHub ChatGPT tool. Do not promise automatic branch cleanup until implemented and verified with an authorized provider.
- The pipeline cannot create staging branches until the App credentials above are present and working. A user request authorizing access is not itself a GitHub App grant.
