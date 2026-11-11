const { test } = require('node:test');
const assert = require('node:assert/strict');
const { staleTodayLabel } = require('../dist/nyx/todo-freshness');

const now = new Date('2026-11-10T12:00:00.000Z');

test('a Nov 1 Day[0] cannot satisfy Nov 10 Normal initialization', () => {
  const result = staleTodayLabel('# Todo\n\n# Day[0] — Sunday, 1 November\n1. Still pending\n', now);
  assert.deepEqual(result, { stale: true, observed: '2026-11-01', expected: '2026-11-10' });
});

test('today in Warsaw is not stale', () => {
  const result = staleTodayLabel('# Day[0] — Tuesday, 10 November', now);
  assert.deepEqual(result, { stale: false, observed: '2026-11-10', expected: '2026-11-10' });
});

test('date matching uses Warsaw timezone across UTC midnight', () => {
  const nearMidnight = new Date('2026-11-09T23:30:00.000Z');
  assert.equal(staleTodayLabel('# Day[0] — Tuesday, 10 November', nearMidnight).stale, false);
});

test('unlabeled task files do not invent an owner rollover', () => {
  assert.deepEqual(staleTodayLabel('# Todo\n1. Pending\n', now), { stale: false, expected: '2026-11-10' });
});
