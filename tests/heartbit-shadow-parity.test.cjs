const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assessHeartBitShadow, HEARTBIT_WORK_MODE_ALLOWED, HEARTBIT_SHADOW_DISPATCH_ALLOWED } =
  require('../dist/heartbit/shadow-parity');

const now = '2026-11-14T21:00:00.000Z';
const ids = ['W1', 'W2', 'W3', 'W4'];
function snapshot() {
  return { observedAtUtc: now, verifiedCycle: 99,
    authority: { head: 'H32', body: 'B28', footer: 'F102' }, workModeAllowed: false,
    workers: ids.map(id => ({ id, state: 'available', taskInstanceId: null, schedulerEnabled: true })) };
}
function input() {
  return { nowUtc: now, tobit: snapshot(), ledger: snapshot(),
    scheduler: { observedAtUtc: now, coordinatorEnabled: true,
      workers: Object.fromEntries(ids.map(id => [id, true])) } };
}
test('read-only shadow parity does not dispatch, even on MATCH', () => {
  const decision = assessHeartBitShadow(input());
  assert.equal(decision.status, 'MATCH');
  assert.equal(decision.verifiedCycle, 99);
  assert.equal(decision.dispatchAllowed, false);
  assert.equal(decision.workModeAllowed, false);
  assert.equal(HEARTBIT_WORK_MODE_ALLOWED, false);
  assert.equal(HEARTBIT_SHADOW_DISPATCH_ALLOWED, false);
});
test('missing independent Ledger or scheduler evidence fails closed', () => {
  for (const key of ['ledger', 'scheduler', 'tobit']) {
    const x = input(); x[key] = null;
    assert.equal(assessHeartBitShadow(x).status, 'INSUFFICIENT_EVIDENCE');
  }
});
test('stale evidence and missing Work-mode prohibition fail closed', () => {
  const x = input(); x.tobit.observedAtUtc = '2026-11-13T00:00:00Z';
  assert.ok(assessHeartBitShadow(x).reasons.includes('MISSING_FRESH_EVIDENCE'));
  const y = input(); delete y.ledger.workModeAllowed;
  assert.equal(assessHeartBitShadow(y).status, 'INSUFFICIENT_EVIDENCE');
  const z = input(); z.ledger.workModeAllowed = true;
  assert.ok(assessHeartBitShadow(z).reasons.includes('WORK_MODE_NOT_FORBIDDEN'));
});
test('authority or cycle mismatch flags drift rather than inventing a new cycle', () => {
  const x = input(); x.ledger.verifiedCycle = 100; x.tobit.authority.head = 'H33';
  const result = assessHeartBitShadow(x);
  assert.equal(result.status, 'DRIFT');
  assert.deepEqual(result.reasons.slice(0, 2), ['CYCLE_DRIFT', 'AUTHORITY_DRIFT']);
  assert.equal(result.dispatchAllowed, false);
});
test('live scheduler disagreement and disabled worker prevent parity', () => {
  const x = input(); x.scheduler.workers.W4 = false;
  const result = assessHeartBitShadow(x);
  assert.equal(result.status, 'DRIFT');
  assert.ok(result.reasons.includes('W4_SCHEDULER_DRIFT'));
  assert.ok(result.reasons.includes('W4_SCHEDULER_DISABLED'));
});
test('lease divergence is detected; duplicate worker rows fail closed', () => {
  const x = input(); x.ledger.workers[1] = { ...x.ledger.workers[1], state: 'assigned', taskInstanceId: 'A37' };
  assert.ok(assessHeartBitShadow(x).reasons.includes('W2_LEASE_DRIFT'));
  const y = input(); y.tobit.workers[1].id = 'W1';
  assert.equal(assessHeartBitShadow(y).status, 'INSUFFICIENT_EVIDENCE');
});
