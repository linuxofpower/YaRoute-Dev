const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
const { cliSchema } = require('../dist/nyx/runtime.schema');
const { NyxCommandResolver } = require('../dist/nyx/command-resolver');
const { NyxCliRegistryService } = require('../dist/nyx/cli-registry.service');
const { NyxResourceResolver } = require('../dist/nyx/resource-resolver.service');
const { NyxCommandExecutor } = require('../dist/nyx/command-executor.service');
const { HandoffStore } = require('../dist/nyx/handoff-store.service');
const { NyxExecutionProfileService } = require('../dist/nyx/execution-profile.service');
const { StorageService } = require('../dist/storage/storage.service');
const { sha256 } = require('../dist/nyx/resource-store.service');

const ref = path => ({ area: 'MAIN', path });
const source = (key, when = 'always') => ({ key, required: true, visible: true, when, perTarget: false });
const contract = () => ({
  adapter: 'context.initialize.v1',
  depth: { default: 'normal', allowed: ['basic', 'normal', 'deep'] },
  scope: { default: 'local', localAreas: ['MAIN'], externalContext: ['chatgpt_library'], globalLabel: 'all_configured_nyx_drives' },
  arguments: { targets: true, maxTargets: 16 },
  sources: {
    basic: [source('maps'), source('nyxcli'), source('todo', 'targeted'), source('todo_10', 'targeted'), source('toget', 'targeted')],
    normal: [source('maps'), source('nyxcli'), source('todo', 'targeted'), source('todo_10', 'targeted'), source('toget', 'targeted')],
    deep: [source('maps'), source('nyxcli'), source('todo', 'targeted'), source('todo_10', 'targeted'), source('toget', 'targeted')],
  },
  pathsVisible: true,
  mutation: 'conversation-artifact',
  handoffsKey: 'handoffs',
  verification: { sourceRead: true, artifactReadback: true },
  response: 'nyx.context.v1',
});
const makeCli = () => cliSchema.parse({ schema: 'nyx.yarocli.v1', version: 'test-v1', commands: { ini: { execution: contract() } } });
const locator = {
  schema: 'nyx.bootstrap.v1',
  cli: ref('authority.json'),
  humanCli: ref('nyxcli.md'),
  paths: { basic: ref('paths.md'), normal: ref('n_paths.json'), deep: ref('d_paths.json') },
  canonical: { head: 'head.zip', body: 'body.zip', footer: 'footer.zip' },
};
const routes = {
  maps: ref('maps.md'),
  todo: ref('todo.md'),
  todo_10: ref('todo_10.md'),
  toget: ref('toget.md'),
  handoffs: ref('Handoffs'),
  'TechLab.area_paths': ref('areas/TechLab/area_paths.json'),
  'NoteFlow.area_paths': ref('areas/NoteFlow/area_paths.json'),
};
const markdown = '# Nyx Paths\n\n| key | area | path |\n| --- | --- | --- |\n' + Object.entries(routes).map(([key, r]) => `| ${key} | ${r.area} | ${r.path} |`).join('\n') + '\n';

class MemoryResources {
  constructor() {
    this.files = new Map(Object.entries({
      'authority.json': JSON.stringify(makeCli()),
      'paths.md': markdown,
      'n_paths.json': JSON.stringify({ schema: 'nyx.filefilter_paths.normal.v1', depth: 'oN' }),
      'd_paths.json': JSON.stringify({ schema: 'nyx.filefilter_paths.deep.v1', depth: 'oD' }),
      'nyxcli.md': '# Nyx CLI\n',
      'maps.md': '# Maps\n',
      'todo.md': '# Todo\n',
      'todo_10.md': '# Todo 10\n',
      'toget.md': '# ToGet\n',
      'areas/TechLab/area_paths.json': JSON.stringify({ area: 'TechLab', central_mutable_state: { file: '0_state/state.json' }, config: { file: '0_state/config.json' } }),
      'areas/TechLab/0_state/state.json': JSON.stringify({ area: 'TechLab', current: 'state' }),
      'areas/TechLab/0_state/config.json': JSON.stringify({ area: 'TechLab', config: true }),
      'areas/NoteFlow/area_paths.json': JSON.stringify({ area: 'NoteFlow', central_mutable_state: { file: '0_state/todo.json' }, configs: { file: '0_state/configs.json' } }),
      'areas/NoteFlow/0_state/todo.json': JSON.stringify({ area: 'NoteFlow', tasks: [] }),
      'areas/NoteFlow/0_state/configs.json': JSON.stringify({ area: 'NoteFlow', rules: [] }),
    }));
    this.writes = []; this.stats = 0;
  }
  async stat(r) { this.stats++; const data = this.files.get(r.path); if (data === undefined) throw new Error('RESOURCE_STAT_FAILED'); return { Size: Buffer.byteLength(data), Hashes: { sha256: sha256(data) } }; }
  async read(r) { if (!this.files.has(r.path)) throw new Error('RESOURCE_READ_FAILED'); return this.files.get(r.path); }
  async optionalRead(r) { return this.files.get(r.path); }
  async optionalList(r) {
    const out = new Map();
    for (const p of this.files.keys()) if (p.startsWith(r.path + '/')) {
      const tail = p.slice(r.path.length + 1), Name = tail.split('/')[0];
      out.set(Name, { Name, IsDir: tail.includes('/') });
    }
    return [...out.values()];
  }
  async createVerified(r, text) {
    const old = this.files.get(r.path);
    if (old !== undefined && old !== text) throw new Error('IMMUTABLE_ARTIFACT_CONFLICT');
    this.files.set(r.path, text); this.writes.push(r.path);
    return { sha256: sha256(text), verified: true };
  }
}
function handoffs(resources) {
  const h = new HandoffStore(resources); const state = new Map(); let tail = Promise.resolve();
  h.locked = (id, action) => {
    const next = tail.then(() => action(state.get(id), async value => { state.set(id, value); }));
    tail = next.catch(() => {}); return next;
  };
  return h;
}
function executor(resources) {
  return new NyxCommandExecutor(
    { locate: async () => locator },
    new NyxCliRegistryService(resources),
    new NyxCommandResolver(),
    new NyxResourceResolver(resources),
    handoffs(resources),
    new NyxExecutionProfileService(resources),
  );
}

test('TechLab init hydrates manifest, mutable state and config without pasting them', async () => {
  const r = new MemoryResources();
  const out = await executor(r).execute({ command: 'ini', args: ['TechLab'], conversationId: 'tech' });
  const keys = out.metadata.source_receipts.map(x => x.key);
  assert.ok(keys.includes('TechLab.area_paths'));
  assert.ok(keys.includes('TechLab.state'));
  assert.ok(keys.includes('TechLab.config'));
  assert.deepEqual(out.files_to_paste.map(x => x.name), ['paths.md', 'maps.md', 'nyxcli.md', 'todo.md', 'todo_10.md', 'toget.md']);
  assert.equal(out.files_to_paste.some(x => /area_paths|state|config/i.test(x.name)), false);
});

test('NoteFlow init follows manifest owner pointers and keeps mutable JSON hidden', async () => {
  const r = new MemoryResources();
  const out = await executor(r).execute({ command: 'ini', args: ['NoteFlow'], conversationId: 'note' });
  const byKey = Object.fromEntries(out.metadata.source_receipts.map(x => [x.key, x]));
  assert.equal(byKey['NoteFlow.area_paths'].visible, false);
  assert.equal(byKey['NoteFlow.state'].ref.path, 'areas/NoteFlow/0_state/todo.json');
  assert.equal(byKey['NoteFlow.config'].ref.path, 'areas/NoteFlow/0_state/configs.json');
});

test('same-area copy can establish owner trust from verified source owner when destination owner is not configured', async () => {
  const roots = {
    get: () => ({ remote: 'fixture', root: '.', provider: 'google-drive' }),
    resolve: (_area, p) => 'fixture:' + p,
    cleanRelativePath: p => p,
    listAreas: () => ['MAIN'],
  };
  const source = {
    Size: 4,
    Hashes: { md5: 'abcd' },
    Metadata: { owner: 'fixture-owner' },
  };
  const destination = {
    Size: 4,
    Hashes: { md5: 'abcd' },
    Metadata: { owner: 'fixture-owner' },
  };
  const rclone = {
    run: async () => ({ stdout: '', stderr: '' }),
    json: async args => String(args[1]).includes('dst.txt') ? destination : source,
  };
  const storage = new StorageService(roots, rclone);
  const out = await storage.executeCopy({
    source: { area: 'MAIN', path: 'src.txt' },
    destination: { area: 'MAIN', path: 'dst.txt' },
    verify: true,
  });
  assert.equal(out.verification.trusted, true);
  assert.equal(out.verification.ownerSource, 'same-area-source-owner');
});


function easyWayFixture(resources, options = {}) {
  const { manifest = true, config = true, state = true, status = 'active' } = options;
  const prefix = 'areas/EasyWay';
  resources.files.set('paths.md', resources.files.get('paths.md') +
    '| EasyWay.area_paths | MAIN | ' + prefix + '/area_paths.json |\\n');
  if (manifest) resources.files.set(prefix + '/area_paths.json', JSON.stringify({
    area: 'EasyWay',
    central_mutable_state: { file: '0_state/state.json' },
    config: { file: '0_state/config.json' },
  }));
  if (config) resources.files.set(prefix + '/0_state/config.json',
    JSON.stringify({ area: 'EasyWay', rules: [] }));
  if (state) resources.files.set(prefix + '/0_state/state.json',
    JSON.stringify({ area: 'EasyWay', status, revision: 1 }));
}

test('EasyWay global Normal cannot silently complete without an Area owner route', async () => {
  const r = new MemoryResources();
  await assert.rejects(
    () => executor(r).execute({ command: 'ini', args: ['EasyWay', 'oGN'], conversationId: 'missing-easyway-route' }),
    /REQUIRED_TARGET_ROUTE_MISSING:EasyWay.area_paths/,
  );
  assert.deepEqual(r.writes, []);
});

test('EasyWay missing manifest or required config/state blocks before FIF creation', async () => {
  for (const [options, expected] of [
    [{ manifest: false }, /REQUIRED_SOURCE_UNAVAILABLE:EasyWay.area_paths/],
    [{ config: false }, /REQUIRED_SOURCE_UNAVAILABLE:EasyWay.config/],
    [{ state: false }, /REQUIRED_SOURCE_UNAVAILABLE:EasyWay.state/],
  ]) {
    const r = new MemoryResources();
    easyWayFixture(r, options);
    await assert.rejects(
      () => executor(r).execute({ command: 'ini', args: ['EasyWay', 'oGN'], conversationId: 'unavailable-owner' }),
      expected,
    );
    assert.deepEqual(r.writes, []);
  }
});

test('EasyWay inactive state and wrong owner fail closed', async () => {
  const inactive = new MemoryResources();
  easyWayFixture(inactive, { status: 'inactive' });
  await assert.rejects(
    () => executor(inactive).execute({ command: 'ini', args: ['EasyWay', 'oGN'], conversationId: 'inactive' }),
    /AREA_STATE_NOT_ACTIVE:EasyWay/,
  );
  assert.deepEqual(inactive.writes, []);
  const mismatch = new MemoryResources();
  easyWayFixture(mismatch);
  mismatch.files.set('areas/EasyWay/area_paths.json', JSON.stringify({
    area: 'OtherArea',
    central_mutable_state: { file: '0_state/state.json' },
    config: { file: '0_state/config.json' },
  }));
  await assert.rejects(
    () => executor(mismatch).execute({ command: 'ini', args: ['EasyWay', 'oGN'], conversationId: 'wrong-owner' }),
    /AREA_MANIFEST_OWNER_MISMATCH:EasyWay/,
  );
  assert.deepEqual(mismatch.writes, []);
});

test('EasyWay valid manifest, active state and config produce exact hidden source receipts', async () => {
  const r = new MemoryResources();
  easyWayFixture(r);
  const out = await executor(r).execute({ command: 'ini', args: ['EasyWay', 'oGN'], conversationId: 'ready-owner' });
  const sourceKeys = new Set(out.metadata.source_receipts.map(item => item.key));
  for (const key of ['EasyWay.area_paths', 'EasyWay.config', 'EasyWay.state']) {
    assert.equal(sourceKeys.has(key), true, key);
  }
  assert.equal(out.metadata.scope, 'global');
  assert.equal(out.metadata.depth, 'normal');
  assert.equal(out.fif.verified, true);
  assert.equal(out.files_to_paste.some(f => /area_paths|state|config/.test(f.name)), false);
});
