import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Pool } from 'pg';
import { assertNoSecrets } from '../nyx/handoff-store.service';

export const NYX_SUM_INTERVAL = 5;
const ownerDigest = (owner: string) => createHash('sha256').update(owner).digest('hex');

@Injectable()
export class NyxContinuityService implements OnModuleInit, OnModuleDestroy {
  private pool?: Pool;

  async onModuleInit() {
    // No in-memory fallback: only durable message receipts may say "saved".
    // This feature remains private behind the existing MCP OAuth owner gate.
    if (!process.env.DATABASE_URL || process.env.NYX_DEPLOYMENT_MODE === 'public') return;
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
    await this.ensureSchema();
  }

  // Reused by the isolated real-PostgreSQL integration test.
  private async ensureSchema() {
    if (!this.pool) throw new Error('NYX_TICK_DATABASE_REQUIRED');
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS nyx_conversation_ticks (
        owner_key text NOT NULL,
        session_id uuid NOT NULL,
        message_id text NOT NULL,
        role text NOT NULL CHECK (role IN ('user', 'assistant')),
        content text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (owner_key, session_id, message_id)
      )
    `);
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS nyx_conversation_sum_offsets (
        owner_key text NOT NULL,
        session_id uuid NOT NULL,
        covered_user_count bigint NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (owner_key, session_id)
      )
    `);
  }

  async onModuleDestroy() {
    await this.pool?.end();
  }

  reminder() {
    return {
      schema: 'nyx.continuity.reminder.v1',
      rule: 'In an initialized private NYX conversation, call nyx_tick for each NEW user message before completing the reply. Use the same sessionId from nyx_ini and a stable unique messageId for that message. Never say a message was saved unless nyx_tick confirms saved=true. When summaryDue=true, call canonical nyx_sum with a truthful summary. Resume counting only after nyx_sum returns a verified checkpoint.',
      intervalUserMessages: NYX_SUM_INTERVAL,
      automaticCapture: false,
      storage: this.pool ? 'postgresql' : 'not_configured',
      limitation: 'Model-initiated tool calls are best-effort. NYX cannot see a ChatGPT message until it is explicitly submitted.',
    };
  }

  async tick(
    owner: string, sessionId: string, messageId: string,
    role: 'user' | 'assistant', content: string,
  ) {
    if (!this.pool) throw new Error('NYX_TICK_DATABASE_REQUIRED');
    assertNoSecrets(content);
    const key = ownerDigest(owner);
    const inserted = await this.pool.query(
      `INSERT INTO nyx_conversation_ticks(owner_key, session_id, message_id, role, content)
       VALUES ($1, $2::uuid, $3, $4, $5)
       ON CONFLICT DO NOTHING RETURNING message_id`,
      [key, sessionId, messageId, role, content],
    );
    const stored = await this.pool.query(
      `SELECT role, content FROM nyx_conversation_ticks
       WHERE owner_key=$1 AND session_id=$2::uuid AND message_id=$3`,
      [key, sessionId, messageId],
    );
    if (stored.rows[0]?.role !== role || stored.rows[0]?.content !== content) {
      throw new Error('NYX_TICK_MESSAGE_ID_CONFLICT');
    }
    const { total, covered } = await this.counts(owner, sessionId);
    const sinceSum = Math.max(0, total - covered);
    return {
      schema: 'nyx.tick.v1',
      saved: true,
      duplicate: inserted.rowCount === 0,
      durability: 'postgresql',
      sessionId,
      messageId,
      role,
      totalUserMessages: total,
      userMessagesSinceSum: sinceSum,
      summaryDue: sinceSum >= NYX_SUM_INTERVAL,
      nextAction: sinceSum >= NYX_SUM_INTERVAL ? 'nyx_sum' : 'continue',
      limitation: 'Only submitted user messages are counted. Assistant replies are not automatically captured.',
    };
  }

  async countUserMessages(owner: string, sessionId: string): Promise<number | null> {
    if (!this.pool) return null;
    return (await this.counts(owner, sessionId)).total;
  }

  async acknowledgeVerifiedSum(owner: string, sessionId: string, coveredAtStart: number | null) {
    if (!this.pool || coveredAtStart === null) return;
    await this.pool.query(
      `INSERT INTO nyx_conversation_sum_offsets(owner_key, session_id, covered_user_count)
       VALUES ($1, $2::uuid, $3)
       ON CONFLICT(owner_key, session_id) DO UPDATE
         SET covered_user_count=GREATEST(nyx_conversation_sum_offsets.covered_user_count, EXCLUDED.covered_user_count),
             updated_at=now()`,
      [ownerDigest(owner), sessionId, coveredAtStart],
    );
  }

  private async counts(owner: string, sessionId: string): Promise<{total: number; covered: number}> {
    if (!this.pool) throw new Error('NYX_TICK_DATABASE_REQUIRED');
    const result = await this.pool.query(
      `SELECT
         (SELECT count(*) FROM nyx_conversation_ticks
          WHERE owner_key=$1 AND session_id=$2::uuid AND role='user') AS total,
         (SELECT COALESCE(covered_user_count, 0) FROM nyx_conversation_sum_offsets
          WHERE owner_key=$1 AND session_id=$2::uuid) AS covered`,
      [ownerDigest(owner), sessionId],
    );
    return {
      total: Number(result.rows[0]?.total ?? 0),
      covered: Number(result.rows[0]?.covered ?? 0),
    };
  }
}
