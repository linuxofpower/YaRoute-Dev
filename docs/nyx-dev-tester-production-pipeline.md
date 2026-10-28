# NYX Dev -> Tester -> Production pipelines (v1)

**Status:** Development PR only. The implemented GitHub Actions workflow is read-only. No cross-repository writes, environment mutations, Heroku deploys, or canonical Head/Body/Footer generation are performed.

## Pipeline A: cross-repository reconciliation

Dev and Tester have separate Git histories. Do not merge entire histories or force-copy the Dev tree over Tester. Their baseline on 28 October 2026 was:

- Dev: linuxofpower/YaRoute-Dev main d0ddd3368b993a439387f3eb3e9cd7b36a00ce74; CI + public repo audit passed.
- Tester: yaMorozYaroslav/YaRoute tester 692d0ffb075f86f31242841cf9ea78cf797d6158; its own CI passed.
- 28 Dev-only files, 24 differing blobs, one Tester-only .github/CODEOWNERS and 105 common blobs. These separate CI successes do not prove the combined code passes tests.

Proposed stages:

1. **Inspect:** run the read-only workflow on Dev via Actions, or run scripts/nyx-promotion-plan.mjs. Its output pins both exact branch SHAs, compares blob SHAs per path, and classifies identical, source-only, target-only, divergent, secret, infrastructure and security-sensitive paths. No implicit merge or Git write.
2. **Reconcile:** every candidate path requires an explicit blob-pinned decision with a rationale. Only reviewed copy_source actions are emitted; otherwise the result is BLOCKED. Target-owned app.json, Procfile and .github/CODEOWNERS are never auto-copied. Secret/credential paths are forbidden.
3. **Review:** preserve Tester-only GitHub branch policy tests and current CI-only Rclone installation fixes. Do not blindly copy Dev test files over newer Tester tests. The existing NestNYX staging tool allows up to **40 selected source/docs/tests paths**, insufficient for the entire current difference. An independently reviewed staging writer or small batches with exact receipts would be needed for full promotion.
4. **Stage:** create a new nyx/* review branch **from the exact current Tester commit**, apply only approved file decisions, open a *draft PR into tester*. Source and destination SHAs must still match; reject drift. This write step is **not implemented by this v1 read-only workflow**.
5. **Verify:** run Tester CI and security audit on the exact combined candidate; test private Rclone, Google/MEGA authorization, tenant isolation, path restrictions and credential handling. Do not infer live success from mocks or unit CI alone.
6. **Release:** merge Tester only after review and passing checks; then open a separate reviewed tester -> protected master PR. Production deployment and rollback verification are distinct, owner-approved actions.

### Approved decisions (example only)

This JSON is passed via --decisions, together with explicitly pinned --source-sha and --target-sha arguments. Hashes here are illustrative.

    {
      "src/example.ts": {
        "action": "copy_source",
        "sourceBlob": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "targetBlob": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "rationale": "Exact diff reviewed and compatible regression tests retained"
      }
    }

For a new file, targetBlob is null. For a preserved divergent file, action is preserve_target with both current hashes. Decisions are rejected if hashes change, so old approvals do not silently apply to new code. The planner emits a canonical digest of the plan JSON for audit provenance. REVIEW_READY means the reviewed *plan* is complete, not that the change has passed Tester CI or is deployable.

### How to run the read-only plan

After this Dev PR is merged, Actions -> **NYX Dev to Tester reconciliation (read-only)** -> Run workflow. The workflow uses only public repository reads and GitHub Actions contents:read, then uploads a short-lived JSON plan artifact. It does not use a secret or deployment token.

The existing npm test command includes tests/nyx-promotion-pipeline.test.cjs through its tests/*.test.cjs test selection.

## Pipeline B: adapt Dev configuration for Tester/Production

The **same reviewed code** should be deployed with target-specific configuration, not broad text replacement of Dev file values. scripts/nyx-deployment-adapter.mjs produces non-secret proposals; it never reads or writes live settings.

| Field | Dev (proposal) | Tester (proposal) | Production (proposal) |
| --- | --- | --- | --- |
| Account | linuxofpower | yaMorozYaroslav | yaMorozYaroslav |
| Branch | main | tester | master (protected) |
| NYX_SERVICE_NAME | DevNestNyx | NestNyx | NestNyx |
| NYX_DEPLOYMENT_MODE | private | private | private |
| NYX_PUBLIC_CONNECTORS_ENABLED | false | false | false |
| NYX_MULTIUSER_RCLONE_ENABLED | false | false | false |

These are intentionally **proposed safe private defaults**, not claims about actual Heroku configuration. Production app.json, Procfile, README, CI workflows and CODEOWNERS stay target-owned. Target-specific OAuth issuer/audience, URL, branding, cloud IDs, PostgreSQL data and Rclone access must be independently verified.

**Never transfer Dev secrets or account credentials to Tester or Production**. Secrets stay in each target's external secret manager. The adapter exposes secret **key names only**. A public multi-user pilot needs a separate app, database and encrypted vault with no inherited private operator Rclone credentials, verified two-user isolation, login, exact-root access, revocation, restart and rollback tests before enabling public mode.

## Known blocker and release gates

Tester has tests/github-api-writes.test.cjs that checks its unrestricted non-default working-branch behavior (three min(1).max(100) schemas and no nyx/* restriction); current Dev mcp.service.ts uses different nyx/* semantics. Straight source-file copying would break that Tester contract. Reconcile the behavior and tests deliberately. Tester also has a CI Rclone installer override that must not be lost.

Track resolution in linuxofpower/YaRoute-Dev issue #35. Do not change yaMorozYaroslav master, GitHub branch rules, Heroku configuration, secrets, or canonical NYX Head/Body/Footer as part of the Dev planning workflow. No files are promoted until exact SHA and tests provide evidence.
