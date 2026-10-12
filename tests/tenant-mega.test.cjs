const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {TenantRcloneService}=require('../dist/storage/tenant-rclone.service');
const {MegaConnectController}=require('../dist/storage/mega-connect.controller');

const UUID='c0a73964-fc25-45b7-8095-612306ab7349';
function fixture(){
 const row={id:UUID,owner_id:'oauth:alice',provider:'mega',display_name:'Archive MEGA',
   provider_identity:null,encrypted_credential:null,status:'pending',is_main:false,
   read_verified_at:null,write_verified_at:null};
 let ticketDigest,used=false;
 const writes=[];
 const service=new TenantRcloneService();
 service.key=Buffer.alloc(32,13);
 const query=async(sql,args=[])=>{
  writes.push({sql,args});
  if(sql.includes('INSERT INTO nyx_tenant_rclone_usage'))return {rowCount:1,rows:[{count:1}]};
  if(sql.includes('SELECT * FROM nyx_tenant_rclone WHERE id=$1 AND owner_id=$2')){
   return {rowCount:args[0]===UUID&&args[1]==='oauth:alice'?1:0,rows:[row]};
  }
  if(sql.includes('SELECT s.owner_id,s.connection_id,c.display_name')){
   return {rowCount:!used&&args[0]===ticketDigest?1:0,
    rows:[{owner_id:'oauth:alice',connection_id:UUID,display_name:row.display_name}]};
  }
  if(sql.includes('DELETE FROM nyx_tenant_rclone_mega_login')){
   if(used||args[0]!==ticketDigest)return {rowCount:0,rows:[]};
   used=true;return {rowCount:1,rows:[{owner_id:'oauth:alice',connection_id:UUID}]};
  }
  if(sql.includes("UPDATE nyx_tenant_rclone")&&sql.includes("status='connected'")){
   row.encrypted_credential=args[2];row.status='connected';return {rowCount:1,rows:[{id:UUID}]};
  }
  return {rowCount:1,rows:[]};
 };
 service.pool={
  query,
  connect:async()=>({query:async(sql,args=[])=>{
   if(sql.includes('INSERT INTO nyx_tenant_rclone_mega_login'))ticketDigest=args[0];
   return query(sql,args);
  },release(){}}),
 };
 return {service,row,writes};
}
test('MEGA enrollment creates independent pending connections with a one-time HTTPS form',async()=>{
 const prev=process.env.NYX_PUBLIC_URL;process.env.NYX_PUBLIC_URL='https://secure.example.test';
 try{
  const {service}=fixture();
  const begun=await service.beginMega('oauth:alice','Archive MEGA');
  assert.equal(begun.provider,'mega');
  const url=new URL(begun.url);
  assert.equal(url.origin,'https://secure.example.test');
  assert.equal(url.pathname,'/connect/mega');
  assert.ok(url.searchParams.get('ticket'));
  assert.equal(await service.inspectMegaTicket(url.searchParams.get('ticket')).then(x=>x.name),'Archive MEGA');
  assert.equal(JSON.stringify(begun).includes('password'),false);
  await assert.rejects(()=>service.beginMega('bob','Archive MEGA'),/AUTHENTICATED_OWNER_REQUIRED/);
  await assert.rejects(()=>service.inspectMegaTicket('malformed-ticket'),/MEGA_ENROLLMENT_INVALID/);
 }finally{prev===undefined?delete process.env.NYX_PUBLIC_URL:process.env.NYX_PUBLIC_URL=prev;}
});
test('MEGA credentials arrive only through HTTPS form, are obscured through stdin and persisted encrypted',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'nyx-mega-enroll-test-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const sh=path.join(root,'fake-rclone.sh');
 const passwordFile=path.join(root,'stdin.txt');
 const configFile=path.join(root,'one-remote.conf');
 fs.writeFileSync(sh,[
  '#!/bin/sh',
  'if [ "$1" = "obscure" ]; then',
  '  IFS= read -r pwd',
  '  printf "%s" "$pwd" > "'+passwordFile+'"',
  '  printf "%s\\n" "abcdefghijklmnopqrstu1234567890"',
  '  exit 0',
  'fi',
  'if [ "$1" = "--config" ]; then',
  '  cp "$2" "'+configFile+'"',
  '  printf "\\nsession_id = ThisIsASafeSession000\\nmaster_key = c2Vzc2lvbk1hc3RlcktleQ==\\n" >> "$2"',
  '  exit 0',
  'fi',
  'exit 3',
  ''
 ].join('\n'),{mode:0o700});
 const old=Object.fromEntries(['RCLONE_BINARY','NYX_PUBLIC_URL'].map(k=>[k,process.env[k]]));
 process.env.RCLONE_BINARY=sh;
 process.env.NYX_PUBLIC_URL='https://secure.example.test';
 try{
  const {service,row,writes}=fixture();
  const begin=await service.beginMega('oauth:alice','Archive MEGA');
  const ticket=new URL(begin.url).searchParams.get('ticket');
  const result=await service.completeMega(ticket,''archive'+'@'+'example.test'','SuperSecret_42','123456');
  assert.deepEqual(result,{connected:true});
  assert.equal(row.status,'connected');
  assert.equal(fs.readFileSync(passwordFile,'utf8'),'SuperSecret_42');
  const cfg=fs.readFileSync(configFile,'utf8');
  assert.match(cfg,/type = mega/);
  assert.match(cfg,/2fa = 123456/);
  assert.match(cfg,/use_https = true/);
  assert.match(cfg,/pass = abcdefghijklmnopqrstu1234567890/);
  assert.doesNotMatch(cfg,/SuperSecret_42/);
  const serialized=JSON.stringify(writes.filter(x=>x.sql.includes('UPDATE nyx_tenant_rclone')));
  assert.ok(!serialized.includes('SuperSecret_42'));
  assert.ok(!serialized.includes('123456'));
  const stored=service.decrypt('oauth:alice',UUID,'mega',row.encrypted_credential);
  assert.equal(stored.user,''archive'+'@'+'example.test'');
  assert.equal(stored.pass,'abcdefghijklmnopqrstu1234567890');
  assert.equal(stored.session_id,'ThisIsASafeSession000');
  assert.equal(stored.master_key,'c2Vzc2lvbk1hc3RlcktleQ==');
  assert.equal(stored.otp,undefined);
  await assert.rejects(()=>service.completeMega(ticket,''archive'+'@'+'example.test'','Again123'),/MEGA_ENROLLMENT_INVALID/);
  await assert.rejects(()=>service.probe('oauth:bob',UUID,'read'),/STORAGE_CONNECTION_NOT_FOUND/);
 }finally{for(const[k,v]of Object.entries(old))v===undefined?delete process.env[k]:process.env[k]=v;}
});
test('MEGA HTTPS form never embeds or sends account secrets through MCP UI',async()=>{
 const code=fs.readFileSync(path.join(__dirname,'..','src','storage','mega-connect.controller.ts'),'utf8');
 const mcp=fs.readFileSync(path.join(__dirname,'..','src','mcp','mcp.service.ts'),'utf8');
 const panel=fs.readFileSync(path.join(__dirname,'..','src','connectors','connections-panel.ts'),'utf8');
 assert.match(code,/Referrer-Policy','no-referrer/);
 assert.match(code,/frame-ancestors 'none'/);
 assert.match(code,/req.headers.origin!==origin/);
 assert.match(code,/application\/x-www-form-urlencoded/);
 assert.match(code,/type="password"/);
 assert.match(code,/type="text" name="otp"/);
 assert.match(mcp,/nyx_storage_begin_mega/);
 assert.match(panel,/nyx_storage_begin_mega/);
 assert.doesNotMatch(mcp,/inputSchema:z.object\(\{[^}]*password:/s);
});
