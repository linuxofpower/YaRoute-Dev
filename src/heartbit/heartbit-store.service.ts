import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';

export type HeartbitAuthoritySnapshot = {
  canonical: {
    head: string;
    body: string;
    footer: string;
  };
  cli: {
    version: string;
    sha256: string;
  };
};

export type HeartbitStatusSnapshot = {
  configured: boolean;
  verifiedCycle: number;
  lastObservedSlot: string | null;
  lastCompletedSlot: string | null;
  lastCompletedAt: string | null;
  lastStatus: string;
  canonical: HeartbitAuthoritySnapshot['canonical'] | null;
  cli: HeartbitAuthoritySnapshot['cli'] | null;
  recentRuns: Array<{
    scheduledFor: string;
    cycle: number | null;
    status: string;
    attempts: number;
    startedAt: string | null;
    completedAt: string | null;
    error: string | null;
  }>;
};

const LOCK_CLASS = 0x4e5958; // "NYX"
const LOCK_KEY = 0x4842; // "HB"

@Injectable()
export class HeartbitStoreService implements OnModuleInit, OnModuleDestroy {
  private pool?: Pool;

  async onModuleInit() {
    if (!process.env.DATABASE_URL) return;

    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 3,
    });

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS nyx_heartbit_state (
        id smallint PRIMARY KEY CHECK (id = 1),
        verified_cycle bigint NOT NULL DEFAULT 0,
        last_observed_slot timestamptz,
        last_completed_slot timestamptz,
        last_completed_at timestamptz,
        last_status text NOT NULL DEFAULT 'never',
        canonical jsonb,
        cli jsonb,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS nyx_heartbit_runs (
        scheduled_for timestamptz PRIMARY KEY,
        cycle bigint,
        status text NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'missed')),
        attempts integer NOT NULL DEFAULT 0,
        started_at timestamptz,
        completed_at timestamptz,
        canonical jsonb,
        cli jsonb,
        error text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await this.pool.query(`
      INSERT INTO nyx_heartbit_state (id)
      VALUES (1)
      ON CONFLICT (id) DO NOTHING
    `);
  }

  async onModuleDestroy() {
    await this.pool?.end();
  }

  requireDurable() {
    if (!this.pool) throw new Error('DATABASE_URL_REQUIRED_FOR_HEARTBIT');
  }

  async observeSlot(slot: Date): Promise<{ missedRecorded: number }> {
    const client = await this.connect();
    try {
      await client.query('BEGIN');
      await this.lock(client);

      const state = await client.query(
        'SELECT last_observed_slot FROM nyx_heartbit_state WHERE id = 1 FOR UPDATE',
      );
      const lastValue = state.rows[0]?.last_observed_slot as Date | string | null | undefined;
      const last = lastValue ? new Date(lastValue) : null;

      let missedRecorded = 0;
      if (last && last.getTime() < slot.getTime()) {
        const inserted = await client.query(
          `
            INSERT INTO nyx_heartbit_runs (
              scheduled_for, status, attempts, created_at, updated_at
            )
            SELECT missed_slot, 'missed', 0, now(), now()
            FROM generate_series(
              $1::timestamptz + interval '1 hour',
              $2::timestamptz - interval '1 hour',
              interval '1 hour'
            ) AS missed_slot
            ON CONFLICT (scheduled_for) DO NOTHING
            RETURNING scheduled_for
          `,
          [last.toISOString(), slot.toISOString()],
        );
        missedRecorded = inserted.rowCount ?? 0;
      }

      if (!last || slot.getTime() > last.getTime()) {
        await client.query(
          `
            UPDATE nyx_heartbit_state
            SET last_observed_slot = $1, updated_at = now()
            WHERE id = 1
          `,
          [slot.toISOString()],
        );
      }

      await client.query('COMMIT');
      return { missedRecorded };
    } catch (error) {
      await this.rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async claimSlot(
    slot: Date,
    leaseMs: number,
  ): Promise<{ claimed: boolean; attempts: number; status: string | null }> {
    const client = await this.connect();
    try {
      await client.query('BEGIN');
      const locked = await this.lock(client);
      if (!locked) {
        await client.query('ROLLBACK');
        return { claimed: false, attempts: 0, status: 'lock-busy' };
      }

      const inserted = await client.query(
        `
          INSERT INTO nyx_heartbit_runs (
            scheduled_for, status, attempts, started_at, created_at, updated_at
          )
          VALUES ($1, 'running', 1, now(), now(), now())
          ON CONFLICT (scheduled_for) DO NOTHING
          RETURNING attempts, status
        `,
        [slot.toISOString()],
      );

      if ((inserted.rowCount ?? 0) > 0) {
        await client.query('COMMIT');
        return {
          claimed: true,
          attempts: Number(inserted.rows[0].attempts),
          status: String(inserted.rows[0].status),
        };
      }

      const reclaimed = await client.query(
        `
          UPDATE nyx_heartbit_runs
          SET
            status = 'running',
            attempts = attempts + 1,
            started_at = now(),
            completed_at = NULL,
            error = NULL,
            updated_at = now()
          WHERE scheduled_for = $1
            AND (
              status = 'failed'
              OR (
                status = 'running'
                AND updated_at < now() - ($2::bigint * interval '1 millisecond')
              )
            )
          RETURNING attempts, status
        `,
        [slot.toISOString(), Math.max(1, Math.floor(leaseMs))],
      );

      if ((reclaimed.rowCount ?? 0) > 0) {
        await client.query('COMMIT');
        return {
          claimed: true,
          attempts: Number(reclaimed.rows[0].attempts),
          status: String(reclaimed.rows[0].status),
        };
      }

      const existing = await client.query(
        'SELECT attempts, status FROM nyx_heartbit_runs WHERE scheduled_for = $1',
        [slot.toISOString()],
      );
      await client.query('COMMIT');

      return {
        claimed: false,
        attempts: Number(existing.rows[0]?.attempts ?? 0),
        status: existing.rows[0]?.status ? String(existing.rows[0].status) : null,
      };
    } catch (error) {
      await this.rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async completeSlot(
    slot: Date,
    authority: HeartbitAuthoritySnapshot,
  ): Promise<{ cycle: number }> {
    const client = await this.connect();
    try {
      await client.query('BEGIN');
      await this.lock(client);

      const run = await client.query(
        'SELECT status, cycle FROM nyx_heartbit_runs WHERE scheduled_for = $1 FOR UPDATE',
        [slot.toISOString()],
      );
      if (!(run.rowCount ?? 0)) throw new Error('HEARTBIT_SLOT_NOT_CLAIMED');

      if (run.rows[0].status === 'completed') {
        await client.query('COMMIT');
        return { cycle: Number(run.rows[0].cycle) };
      }
      if (run.rows[0].status !== 'running') {
        throw new Error(`HEARTBIT_SLOT_NOT_RUNNING:${String(run.rows[0].status)}`);
      }

      const state = await client.query(
        `
          UPDATE nyx_heartbit_state
          SET
            verified_cycle = verified_cycle + 1,
            last_completed_slot = $1,
            last_completed_at = now(),
            last_status = 'completed',
            canonical = $2::jsonb,
            cli = $3::jsonb,
            updated_at = now()
          WHERE id = 1
          RETURNING verified_cycle
        `,
        [
          slot.toISOString(),
          JSON.stringify(authority.canonical),
          JSON.stringify(authority.cli),
        ],
      );

      const cycle = Number(state.rows[0].verified_cycle);
      await client.query(
        `
          UPDATE nyx_heartbit_runs
          SET
            cycle = $2,
            status = 'completed',
            completed_at = now(),
            canonical = $3::jsonb,
            cli = $4::jsonb,
            error = NULL,
            updated_at = now()
          WHERE scheduled_for = $1
        `,
        [
          slot.toISOString(),
          cycle,
          JSON.stringify(authority.canonical),
          JSON.stringify(authority.cli),
        ],
      );

      await client.query('COMMIT');
      return { cycle };
    } catch (error) {
      await this.rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async failSlot(
    slot: Date,
    errorMessage: string,
    authority?: Partial<HeartbitAuthoritySnapshot>,
  ) {
    const client = await this.connect();
    try {
      await client.query('BEGIN');
      await this.lock(client);

      const canonical = authority?.canonical ? JSON.stringify(authority.canonical) : null;
      const cli = authority?.cli ? JSON.stringify(authority.cli) : null;
      const error = errorMessage.slice(0, 12000);

      await client.query(
        `
          UPDATE nyx_heartbit_runs
          SET
            status = 'failed',
            completed_at = now(),
            canonical = COALESCE($2::jsonb, canonical),
            cli = COALESCE($3::jsonb, cli),
            error = $4,
            updated_at = now()
          WHERE scheduled_for = $1
            AND status = 'running'
        `,
        [slot.toISOString(), canonical, cli, error],
      );

      await client.query(
        `
          UPDATE nyx_heartbit_state
          SET
            last_status = 'failed',
            canonical = COALESCE($1::jsonb, canonical),
            cli = COALESCE($2::jsonb, cli),
            updated_at = now()
          WHERE id = 1
        `,
        [canonical, cli],
      );

      await client.query('COMMIT');
    } catch (error) {
      await this.rollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async status(): Promise<HeartbitStatusSnapshot> {
    if (!this.pool) {
      return {
        configured: false,
        verifiedCycle: 0,
        lastObservedSlot: null,
        lastCompletedSlot: null,
        lastCompletedAt: null,
        lastStatus: 'database-unavailable',
        canonical: null,
        cli: null,
        recentRuns: [],
      };
    }

    const [state, runs] = await Promise.all([
      this.pool.query('SELECT * FROM nyx_heartbit_state WHERE id = 1'),
      this.pool.query(
        `
          SELECT scheduled_for, cycle, status, attempts, started_at, completed_at, error
          FROM nyx_heartbit_runs
          ORDER BY scheduled_for DESC
          LIMIT 24
        `,
      ),
    ]);

    const row = state.rows[0] ?? {};
    return {
      configured: true,
      verifiedCycle: Number(row.verified_cycle ?? 0),
      lastObservedSlot: this.iso(row.last_observed_slot),
      lastCompletedSlot: this.iso(row.last_completed_slot),
      lastCompletedAt: this.iso(row.last_completed_at),
      lastStatus: String(row.last_status ?? 'unknown'),
      canonical: row.canonical ?? null,
      cli: row.cli ?? null,
      recentRuns: runs.rows.map((run) => ({
        scheduledFor: this.iso(run.scheduled_for)!,
        cycle: run.cycle === null || run.cycle === undefined ? null : Number(run.cycle),
        status: String(run.status),
        attempts: Number(run.attempts ?? 0),
        startedAt: this.iso(run.started_at),
        completedAt: this.iso(run.completed_at),
        error: run.error ? String(run.error) : null,
      })),
    };
  }

  private async connect(): Promise<PoolClient> {
    this.requireDurable();
    return this.pool!.connect();
  }

  private async lock(client: PoolClient): Promise<boolean> {
    await client.query(
      'SELECT pg_advisory_xact_lock($1, $2)',
      [LOCK_CLASS, LOCK_KEY],
    );
    return true;
  }

  private async rollback(client: PoolClient) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original failure.
    }
  }

  private iso(value: Date | string | null | undefined): string | null {
    return value ? new Date(value).toISOString() : null;
  }
}
