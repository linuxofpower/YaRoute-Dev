const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.resolve(__dirname, '../dist/heartbit/shadow-once.js');
const ids = ['W1', 'W2', 'W3', 'W4'];
const snapshot = (now) => ({
  observedAtUtc: now, verifiedCycle: 99,
  authority: { head: 'H32', body: 'B28', footer: 'F102' },
  workModeAllowed: false,
  workers: ids.map(id => ({ id, state: 'available', taskInstanceId: null, schedulerEnabled: true })),
});
const observations = () => {
  const now = new Date().toISOString();
  return {
    nowUtc: '2020-01-01T00:00:00Z', // Must be ignored by the runner.
    tobit: snapshot(now), ledger: snapshot(now),
    scheduler: { observedAtUtc: now, coordinatorEnabled: true,
      workers: Object.fromEntries(ids.map(id => [id, true])) },
  };
};
function run(args) {
  const p = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 5000 });
  if (p.error) throw p.error;
  return { code: p.status, output: JSON.parse(p.stdout.trim()), stderr: p.stderr };
}
function withFile(t, value) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nyx-heartbit-shadow-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const p = path.join(dir, 'evidence.json');
  fs.writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
  return p;
}
test('self-check is immediate and never claims real runtime health', () => {
  const result = run(['--self-check']);
  assert.equal(result.code, 0);
  assert.equal(result.output.status, 'SELF_CHECK_ONLY');
  assert.equal(result.output.mode, 'SHADOW_ONLY');
  assert.equal(result.output.execution, 'ON_DEMAND');
  assert.equal(result.output.workModeAllowed, false);
  assert.equal(result.output.dispatchAllowed, false);
});
test('fresh independent evidence can MATCH but cannot dispatch or choose Work', t => {
  const result = run(['--input', withFile(t, observations())]);
  assert.equal(result.code, 0);
  assert.equal(result.output.status, 'MATCH');
  assert.equal(result.output.verifiedCycle, 99);
  assert.equal(result.output.dispatchAllowed, false);
  assert.equal(result.output.workModeAllowed, false);
});
test('disabled scheduler is drift with exit status 2', t => {
  const o = observations();
  o.scheduler.workers.W4 = false;
  const result = run(['--input', withFile(t, o)]);
  assert.equal(result.code, 2);
  assert.equal(result.output.status, 'DRIFT');
  assert.ok(result.output.reasons.includes('W4_SCHEDULER_DISABLED'));
});
test('stale observations fail closed; timestamp inside evidence cannot bypass age check', t => {
  const o = observations();
  o.tobit.observedAtUtc = '2020-01-01T00:00:00Z';
  o.nowUtc = '2020-01-01T00:00:00Z';
  const result = run(['--input', withFile(t, o)]);
  assert.equal(result.code, 3);
  assert.equal(result.output.status, 'INSUFFICIENT_EVIDENCE');
});
test('missing evidence, malformed JSON, oversized file and invalid invocation stop safely', t => {
  for (const args of [[], ['--input'], ['--bogus']]) {
    const result = run(args);
    assert.equal(result.code, 64);
  }
  const missing = run(['--input', path.join(os.tmpdir(), 'missing-nyx-heartbit-xyz.json')]);
  assert.equal(missing.code, 3);
  const bad = run(['--input', withFile(t, '{secret:abc')]);
  assert.equal(bad.code, 3);
  assert.doesNotMatch(JSON.stringify(bad), /secret:abc/);
  const huge = run(['--input', withFile(t, 'x'.repeat(65 * 1024))]);
  assert.equal(huge.code, 3);
});
test('Work-mode permission is never accepted as sufficient evidence', t => {
  const o = observations();
  o.ledger.workModeAllowed = true;
  const result = run(['--input', withFile(t, o)]);
  assert.equal(result.code, 3);
  assert.equal(result.output.workModeAllowed, false);
  assert.equal(result.output.dispatchAllowed, false);
});
