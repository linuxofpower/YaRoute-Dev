const { test } = require('node:test');
const assert = require('node:assert/strict');
const { headStatusReport } = require('../dist/nyx/head-status-report');

const locator = { canonical: { head: 'head-fixture', body: 'body-fixture', footer: 'footer-fixture' } };
const bootstrap = { locate: async () => locator };
const registry = { current: async () => ({ cli: { version: 'fixture-v1' }, hash: 'a'.repeat(64) }) };
const library = { snapshot: () => ({ source: 'fixture' }) };

test('read-only head status reports unavailable bootstrap without false READY or secret leakage', async () => {
  const status = await headStatusReport(
    { locate: async () => { throw new Error('rclone error: credential=PRIVATE_TOKEN'); } },
    { current: async () => { throw new Error('must not read CLI'); } },
    async () => { throw new Error('must not inspect'); }, library,
  );
  assert.equal(status.status, 'NOT_READY');
  assert.equal(status.bootstrapPointerAndCliVerified, false);
  assert.equal(status.blockedScope, 'canonical_nyx_commands');
  assert.equal(status.diagnostic, 'BOOTSTRAP_INVALID_OR_UNAVAILABLE');
  assert.deepEqual(status.allowedIndependentWork, ['read_only_connector_diagnostics']);
  assert.doesNotMatch(JSON.stringify(status), /PRIVATE_TOKEN|fixture-v1/);
});

test('invalid canonical CLI still blocks command readiness', async () => {
  const status = await headStatusReport(bootstrap,
    { current: async () => { throw new Error('secret=PRIVATE_TOKEN'); } },
    async () => ({ ready: true, keys: [] }), library);
  assert.equal(status.status, 'NOT_READY');
  assert.equal(status.diagnostic, 'CANONICAL_CLI_INVALID_OR_UNAVAILABLE');
  assert.equal(status.bootstrapPointerAndCliVerified, false);
  assert.doesNotMatch(JSON.stringify(status), /PRIVATE_TOKEN/);
});

test('mutable observed draft drift remains warning while validated CLI stays available', async () => {
  const preflight = { ready: true, configured: true, driftDetected: true, keys: [
    { key: 'temp_paths', mode: 'observe', status: 'changed' },
    { key: 'temp_nyxcli', mode: 'observe', status: 'unavailable' },
  ] };
  const status = await headStatusReport(bootstrap, registry, async () => preflight, library);
  assert.equal(status.status, 'BOOTSTRAP_VERIFIED_WITH_WARNINGS');
  assert.deepEqual(status.issues.map(issue => issue.severity), ['DEFERRED_WARNING', 'DEFERRED_WARNING']);
  assert.equal(status.bootstrapPointerAndCliVerified, true);
  assert.equal('blockedScope' in status, false);
});

test('enforced pin drift and unexpected profile errors do not become READY', async () => {
  const enforced = await headStatusReport(bootstrap, registry,
    async () => ({ ready: false, configured: true, driftDetected: true, keys: [
      { key: 'active_key', mode: 'enforce', status: 'changed' },
    ] }), library);
  assert.equal(enforced.status, 'NOT_READY');
  assert.equal(enforced.issues[0].severity, 'HARD_BLOCK');
  assert.equal(enforced.blockedScope, 'canonical_nyx_commands');

  const unexpected = await headStatusReport(bootstrap, registry,
    async () => { throw Error('PRIVATE_TOKEN'); }, library);
  assert.equal(unexpected.status, 'NOT_READY');
  assert.equal(unexpected.preflight.error, 'EXECUTION_PROFILE_INVALID_OR_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(unexpected), /PRIVATE_TOKEN/);
});
