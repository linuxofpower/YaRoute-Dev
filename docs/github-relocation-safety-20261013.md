# Verified GitHub access and safe relocation (2026-10-13)

This is an **operational snapshot**, not a canonical Head/Body/Footer update. Revalidate live repository and installation permissions before every consequential action. The machine-readable companion is `config/github-repository-topology.v001.json`.

## Two connected identities and access truth

- **linuxofpower (development):** GitHub reports owner permission on its eight repositories. Creating branches, editing files and opening PRs were actually verified in `linuxofpower/YaRoute-Dev` (example: development PR #13). **On `yaMorozYaroslav/YaRoute`, this account is read-only.**
- **yaMorozYaroslav (production):** GitHub reports owner/admin permission on its ten repositories, but the current ChatGPT GitHub App returned **HTTP 403** for creating a branch, changing a file or opening a PR in `YaRoute`. That discrepancy is an **installation/token permission problem**, not evidence of working write access. This account can read `linuxofpower/YaRoute-Dev` but not write it.
- No claim of verified write access on every branch. Branch lists and owner-level permissions are observations; protections, rulesets and commit signatures must be checked separately when a specific branch is targeted.
- All original repositories retain their identities and default branches. No destructive operations are allowed based on this registry.

## Verified source → destination relocation matrix

| Source (yaMorozYaroslav) | Destination (linuxofpower) | Status |
| --- | --- | --- |
| FloraDevClient-relocate- | FloraClient-Dev | **NOT MIGRATED.** Destination default branch contains README only. |
| FloraDevServer-relocate- | FloraServer-Dev | **NOT MIGRATED.** Destination default branch contains README only. |
| IdeaCliDev-relocate- | IdeaClient-Dev | **PARTIAL/INDEPENDENT.** Destination has code, but source HEAD SHA was not retrievable from destination commit history. Source contains historical `certificates.backup` requiring sensitive-material audit; do not bulk-copy blindly. |
| IdeaServDev-relocate- | IdeaServer-Dev | **PARTIAL/INDEPENDENT.** Destination has code, but source HEAD SHA was not retrievable from destination commit history. |

Additional production/development pairings: `MyWeb → MyWeb-Dev`, `YaRoute → YaRoute-Dev`; these pairs have independent active development and production histories. They must be compared before any promotion. `FloraClient/FloraServer` and `IdeaClient/IdeaServer` remain production repositories. `NyxGPT` and `CodeSnippets` are support repositories, not relocation destinations.

## Non-destructive migration contract

1. **Identify full source Git ancestry.** List remote branches and tags, fetch `--all` from the original, record commit and tree IDs, scan tracked files and full reachable history for accidentally committed sensitive credentials, tokens, keys, backups and large files. Never push unsafe content to a new public repository.
2. **Back up both old and new repos before change.** Independently create `git bundle create` archives containing `--all`, verify them using `git bundle verify` and `git fsck`. Keep rollback copies outside either repo. Backup artifacts and storage must be verified; do not assume.
3. **Import *history*, not only latest files.** Import source refs into new repo under unique `migration/<source>/<branch>` refs first, never replace destination `main` and never use `git push --mirror` against an occupied destination. Preserve existing destination refs/tags and source commit ancestors. Import safe source objects only, after sensitive history review and any required redaction, with an auditable exception for rewritten histories.
4. **Integrate source code through a review branch and PR.** Merge imported ancestry using ordinary Git history-preserving merges where feasible; test builds and ensure no remaining files/refs are absent. Do not use a squash-only migration if the goal is to retain original commit ancestors.
5. **Verify migration:** each original source branch/tag and intended history is present in the destination (commit reachability, not just filenames), the current tree is correct, all PR/test/deployment references are reconciled, and backups/restoration work.
6. **Only after explicit final approval**, prepare a cleanup PR **inside the original `*-relocate-*` repository** removing tracked working files while preserving `.git` history and old branches. Keep a README with destination/archival link if wanted. **Never delete or rename the original repository**, alter original commit ancestry or force-push its default branch.
7. **Contribution graph caution:** clearing tracked files in a *new normal commit* keeps old commit objects reachable if no history rewrite occurs, but green-square contribution counts still depend on GitHub commit author email association, default branch/gh-pages and repository/fork/visibility requirements. Verify profiles before and after; do not promise unchanged squares without evidence.

### Git inspection examples (read-only or local artifacts)

```sh
git clone --mirror https://github.com/yaMorozYaroslav/FloraDevClient-relocate-.git source.mirror.git
git -C source.mirror.git fsck --full
git -C source.mirror.git bundle create ../source.full-history.bundle --all
git -C source.mirror.git show-ref
git clone https://github.com/linuxofpower/FloraClient-Dev.git destination
git -C destination branch -a
# DO NOT run `push --mirror` on an occupied destination.
```

## Command-health UI and `nyx hea` request

`YaRoute-Dev` PR #11 already stages color-coded Nyx command buttons: **gray = Head-only**, **yellow = executable but variation receipts incomplete/issues**, **green = all required variations verified for the same canonical CLI SHA**. Add recognizable icons, accessible text labels and a separate *read-only* command-health inspection tool.

**Canonical CLI v004 currently has 21 commands and no `hea`.** Do not pretend `nyx hea` is an authoritative CLI command yet. Implement an auxiliary `nyx_hea` health observation if needed and propose `hea` as a new canonical command via Head FIN/UPD/GEN; only the next verified Head/CLI should activate `nyx hea`. Never turn a status check into command execution or leak private Head to public tenants.

---
Last edited: 2026-10-13 Europe/Warsaw
Edited by: ChatGPT (requested by user)
