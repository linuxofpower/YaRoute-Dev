const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
require('reflect-metadata');
const { NyxContinuityService } = require('../dist/mcp/nyx-continuity.service');

const owner = 'oauth:test-owner';
const session = '11111111-1111-4111-8111-111111111111';

class FakePool {
  constructor() {
    this.messages = new Map();
    this.offsets = new Map();
  }
  async query(sql, params = []) {
    const key = params.slice(0, 2).join('|');
    if (sql.includes('INSERT INTO nyx_conversation_ticks')) {
      const msgKey = key + '|' + params[2];
      if (this.messages.has(msgKey)) return { rowCount: 0, rows: [] };
      this.messages.set(msgKey, { role: params[3], content: params[4] });
      return { rowCount: 1, rows: [{ message_id: params[2] }] };
    }
    if (sql.includes('SELECT role, content FROM nyx_conversation_ticks')) {
      const data = this.messages.get(key + '|' + params[2]);
      return { rowCount: data ? 1 : 0, rows: data ? [data] : [] };
    }
    if (sql.includes('AS total')) {
      const total = [...this.messages].filter(([id, value]) =>
        id.startsWith(key + '|') && value.role === 'user').length;
      return { rowCount: 1, rows: [{ total, covered: this.offsets.get(key) || 0 }] };
    }
    if (sql.includes('INSERT INTO nyx_conversation_sum_offsets')) {
      this.offsets.set(key, Math.max(params[2], this.offsets.get(key) || 0));
      return { rowCount: 1, rows: [] };
    }
    throw new Error('Unexpected database query');
  }
}

const service = () => {
  const tracker = new NyxContinuityService();
  tracker.pool = new FakePool();
  return tracker;
};

test('no database: do not claim durable NYX tick receipts', async () => {
  const tracker = new NyxContinuityService();
  await assert.rejects(tracker.tick(owner, session, 'm1', 'user', 'Hello'), /NYX_TICK_DATABASE_REQUIRED/);
  assert.equal(tracker.reminder().storage, 'not_configured');
});

test('exact duplicate messages are idempotent, changed replay fails closed', async () => {
  const tracker = service();
  const a = await tracker.tick(owner, session, 'm1', 'user', 'Hello');
  const b = await tracker.tick(owner, session, 'm1', 'user', 'Hello');
  assert.equal(a.saved, true);
  assert.equal(a.duplicate, false);
  assert.equal(b.duplicate, true);
  assert.equal(b.totalUserMessages, 1);
  await assert.rejects(tracker.tick(owner, session, 'm1', 'user', 'Changed'), /NYX_TICK_MESSAGE_ID_CONFLICT/);
});

test('fifth user message requests canonical SUM, verified acknowledgment resets count', async () => {
  const tracker = service();
  for (let i = 1; i <= 5; i++) {
    const r = await tracker.tick(owner, session, 'm' + i, 'user', 'Message ' + i);
    assert.equal(r.totalUserMessages, i);
    assert.equal(r.summaryDue, i === 5);
  }
  assert.equal((await tracker.tick(owner, session, 'assistant-1', 'assistant', 'Answer')).totalUserMessages, 5);
  await tracker.acknowledgeVerifiedSum(owner, session, 5);
  let next = await tracker.tick(owner, session, 'm6', 'user', 'Message 6');
  assert.equal(next.userMessagesSinceSum, 1);
  assert.equal(next.summaryDue, false);
  await tracker.acknowledgeVerifiedSum(owner, session, 2);
  assert.equal((await tracker.tick(owner, session, 'm7', 'user', 'Message 7')).userMessagesSinceSum, 2);
});

test('different OAuth owners cannot read or affect each other’s tick counts', async () => {
  const tracker = service();
  await tracker.tick(owner, session, 'm1', 'user', 'Owner one');
  await tracker.tick('oauth:other-owner', session, 'm1', 'user', 'Owner two');
  await tracker.tick(owner, session, 'm2', 'user', 'Owner one again');
  assert.equal(await tracker.countUserMessages(owner, session), 2);
  assert.equal(await tracker.countUserMessages('oauth:other-owner', session), 1);
});

test('reusable credentials are blocked by the existing NYX secret guard', async () => {
  const tracker = service();
  await assert.rejects(
    tracker.tick(owner, session, 'secret-1', 'user', 'password=supersecret123'),
    /SECRET_FIELD_REJECTED/,
  );
});

test('private tool and five-message reminder are wired without changing canonical Head commands', () => {
  const file = readFileSync(join(__dirname, '..', 'src', 'mcp', 'mcp.service.ts'), 'utf8');
  const privateGate = file.indexOf("if (process.env.NYX_DEPLOYMENT_MODE==='public') return server;");
  const tickRegistration = file.indexOf("'nyx_tick'");
  assert.ok(tickRegistration > privateGate, 'nyx_tick must be private only');
  assert.match(file, /this\.continuity\.reminder\(\)/);
  assert.match(file, /this\.executeVerifiedSum\(input\.sessionId/);
  assert.match(file, /this\.continuity\.acknowledgeVerifiedSum/);
});
