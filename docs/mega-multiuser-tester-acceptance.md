# Multi-user MEGA Tester acceptance — manual owner-controlled pilot

Status: test plan, NOT live provider acceptance, NOT permission to deploy master.

## 1. Deploy an isolated pilot from exact Tester SHA

- Dev source must pass security/build/tests; promote only the reviewed exact Dev patch to the unprotected Tester branch and verify Tester CI.
- Deploy Tester SHA to a DEDICATED HTTPS public pilot app, NOT an existing private Dev/Pro app. Use a separate PostgreSQL database, new base64 32-byte AES encryption key, separate OAuth issuer/audience and two independent authorized user subjects.
- A public pilot MUST NOT have RCLONE_CONFIG_B64, RCLONE_CONFIG_PATH, RCLONE_CONFIG, any RCLONE_CONFIG_* variable, NYX_SHARED_ROOTS_JSON, or a persistent old Rclone config file. Keep old operator storage online in the separate private service while testing. Rclone executable is still required.
- On the public pilot only: NYX_DEPLOYMENT_MODE=public, NYX_PUBLIC_CONNECTORS_ENABLED=true, NYX_MULTIUSER_RCLONE_ENABLED=true. Never reuse operator credentials.
- Require HTTPS /health 200 with expected running commit SHA AND authenticated discovery of public tenant tools. A healthy /health alone cannot verify multi-user setup.
- Expected MCP tools include: nyx_storage_connections_list, nyx_storage_connection_create, nyx_storage_connection_permissions, nyx_storage_connection_roots, nyx_storage_connection_begin_mega, nyx_storage_connection_test_pending, nyx_storage_connection_activate, nyx_storage_connection_test_active, nyx_storage_connection_list_files and nyx_storage_connection_revoke.
- STOP if any expected tool is missing, private legacy tools are exposed, OAuth identity is ambiguous, old global credentials are detected, or running commit differs from Tester.

## 2. Owner personally tests two real MEGA accounts

Passwords and authenticator codes go ONLY into the first-party HTTPS provider setup form. Never paste into ChatGPT, commits, evidence documents, logs or public links.

- [ ] User A authenticates through distinct OAuth subject A and creates independent MEGA connection A.
- [ ] User A explicitly selects storage:list permission and ONE exact selected root; signs in through the one-use HTTPS setup, including a real 2FA code when required.
- [ ] User A tests pending root, activates, tests active root, and lists files read-only inside the exact permitted root.
- [ ] User B authenticates using independent OAuth subject B and a different MEGA account/root; repeats the full flow.
- [ ] Cross-user attempted list, probe, activation, grant change and revoke operations are denied in both directions.
- [ ] Alternate roots, account-root fallback, ../ traversal and remote alias injection are denied.
- [ ] Restart public pilot with the same dedicated DB/key: active owner-scoped connections continue read-only; no cross-user metadata leakage.
- [ ] Failed pending replacement cannot clobber an already verified active credential.
- [ ] User A revokes A connection. All pending/active encrypted tenant credentials and outstanding one-time enrollment states are removed, access denied, B unaffected. Provider-side sessions must be revoked separately by the account holder; already-running reads can complete.
- [ ] Check no upload, deletion or write operation is possible.
- [ ] Record each observed PASS/FAIL, timestamp, Tester commit, deployed commit, non-secret evidence and explicit owner acceptance. CI/mocks alone do not count.

## 3. Only after owner manual PASS

- Perform a separately reviewed and reversible disconnect of LEGACY PRIVATE Rclone service-side credentials from the replacement service. Do not delete or modify unrelated local Arch Linux/Termux Rclone configs; do not uninstall the Rclone executable.
- Repeat isolation, restart, read-only probe and revocation tests after the cutover. Preserve rollback evidence.
- Do not merge old direct Tester-to-master PR #28 unreviewed; reconcile/close it as release hygiene.
- Only after separate explicit production approval, generate a fresh GitHub App bot-authored draft PR from the accepted Tester tree to protected master, obtain valid code-owner approval and green checks, and separately verify production deployment SHA.
- Nothing in this runbook authorizes master merge or Heroku configuration changes.

## Evidence
Dev issue #54 tracks acceptance. Source tests include tenant-rclone-auth, tenant-mega-2fa, tenant-mega-root-security, tenant-mega-verification-binding, tenant-active-root, tenant-storage-onboarding and tenant-storage-revoke. Synthetic tests do not prove live MEGA provider behavior.
