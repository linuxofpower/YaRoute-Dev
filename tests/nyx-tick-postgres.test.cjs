const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
require('reflect-metadata');
const { Pool } = require('pg');
const { NyxContinuityService } = require('../dist/mcp/nyx-continuity.service');

const url = process.env.NYX_TEST_PG_URL;

test('real PostgreSQL: durable five-turn checkpoint, idempotency, isolation and replay', {skip: !url}, async () => {
  const pool = new Pool({ connectionString: url, ssl: false });
  const first = new NyxContinuityService();
  const second = new NyxContinuityService();
  first.pool = pool;
  second.pool = pool;
  const session = randomUUID();
  const owner = 'oauth:integration-' + randomUUID();
  const other = 'oauth:integration-other-' + randomUUID();
  try {
    await first.ensureSchema();
    for (let i = 1; i <= 5; i++) {
      const result = await first.tick(owner, session, 'test-' + i, 'user', 'Line ' + i);
      assert.equal(result.totalUserMessages, i);
      assert.equal(result.summaryDue, i === 5);
    }
    // Independent process/service instance sees the database, not an in-memory map.
    assert.equal(await second.countUserMessages(owner, session), 5);
    assert.equal((await second.tick(owner, session, 'test-5', 'user', 'Line 5')).duplicate, true);
    await assert.rejects(
      second.tick(owner, session, 'test-5', 'user', 'Line five changed'),
      /NYX_TICK_MESSAGE_ID_CONFLICT/,
    );
    const roleResult = await second.tick(other, session, 'test-1', 'user', 'Different owner');
    assert.equal(roleResult.totalUserMessages, 1);
    await first.acknowledgeVerifiedSum(owner, session, 5);
    const next = await second.tick(owner, session, 'test-6', 'user', 'Fresh checkpoint');
    assert.equal(next.userMessagesSinceSum, 1);
    assert.equal(next.summaryDue, false);
    await first.acknowledgeVerifiedSum(owner, session, 1);
    assert.equal((await second.tick(owner, session, 'test-7', 'user', 'Seventh')).userMessagesSinceSum, 2);
  } finally {
    // Test session is a disposable GUID; the CI PostgreSQL container is also ephemeral.
    await pool.end();
  }
});
