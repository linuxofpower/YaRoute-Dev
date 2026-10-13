const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  TENANT_ACCOUNT_CAPS, safeRelativePath, validateTenantScope, resolveTenantPath,
} = require('../dist/storage/tenant-storage-policy');
const { TenantRcloneService } = require('../dist/storage/tenant-rclone.service');
const UUID='ddf5d5ee-d2f1-43aa-860f-91abbe69bec4';

test('tenant caps are six MEGA and nine Google Drive connections', () => {
  assert.deepEqual(TENANT_ACCOUNT_CAPS,{mega:6,drive:9});
});

test('folder is fail-closed until a root is explicitly selected',()=>{
  const scope={mode:'folder',root:null};
  assert.throws(()=>resolveTenantPath(scope,'list',''),/STORAGE_SCOPE_ROOT_NOT_SELECTED/);
  assert.equal(resolveTenantPath(validateTenantScope('folder','Photos/Travel'),'list','2026'),
    'Photos/Travel/2026');
  assert.equal(resolveTenantPath(validateTenantScope('file','Private/a.txt'),'stat',''),
    'Private/a.txt');
  assert.throws(()=>resolveTenantPath(validateTenantScope('file','Private/a.txt'),'list',''),
    /STORAGE_FILE_SCOPE_DENIED/);
  assert.throws(()=>validateTenantScope('unrestricted',''),/STORAGE_UNRESTRICTED_CONFIRMATION_REQUIRED/);
  assert.deepEqual(validateTenantScope('unrestricted','',true),{mode:'unrestricted',root:''});
});

test('scope escapes and alternate path syntaxes are rejected',()=>{
  for(const bad of ['..','a/../b','a//b','a/./b','/absolute','a\\b','a:%2f','a%2fb','-flag','a/-flag','a/','']) {
    assert.throws(()=>safeRelativePath(bad),/STORAGE_SCOPE_PATH_INVALID/,bad);
  }
  for(const bad of ['..','../foo','a/../../b','a\\x','a//b','-danger'])
    assert.throws(()=>resolveTenantPath({mode:'folder',root:'allowed'},'list',bad),
      /STORAGE_SCOPE_PATH_INVALID/,bad);
  assert.equal(resolveTenantPath({mode:'folder',root:'allowed'},'stat',''),'allowed');
  assert.equal(resolveTenantPath({mode:'unrestricted',root:''},'list','inside'),'inside');
});

test('provider caps are checked under database transaction-scoped owner lock',async()=>{
  const service=new TenantRcloneService();
  const queries=[];
  const client={query:async(sql,args)=>{
    queries.push({sql,args});
    if(sql.includes('count(*)')) return {rows:[{count:args[1]==='mega'?'6':'8'}]};
    return {rows:[]};
  }};
  await assert.rejects(()=>service.assertCreationCapacity(client,'oauth:alice','mega'),
    /STORAGE_PROVIDER_ACCOUNT_LIMIT/);
  await service.assertCreationCapacity(client,'oauth:alice','drive');
  assert.equal(queries.filter(x=>x.sql.includes('pg_advisory_xact_lock')).length,2);
  assert.ok(queries.filter(x=>x.sql.includes('count(*)')).every(x=>x.args[0]==='oauth:alice'));
});

test('only the owning authenticated account can configure a connected scope',async()=>{
  const service=new TenantRcloneService(),calls=[];
  service.key=Buffer.alloc(32,1);
  service.pool={query:async(sql,args)=>{
    calls.push({sql,args});
    if(sql.includes('SELECT * FROM nyx_tenant_rclone WHERE id=$1 AND owner_id=$2')){
      const ok=args[1]==='oauth:alice'&&args[0]===UUID;
      return {rowCount:ok?1:0,rows:ok?[{id:UUID,owner_id:'oauth:alice',status:'connected',provider:'mega'}]:[]};
    }
    return {rowCount:1,rows:[{id:UUID}]};
  }};
  await assert.rejects(()=>service.configureScope('oauth:bob',UUID,'folder','Photos'),
    /STORAGE_CONNECTION_NOT_FOUND/);
  await assert.rejects(()=>service.configureScope('oauth:alice',UUID,'unrestricted','',false),
    /STORAGE_UNRESTRICTED_CONFIRMATION_REQUIRED/);
  const ok=await service.configureScope('oauth:alice',UUID,'folder','Photos');
  assert.equal(ok.scopeMode,'folder');
  assert.equal(ok.fileOperationsEnabled,false);
  assert.equal(calls.filter(x=>x.sql.startsWith('UPDATE')).length,1);
  assert.equal(calls.at(-1).args[0],'oauth:alice');
  assert.equal(calls.at(-1).args[3],'Photos');
});
