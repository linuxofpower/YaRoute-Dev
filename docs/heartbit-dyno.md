# HeartBit second dyno

NestNyx now defines HeartBit as a separate Heroku process type.

```text
web      -> npm run start:prod
heartbit -> npm run start:heartbit
```

The two process types use the same release slug and Heroku config vars, but they have different responsibilities:

- `web` serves REST/MCP and continues to own the legacy storage-job poller.
- `heartbit` owns the durable hourly control pulse.
- HeartBit does **not** listen on an HTTP port.
- HeartBit does **not** claim or recover storage jobs.
- PostgreSQL is mandatory for HeartBit; there is no in-memory fallback.

## What one HeartBit pulse proves

For the current hour slot, HeartBit:

1. records missing prior hourly boundaries as `missed` evidence rather than inventing successful backfill cycles;
2. claims the current slot under a PostgreSQL advisory lock;
3. resolves the current Nyx bootstrap;
4. verifies current canonical Head / Body / Footer plus current CLI bytes;
5. commits exactly one verified cycle for that hourly slot, or persists a failed attempt;
6. retries a failed current slot while it is still current;
7. exposes the durable result through protected `GET /heartbit/status` and private MCP `nyx_heartbit_status`.

A Heroku restart therefore does not reset the cycle counter or silently lose missing-boundary evidence.

## Runtime settings

Required:

- `DATABASE_URL`
- the existing private Nyx bootstrap/storage configuration already required to resolve current Head authority.

Optional:

- `NYX_HEARTBIT_POLL_MS` — control-loop poll interval, default 60000 ms, clamped to 5 seconds–5 minutes.
- `NYX_HEARTBIT_LEASE_MS` — stale running-slot reclaim lease, default 15 minutes, clamped to 1–60 minutes.

No additional secret is introduced by HeartBit.

## Deployment / cutover

A Procfile process type does not by itself guarantee that Heroku scales it to one dyno.

After a verified deployment to `nest-nyx-pro`, scale exactly one HeartBit dyno:

```bash
heroku ps:scale heartbit=1 -a nest-nyx-pro
```

Then verify at least two consecutive backend cycles through `nyx_heartbit_status` or the protected REST status endpoint.

Keep the existing ChatGPT HeartBit automation enabled during that proof window. Only after backend HeartBit proves two consecutive hourly cycles should the old ChatGPT **HeartBit scheduler** be disabled. W1–W4 may remain temporarily as execution workers until their dispatch/claim path is migrated to NestNyx.

Do not scale multiple HeartBit dynos intentionally. PostgreSQL locking prevents duplicate cycle commits, but one dyno is the intended topology.

## Scope of this migration

This first migration moves the **clock, durable cycle journal, missed-boundary evidence, authority verification, and liveness ownership** into NestNyx.

It does not yet make NestNyx invoke ChatGPT workers or execute every historical HeartBit maintenance task itself. Those worker-dispatch paths should migrate separately so scheduler reliability is no longer coupled to ChatGPT automation wakeups.
