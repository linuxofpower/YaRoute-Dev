# NYX / YaRoCLI — universal initialization display contract

Status: DEV implementation contract, not a modification of canonical Head/Body/Footer. Canonical Head owns command semantics; this document defines the requested UI delivery behavior for the existing `ini` execution binding.

## Baseline packet

Every successful `Nyx ini` operation, with no target or any requested Area, skill or domain, must read and return complete, unabridged content of these **six** files in precisely this order:

1. `Documents/Nyxpad/paths.md`
2. `Documents/Nyxpad/maps.md`
3. `Documents/Nyxpad/nyxcli.md` (human mirror, not machine authority)
4. `Documents/Notepad/todo.md`
5. `Documents/Notepad/0_active/todo_10.md`
6. `Documents/Notepad/0_active/toget.md`

The operator runtime profile must mark each source `required=true`, `visible=true`, `when=always` for Basic, Normal, and Deep. `paths.md` is the extra mandatory basic paths source. Other files may be added for a target or depth but cannot replace the six.

Target-specific state/config may be read as verified hidden backend context; do not paste mutable secrets or full Area state by default. `NoteFlow` Normal has three additional visible files (`todo_30.md`, `todo_90.md`, `togive.md`), subject to source availability. A target without a resolved owner receives the six-file baseline with a **partial-context warning**, never fabricated owner/Area state.

Normal/Deep routing registries are read/validated but are not part of the default visible file packet.

## MCP + ChatGPT delivery

For `nyx_ini` and the `ini` variant of `nyx_execute`:

- Backend validates all mandatory reads and SHA-256 source receipts before writing the FIF; no missing required source may be omitted silently.
- Backend returns `files_to_paste`, `delivery.markdown` and `delivery.expected`, including exact file names, source keys, SHA-256 hashes, count and order.
- The **FIRST MCP text part** is `delivery.markdown` with all six complete source bodies. Tool results must not bury the payload inside serialized JSON.
- The model must put the full `delivery.markdown` into the **FIRST user-visible assistant reply**, before any status, summary, TODO list, or question. No names-only or links-only substitutes.
- The `nyx_ini` MCP Apps resource separately renders the complete received documents, independently of prose generation, so the host can show user-visible content even if the model neglects to paste it.
- The backend cannot attest that text was actually pasted into the ChatGPT message or that a specific client displayed the component. `PENDING_USER_VISIBLE_RENDER` is truthful until a client-verifiable acknowledgment exists. A verified FIF does not constitute that acknowledgment.
- If a source is absent or hash mismatch occurs, fail clearly; do not claim completion or replace contents from memory.
- For unknown/unrouted domain or skill targets, `READY_WITH_WARNINGS` refers to the six verified baseline files only. It does **not** assert domain-specific initialization.

## GPT Project instruction (copy into NYX project guidance)

> On **every** successful YaRoCLI `Nyx ini` command, show the complete six-file standard packet returned by NestNyx. Copy the entire first MCP text part / `delivery.markdown` into the **first visible assistant reply**, in the returned order, **before** any commentary, summary or readiness claims. Do not merely list file names, link to files, truncate document contents, claim delivery based on a verified FIF, or ask whether to paste. Render extra target-specific files when marked visible. If required source bytes are absent, say initialization is incomplete. Report unresolved target-owner warnings without inventing Area/skill/domain state. If a ChatGPT display limit prevents complete pasting, state explicitly that the delivery requirement failed; the MCP document widget is a separate fallback, not a proof of chat text delivery.

## Acceptance criteria

1. Invoke bare `Nyx ini` and `nyx_ini` with `scope=local/global` and each supported depth. Every successful response includes the same six complete source bodies in order.
2. Invoke `Nyx ini Voice`, `Mental`, `FileFilter`, `NoteFlow`, `WORK`, `TECH`, and `SKILLS`. All deliver the six baseline sources; only actual owner reads count as target-specific initialization. NoteFlow Normal appends its three extra visible files.
3. Reconfiguration `Nyx ini ++` and `Nyx ini --` also return the six files without changing FIF identity.
4. Verify source-read failure is fail-closed; verify a target without owner routing is clearly marked `READY_WITH_WARNINGS` and cannot claim the requested specialized context.
5. Verify the MCP text **first part**, structured response, and MCP Apps widget each carry/render unabridged file content.
6. Real ChatGPT client acceptance requires checking the **visible assistant reply** and, separately, the rendered MCP widget; unit tests alone cannot certify these external surfaces.

## Syntax note

The existing Head/YaRoCLI semantics still govern modifier syntax. `oLN` means local normal, `oGN` global normal and `GNo` the inherited global-normal modifier. Bare `oG` and `oL` are **not** currently typed complete depth modifiers in the backend; do not silently invent their meaning or change canonical Head CLI without the proper Head lifecycle. For bare initialization with explicit scope, `nyx_ini(scope=global|local)` is an operational API option.
