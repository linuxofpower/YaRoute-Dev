# Free-first NYX credential security and licensing decision

**Proposal only.** This branch does not change production, Heroku, the license,
the shared root encryption key, commercial OAuth scopes or tenant file operations.

## What already works with no additional cryptography fee

- AES-256-GCM through the Node.js built-in crypto library.
- PostgreSQL-backed owner-scoped encrypted connector metadata.
- Google Drive OAuth and MEGA connect entry points on the earlier tenant development branch.
- Temporary per-invocation Rclone configuration rather than the operator's global config.

## Changes in this branch

- v2 ciphertexts receive keys derived with HKDF-SHA256 separately per
  authenticated owner + connection + provider using one server-managed 256-bit
  master key. New versions have a 'v2:' prefix.
- Both v2 and legacy AES-GCM ciphertexts are accepted for reads, for gradual
  migration without unexpectedly losing existing tenant authorization.
- The existing public storage connection registry opts into v2 for new writes.
- The newer `TenantRcloneService` integration has NOT been updated in this
  branch; it remains at the original encrypted-storage implementation.
- No root key rotation logic or external KMS exists yet. Master-key compromise
  still exposes all derived keys. Provider credentials remain accessible to the
  running process while a permitted operation executes.

## Before public user onboarding

- Integrate and test v2 on ALL credential registries, not merely one.
- Key-version registry, zero-downtime key rotation and re-encryption migration.
- Thorough tenant isolation tests across simultaneous users and scopes.
- Restrict provider error logging, uploads/downloads and environment exposure.
- Verify per-tenant OAuth scopes, MEGA sessions and write probes with live tests.
- Enforce backend-side file/folder scope before any mutable operation.
- Safe read/verify/copy/move operations; no source deletion until independent
  verification and operator consent.
- Google OAuth consent review and MEGA service policy review before commercial launch.
- Confirm secure, independently controlled credential recovery policy and backups.
- Perform secret scanning and rotate any credentials leaked in earlier public Git
  history. Old credential exposure is not fixed by new encrypted database records.

## No-cost vs paid prerequisites

Crypto code and Rclone are free to license. Hosted database, app dynos,
managed KMS, rate limits and transfer bandwidth may still cost money.
Avoid adding external billable cloud resources automatically.

## Owner's open-source direction — accepted as a proposal, NOT relicensed yet

**Owner decision (14 October 2026):** Open-source all original NYX/Yaro
software, including the platform, storage engine, CLI, reusable adapters,
interfaces, tests, architecture and executable definitions, **preferably
under MIT** where authorship and upstream licenses permit. The goal is to
keep **private personal and tenant data**, not to keep NYX code proprietary.

### Public software versus private data boundary

**Public, after safety review:** implementation source code, architectural
rules, generic command schemas and templates, sanitized examples, CI,
documentation, provider adapters, and encryption algorithm implementations.

**Private, always:** user records and project notes, private canonical Body
content and mutable Footer continuity, secrets, authentication tokens,
OAuth credentials, tenant database contents, backups, private manifests and
hashes, location identifiers and sensitive account metadata. Do not
assume a Head/Body/Footer bundle is safe to publish simply because some
schema or command definitions inside it are open-sourceable. Extract,
sanitize, and verify individual public elements.

**Enforcement:** no production secrets or personal data in commits, GitHub
Actions artifacts/logs, build outputs, examples or public issue/PR text.
Use explicit exclusions, automated secret checks, local and CI scanning,
and a private runtime data store. Scan **reachable history** of every
repository before making it public or copying its historical commits.
Rotate leaked credentials rather than relying on current-file deletion.

### Pending licensing actions (must verify before publication)

1. Audit file-level authorship and inbound dependency/third-party licenses.
   The current `LICENSE` says proprietary while `package.json` declares
   `AGPL-3.0-or-later`; the mismatch remains unresolved.
2. Confirm all original code is controlled by the owner and any incorporated
   copyleft components permit the desired distribution model. Do not
   relabel third-party AGPL code as MIT.
3. After confirming provenance and public-data hygiene, reconcile the
   `LICENSE`, `package.json` and copyright/third-party notices to the
   chosen license consistently, one controlled PR at a time.
4. Preserve Rclone MIT copyright notices; its commercial permission does
   not grant proprietary rights to provider accounts/data.
5. Keep private canonical data separate from the publicly licensed NYX
   implementation. Do not rewrite Head/Body/Footer outside canonical lifecycle.

This document records the owner's preference and the release gate. **No
existing repository license is changed by this proposal.**
