const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {NyxWarningQueueService,warningQueueRoot}=require('../dist/nyx/warning-queue.service');

const root='YaRoute/0_repository/3_template/staging/drafts/temp_files/runtime_warnings';
function fakeStore(){
 const data=new Map();const writes=[];
 return {data,writes,async createVerified(ref,text){
   assert.equal(ref.area,'MAIN');
   const existing=data.get(ref.path);
   if(existing!==undefined&&existing!==text)throw Error('immutable conflict');
   data.set(ref.path,text);writes.push(ref.path);
   return {verified:data.get(ref.path)===text};
 }};
}
test('no warnings require no storage configuration or mutation',async()=>{
 const store=fakeStore();const queue=new NyxWarningQueueService(store);
 assert.deepEqual(await queue.persist('owner','ini',[]),{status:'NO_WARNINGS',count:0,verified:true});
 assert.equal(store.writes.length,0);
});
test('observed optional warnings create idempotent immutable daily receipts under Template',async()=>{
 const previous=process.env.NYX_WARNING_QUEUE_ROOT;process.env.NYX_WARNING_QUEUE_ROOT=root;
 try{
  const store=fakeStore(),queue=new NyxWarningQueueService(store);
  const warnings=['OPTIONAL_SOURCE_UNAVAILABLE:Voice.state','KEY_OBSERVE_SOURCE_UNAVAILABLE:temp_paths'];
  const a=await queue.persist('owner-a','ini',warnings,'2026-11-01');
  const b=await queue.persist('owner-a','ini',[...warnings,warnings[0]],'2026-11-01');
  assert.deepEqual(a,{status:'PERSISTED',count:2,verified:true});
  assert.deepEqual(b,a);
  assert.equal(store.data.size,2);
  for(const [name,bytes] of store.data){
   assert.ok(name.startsWith(root+'/2026-11-01/'));
   const record=JSON.parse(bytes);
   assert.equal(record.state,'OPEN');assert.equal(record.severity,'DEFERRED_WARNING');
   assert.equal(record.canonicalAuthorityChanged,false);
   assert.equal('owner' in record,false);
  }
 }finally{if(previous===undefined)delete process.env.NYX_WARNING_QUEUE_ROOT;else process.env.NYX_WARNING_QUEUE_ROOT=previous;}
});
test('unsafe configuration or arbitrary error text cannot be written',async()=>{
 const previous=process.env.NYX_WARNING_QUEUE_ROOT;const store=fakeStore(),queue=new NyxWarningQueueService(store);
 try{
  delete process.env.NYX_WARNING_QUEUE_ROOT;
  assert.equal((await queue.persist('owner','ini',['OPTIONAL_SOURCE_UNAVAILABLE:map'])).status,'NOT_CONFIGURED');
  process.env.NYX_WARNING_QUEUE_ROOT='YaRoute/0_repository/3_template/staging/drafts/temp_files/../secret';
  assert.equal((await queue.persist('owner','ini',['OPTIONAL_SOURCE_UNAVAILABLE:map'])).status,'PERSISTENCE_FAILED');
  assert.throws(()=>warningQueueRoot('../outside'),/WARNING_QUEUE_PATH_INVALID/);
  process.env.NYX_WARNING_QUEUE_ROOT=root;
  assert.equal((await queue.persist('owner','ini',['PRIVATE_TOKEN=literal-secret'])).status,'PERSISTENCE_FAILED');
  assert.equal(store.data.size,0);
 }finally{if(previous===undefined)delete process.env.NYX_WARNING_QUEUE_ROOT;else process.env.NYX_WARNING_QUEUE_ROOT=previous;}
});
test('public tenant mode cannot write through the private MAIN warning queue',async()=>{
 const previousMode=process.env.NYX_DEPLOYMENT_MODE;
 const previousRoot=process.env.NYX_WARNING_QUEUE_ROOT;
 process.env.NYX_DEPLOYMENT_MODE='public';process.env.NYX_WARNING_QUEUE_ROOT=root;
 try{
  const store=fakeStore(),queue=new NyxWarningQueueService(store);
  const result=await queue.persist('oauth:tenant-a','ini',['OPTIONAL_SOURCE_UNAVAILABLE:state']);
  assert.equal(result.status,'NOT_CONFIGURED');assert.equal(store.writes.length,0);
 }finally{
  if(previousMode===undefined)delete process.env.NYX_DEPLOYMENT_MODE;else process.env.NYX_DEPLOYMENT_MODE=previousMode;
  if(previousRoot===undefined)delete process.env.NYX_WARNING_QUEUE_ROOT;else process.env.NYX_WARNING_QUEUE_ROOT=previousRoot;
 }
});
test('provider write/readback failures are reported and never mistaken for persisted warnings',async()=>{
 const previous=process.env.NYX_WARNING_QUEUE_ROOT;process.env.NYX_WARNING_QUEUE_ROOT=root;
 try{
  const queue=new NyxWarningQueueService({createVerified:async()=>{throw Error('provider down');}});
  const out=await queue.persist('owner','ini',['OPTIONAL_SOURCE_UNAVAILABLE:state']);
  assert.equal(out.status,'PERSISTENCE_FAILED');assert.equal(out.verified,false);
 }finally{if(previous===undefined)delete process.env.NYX_WARNING_QUEUE_ROOT;else process.env.NYX_WARNING_QUEUE_ROOT=previous;}
});
test('command executor integrates persistence only after a verified init/FIF',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','src','nyx','command-executor.service.ts'),'utf8');
 const receipt=source.indexOf('const fif = plan.contract.adapter');
 const persist=source.indexOf('await this.warningQueue.persist');
 assert.ok(receipt>=0&&persist>receipt);
 assert.match(source,/plan\.contract\.adapter === 'context\.initialize\.v1'/);
});
