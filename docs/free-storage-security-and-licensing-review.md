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

## Licensing discrepancy — explicit decision required

`LICENSE` in the production and development repositories currently says
PROPRIETARY / ALL RIGHTS RESERVED, while `package.json` lists
`AGPL-3.0-or-later`. This is a legal/documentation conflict; do not claim
the entire repository is uniformly proprietary or AGPL until reviewed.

Rclone's independent license is MIT and allows commercial use, including by a
proprietary server, provided required notices are preserved. Switching original
NestNyx code to MIT would grant everyone permission to copy, fork, modify,
redistribute and commercially sell that code. A previously granted MIT license
cannot practically be withdrawn from copies already distributed.

Do not edit the LICENSE, package.json `license` field, or third-party notices
without confirming copyright ownership, contributor provenance, inbound
licenses of incorporated works, and explicit owner approval of intended
open-source vs proprietary business model.

**Suggested compromise for discussion:** MIT-license a clearly owned reusable
Rclone adapter/SDK, preserve commercial proprietary NYX application code if the
owner wants exclusivity, and preserve upstream MIT notices. No licensing change
has been made.
