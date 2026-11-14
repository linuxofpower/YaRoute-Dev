# HeartBit → NestNyx DEV: cost-bounded shadow phase

Status: **development-only / not deployed / no extra dyno**. This change adds a deterministic, read-only parity gate. It does not schedule, dispatch, claim, complete, or persist any task. It does not alter canonical Head, Body, Footer, ToBit, the Ledger or production resources.

## Budget gate

Heroku Eco offers **1,000 shared dyno-hours per $5 monthly account plan**. Two 24×7 dynos use about 1,440 hours in a 30-day month, exceeding the pool even before other Eco apps. On Cedar, Eco permits one dyno per process type and at most two concurrently running Eco dynos per app; a separate web and heartbit process may be technically possible, but they are **not safe to leave running continuously** within the user's $5 budget. An Eco web dyno can sleep after inactivity, and a paired worker sleeps with it; worker-only Eco apps do not sleep. Never scale another dyno as part of this change. Actual account usage/billing must be checked separately before any scale operation.

## Sequence and gates

1. Verify Head/Body/Footer, ToBit, Ledger and target DEV bootstrap/profile. Do not treat the deployed H31/B27/F97 profile as H32/B28/F102 until coordinated verified rollout; draft PR #91 must not be merged alone.
2. Read independent ToBit, Ledger and actual ChatGPT scheduler observations and pass them as HeartBitShadowInput. The parity function rejects stale/missing evidence, Work-mode allowance, authority/cycle drift, and worker/lease/scheduler differences.
3. Keep dispatchAllowed=false, workModeAllowed=false and the ChatGPT HeartBit owner intact; do not increment cycles or invent success.
4. Next development phase: add an explicitly gated, owner/tenant-isolated Neon PostgreSQL *shadow-only* slot journal and observability. Never persist secrets. Require one unique logical slot, idempotent receipts, and missed-slot diagnostics. No automatic CoreGen, CAN, mail or notifications.
5. After at least **two consecutive verified shadow cycles**, assess controlled dispatch parity under explicit owner approval. Prefer a cost-bounded scheduler that can wake a sleeping Eco web dyno instead of a continuously running worker.
6. Only after explicit owner budget approval and validated rollback, consider scaling a second dyno or a different hosting tier. Never disable the existing ChatGPT HeartBit before verified replacement and rollback parity.

## Test

After npm run build, run node --test tests/heartbit-shadow-parity.test.cjs. Tests cover independent observations, missing/stale evidence, strict no-Work execution, cycle/authority drift, worker lease disagreement and scheduler-disabled gates.

## Known blockers

- DEV bootstrap/CLI/profile parity with canonical H32/B28/F102 has not been independently verified; production remains isolated.
- No verified live Heroku account Eco-hour telemetry was available here; cost examples use published limits.
- This is a library and test harness, **not a running shadow service**. Activating polling, persistence and scheduler input requires separate reviewed changes.
