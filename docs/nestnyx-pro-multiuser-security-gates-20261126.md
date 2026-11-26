# NestNyx multi-user Pro promotion: security gates (2026-11-26)

**Status: NOT APPROVED for public Pro onboarding. Dev/Tester and Pro remain distinct.**
This is an evidence-backed release checklist, not a canonical Head/Footer mutation, an authorization to publish, or a claim of 30-day stability. Re-verify all dynamic facts at promotion time.

## Verified now

- GitHub: Dev `linuxofpower/YaRoute-Dev` main `73bef39e367846cbe0b29ab480b805d77cac193c`; Tester `yaMorozYaroslav/YaRoute` tester `1b9590d71358f14c64516adcf3d70938835cb578`; Pro master `94db6e59f424379d1dee334f64fe0cffcd32ea24` protected.
- Recent Tester CI/security audit green. Heroku Tester deploy preflight reported an exact running SHA match for `1b9590d7`. This does NOT attest Pro runtime.
- Two genuine separate NestNyxDev OAuth accounts authenticated. Read-only owner listing: 8 active connections for one account and 7 active + 2 pending for the other, no overlapping connection IDs.
- Both owners listed own selected provider root successfully. Reusing the other owner's connection for `list_files` returned `TENANT_RCLONE_CONNECTION_FORBIDDEN` in both directions.
- Eight cross-owner `select_best` authorizations (`list`, `write`, `move`, `delete` from either account) were denied. This endpoint is READ-ONLY; it is not an actual write or delete test.
- Dev PR #167 adds executable source-level regression tests: 20 denial cases against `mutateMegaFile`, `mutateGoogleFile`, `createTenantTextFile`, and `cleanupTenantTrash`; an authorized-owner provider-stage sentinel; and a private-mode rollback sentinel. Tests never call real Rclone or DB. CI run 45729629062 succeeded, 601 passing / 0 failing. PR is ready for review, NOT merged or deployed.

## Independent Neon metadata check (sanitized)

Three distinct projects exist, each with its own compute host and database. No credentials, subjects, token values, or file content were read.

| Project | Host (unpooled) | Tenant connection rows | Unique owner count |
| --- | --- | ---: | ---: |
| `nestnyx-public` | `ep-falling-silence-b9rcrzay.c-7.eu-central-1.aws.neon.tech` | 3 | 1 |
| `nestnyx-dev` (historical) | `ep-summer-fire-b9obdo3n.c-7.eu-central-1.aws.neon.tech` | 19 | 2 |
| `nestnyx-pro` | `ep-dawn-sky-b9yxwyf6.c-7.eu-central-1.aws.neon.tech` | legacy schema | n/a |

Live plugin exposed 19 combined tenant connections, *consistent with* historical `nestnyx-dev` rows. However exact runtime `DATABASE_URL` host is **NOT VERIFIED**; count coincidence is not a connection attestation. Confirm actual Heroku Dev and Pro DB hosts via sanitized read-only inspection before any migration/Pro promotion; maintain old data and keys for recovery.

## Unmet pre-public-release gates

1. **Effective database attestation:** verify `dev-nest-nyx` and `nest-nyx-pro` Heroku database host mapping, encryption-key separation and absence of global/private Rclone in public Dev. Do not print raw `DATABASE_URL`, `HEROKU_API_KEY`, Rclone config or OAuth tokens.
2. **Real mutation integration:** create and verify a fresh disposable file in each account's own authorized test root; reject cross-owner use of the same exact connection/root for create, rename/move, trash and account-wide cleanup preflight; verify denial BEFORE a destructive provider operation. No irreversible Trash cleanup.
3. **Live OAuth negative tests:** no-token 401, expired/invalid signature, wrong audience, insufficient scope, non-Google subject 403, JWKS outage fail-closed 503; test true refresh and reconnect intervals. Static unit tests are not live proof.
4. **Neon isolation/restart:** prove two tenants survive restart, encrypted per-owner credentials cannot decrypt across tenants, FIF/FIB and KEY records are inaccessible across owners, revocation persists; verify public tenant actually uses the expected Neon instance.
5. **Pro-specific safety:** preserve operator-only private Rclone and owner allowlist until separated Pro release; check current Pro Heroku release SHA, OAuth settings, legacy shared roots and protected master branch; design rollback with exact recovery evidence.
6. **Security scanners:** inspect GitHub alerts, dependency findings, git history (including deleted blobs), CSP/headers and rate limits, and actual Heroku config non-secret flags before public invitation.
7. **Release discipline:** reviewed Dev PR, green CI, automatic guarded Tester PR and independent CI, live Tester SHA and isolated two-account behavior; only then plan an explicit Pro promotion and opt-in exposure with rollback.

**Do not treat this document or synthetic test pass as a request to enable multi-user mode in production.**
