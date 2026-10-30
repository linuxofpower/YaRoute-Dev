# Private Nyx runtime maintenance

The private operator MCP offers two typed operations independent of Yaro command
execution, so a failed KEY preflight does not prevent inspecting or preparing its
repair. These are backend maintenance capabilities, not new Head commands.

- `nyx_maintenance_runtime_inspect`: supply an owner-scoped GitHub connection,
  repository and exact Tester SHA. Reads only
  `config/nyx-runtime-profile.json` at that revision, compares its pinned keys
  with live routed sources and checks its CLI fingerprint against the verified
  bootstrap CLI. The source definitions and command bindings must match the
  configured deployed profile before any repository-directed private read.
  Returns hashes and statuses without source contents.
- `nyx_maintenance_runtime_prepare`: submit that exact Tester SHA, profile hash,
  CLI hash, a new `nyx/*` review branch, and the explicitly reviewed hash for
  **every** existing key. Re-reads sources and refuses changed, unavailable,
  omitted or duplicate pins. Stages only changed key hashes and opens a draft
  PR into Tester after verifying the written profile and review-branch SHA.

Authenticated private-owner access, owner-scoped repository/path/branch grants
and existing connection request quotas apply. The general file-write tool still
rejects configuration files. This narrow operation cannot add key sources,
change source refs, change the CLI fingerprint, edit command contracts or write
credentials. Public tenant mode cannot register or execute these operations.
There is no shell or Git CLI runner.

A changed Tester tip or profile invalidates the review. Failed PR creation
returns the already-verified branch receipt so the operator can finish review
without pretending the whole operation succeeded. No default or Tester ref is
updated by preparation. Existing separately authorized CI/merge and hosting
operations remain responsible for rollout; this interface has no Heroku config,
restart, deployment or billing executor.

Pin verification is distinct from canonical readiness. The bootstrap's declared
Head/Body/Footer may be stale; this interface reports that canonical freshness
has not been independently checked. A successful pin-only repair does not
certify current Head command compatibility, create a FIF, initialize an Area,
or prove two-user MEGA isolation. Resolve the newest valid Footer and reconcile
bootstrap/adapter authority separately before claiming canonical INI completion.

## Initial rollout

These endpoints become callable only after their source revision is deployed to
the private NestNyx app and its MCP tool inventory is refreshed. Source commits
or Dev CI alone do not update a connected deployment. The existing target-owned
runtime-profile parity gate still applies to automatic Dev-to-Tester promotion;
this implementation does not bypass that gate or modify stored/local credentials.

## Mutable draft overlay drift (30 October 2026)

The runtime profile distinguishes enforced integrity pins (default, fail-closed) from
**observe-only** integrity receipts for the *two exact known mutable staging drafts*:
`temp_paths` and `temp_nyxcli`. Only these named MAIN draft files under
`0_repository/3_template/staging/drafts/` may have `mode: "observe"`.
A change or read error is returned as `KEY_OBSERVE_*` warning and is reported
by the private preflight diagnostics; the changed bytes are **never** accepted
as CLI authority, executed, used to change routing, or silently re-pinned.
Other keys, including `active_key`, remain enforced and fail-closed.

This prevents routine draft editing from globally disabling `ini`, `hel`,
or unrelated commands. It does **not** bypass verification of the real canonical
CLI, the runtime profile, authoritative source reads, resource routing or FIF
readback. Stale bootstrap Head/Body/Footer pointers, unsupported InitBun
contracts, and undeployed backend source are separate blockers and must be
resolved through the reviewed Tester/production release workflow. A Dev merge
alone is not proof of a working live initialization.

Regression tests reject observe mode on arbitrary keys or source paths, prove
that both draft drift and unavailability are reported without blocking, and
verify that a changed enforced key still prevents execution.
