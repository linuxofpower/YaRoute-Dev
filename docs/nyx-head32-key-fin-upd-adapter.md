# YaRoute KEY → FIN → UPD: Head v032 contract and Dev adapter

Authority: canonical \`head_db_v032.zip\` SHA-256 \`57410dda8efea81858a4207200e1302b782bbd089d3e17d0be20b1e2cbb7ae14\`,
\`LEAD/Core_Skills/YaRoCLI/nyxcli.json\`, \`LEAD/Yaro_Compact_Command_Grammar_v009.json\`,
\`FILE/Yaro_Global_Source_Resolution_v001.json\`, and \`FILE/Yaro_Update_Key_Utilization_Policy_v001.json\`.
Resolved continuation: Body v028, Footer v102. Re-resolve these before future canonical actions.

## Exact behavior

| Command | Canonical contract | Dev status |
|---|---|---|
| \`Nyx key oF\` | Update mutable temporary key, no seed; log hashes, diff, and disposition | Existing owner-isolated Neon KEY staging |
| \`Nyx key oS\` | Update key and make appropriate key-derived seed | Existing pending-validation tenant seed proposal only |
| \`Nyx fin Go\` | Generic cross-core planning; Head/Body slices; no selected rewritten core | Pure FIN planner; **blocked** until authority/keys/LCB resolved |
| \`Nyx upd Go\` | Same-chat compatible FIN; disposition every valid key; Head/Body update slices | Pure UPD planner; **blocked** if FIN incomplete |
| \`Nyx key oFxS x fin x upd Go\` | Accepted pending KEY-only alias expanding \`key oF → key oS → fin → upd\` | Bounded public \`nyx_execute\`; KEY transaction + explicit FIN/UPD blockers |

The KEY-only \`oFxS\` alias is **not part of canonical Head v032**. It is an accepted Dev adapter convention pending a separately versioned Head generation and CAN. The explicit current-Head command is \`Nyx key oF x key oS x fin x upd Go\`. Do not generalize \`xS\` to other commands; reject ambiguous local/global escalations.

## Public execution and safety

\`nyx_execute\` is exposed only in public mode with a **strict KEY/FIN/UPD allowlist**. Input is an exact command string and up to 80 explicitly supplied bounded user messages; it is **not** authorized to retrieve hidden ChatGPT history, private MAIN, Head/Body/Footer Drive contents, or global pending/LCB sources from arbitrary accounts.

1. Parse the exact chain and resolve local vs inherited global scope.
2. Extract only grounded new user-authored KEY decisions. Reject bare commands, speculation, diagnostics, assistant claims and credentials. If no valid candidate, abort without a KEY write.
3. For KEY stages, call existing tenant-isolated atomic \`executeFs\`; verify F/S receipts, commit and read back.
4. Read the owner-only active KEY including archived candidates through Neon exact readback.
5. Assemble generic FIN preflight with retained candidate inventory, Head/Body slices, Footer-continuity candidates and exact missing source classes. **Never invent or silently consume keys.**
6. Require trusted, exact-byte source receipts for current chat, canonical Head, Body and Footer; for global mode additionally active, promoted pending KEY records and relevant LCBs. External records are conditional on relevance. An MCP client's \`verified: true\` assertion is not evidence.
7. With current public grants, return \`PARTIAL_DIAGNOSTIC\` for FIN and \`BLOCKED_FIN_PRECONDITION\` for UPD. A simulated/pure test of successful planning is not a live FIN or UPD.
8. No core GEN, CAN, Footer checkpoint, private Head/Body write or auto-release is performed.

\`finalizeYaroPlanning\` has the future trusted-adapter contract: all required source classes need verified SHA-256 receipts, every in-scope KEY needs exactly one sourced disposition, confidence/blocked keys cannot be silently promoted, and FIN selects no generation target. \`updateYaroPlanning\` requires FIN_PASS from the **same invocation**; it produces unversioned, nonpersisted instruction slices only. Persisting a canonical \`fin_seed_g_vNNN\` or \`seed_g_vNNN\` requires the existing Footer continuity and generation lifecycle, not these pure helper functions.

## Missing before full parity

- Authenticated global source resolver with exact Drive/Head/Body/Footer readback through **each owner's authorized source accounts**, plus current-chat and relevant LCB/KEY continuity.
- Canonical key triage/FOOTER checkpoint, fully verified local Git-style diff and lifecycle-controlled seed generation.
- Version allocation, immutable artifact writes, source-class coverage and item disposition receipts for actual FIN/UPD seeds.
- End-to-end authenticated MCP tool discovery, live Neon receipt check, idempotent retry, Dev→Tester promotion, Heroku live SHA matching.
- Next canonical Head generation and separate Footer snapshot/diff/readback to make the \`oFxS\` shorthand an authoritative CLI change.

Do not claim FIN/UPD COMPLETE, seed consumed, canonical updated, or global reconciliation from a preflight. Errors are not unsupported commands. A failed gate must retain the exact blocker.
