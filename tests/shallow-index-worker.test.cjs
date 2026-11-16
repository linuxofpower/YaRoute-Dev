const {test} = require('node:test');
const assert = require('node:assert/strict');
const {ShallowIndexService} = require('../dist/indexing/shallow-index.service.js');

const owner='oauth:issuer|primary';
const conn='4dc262bd-f27a-43b5-8e2d-d5fa761cb88f';
const root='MEGA_ROOT';
const job={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  owner_id:owner,connection_id:conn,provider:'mega',root_id:root,enabled:true};
function fixture(source={readOnly:true,truncated:false,
    items:[{path:'safe.txt',isDir:false,size:123}]},deny=false){
  const sql=[],writes=[];
  const client={
    query:async(q,args=[])=>{
      writes.push({sql:q,args});
      if(q.includes('SELECT enabled FROM'))return {rowCount:1,rows:[{enabled:true}]};
      if(q.includes('RETURNING id'))return {rowCount:1,rows:[{id:job.id}]};
      return {rowCount:1,rows:[]};
    },
    release(){},
  };
  const service=new ShallowIndexService(
    {registryPolicy(){return {requireResource:async()=>{
      if(deny)throw Error('DENIED');return {};
    }}}},
    {listAuthorizedRoot:async()=>source,
      probeAuthorizedRoot:async()=>deny?'failed':'verified'},
  );
  service.encryptionKey=Buffer.alloc(32,13);
  service.pool={
    query:async(q,args=[])=>{
      sql.push({sql:q,args});
      if(q.includes('WITH due AS')){
        return {rows:[{...job,lease_token:args[0]}],rowCount:1};
      }
      if(q.includes('RETURNING id'))return {rows:[{id:job.id}],rowCount:1};
      return {rowCount:1,rows:[]};
    },
    connect:async()=>client,
  };
  return {service,sql,writes};
}

test('index feature must fail closed when not enabled',async()=>{
  const service=new ShallowIndexService({}, {});
  assert.rejects(()=>service.status(owner),/INDEX_NOT_ENABLED/);
  assert.rejects(()=>service.runOnce(),/INDEX_NOT_ENABLED/);
});

test('shallow one-off stores only sealed path metadata and exits',async()=>{
  const {service,sql,writes}=fixture();
  const result=await service.runOnce();
  assert.equal(result.status,'COMPLETE_SHALLOW');
  assert.equal(result.items,1);
  assert.equal(result.providerMutation,false);
  const insert=writes.find(x=>x.sql.includes('INSERT INTO nyx_tenant_index_items_v1'));
  assert.ok(insert);
  assert.equal(insert.args[0],owner);
  assert.match(insert.args[3],/^[a-f0-9]{64}$/);
  assert.notEqual(insert.args[4],'safe.txt');
  assert.equal(Buffer.from(insert.args[4],'base64').includes('safe.txt'),false);
  assert.ok(writes.some(x=>x.sql.includes('COMMIT')));
  assert.equal(JSON.stringify(result).includes('safe.txt'),false);
  assert.ok(sql.some(x=>x.sql.includes('WITH due AS')&&x.sql.includes('SKIP LOCKED')));
});

test('truncation blocks incomplete index and writes no rows',async()=>{
  const {service,sql,writes}=fixture({readOnly:true,truncated:true,
    items:[{path:'one.txt',isDir:false,size:1}]});
  const result=await service.runOnce();
  assert.equal(result.status,'BLOCKED_TRUNCATED');
  assert.equal(result.reason,'INDEX_DIRECTORY_PAGINATION_REQUIRED');
  assert.equal(writes.length,0);
  assert.ok(sql.some(x=>x.sql.includes("state='blocked_truncated'")));
});

test('untrusted provider response retries safely without writes or file names',async()=>{
  const {service,sql,writes}=fixture({readOnly:false,truncated:false,items:[
    {path:'secret.txt',isDir:false,size:10}]});
  const result=await service.runOnce();
  assert.equal(result.status,'RETRY_PENDING');
  assert.equal(writes.length,0);
  assert.equal(JSON.stringify(result).includes('secret'),false);
  assert.ok(sql.some(x=>x.sql.includes("state='retry'")));
});

test('revoked authorization stops indexing before saving metadata',async()=>{
  const {service,writes}=fixture(undefined,true);
  const result=await service.runOnce();
  assert.equal(result.status,'RETRY_PENDING');
  assert.equal(writes.length,0);
});

test('owner validation and exact-provider probe happen before job opt-in',async()=>{
  const {service}=fixture();
  await assert.rejects(
    ()=>service.optIn('unverified',conn,'mega',root),
    /INDEX_AUTHENTICATED_OWNER_REQUIRED/);
  const result=await service.optIn(owner,conn,'mega',root);
  assert.equal(result.mode,'shallow');
  assert.equal(result.enabled,true);
});

test('a revoked provider probe refuses enabling background access',async()=>{
  const {service}=fixture(undefined,true);
  await assert.rejects(
    ()=>service.optIn(owner,conn,'mega',root),
    /INDEX_AUTHORIZED_ROOT_NOT_VERIFIED/);
});
