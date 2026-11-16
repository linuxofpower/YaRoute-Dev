const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {TenantRcloneService}=require('../dist/connectors/tenant-rclone.service');
const {MegaPermanentDeleteController}=require('../dist/connectors/mega-permanent-delete.controller');
const source=fs.readFileSync(path.join(__dirname,'..','src','connectors','tenant-rclone.service.ts'),'utf8');
const owner='oauth:google-oauth2|test_owner',id='11111111-2222-4333-8444-555555555555';
const filename='NYX_DEV_PERMANENT_TEST_20261116_A1b2c3d4.txt';
const other='private_archive.zip';
function cfg(t,enabled=true){
 const keys=['NYX_DEPLOYMENT_MODE','NYX_PUBLIC_MEGA_WRITE_ENABLED',
   'NYX_PUBLIC_MEGA_PERMANENT_DELETE_ENABLED','NYX_PUBLIC_URL'];
 const saved=Object.fromEntries(keys.map(x=>[x,process.env[x]]));
 t.after(()=>{for(const[k,v]of Object.entries(saved)){
   if(v===undefined)delete process.env[k];else process.env[k]=v;
 }});
 Object.assign(process.env,{
   NYX_DEPLOYMENT_MODE:'public',NYX_PUBLIC_MEGA_WRITE_ENABLED:'true',
   NYX_PUBLIC_MEGA_PERMANENT_DELETE_ENABLED:enabled?'true':'false',
   NYX_PUBLIC_URL:'https://dev.example.invalid',
 });
}
function fixture(){
 const operations=[],deleted=new Set();
 const file={id:'IMMUTABLE-NODE-1234',size:27,modTime:'2026-11-16T10:00:00Z'};
 const db=new Map();let read=0;
 const connection={registryPolicy:()=>({requireResource:async(o,c,scope,resource)=>{
   if(o!==owner||c!==id||scope!=='storage:delete'||resource.id!=='MEGA_ROOT')
     throw Error('FORBIDDEN');
 }})};
 const svc=new TenantRcloneService(connection);
 svc.encryptionKey=Buffer.alloc(32,9);
 svc.authorizedTarget=async(o,c,provider,root,source)=>{
   if(o!==owner||c!==id||provider!=='mega'||root!=='MEGA_ROOT')
     throw Error('FORBIDDEN');
   return {profile:{provider:'mega',user:['test','example.invalid'].join('@'),
     obscuredPassword:'synthetic'},path:source};
 };
 svc.hardDeleteProbe=async(_profile,source,operation)=>{
   operations.push([source,operation]);
   if(source!==filename)throw Error('MUST_NOT_TOUCH_UNRELATED_FILE');
   if(operation==='hard-delete'){deleted.add(source);return null;}
   read++;
   return deleted.has(source)?null:file;
 };
 const client={query:async(sql,args=[])=>{
   if(sql.includes('INSERT INTO nyx_mega_hard_delete_receipts_v1'))return {rowCount:1,rows:[]};
   if(sql.includes('UPDATE nyx_mega_hard_delete_receipts_v1'))return {rowCount:1,rows:[]};
   return {rowCount:1,rows:[]};
 },release(){}};
 svc.pool={
   connect:async()=>client,
   query:async(sql,args=[])=>{
     if(sql.includes('DELETE FROM nyx_mega_hard_delete_challenges_v1') &&
        !sql.includes('RETURNING')){
       db.clear();return {rowCount:0,rows:[]};}
     if(sql.includes('INSERT INTO nyx_mega_hard_delete_challenges_v1')){
       db.set(args[0],{owner_id:args[1],connection_id:args[2],root_id:args[3],
         source_path:args[4],expected_file_id:args[5],expected_size:args[6],
         expected_mtime:args[7]});
       return {rowCount:1,rows:[]};
     }
     const item=db.get(args[0]);
     if(sql.includes('SELECT source_path,expected_size'))
       return item?{rowCount:1,rows:[item]}:{rowCount:0,rows:[]};
     if(sql.includes('DELETE FROM nyx_mega_hard_delete_challenges_v1') &&
        sql.includes('RETURNING')){
       db.delete(args[0]);return item?{rowCount:1,rows:[item]}:{rowCount:0,rows:[]};}
     throw Error('UNEXPECTED_QUERY');
   },
 };
 return {svc,operations,deleted,db,file};
}
test('irreversible pilot remains independently disabled by default',async t=>{
 cfg(t,false);const {svc,operations}=fixture();
 await assert.rejects(
  svc.beginMegaHardDeletePilot(owner,id,'MEGA_ROOT',filename),/HARD_DELETE_DISABLED/);
 assert.deepEqual(operations,[]);
});
test('pilot strictly denies existing documents, folders, remote switches and trash bins',async t=>{
 cfg(t);const {svc,operations}=fixture();
 for(const bad of [other,'FullCamera/photo.jpg','../outside.txt',
  'NYX_DEV_PERMANENT_TEST_bad.txt','NYX_DEV_PERMANENT_TEST_abcdefgh.txt/file',
  'MEGA_ROOT:NYX_DEV_PERMANENT_TEST_abcdefgh.txt']) {
   await assert.rejects(
    svc.beginMegaHardDeletePilot(owner,id,'MEGA_ROOT',bad),/PILOT_ONLY|PATH_INVALID/);
 }
 await assert.rejects(
  svc.beginMegaHardDeletePilot(owner,id,'MEGA_TRASH',filename),/ROOT_DENIED/);
 assert.deepEqual(operations,[]);
});
test('one-use browser consent permanently removes exact disposable file only',async t=>{
 cfg(t);const {svc,operations,deleted}=fixture();
 const prepared=await svc.beginMegaHardDeletePilot(owner,id,'MEGA_ROOT',filename);
 assert.equal(prepared.status,'approval_required');
 assert.equal(prepared.permanent,true);
 assert.equal(operations.length,1);
 assert.equal(deleted.size,0);
 const state=new URL(prepared.url).searchParams.get('state');
 const preview=await svc.megaHardDeletePilotPreview(state);
 assert.equal(preview.filePath,filename);
 await assert.rejects(
  svc.confirmMegaHardDeletePilot(state,'DELETE '+filename),/APPROVAL_INVALID/);
 assert.equal(deleted.size,0);
 const confirmed=await svc.confirmMegaHardDeletePilot(state,'PERMANENT DELETE '+filename);
 assert.equal(confirmed.status,'verified');
 assert.equal(confirmed.restorable,false);
 assert.deepEqual([...deleted],[filename]);
 assert.equal(operations.filter(x=>x[1]==='hard-delete').length,1);
 await assert.rejects(
  svc.confirmMegaHardDeletePilot(state,'PERMANENT DELETE '+filename),/APPROVAL_INVALID/);
 assert.equal(operations.filter(x=>x[1]==='hard-delete').length,1);
});
test('stale metadata consumes approval but never executes irreversible operation',async t=>{
 cfg(t);const {svc,operations,deleted,file}=fixture();
 const prepared=await svc.beginMegaHardDeletePilot(owner,id,'MEGA_ROOT',filename);
 const state=new URL(prepared.url).searchParams.get('state');
 file.id='CHANGED-NODE';
 await assert.rejects(
  svc.confirmMegaHardDeletePilot(state,'PERMANENT DELETE '+filename),/SOURCE_CHANGED/);
 assert.equal(deleted.size,0);
 assert.ok(!operations.some(x=>x[1]==='hard-delete'));
});
test('controller is one-file approval only; no broad cleanup, no credentials',async()=>{
 const controller=new MegaPermanentDeleteController({
  megaHardDeletePilotPreview:async()=>({filePath:filename,fileSize:27}),
  confirmMegaHardDeletePilot:async()=>({status:'verified',sourcePath:filename,receiptId:'fixture-receipt'}),
 });
 const response=()=>({headers:{},statusCode:200,setHeader(k,v){this.headers[k]=v;return this;},
  status(code){this.statusCode=code;return this;},
  type(){return this;},send(html){this.html=html;return this;}});
 const get=response();await controller.preview('safe-state',get);
 assert.equal(get.statusCode,200);
 assert.match(get.html,/NOT TRASH/);
 assert.match(get.html,/PERMANENT DELETE/);
 assert.equal(get.headers['Cache-Control'],'no-store');
 const post=response();await controller.confirm({
  state:'safe-state',confirmation:'PERMANENT DELETE '+filename},post);
 assert.equal(post.statusCode,200);
 assert.match(post.html,/cannot be undone/);
 assert.match(source,/--mega-hard-delete=true/);
 assert.doesNotMatch(source,/run\(\[['\"](?:purge|cleanup)['\"]/);
 assert.match(source,/NYX_DEV_PERMANENT_TEST_/);
});
