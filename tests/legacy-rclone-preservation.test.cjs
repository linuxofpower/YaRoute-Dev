const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {RcloneService}=require('../dist/storage/rclone.service');
const {SharedRootsService}=require('../dist/storage/shared-roots.service');
const {TenantRcloneService}=require('../dist/storage/tenant-rclone.service');

function restoreEnv(old) {
  for(const [key,value] of Object.entries(old))
    if(value===undefined)delete process.env[key];else process.env[key]=value;
}
const keys=['RCLONE_CONFIG_PATH','RCLONE_CONFIG_B64','NYX_DEPLOYMENT_MODE',
  'NYX_TENANT_STORAGE_ENABLED','NYX_PUBLIC_CONNECTORS_ENABLED',
  'NYX_SHARED_ROOTS_JSON'];
const digest=content=>createHash('sha256').update(content).digest('hex');

test('private legacy Rclone remotes survive multiaccount code and remain unchanged',async t=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'nyx-preserve-legacy-'));
  t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
  const target=path.join(folder,'rclone.conf');
  // Test-only placeholders, not credentials; provider configs remain owned by private mode.
  const fixture=[
    '[my_drive]', 'type = drive', 'scope = drive', 'token = SAMPLE_DO_NOT_USE',
    '[other_drive]', 'type = drive', 'scope = drive.readonly', 'token = SAMPLE_DO_NOT_USE',
    '[my_mega]', 'type = mega', 'user = example.invalid', 'pass = TEST_NOT_VALID', ''
  ].join('\n');
  fs.writeFileSync(target,fixture,{mode:0o600});
  const before=digest(fs.readFileSync(target));
  const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  try{
    process.env.RCLONE_CONFIG_PATH=target;
    delete process.env.RCLONE_CONFIG_B64;
    process.env.NYX_DEPLOYMENT_MODE='private';
    delete process.env.NYX_TENANT_STORAGE_ENABLED;
    new RcloneService().onModuleInit();
    const summary=new RcloneService().safeRemoteConfiguration('my_drive','drive');
    assert.equal(summary.declaredScope,'drive');
    assert.ok(!JSON.stringify(summary).includes('SAMPLE_DO_NOT_USE'));
    const disabledTenant=new TenantRcloneService();
    await disabledTenant.onModuleInit();
    await assert.rejects(()=>disabledTenant.list('oauth:owner'),/TENANT_STORAGE_NOT_ENABLED/);
    assert.equal(digest(fs.readFileSync(target)),before);
    assert.equal(fs.statSync(target).mode & 0o777,0o600);
  }finally{restoreEnv(old);}
});

test('public multiuser mode never overwrites or reads legacy private Rclone config',()=>{
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'nyx-legacy-public-'));
  try{
    const target=path.join(folder,'rclone.conf');
    const fixture='[legacy]\ntype = drive\ntoken = EXISTING_DO_NOT_USE\n';
    fs.writeFileSync(target,fixture,{mode:0o600});
    const before=digest(fs.readFileSync(target));
    const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
    try{
      process.env.RCLONE_CONFIG_PATH=target;
      process.env.RCLONE_CONFIG_B64=Buffer.from('[new]\ntype = mega\n','utf8').toString('base64');
      process.env.NYX_DEPLOYMENT_MODE='public';
      process.env.NYX_PUBLIC_CONNECTORS_ENABLED='true';
      new RcloneService().onModuleInit();
      assert.equal(digest(fs.readFileSync(target)),before);
      assert.deepEqual(new SharedRootsService().listAreas(),[]);
      assert.throws(()=>new RcloneService().safeRemoteConfiguration('legacy','drive'),
        /PRIVATE_RCLONE_CONNECTIONS_ONLY/);
    }finally{restoreEnv(old);}
  }finally{fs.rmSync(folder,{recursive:true,force:true});}
});
