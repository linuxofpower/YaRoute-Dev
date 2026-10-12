const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {TenantRcloneService}=require('../dist/storage/tenant-rclone.service');
const {RcloneService}=require('../dist/storage/rclone.service');
const {SharedRootsService}=require('../dist/storage/shared-roots.service');

function row(owner,id,name,credential=null) {
 return {owner_id:owner,id,display_name:name,provider:'drive',
   provider_identity:null,encrypted_credential:credential,status:credential?'connected':'pending',
   is_main:false,read_verified_at:null,write_verified_at:null};
}
function fixture(rows=[]) {
 const service=new TenantRcloneService();
 service.key=Buffer.alloc(32,7);
 const queries=[];
 service.pool={query:async(sql,values=[])=>{
  queries.push({sql,values});
  if(sql.includes('SELECT * FROM nyx_tenant_rclone WHERE id=$1 AND owner_id=$2')){
   const match=rows.find(x=>x.id===values[0]&&x.owner_id===values[1]);
   return {rowCount:match?1:0,rows:match?[match]:[]};
  }
  if(sql.includes('SELECT * FROM nyx_tenant_rclone')){
   return {rows:rows.filter(x=>x.owner_id===values[0])};
  }
  return {rowCount:1,rows:[]};
 }};
 return {service,queries};
}
const idA='e18c590d-adc4-4d2b-818d-02fc016c1220';
const idB='affea724-b9db-4cb9-a337-5cb55531da80';
test('dynamic remotes are isolated by the authenticated NestNyx subject',async()=>{
 const {service}=fixture([row('oauth:alice',idA,'Drive 1'),row('oauth:alice',idB,'Drive 2'),row('oauth:bob','414ef60e-6ad9-48eb-8c3f-2bdd8ab70211','Drive 1')]);
 const alice=await service.list('oauth:alice');
 const bob=await service.list('oauth:bob');
 assert.equal(alice.length,2);assert.equal(bob.length,1);
 assert.ok(alice.every(x=>!('encrypted_credential' in x)&&!('owner_id' in x)));
 await assert.rejects(()=>service.rename('oauth:bob',idA,'Stolen'),/STORAGE_CONNECTION_NOT_FOUND/);
 await assert.rejects(()=>service.disconnect('oauth:bob',idB),/STORAGE_CONNECTION_NOT_FOUND/);
 await assert.rejects(()=>service.list('alice'),/AUTHENTICATED_OWNER_REQUIRED/);
 await assert.rejects(()=>service.probe('oauth:bob',idA,'read'),/STORAGE_CONNECTION_NOT_FOUND/);
});
test('credential encryption binds token to owner, connection and provider',()=>{
 const {service}=fixture();
 const packed=service.encrypt('oauth:alice',idA,'drive',{access_token:'private',refresh_token:'secret'});
 assert.ok(!packed.includes('private'));
 assert.equal(service.decrypt('oauth:alice',idA,'drive',packed).access_token,'private');
 for(const [owner,id,provider] of [
  ['oauth:bob',idA,'drive'],['oauth:alice',idB,'drive'],['oauth:alice',idA,'mega']
 ]) assert.throws(()=>service.decrypt(owner,id,provider,packed));
});
test('MAIN needs connected Google Drive with verified write',async()=>{
 const a=row('oauth:alice',idA,'Drive A');
 const {service}=fixture([a]);
 await assert.rejects(()=>service.setMain('oauth:alice',idA),/MAIN_REQUIRES_VERIFIED_WRITABLE_DRIVE/);
 a.status='connected';a.write_verified_at=new Date();a.provider='mega';
 await assert.rejects(()=>service.setMain('oauth:alice',idA),/MAIN_REQUIRES_VERIFIED_WRITABLE_DRIVE/);
});
test('tenant feature is disabled by default and cannot start in private operator mode',async()=>{
 const old=Object.fromEntries(['NYX_TENANT_STORAGE_ENABLED','NYX_DEPLOYMENT_MODE'].map(x=>[x,process.env[x]]));
 try{
  delete process.env.NYX_TENANT_STORAGE_ENABLED;
  const s=new TenantRcloneService();await s.onModuleInit();
  await assert.rejects(()=>s.list('oauth:alice'),/TENANT_STORAGE_NOT_ENABLED/);
  process.env.NYX_TENANT_STORAGE_ENABLED='true';
  process.env.NYX_DEPLOYMENT_MODE='private';
  await assert.rejects(()=>s.onModuleInit(),/TENANT_STORAGE_REQUIRES_PUBLIC_CONNECTOR_MODE/);
 }finally{for(const [k,v] of Object.entries(old))v===undefined?delete process.env[k]:process.env[k]=v;}
});
test('public mode never reads the operator process-global rclone configuration',async()=>{
 const old=Object.fromEntries(['NYX_DEPLOYMENT_MODE','RCLONE_CONFIG_PATH','NYX_SHARED_ROOTS_JSON'].map(x=>[x,process.env[x]]));
 try{
  process.env.NYX_DEPLOYMENT_MODE='public';
  process.env.RCLONE_CONFIG_PATH='/path/which/does/not/exist';
  delete process.env.NYX_SHARED_ROOTS_JSON;
  new RcloneService().onModuleInit();
  await assert.rejects(()=>new RcloneService().listRemoteNamesByType('drive'),/PRIVATE_RCLONE_CONNECTIONS_ONLY/);
  assert.deepEqual(new SharedRootsService().listAreas(),[]);
 }finally{for(const [k,v] of Object.entries(old))v===undefined?delete process.env[k]:process.env[k]=v;}
});
test('per-job Rclone config includes only selected tenant credentials, and is removed',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nyx-tenant-test-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const binary=path.join(dir,'fake-rclone.sh');
 fs.writeFileSync(binary,'#!/bin/sh\nif [ "$1" != "--config" ]; then exit 13; fi\ncat "$2" > "'+path.join(dir,'captured.txt')+'"\nexit 0\n',{mode:0o700});
 const original=Object.fromEntries(['RCLONE_BINARY','NYX_GOOGLE_CLIENT_ID','NYX_GOOGLE_CLIENT_SECRET'].map(x=>[x,process.env[x]]));
 process.env.RCLONE_BINARY=binary;
 process.env.NYX_GOOGLE_CLIENT_ID='test-client';
 process.env.NYX_GOOGLE_CLIENT_SECRET='test-secret';
 try {
  const {service}=fixture();
  const cred=service.encrypt('oauth:alice',idA,'drive',{access_token:'only-alice',
    refresh_token:'refresh-alice',token_type:'Bearer',expiry:new Date(Date.now()+3600000).toISOString()});
  const a=row('oauth:alice',idA,'Drive A',cred);
  const {service:tester}=fixture([a]);
  const result=await tester.probe('oauth:alice',idA,'read');
  assert.equal(result.verified,true);
  const config=fs.readFileSync(path.join(dir,'captured.txt'),'utf8');
  assert.match(config,/only-alice/);
  assert.doesNotMatch(config,/bob|operator-remotes|\[private\]/);
  assert.equal((config.match(/\[tenant\]/g)||[]).length,1);
 }finally{for(const [k,v] of Object.entries(original))v===undefined?delete process.env[k]:process.env[k]=v;}
});
