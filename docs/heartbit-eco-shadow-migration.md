# HeartBit → NestNyx DEV: cost-bounded, on-demand shadow migration

Status: **DRAFT PR ONLY / not deployed / no extra dyno / no scheduled job**. The shadow evaluator and short-lived CLI perform no network calls, SQL writes, dispatch, worker claims, cycle advances, CoreGen, CAN, email, or external mutations.

## Verified operating preference and user-provided Eco evidence

User preference (2026-11-15): **do not run HeartBit nonstop; run it only when needed**. No dedicated `heartbit.1` formation dyno should be scaled for this design.

User-supplied `heroku ps -a dev-nest-nyx` at roughly 2026-11-15 02:08 Warsaw reported:
- Account Eco quota remaining: **902h 0m (90%)** of shared 1,000h monthly pool.
- This application's Eco consumption: **50h 35m (5%)**.
- App formation: **web.1 (Eco) only**, running `npm run start:prod`.
- A local `secret-tool` / D-Bus secret-service warning appeared, but the Heroku CLI returned dyno/usage data. Do not interpret it as a dyno failure.

Heroku Eco is $5/month for 1,000 **shared** dyno-hours. A one-off `heroku run` or free Heroku Scheduler task consumes only wall-clock time while it runs. An Eco web dyno sleeps after 30 minutes without incoming traffic. One-off jobs exit on completion and do not automatically restart; if a worker-only app is scaled separately it can consume hours continuously. A full-time web+worker pair would use ~1,440h in a 30-day month, more than the quota. The command below uses the existing Eco app, no second formation dyno.

References:
- https://devcenter.heroku.com/articles/eco-dyno-hours
- https://devcenter.heroku.com/articles/one-off-dynos
- https://devcenter.heroku.com/articles/working-with-one-off-dynos
- https://devcenter.heroku.com/articles/scheduler

## One-off entrypoint (development feature only)

`src/heartbit/shadow-once.ts` is deliberately small, synchronous, and bounded. It reads independently collected shadow evidence only from `--input <path>`, using a **64 KiB maximum**, checks freshness against the actual current UTC time, and prints *only* status and safe reason codes. It cannot dispatch, start a scheduler, or use ChatGPT Work mode. No autonomous task is installed.

After **review, CI, a separate explicit deployment, and release verification**, the on-demand self-check command would be:

```bash
heroku run -a dev-nest-nyx -- node dist/heartbit/shadow-once.js --self-check
```

**Important:** `--self-check` only verifies that the code is available in a one-off dyno. It is **not** a HeartBit cycle or proof that live parity works. For actual parity, the input must be created *on that dyno* by a future read-only adapter from independently verified fresh ToBit, Ledger, and actual scheduler states. A file on a user's laptop is **not automatically available** on Heroku's ephemeral dyno filesystem. Until the adapter exists, `--input` is available only for offline/fixture tests; do not schedule it as if it were a production HeartBit job.

Local (after `npm run build`):

```bash
node dist/heartbit/shadow-once.js --self-check
node dist/heartbit/shadow-once.js --input /path/to/fresh-evidence.json
node --test tests/heartbit-shadow-parity.test.cjs tests/heartbit-shadow-once.test.cjs
```

Exit codes: 0 = valid self-check or evidence MATCH; 2 = DRIFT; 3 = insufficient/read-invalid evidence; 64 = invalid invocation. The structured status distinguishes self-check from MATCH. All outcomes have `dispatchAllowed=false` and `workModeAllowed=false`, so a zero exit status never gives dispatch authority.

## Migration steps and hard gates

1. Verify Head/Body/Footer, ToBit, Ledger, actual worker schedules and DEV bootstrap/profile. Current deployment has H31/B27/F97 pins while canonical evidence is H32/B28/F102; coordinate bootstrap/profile update separately. Draft PR #91 must not merge alone.
2. In a separate reviewed change, build **read-only live observations** from ToBit, Ledger and actual scheduler, with real timestamps and provenance; do not substitute the static cached ToBit flags for actual scheduler telemetry. The evaluator fails closed on missing/stale/contradictory observations.
3. Add owner/tenant-isolated **free Neon PostgreSQL** shadow journal with unique slot key, transaction-safe lock, idempotent receipts and missed-slot evidence. Repeated one-off invocations must not duplicate work or advance a cycle.
4. Run at least **two consecutive independently verified shadow cycles**, preserving ChatGPT HeartBit as the only scheduler/dispatcher. Observe behavior and diagnose drift.
5. Only after successful evidence parity consider a minimal recurring Heroku Scheduler one-off (free add-on, not guaranteed exactly once: it can skip or duplicate a slot) or manual/event-driven triggers. The default remains **manual/on-demand**, not hourly always-on.
6. No `heartbit.1` dyno, no new Heroku add-on, no scaling/deployment, no production switch, no ChatGPT HeartBit disablement, no worker dispatch, and no automatic CAN without separately reviewed authorization and rollback.

## Existing and new tests

- `tests/heartbit-shadow-parity.test.cjs` exercises independent evidence, clock drift, explicit no-Work-mode constraint, authority/cycle mismatch, scheduler disagreement and leases.
- `tests/heartbit-shadow-once.test.cjs` exercises the CLI one-shot self-check, evidence MATCH/DRIFT, stale evidence, input-size boundary, missing/invalid evidence and false Work-mode grants.

## Outstanding

- The new one-off executable **has not been deployed** to Heroku; the existing public DEV web process is unchanged.
- No live input adapter, Neon slot journal, real shadow cycle, CI success or production cutover is claimed by this PR.
- Existing Eco hours are a snapshot from the user, not a continuously queried usage balance.
