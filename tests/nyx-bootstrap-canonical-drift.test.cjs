const { test } = require('node:test');
const assert = require('node:assert/strict');
require('reflect-metadata');
const { NyxBootstrapService } = require('../dist/nyx/bootstrap.service');

const locator = {
 schema:'nyx.bootstrap.v1',
 cli:{ area:'MAIN',path:'cli.json' },
 paths:{ basic:{ area:'MAIN',path:'paths.md' } },
 canonical:{ head:'head_db_v028.zip',body:'body_db_v024.zip',footer:'footer_db_v080.zip' },
};
const store = { read: async () => JSON.stringify(locator) };

test('bootstrap fails closed on configured canonical pointer drift', async () => {
 const old = process.env.NYX_EXPECTED_CANONICAL_HEAD;
 const oldPath = process.env.NYX_BOOTSTRAP_PATH;
 try {
   process.env.NYX_BOOTSTRAP_PATH = 'bootstrap.json';
   process.env.NYX_EXPECTED_CANONICAL_HEAD = 'head_db_v031.zip';
   await assert.rejects(() => new NyxBootstrapService(store).locate(), /CANONICAL_POINTER_STALE:head/);
   process.env.NYX_EXPECTED_CANONICAL_HEAD = 'head_db_v028.zip';
   const ok = await new NyxBootstrapService(store).locate();
   assert.equal(ok.canonical.head, 'head_db_v028.zip');
 } finally {
   if (old === undefined) delete process.env.NYX_EXPECTED_CANONICAL_HEAD;
   else process.env.NYX_EXPECTED_CANONICAL_HEAD = old;
   if (oldPath === undefined) delete process.env.NYX_BOOTSTRAP_PATH;
   else process.env.NYX_BOOTSTRAP_PATH = oldPath;
 }
});
