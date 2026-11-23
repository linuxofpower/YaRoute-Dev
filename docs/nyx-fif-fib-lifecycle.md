# NYX conversation continuity: FIF -> FIB

**Authority:** `head_db_v032.zip`, `LEAD/Core_Skills/InitBun/InitBun_Core_Skill_v006.md`, `LEAD/Unified_Chat_Bundle_FIF_FIB_Policy_v001.json`, `LEAD/FIF_SUM_Background_Continuity_Policy_v001.json`, `LEAD/FIF_Session_Incremental_Continuity_Policy_v001.json`, `LEAD/SUM_Exact_Count_and_Output_Order_Policy_v001.json`. Resolve a newer verified canonical Head before using this as live authority. This file documents implementation; it does not supersede Head.

## Identity and state

- **FIF** = First Initialization File. `Nyx ini` creates/reuses one verified, conversation-bound FIF, with immutable revision history and source-read receipts. A target or source change may append a FIF revision, not overwrite an old revision.
- **FIB** = Fresh Initialization Bundle. First *verified* `Nyx sum` promotes the active FIF to a FIB revision **under the same stable artifact ID**. Later SUMs append FIB revisions; identical payload/state retries return the same checkpoint.
- `created_at` persists, `updated_at` advances on actual changes. Required continuity fields include compact current context, urgent items, next action, message-count status, canonical/source lineage, and prior checkpoints.
- Summary output stays **title first, summary second**. EXT may add its remaining report after the summary.
- Exact message count is **UNKNOWN** unless the runtime has an independent authoritative visible transcript count. A caller-supplied number is separately retained as `unverified_message_count`; it is not a verified count.

## Existing private runtime implementation

`src/nyx/handoff-store.service.ts` stores a checkpoint under the deterministic `artifactId(owner, conversationId)`, with durable serialization via Postgres or the strictly gated, single-dyno remote ledger. Handoff member writes go through immutable create/readback verification.

1. `initialize()`: require upstream source/routing verification, build FIF metadata, verify old checkpoint if present, and write an immutable `FIF_<id>.json` (or `FIF_<id>.revisions/<digest>.json`).
2. `summarize()`: require existing FIF/FIB; verify prior checkpoint, add new deltas without clearing omitted urgent items/next action, and compute the new FIB revision.
3. Write `FIB_<id>/revisions/<revision>/` members: `fif.json`, `summary.md`, `summary.json`, `sources.json`, `continuity.json`. The predecessor's kind/ref/SHA is included in new revision metadata.
4. Write `manifest.json` **last** as the commit marker. Verify its ID, revision, exact five member names/paths/hashes, embedded FIF/source consistency, and predecessor linkage on subsequent reads.
5. Advance the serialized lineage checkpoint only after successfully writing/verifying the revision. Preserve earlier FIF/FIB artifacts; partial writes cannot legitimately be reported COMPLETE.
6. Repeated unchanged SUM returns the same checkpoint; changed SUM appends a new revision. The SUM response exposes `continuity.transition`: `FIF_TO_FIB` for first promotion, `FIB_REVISION` for changed subsequent SUM, and `UNCHANGED` for an idempotent repeat; also returns the stable artifact ID and verified checkpoint SHA. `ini ++` / `ini --` after promotion preserves FIB shape and the prior summary.

## Public NestNyxDev boundary — not yet a native FIF/SUM

The public `nyx_ini_plan` tool parses targets/modifiers and returns `PARTIAL_DIAGNOSTIC` with `fif:null`. It **does not** produce a FIF; public `nyx_sum` is not registered. Do not conflate its successful invocation with initialization or promotion.

Before enabling tenant-native FIF/FIB, implement and verify all of:

- An authenticated, tenant-**authorized** source resolver: current Footer/canonical Head/Body + typed paths/config/status, mandatory semantic reads, and required visible rendering. Caller assertions are not source receipts.
- Owner-bound conversation identity and server-side resource isolation. Use separately authorized tenant storage/Neon; never allow public tenants into private operator MAIN/Rclone or a global handoff table by an untrusted owner parameter.
- Server-issued source/read/render/FIF receipts with immutable artifact writes and SHA readback. If source or transcript evidence is unavailable, return the specific missing gate; never fabricate hashes, a FIF, a FIB, or an exact count.
- `Nyx sum` must require the verified same-conversation FIF, promote the same identity, maintain compact incremental context and required provenance, and verify the persisted FIB before completion.
- Regression tests: same owner/retry, cross-owner denial, absent FIF, stale/changed authority, missing source, count UNKNOWN, incremental omitted fields, immutable revision/repair, changed FIB member or manifest, and concurrent SUM.

## Scope

Dev PR hardens the existing private engine as a reusable lifecycle reference. **It does not deploy tenant-native SUM, create any live chat's FIF/FIB, rewrite Head/Body/Footer, promote a seed, or touch NestNyxPro.**
