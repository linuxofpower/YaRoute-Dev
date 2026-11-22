# NYX public Dev initialization: incident and fail-closed recovery

Scope: **NestNyxDev and its authorized users**. This document does not authorize access to private operator storage, a change in tenant grants, or a canonical bundle generation.

## Incident: 2026-11-22
Command: `Nyx ini YaRoute WebArt TechLab EasyWay GNo I`.

Observed state: `PARTIAL_DIAGNOSTIC`, **no persisted/read-back FIF**. Head v032, Body v028 and Footer v102 archives were structurally verified but the exact Footer/registry canonical pointer readback was pending. YaRoute's skill was located; TechLab's Area routing/state/config were read; WebArt remains `staged_noncanonical`; EasyWay has mismatching old manifest vs operational folder routes. Do not call that READY or COMPLETE.

Root causes / contributing failures:
1. The public Dev MCP surface deliberately does **not** register private `nyx_ini` or the operator's shared Rclone bootstrap. This is an authorization boundary, not an invitation to disable authentication.
2. Prior command parsing did not understand Head's inherited `GNo` form (fixed in Dev); the trailing single-letter `I` is not a verified target and must be reported as unresolved.
3. Dev repository `main` CI and merge are not deployment receipts. The live `dev-nest-nyx` release guard is tied to the **Tester** source ref; verify the actual deployed commit, live MCP tool discovery and a real authenticated invocation separately.
4. Mandatory Normal-depth routes, source reads, visible renders, full typed resolution and session lineage were not verified; a local diagnostic JSON is **not** a FIF.
5. Automated Dev -> Tester stage was blocked on an oversized `src/connectors/connections-panel.ts` blob. Do not silently skip it or raise generic caps, especially while the candidate contains unrelated changes and can auto-merge after CI.

## Before returning READY
The internal assessor `inspectIniReadiness` in `src/nyx/init-readiness.ts` must have server-verified TRUE receipts for **all seven gates**:
- `canonical_pointer_verified`: current Footer plus exact canonical Head/Body and registry readback
- `live_cli_and_routes_verified`: current Head CLI and Basic/Normal paths and topology
- `all_target_owners_resolved`: every typed target resolved, staged/noncanonical or ambiguous names handled explicitly
- `all_required_source_reads_verified`: owning Area config/state and required routed sources read
- `all_required_visible_renders_verified`: actual user-facing Normal-depth render receipts
- `conversation_fif_persisted_and_read_back`: same conversation-scoped FIF persisted and verified by readback
- `live_runtime_feature_verified`: deployed runtime, authenticated tool discovery and response attested

No caller-supplied booleans or old hashes may be substituted for these server receipts. If any gate fails, return `PARTIAL_DIAGNOSTIC` / `NOT_READY` with its exact gate and never invent a FIF.

## Recovery procedure
1. Read current canonical Footer first; check pointers/hashes/readback, then exact Head CLI, Basic paths/maps and Normal registry. Prefer deterministic paths; do not guess file IDs from memory.
2. Resolve `GNo` as inherited global Normal scope, preserving unknown tokens separately; do not invent a target. Resolve YaRoute, WebArt, TechLab, EasyWay from current Head/Body and authorized Area paths. Do not auto-promote WebArt or choose between conflicting EasyWay routes.
3. Execute source reads only through the authenticated owner's isolated connector grants. Cross-account or private operator Rclone fallback is forbidden.
4. Evaluate seven gates. Report exact missing ones; no successful completion until the persisted FIF and visible receipts exist.
5. For a code rollout, first run Dev unit/security/build CI. Stage **reviewed specific code** to Tester, run Tester CI and preserve review/merge protections. Avoid unbounded 53-file auto-promotion or enlarging source limits indiscriminately.
6. Check the live target's `/health` commit against the authorized Tester ref, then inspect `nyx_capabilities`, discover `nyx_ini_plan`, and call it with the actual request under the correct Dev OAuth user. Use `assessLiveIniPreflight` in `scripts/nyx-dev-deployment-guard.mjs` for release acceptance. That proves preflight availability **only**; it is not native INI.
7. Retest the full command only when the tenant's source-content read, canonical pointer, render and FIF persistence capabilities exist. Otherwise stop at explicit PARTIAL and queue precise missing capabilities.

Security invariant: public tenants never inherit private MAIN, shared credentials, other users' Drive/MEGA or implicit elevated write grants. No secrets in receipts, commits, diagnostics or Area state.
