const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {assertPublicRcloneIsolation,LEGACY_RCLONE_ENV_KEYS}=
  require('../dist/storage/public-rclone-isolation');
const {RcloneService}=require('../dist/storage/rclone.service');

test('public runtime rejects every legacy private Rclone environment variable',()=>{
 for(const key of LEGACY_RCLONE_ENV_KEYS){
  const env={[key]:'test-only-placeholder'};
  assert.throws(()=>assertPublicRcloneIsolation(env,()=>false),
    /PUBLIC_STORAGE_PRIVATE_CONFIG_PRESENT/);
 }
});
test('public runtime rejects Rclone remote secrets supplied as environment options',()=>{
 for(const key of ['RCLONE_CONFIG_MYMEGA_PASS','RCLONE_CONFIG_DRIVE_TOKEN',
                    'RCLONE_CONFIG_MYDRIVE_CLIENT_SECRET']){
  assert.throws(()=>assertPublicRcloneIsolation({[key]:'synthetic'},()=>false),
    /PUBLIC_STORAGE_PRIVATE_CONFIG_PRESENT/);
 }
});

test('public runtime rejects old private default config file without opening it',()=>{
 const checked=[];
 assert.throws(()=>assertPublicRcloneIsolation({},p=>{
  checked.push(p);return true;
 }),/PUBLIC_STORAGE_PRIVATE_CONFIG_FILE_PRESENT/);
 assert.deepEqual(checked,['/tmp/rclone.conf']);
});
test('public isolation check does not read, modify or delete any secret',()=>{
 let checks=0;
 assert.doesNotThrow(()=>assertPublicRcloneIsolation({
  NYX_MULTIUSER_RCLONE_ENABLED:'true',
  NYX_DEPLOYMENT_MODE:'public',
  NYX_PUBLIC_CONNECTORS_ENABLED:'true',
 },p=>{checks++;assert.equal(p,'/tmp/rclone.conf');return false;}));
 assert.equal(checks,1);
});
test('public RcloneService bootstrap fails before using an inherited operator config',t=>{
 const vars=['NYX_DEPLOYMENT_MODE','NYX_PUBLIC_CONNECTORS_ENABLED',
  'RCLONE_CONFIG_B64','RCLONE_CONFIG_PATH','RCLONE_CONFIG','NYX_SHARED_ROOTS_JSON'];
 const saved=Object.fromEntries(vars.map(k=>[k,process.env[k]]));
 t.after(()=>{for(const k of vars){
  if(saved[k]===undefined)delete process.env[k];
  else process.env[k]=saved[k];
 }});
 process.env.NYX_DEPLOYMENT_MODE='public';
 process.env.NYX_PUBLIC_CONNECTORS_ENABLED='true';
 for(const k of vars.filter(k=>k.startsWith('RCLONE_CONFIG')||k==='NYX_SHARED_ROOTS_JSON'))
  delete process.env[k];
 process.env.RCLONE_CONFIG_B64='fixture-private-not-a-real-credential';
 assert.throws(()=>new RcloneService().onModuleInit(),
   /PUBLIC_STORAGE_PRIVATE_CONFIG_PRESENT/);
});
test('private RcloneService keeps an existing local config without rewriting it',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nyx-private-fallback-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'config.conf');
 const marker='[test-only]\ntype = local\n';
 fs.writeFileSync(file,marker,{mode:0o600});
 const vars=['NYX_DEPLOYMENT_MODE','RCLONE_CONFIG_B64','RCLONE_CONFIG_PATH'];
 const saved=Object.fromEntries(vars.map(k=>[k,process.env[k]]));
 t.after(()=>{for(const k of vars){
  if(saved[k]===undefined)delete process.env[k];
  else process.env[k]=saved[k];
 }});
 process.env.NYX_DEPLOYMENT_MODE='private';
 process.env.RCLONE_CONFIG_PATH=file;
 delete process.env.RCLONE_CONFIG_B64;
 assert.doesNotThrow(()=>new RcloneService().onModuleInit());
 assert.equal(fs.readFileSync(file,'utf8'),marker);
});
