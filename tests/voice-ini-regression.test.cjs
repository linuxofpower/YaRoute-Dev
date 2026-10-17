const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hydrateVoice } = require('../dist/nyx/voice-init');
const { sha256 } = require('../dist/nyx/resource-store.service');

const ref = path => ({ area: 'MAIN', path });
const root = 'areas/Voice';
const manifestPath = root + '/area_paths.json';
const configPath = root + '/0_state/config.json';
const statePath = root + '/0_state/state.json';

function fixture() {
  const routes = {
    'Voice.state': ref(statePath),
    'Voice.config': ref(configPath),
  };
  const files = new Map([
    [manifestPath, JSON.stringify({
      area: 'Voice',
      config: { file: '0_state/config.json' },
      central_mutable_state: { file: '0_state/state.json' },
    })],
    [configPath, JSON.stringify({ area: 'Voice', rules: ['Keep prior source history'] })],
    [statePath, JSON.stringify({ area: 'Voice', status: 'active', message_count: 12 })],
  ]);
  const reads = [];
  const checked = [];
  const store = {
    async read(r) {
      reads.push(r);
      if (!files.has(r.path)) throw new Error('RESOURCE_READ_FAILED');
      return files.get(r.path);
    },
  };
  const outbound = [{
    key: 'paths', ref: ref('paths.md'),
    visible: true, content: '# paths',
    sha256: sha256('# paths'), bytes: 7,
  }];
  const checkScope = (r, key) => checked.push({ ref: r, key });
  return { routes, files, reads, checked, store, outbound, checkScope };
}

test('Voice hydration returns exact manifest/config/state with verifiable bytes and hashes', async () => {
  const f = fixture();
  await hydrateVoice(f.routes, f.outbound, f.store, f.checkScope);
  assert.deepEqual(f.outbound.map(x => x.key), [
    'paths', 'Voice.area_paths', 'Voice.config', 'Voice.state',
  ]);
  assert.deepEqual(f.checked.map(x => x.key), [
    'Voice.area_paths', 'Voice.config', 'Voice.state',
  ]);
  assert.deepEqual(f.reads.map(x => x.path), [manifestPath, configPath, statePath]);
  for (const file of f.outbound.slice(1)) {
    assert.equal(file.visible, true);
    assert.equal(file.bytes, Buffer.byteLength(file.content));
    assert.equal(file.sha256, sha256(file.content));
    assert.equal(file.content, f.files.get(file.ref.path));
  }
});

test('a routed manifest is respected; an absent manifest route is safely inferred from two owner routes', async () => {
  const f = fixture();
  await hydrateVoice(f.routes, f.outbound, f.store, f.checkScope);
  assert.equal(f.outbound[1].ref.path, manifestPath);
  const g = fixture();
  g.routes['Voice.area_paths'] = ref(manifestPath);
  await hydrateVoice(g.routes, g.outbound, g.store, g.checkScope);
  assert.equal(g.outbound[1].ref.path, manifestPath);
});

test('Voice missing any required source fails closed without partially exposing owner data', async () => {
  for (const missing of [manifestPath, configPath, statePath]) {
    const f = fixture();
    f.files.delete(missing);
    const original = structuredClone(f.outbound);
    await assert.rejects(hydrateVoice(f.routes, f.outbound, f.store, f.checkScope),
      /REQUIRED_SOURCE_UNAVAILABLE:Voice/);
    assert.deepEqual(f.outbound, original, 'no partial Voice source delivery on failure');
  }
});

test('Voice malformed or wrong-area JSON is rejected without partial delivery', async () => {
  for (const p of [manifestPath, configPath, statePath]) {
    for (const value of ['{malformed', JSON.stringify({ area: 'Other' })]) {
      const f = fixture();
      f.files.set(p, value);
      await assert.rejects(hydrateVoice(f.routes, f.outbound, f.store, f.checkScope),
        /VOICE_SOURCE_INVALID:Voice/);
      assert.deepEqual(f.outbound.map(x => x.key), ['paths']);
    }
  }
});

test('Voice manifest owner paths may not diverge from routed config/state', async () => {
  for (const role of ['config', 'central_mutable_state']) {
    const f = fixture();
    const manifest = JSON.parse(f.files.get(manifestPath));
    manifest[role].file = '0_state/incorrect.json';
    f.files.set(manifestPath, JSON.stringify(manifest));
    await assert.rejects(hydrateVoice(f.routes, f.outbound, f.store, f.checkScope),
      /VOICE_OWNER_ROUTE_MISMATCH/);
    assert.deepEqual(f.outbound.map(x => x.key), ['paths']);
  }
});

test('Voice refuses mismatched provider, directory and manifest routes', async () => {
  const provider = fixture();
  provider.routes['Voice.config'] = { area: 'OTHER', path: configPath };
  await assert.rejects(hydrateVoice(provider.routes, provider.outbound, provider.store, provider.checkScope),
    /REQUIRED_SOURCE_UNAVAILABLE:Voice.routes/);

  const directory = fixture();
  directory.routes['Voice.state'] = ref(root + '/unsafe/state.json');
  await assert.rejects(hydrateVoice(directory.routes, directory.outbound, directory.store, directory.checkScope),
    /VOICE_OWNER_ROUTE_INVALID/);

  const manifest = fixture();
  manifest.routes['Voice.area_paths'] = ref(root + '/alternate_manifest.json');
  await assert.rejects(hydrateVoice(manifest.routes, manifest.outbound, manifest.store, manifest.checkScope),
    /VOICE_OWNER_ROUTE_INVALID/);
});

test('ambiguous case-insensitive Voice routing fails before reading any source', async () => {
  const f = fixture();
  f.routes['voice.STATE'] = ref(statePath);
  await assert.rejects(hydrateVoice(f.routes, f.outbound, f.store, f.checkScope),
    /AMBIGUOUS_RESOURCE_ROUTE/);
  assert.equal(f.reads.length, 0);
});

test('previously loaded Voice file is made visible without a duplicate packet entry', async () => {
  const f = fixture();
  const content = f.files.get(configPath);
  f.outbound.push({
    key: 'Voice.config', ref: ref(configPath), content,
    visible: false, sha256: sha256(content), bytes: Buffer.byteLength(content),
  });
  await hydrateVoice(f.routes, f.outbound, f.store, f.checkScope);
  assert.equal(f.outbound.filter(x => x.ref.path === configPath).length, 1);
  assert.equal(f.outbound.find(x => x.ref.path === configPath).visible, true);
});

test('the backend must not claim ChatGPT actually rendered files', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const executor = fs.readFileSync(path.join(__dirname, '../src/nyx/command-executor.service.ts'), 'utf8');
  const mcp = fs.readFileSync(path.join(__dirname, '../src/mcp/mcp.service.ts'), 'utf8');
  assert.match(executor, /AWAITING_DELIVERY/);
  assert.match(executor, /verified_by_backend:\s*false/);
  assert.match(executor, /files_to_paste: toPaste\.map/);
  assert.match(mcp, /MUST (?:paste|display)/i);
});
