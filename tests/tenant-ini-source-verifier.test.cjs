const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { verifyTenantIniSources } = require('../dist/nyx/tenant-ini-source-verifier');
const sha = value => createHash('sha256').update(value).digest('hex');
const owner = 'oauth:tenant-one';
const conn = '11111111-1111-4111-8111-111111111111';
const spec = (value='canonical-head') => ({
 key:'head', connectionId:conn, path:'0_head/head_db.json',
 expectedSha256:sha(value),required:true,visible:true,
});
const reader = (value='canonical-head', override={}) => ({
 async readOwned(who,connectionId,path) {
  return {owner:who,connectionId,path,content:value,...override};
 },
});
test('INI source receipts are derived from real owner-scoped byte reads; rendering remains outstanding',async()=>{
 const result=await verifyTenantIniSources(owner,[spec()],reader());
 assert.equal(result.receipts.length,1);
 assert.equal(result.receipts[0].sha256,sha('canonical-head'));
 assert.equal(result.receipts[0].bytes,Buffer.byteLength('canonical-head'));
 assert.equal(result.receipts[0].ownerVerified,true);
 assert.equal(result.receipts[0].visibleRenderVerified,false);
 assert.equal(result.rendered,false);
});
test('missing required source or substituted content never verifies',async()=>{
 await assert.rejects(()=>verifyTenantIniSources(owner,[spec()],{readOwned:async()=>null}),
   /INI_TENANT_REQUIRED_SOURCE_MISSING/);
 await assert.rejects(()=>verifyTenantIniSources(owner,[spec()],reader('changed')),
   /INI_TENANT_SOURCE_HASH_CHANGED/);
});
test('wrong owner, connection or file path is rejected',async()=>{
 for(const override of [{owner:'oauth:other'}, {connectionId:'22222222-2222-4222-8222-222222222222'}, {path:'elsewhere'}]){
  await assert.rejects(()=>verifyTenantIniSources(owner,[spec()],reader('canonical-head',override)),
   /INI_TENANT_READ_OWNER_MISMATCH/);
 }
});
test('invalid owner and source traversal are rejected before any read',async()=>{
 const failReader={readOwned:async()=>{throw Error('READ_SHOULD_NOT_RUN')}};
 await assert.rejects(()=>verifyTenantIniSources('untrusted',[spec()],failReader),/INI_TENANT_OWNER_INVALID/);
 for(const path of ['../head','MAIN:secrets','/absolute','a/../b','a//b']){
  await assert.rejects(()=>verifyTenantIniSources(owner,[{...spec(),path}],failReader),
   /INI_TENANT_SOURCE_SPEC_INVALID/);
 }
});
test('optional absent sources are explicit, duplicate keys fail closed',async()=>{
 const missing=await verifyTenantIniSources(owner,[{...spec(),required:false}],{readOwned:async()=>null});
 assert.deepEqual(missing.missing,['head']);
 assert.equal(missing.receipts.length,0);
 await assert.rejects(()=>verifyTenantIniSources(owner,[spec(),spec()],reader()),
   /INI_TENANT_SOURCE_SPEC_INVALID/);
});
