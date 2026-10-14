const {test}=require('node:test');
const assert=require('node:assert/strict');
const {TenantRcloneService}=require('../dist/storage/tenant-rclone.service');

function installFixture() {
  const service=new TenantRcloneService();
  service.key=Buffer.alloc(32,23);
  const stored=[];
  const txLog=[];
  const query=async(sql,args=[])=>{
    if(sql.includes('INSERT INTO nyx_tenant_rclone_usage'))
      return {rowCount:1,rows:[{count:1}]};
    if(sql.includes('SELECT count(*) AS count FROM nyx_tenant_rclone')) {
      const count=stored.filter(row=>row.owner_id===args[0]&&row.provider===args[1]).length;
      return {rowCount:1,rows:[{count:String(count)}]};
    }
    if(sql.includes('INSERT INTO nyx_tenant_rclone(')||sql.includes('INSERT INTO nyx_tenant_rclone (')) {
      stored.push({id:args[0],owner_id:args[1],provider:sql.includes("'drive'")?'drive':'mega',
        display_name:args[2],status:'pending',is_main:false,read_verified_at:null,write_verified_at:null,
        scope_mode:'folder',scope_root:null});
      return {rowCount:1,rows:[]};
    }
    if(sql.includes('SELECT * FROM nyx_tenant_rclone') && sql.includes('WHERE owner_id=$1 ORDER BY created_at,id'))
      return {rowCount:stored.filter(row=>row.owner_id===args[0]).length,
        rows:stored.filter(row=>row.owner_id===args[0])};
    if(sql.includes('SELECT * FROM nyx_tenant_rclone WHERE id=$1 AND owner_id=$2')) {
      const row=stored.find(row=>row.id===args[0]&&row.owner_id===args[1]);
      return {rowCount:row?1:0,rows:row?[row]:[]};
    }
    if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')txLog.push(sql);
    return {rowCount:1,rows:[]};
  };
  service.pool={query,connect:async()=>({query,release(){}})};
  return {service,stored,txLog};
}

test('reconnected tenant can add several independent Google Drive and MEGA accounts',async()=>{
  const previous={NYX_PUBLIC_URL:process.env.NYX_PUBLIC_URL,
    NYX_GOOGLE_CLIENT_ID:process.env.NYX_GOOGLE_CLIENT_ID};
  process.env.NYX_PUBLIC_URL='https://example.test';
  process.env.NYX_GOOGLE_CLIENT_ID='test-client-id';
  try{
    const {service,stored}=installFixture();
    const drive=[];
    for(let i=1;i<=3;i++)drive.push(await service.beginGoogle('oauth:owner-one','Drive '+i));
    const mega=[];
    for(let i=1;i<=2;i++)mega.push(await service.beginMega('oauth:owner-one','MEGA '+i));
    assert.equal(new Set([...drive,...mega].map(item=>item.id)).size,5);
    assert.ok(drive.every(item=>new URL(item.url).hostname==='accounts.google.com'));
    assert.ok(mega.every(item=>new URL(item.url).pathname==='/connect/mega'));
    const own=await service.list('oauth:owner-one');
    assert.equal(own.length,5);
    assert.equal(own.filter(x=>x.provider==='google-drive').length,3);
    assert.equal(own.filter(x=>x.provider==='mega').length,2);
    assert.ok(own.every(x=>!('encrypted_credential' in x)&&!('owner_id' in x)));
    await service.beginGoogle('oauth:owner-two','Drive 1');
    await service.beginMega('oauth:owner-two','MEGA 1');
    const other=await service.list('oauth:owner-two');
    assert.equal(other.length,2);
    assert.equal(stored.length,7);
    assert.ok(other.every(x=>!own.some(y=>y.id===x.id)));
    await assert.rejects(()=>service.rename('oauth:owner-two',drive[0].id,'foreign'),/STORAGE_CONNECTION_NOT_FOUND/);
    await assert.rejects(()=>service.probe('oauth:owner-two',mega[0].id,'read'),/STORAGE_CONNECTION_NOT_FOUND/);
  }finally{
    for(const[k,v]of Object.entries(previous))
      v===undefined?delete process.env[k]:process.env[k]=v;
  }
});

test('account limits are enforced independently for MEGA and Google Drive',async()=>{
  const {service}=installFixture();
  process.env.NYX_PUBLIC_URL='https://example.test';
  process.env.NYX_GOOGLE_CLIENT_ID='test-client-id';
  try{
    for(let i=0;i<6;i++) await service.beginMega('oauth:owner','MEGA '+i);
    await assert.rejects(()=>service.beginMega('oauth:owner','MEGA 7'),/MEGA_ENROLLMENT_FAILED/);
    for(let i=0;i<9;i++) await service.beginGoogle('oauth:owner','Drive '+i);
    await assert.rejects(()=>service.beginGoogle('oauth:owner','Drive 10'),/STORAGE_PROVIDER_ACCOUNT_LIMIT/);
    const own=await service.list('oauth:owner');
    assert.equal(own.length,15);
    assert.equal(own.filter(x=>x.provider==='mega').length,6);
    assert.equal(own.filter(x=>x.provider==='google-drive').length,9);
  }finally{delete process.env.NYX_PUBLIC_URL;delete process.env.NYX_GOOGLE_CLIENT_ID;}
});
