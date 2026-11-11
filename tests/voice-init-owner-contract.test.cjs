const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { hydrateVoice } = require('../dist/nyx/voice-init');

const root = 'areas/Voice';
const ref = path => ({ area: 'MAIN', path });
const routes = () => ({
  'Voice.state': ref(root + '/0_state/state.json'),
  'Voice.config': ref(root + '/0_state/config.json'),
});
const validManifest = () => ({
  schema: 'yaro_area_paths_manifest',
  area: 'Voice',
  central_mutable_state: { file: '0_state/state.json' },
  config: { file: '0_state/config.json' },
});
function fixture() {
  const data = new Map([
    [root + '/area_paths.json', JSON.stringify(validManifest())],
    [root + '/0_state/config.json', JSON.stringify({ area: 'Voice', rules: ['remember sum'] })],
    [root + '/0_state/state.json', JSON.stringify({ area: 'Voice', status: 'active' })],
  ]);
  const store = {
    reads: [],
    async read(r) {
      this.reads.push(r.path);
      if (!data.has(r.path)) throw new Error('RESOURCE_NOT_FOUND');
      return data.get(r.path);
    },
  };
  return { data, store, files: [], routes: routes(), scopeChecks: [] };
}
async function run(f) {
  return hydrateVoice(f.routes, f.files, f.store, (ref, key) => f.scopeChecks.push([key, ref.path]));
}

test('Voice init includes three verified visible owner sources in deterministic order', async () => {
  const f = fixture();
  await run(f);
  assert.deepEqual(f.files.map(file => file.key), ['Voice.area_paths', 'Voice.config', 'Voice.state']);
  assert.deepEqual(f.files.map(file => file.visible), [true, true, true]);
  assert.deepEqual(f.files.map(file => file.ref.path), [
    root + '/area_paths.json', root + '/0_state/config.json', root + '/0_state/state.json',
  ]);
  assert.deepEqual(f.store.reads, f.files.map(file => file.ref.path));
  assert.deepEqual(f.scopeChecks.map(([key]) => key), f.files.map(file => file.key));
  for (const file of f.files) {
    assert.equal(file.content, f.data.get(file.ref.path));
    assert.equal(file.bytes, Buffer.byteLength(file.content));
    assert.equal(file.sha256, createHash('sha256').update(file.content).digest('hex'));
  }
});

test('missing Voice route pair or mismatched drive scope fails before storage reads', async () => {
  for (const broken of [
    { 'Voice.state': routes()['Voice.state'] },
    { 'Voice.config': routes()['Voice.config'] },
    { 'Voice.state': routes()['Voice.state'], 'Voice.config': { area: 'OTHER', path: root + '/0_state/config.json' } },
  ]) {
    const f = fixture();
    f.routes = broken;
    await assert.rejects(() => run(f), /REQUIRED_SOURCE_UNAVAILABLE:Voice.routes/);
    assert.deepEqual(f.store.reads, []);
    assert.deepEqual(f.files, []);
  }
});

test('untrusted route layout and manifest mismatch fail closed', async () => {
  for (const broken of [
    { 'Voice.state': ref(root + '/state.json'), 'Voice.config': routes()['Voice.config'] },
    { ...routes(), 'Voice.area_paths': ref('areas/Other/area_paths.json') },
  ]) {
    const f = fixture();
    f.routes = broken;
    await assert.rejects(() => run(f), /VOICE_OWNER_ROUTE_INVALID/);
    assert.deepEqual(f.files, []);
  }
  const f = fixture();
  f.data.set(root + '/area_paths.json', JSON.stringify({
    ...validManifest(), central_mutable_state: { file: '0_state/other.json' },
  }));
  await assert.rejects(() => run(f), /VOICE_OWNER_ROUTE_MISMATCH/);
  assert.deepEqual(f.files, []);
});

test('required Voice file missing, malformed or owned by a different Area fails closed', async () => {
  for (const key of [
    root + '/area_paths.json',
    root + '/0_state/config.json',
    root + '/0_state/state.json',
  ]) {
    for (const corruption of ['missing', 'invalid_json', 'wrong_owner']) {
      const f = fixture();
      if (corruption === 'missing') f.data.delete(key);
      if (corruption === 'invalid_json') f.data.set(key, '{ bad json');
      if (corruption === 'wrong_owner') f.data.set(key, JSON.stringify({ area: 'TechLab' }));
      await assert.rejects(() => run(f), /REQUIRED_SOURCE_UNAVAILABLE:Voice|VOICE_SOURCE_INVALID:Voice|VOICE_OWNER_ROUTE_MISMATCH/);
      assert.deepEqual(f.files, [], 'no partial Voice packet after failed hydration');
    }
  }
});

test('ambiguous Voice alias fails closed', async () => {
  const f = fixture();
  f.routes['voice.STATE'] = ref(root + '/0_state/state.json');
  await assert.rejects(() => run(f), /AMBIGUOUS_RESOURCE_ROUTE/);
  assert.deepEqual(f.store.reads, []);
});

test('re-hydration marks an existing exact source visible without duplicating it', async () => {
  const f = fixture();
  await run(f);
  f.files[1].visible = false; // Existing hidden copy becomes display-mandatory for Voice.
  await run(f);
  assert.equal(f.files.length, 3);
  assert.equal(f.files[1].visible, true);
  assert.deepEqual(f.files.map(file => file.key), ['Voice.area_paths', 'Voice.config', 'Voice.state']);
});

test('scope gate rejection prevents all resource reads and FIF creation', async () => {
  const f = fixture();
  await assert.rejects(
    () => hydrateVoice(f.routes, f.files, f.store, () => { throw new Error('LOCAL_SCOPE_RESOURCE_FORBIDDEN'); }),
    /LOCAL_SCOPE_RESOURCE_FORBIDDEN/,
  );
  assert.deepEqual(f.store.reads, []);
  assert.deepEqual(f.files, []);
});
