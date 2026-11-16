#!/usr/bin/env node
/**
 * Read-only Rclone inventory by default; explicitly gated tenant-vault staging.
 * Operator-only local CLI. Never prints Rclone credentials, tokens or Heroku env.
 * This does NOT confer provider grants, activate a connection, or deploy code.
 */
import {spawnSync} from 'node:child_process';
import {randomUUID,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const fail=(code)=>{throw Error('NYX_IMPORT_'+code);};
const safeName=/^[A-Za-z][A-Za-z0-9_.-]{0,119}$/;
const ownerPattern=/^oauth:google-oauth2\|[0-9]{6,128}$/;
const rootPattern=/^[A-Za-z0-9_-]{1,256}$/;
const allowedKeys=Object.freeze({
  drive:new Set(['type','token','client_id','client_secret','root_folder_id','team_drive','scope']),
  mega:new Set(['type','user','pass','session_id','master_key']),
});
const columns=['provider','state','owner_id','connection_id','encrypted_profile'];

function isObject(value) { return value!==null && !Array.isArray(value) && typeof value==='object'; }
function text(value) { return typeof value==='string' ? value.trim() : ''; }
function requireField(value,max=32768) {
  if(typeof value!=='string'||!value.length||value.length>max||/[\x00\r\n]/.test(value))
    fail('UNSUPPORTED_RCLONE_FIELD');
  return value;
}
export function safeInventory(configuration) {
  if(!isObject(configuration))fail('CONFIG_INVALID');
  const entries=Object.entries(configuration);
  if(entries.length>64)fail('CONFIG_TOO_MANY_REMOTES');
  return entries.map(([name,value])=>{
    const provider=value?.type;
    const unsupported=isObject(value) && allowedKeys[provider]
      ? Object.keys(value).filter(k=>!allowedKeys[provider].has(k))
      : [];
    return {
      remote:name, provider:provider==='drive'?'google-drive':provider==='mega'?'mega':'unsupported',
      hasCredential:provider==='drive'?!!text(value?.token):
        provider==='mega'?!!text(value?.user)&&!!text(value?.pass):false,
      rootMode:provider==='drive'?(text(value?.root_folder_id)?'explicit':'account-root'):'mega-root',
      teamDriveMode:provider==='drive'?(text(value?.team_drive)?'selected':'not-selected'):undefined,
      supported:!!allowedKeys[provider] && unsupported.length===0,
      unsupportedOptions:unsupported,
    };
  });
}
export function buildPendingImport(configuration,manifest) {
  if(!isObject(configuration)||!isObject(manifest)||
    !ownerPattern.test(manifest.ownerId)||!Array.isArray(manifest.remotes)||
    manifest.remotes.length!==8)fail('MANIFEST_INVALID');
  const names=new Set(),labels=new Set();let drives=0,megas=0;
  const rows=manifest.remotes.map(spec=>{
    if(!isObject(spec)||typeof spec.remote!=='string'||!safeName.test(spec.remote)||
      typeof spec.displayName!=='string'||!spec.displayName.trim()||
      spec.displayName.length>80||/[\x00-\x1f\x7f]/.test(spec.displayName)||
      names.has(spec.remote)||labels.has(spec.displayName.toLowerCase()))fail('MANIFEST_INVALID');
    names.add(spec.remote);labels.add(spec.displayName.toLowerCase());
    const cfg=configuration[spec.remote];
    if(!isObject(cfg)||!allowedKeys[cfg.type])fail('REMOTE_ABSENT_OR_UNSUPPORTED');
    const unexpected=Object.keys(cfg).filter(key=>!allowedKeys[cfg.type].has(key));
    if(unexpected.length)fail('UNSUPPORTED_RCLONE_OPTION');
    const provider=cfg.type==='drive'?'google-drive':'mega';
    let profile,root,kind;
    if(provider==='google-drive'){
      drives++;
      const token=requireField(cfg.token);
      let parsed;
      try{parsed=JSON.parse(token);}catch{fail('DRIVE_TOKEN_INVALID');}
      if(!isObject(parsed)||!text(parsed.access_token)&&!text(parsed.refresh_token))
        fail('DRIVE_TOKEN_INVALID');
      // Explicit root from the existing config must never be rewritten.
      const existingRoot=text(cfg.root_folder_id);
      root=requireField(spec.rootId,256);
      if(!rootPattern.test(root)||
        (existingRoot && existingRoot!==root)||
        (!existingRoot && root!=='root'))fail('DRIVE_ROOT_MISMATCH');
      if(cfg.scope!==undefined&&!['drive','drive.file','drive.readonly'].includes(cfg.scope))
        fail('DRIVE_SCOPE_UNSUPPORTED');
      profile={provider,token,rootFolderId:root};
      // Rclone team_drive selects a different Google Drive namespace.
      // Its exact opaque ID is encrypted inside the owner-scoped profile, never logged.
      if(cfg.team_drive!==undefined){
        if(typeof cfg.team_drive!=='string' || cfg.team_drive.length>256 ||
           (cfg.team_drive!=='' && !rootPattern.test(cfg.team_drive)))
          fail('TEAM_DRIVE_INVALID');
        if(cfg.team_drive)profile.teamDriveId=cfg.team_drive;
      }
      if(cfg.client_id)profile.clientId=requireField(cfg.client_id,2048);
      if(cfg.client_secret)profile.clientSecret=requireField(cfg.client_secret,2048);
      if(cfg.scope)profile.scope=cfg.scope;
      kind='drive';
    }else{
      megas++;
      root=spec.rootId;
      if(root!=='MEGA_ROOT')fail('MEGA_ROOT_UNSUPPORTED');
      if(Boolean(cfg.session_id)!==Boolean(cfg.master_key))fail('MEGA_SESSION_INCOMPLETE');
      profile={provider,user:requireField(cfg.user,512),
        obscuredPassword:requireField(cfg.pass,8192)};
      if(cfg.session_id) {
        profile.sessionId=requireField(cfg.session_id,4096);
        profile.masterKey=requireField(cfg.master_key,4096);
      }
      kind='mega-root';
    }
    return {name:spec.remote,displayName:spec.displayName,provider,root,kind,profile};
  });
  if(drives!==6||megas!==2)fail('EXPECTED_SIX_DRIVE_TWO_MEGA');
  return {ownerId:manifest.ownerId,rows};
}
export function sealForTenant(owner,id,profile,key,iv=randomBytes(12)) {
  if(!Buffer.isBuffer(key)||key.length!==32||!Buffer.isBuffer(iv)||iv.length!==12)
    fail('KEY_INVALID');
  const cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from(JSON.stringify([owner,id,profile.provider,'v2'])));
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(profile),'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),encrypted]).toString('base64');
}
function collect(tool,args,max=16*1024*1024) {
  const result=spawnSync(tool,args,{encoding:'utf8',maxBuffer:max,
    stdio:['ignore','pipe','pipe'],timeout:30000});
  // Never expose subprocess stderr, which can sometimes contain sensitive config.
  if(result.error||result.status!==0||!result.stdout)fail('LOCAL_COMMAND_FAILED');
  return result.stdout;
}
function rcloneConfig() {
  let value;
  try{value=JSON.parse(collect('rclone',['config','dump']));}
  catch{fail('CONFIG_UNAVAILABLE');}
  if(!isObject(value))fail('CONFIG_INVALID');
  return value;
}
function appEnvironment() {
  let data;
  try{data=JSON.parse(collect('heroku',['config','--json','-a','dev-nest-nyx']));}
  catch{fail('APP_CONFIG_UNAVAILABLE');}
  if(!isObject(data)||data.NYX_DEPLOYMENT_MODE!=='public'||
     data.NYX_PUBLIC_CONNECTORS_ENABLED!=='true'||
     data.NYX_MULTIUSER_RCLONE_ENABLED!=='true'||
     data.NYX_PUBLIC_TENANT_GOOGLE_MULTI_ENABLED!=='true'||
     ['RCLONE_CONFIG_B64','RCLONE_CONFIG','RCLONE_CONFIG_PATH','NYX_SHARED_ROOTS_JSON']
       .some(k=>Boolean(text(data[k]))))fail('PUBLIC_ISOLATION_NOT_READY');
  if(typeof data.DATABASE_URL!=='string' ||
    !/^postgres(?:ql)?:\/\//.test(data.DATABASE_URL))fail('DATABASE_URL_INVALID');
  const keyText=data.NYX_STORAGE_ENCRYPTION_KEY;
  if(typeof keyText!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(keyText))
    fail('KEY_INVALID');
  const key=Buffer.from(keyText,'base64');
  if(key.length!==32||key.toString('base64')!==keyText)fail('KEY_INVALID');
  return {url:data.DATABASE_URL,key};
}
export async function stageWithDb(db,plan,key,ids=()=>randomUUID()) {
  const client=await db.connect();
  let began=false;
  try{
    await client.query('BEGIN');began=true;
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',
      ['nyx_owner_rclone_import_v1',plan.ownerId]);
    // Refuse all pre-existing owner storage, not just matching remote names.
    // An explicit reconciliation run must be separately reviewed.
    const existing=await client.query(
      "SELECT count(*)::int AS n FROM nyx_connector_connections WHERE owner_id=$1 AND provider IN ('google-drive','mega')",
      [plan.ownerId]);
    if(Number(existing.rows?.[0]?.n)!==0)fail('OWNER_ALREADY_HAS_STORAGE');
    const existingVault=await client.query(
      'SELECT count(*)::int AS n FROM nyx_rclone_tenant_credentials_v2 WHERE owner_id=$1',
      [plan.ownerId]);
    if(Number(existingVault.rows?.[0]?.n)!==0)fail('OWNER_VAULT_ALREADY_HAS_ROWS');
    for(const r of plan.rows) {
      const id=ids();
      if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
        fail('CONNECTION_ID_INVALID');
      const resource=[{kind:r.kind,id:r.root,capabilities:['storage:list']}];
      await client.query(
        'INSERT INTO nyx_connector_connections '+
        '(id,owner_id,display_name,provider,external_account_id,capabilities,'+
        'provider_capabilities,resources,status) '+
        "VALUES($1,$2,$3,$4,'pending',$5::jsonb,'[]'::jsonb,$6::jsonb,'pending')",
        [id,plan.ownerId,r.displayName,r.provider,JSON.stringify(['storage:list']),JSON.stringify(resource)]);
      const sealed=sealForTenant(plan.ownerId,id,r.profile,key);
      await client.query(
        'INSERT INTO nyx_rclone_tenant_credentials_v2 '+
        '(owner_id,connection_id,provider,encrypted_profile,state) '+
        "VALUES($1,$2,$3,$4,'pending')",
        [plan.ownerId,id,r.provider,sealed]);
    }
    const verified=await client.query(
      "SELECT count(*)::int AS n FROM nyx_rclone_tenant_credentials_v2 WHERE owner_id=$1 AND state='pending'",
      [plan.ownerId]);
    if(Number(verified.rows?.[0]?.n)!==8)fail('STAGING_READBACK_FAILED');
    await client.query('COMMIT');began=false;
    return {status:'PENDING_ONLY_NO_PROVIDER_GRANTS',count:8};
  }catch{
    if(began)await client.query('ROLLBACK').catch(()=>{});
    fail('STAGING_FAILED_ROLLED_BACK_OR_UNCERTAIN');
  }finally{client.release();}
}

export function openForTenant(owner,id,provider,encrypted,key) {
  if(!Buffer.isBuffer(key)||key.length!==32||
     typeof encrypted!=='string'||encrypted.length>1024*1024)
    fail('CIPHER_INVALID');
  const raw=Buffer.from(encrypted,'base64');
  if(raw.length<29)fail('CIPHER_INVALID');
  const cipher=createDecipheriv('aes-256-gcm',key,raw.subarray(0,12));
  cipher.setAAD(Buffer.from(JSON.stringify([owner,id,provider,'v2'])));
  cipher.setAuthTag(raw.subarray(12,28));
  try {
    const profile=JSON.parse(Buffer.concat([
      cipher.update(raw.subarray(28)),cipher.final()]).toString('utf8'));
    if(profile?.provider!==provider)fail('CIPHER_PROVIDER_MISMATCH');
    return profile;
  }catch{fail('CIPHER_AUTHENTICATION_FAILED');}
}
/**
 * Operator-only promotion. Dev's independent live probe must attest all eight
 * pending credentials first. No direct provider grants from manifest/input.
 * All metadata + vault rows switch in one transaction, never partially.
 */
export async function finalizeReadVerified(db,plan,key,now=new Date()) {
  const client=await db.connect();
  let inTransaction=false;
  try{
    await client.query('BEGIN');inTransaction=true;
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',
      ['nyx_owner_rclone_import_v1',plan.ownerId]);
    const all=await client.query(
      "SELECT id,display_name,provider,status,external_account_id,capabilities,"+
      "provider_capabilities,resources FROM nyx_connector_connections WHERE owner_id=$1"+
      " AND provider IN ('google-drive','mega') FOR UPDATE",[plan.ownerId]);
    if(all.rowCount!==8)fail('FINALIZE_EXPECTED_EIGHT');
    const vault=await client.query(
      "SELECT connection_id,provider,encrypted_profile,read_verified_at,state "+
      "FROM nyx_rclone_tenant_credentials_v2 WHERE owner_id=$1 FOR UPDATE",
      [plan.ownerId]);
    if(vault.rowCount!==8)fail('FINALIZE_VAULT_EXPECTED_EIGHT');
    const byName=new Map(plan.rows.map(r=>[r.displayName,r]));
    const byConnection=new Map(vault.rows.map(r=>[r.connection_id,r]));
    if(byConnection.size!==8)fail('FINALIZE_DUPLICATE');
    const epoch=now.getTime();
    if(!Number.isFinite(epoch))fail('FINALIZE_CLOCK_INVALID');
    for(const c of all.rows){
      const expected=byName.get(c.display_name);
      const candidate=byConnection.get(c.id);
      if(!expected||!candidate||candidate.provider!==expected.provider||
        candidate.state!=='pending'||c.status!=='pending'||
        c.external_account_id!=='pending'||c.provider!==expected.provider ||
        JSON.stringify(c.capabilities)!==JSON.stringify(['storage:list'])||
        JSON.stringify(c.provider_capabilities)!=='[]')fail('FINALIZE_METADATA_MISMATCH');
      const rules=typeof c.resources==='string'?JSON.parse(c.resources):c.resources;
      if(!Array.isArray(rules)||rules.length!==1||
        rules[0]?.kind!==expected.kind||rules[0]?.id!==expected.root||
        JSON.stringify(rules[0]?.capabilities)!==JSON.stringify(['storage:list']))
        fail('FINALIZE_ROOT_MISMATCH');
      const probeAt=new Date(candidate.read_verified_at).getTime();
      if(!Number.isFinite(probeAt)||probeAt>epoch+30000||
        epoch-probeAt>15*60*1000)fail('FINALIZE_STALE_PROBE');
      const profile=openForTenant(plan.ownerId,c.id,expected.provider,
        candidate.encrypted_profile,key);
      if(expected.provider==='google-drive'){
        if(profile.rootFolderId!==expected.root||!profile.token||
           (profile.teamDriveId||'')!==(expected.profile.teamDriveId||''))
          fail('FINALIZE_CREDENTIAL_ROOT_MISMATCH');
      }else if(profile.verifiedRoot!==expected.root)
        fail('FINALIZE_MEGA_ROOT_NOT_VERIFIED');
    }
    // Metadata has no provider email claim: this is an operator-import ID.
    // Only storage:list is granted, based on fresh provider read proof.
    for(const c of all.rows){
      const update=await client.query(
        "UPDATE nyx_connector_connections SET status='active',"+
        " provider_capabilities='[\"storage:list\"]'::jsonb,"+
        " external_account_id=$3,updated_at=now() "+
        "WHERE owner_id=$1 AND id=$2 AND status='pending' "+
        "AND external_account_id='pending'",
        [plan.ownerId,c.id,'rclone-import:'+c.id]);
      if(update.rowCount!==1)fail('FINALIZE_METADATA_RACE');
      const cred=await client.query(
        "UPDATE nyx_rclone_tenant_credentials_v2 SET state='active',updated_at=now() "+
        "WHERE owner_id=$1 AND connection_id=$2 AND state='pending' "+
        "AND read_verified_at>now()-interval '15 minutes'",
        [plan.ownerId,c.id]);
      if(cred.rowCount!==1)fail('FINALIZE_CREDENTIAL_RACE');
    }
    await client.query('COMMIT');inTransaction=false;
    return {status:'ACTIVE_READ_VERIFIED_EIGHT',count:8,writeGrants:false};
  }catch{
    if(inTransaction)await client.query('ROLLBACK').catch(()=>{});
    fail('FINALIZE_FAILED_ROLLED_BACK_OR_UNCERTAIN');
  }finally{client.release();}
}

function argsOf(argv) {
  if(argv.length===0||argv.length===1&&argv[0]==='--inventory')
    return {mode:'inventory'};
  if(argv.length===3&&argv[0]==='--plan'&&argv[1]==='--manifest')
    return {mode:'plan',manifest:argv[2]};
  if(argv.length===4&&['--stage','--finalize'].includes(argv[0])&&argv[1]==='--manifest')
    return {mode:argv[0].slice(2),manifest:argv[2],confirmation:argv[3]};
  fail('USAGE');
}
async function main(argv) {
  const options=argsOf(argv);
  const config=rcloneConfig();
  if(options.mode==='inventory') {
    const entries=safeInventory(config);
    // Includes only configured remote names and option names; no values.
    console.log(JSON.stringify({mode:'READ_ONLY',remotes:entries},null,2));
    return;
  }
  let manifest;
  try{manifest=JSON.parse(readFileSync(options.manifest,'utf8'));}catch{fail('MANIFEST_UNAVAILABLE');}
  const plan=buildPendingImport(config,manifest);
  console.log(JSON.stringify({mode:options.mode,ownerFormatVerified:true,count:plan.rows.length,
    sixDriveTwoMega:true,rootKinds:plan.rows.map(r=>({remote:r.name,kind:r.kind,
      rootMode:r.root==='root'?'account-root':'explicit-or-mega'}))},null,2));
  if(options.mode==='plan')return;
  if(options.confirmation!==(options.mode==='stage'?'STAGE_EIGHT_PENDING':'ACTIVATE_EIGHT_VERIFIED'))
    fail('EXPLICIT_CONFIRMATION_REQUIRED');
  if(process.env.NYX_IMPORT_APPROVED_OWNER!==plan.ownerId)
    fail('OWNER_ATTESTATION_REQUIRED');
  const app=appEnvironment();
  const {Pool}=await import('pg');
  const db=new Pool({connectionString:app.url,max:1,connectionTimeoutMillis:5000,
    statement_timeout:15000});
  try{
    const result=options.mode==='stage'?await stageWithDb(db,plan,app.key):
      await finalizeReadVerified(db,plan,app.key);
    console.log(JSON.stringify(result));
  }finally{app.key.fill(0);await db.end();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch(e=>{
    // No stack, connection strings, tokens, provider messages or SQL details.
    console.error(/^NYX_IMPORT_[A-Z_]+$/.test(e?.message??'')?e.message:
      'NYX_IMPORT_ABORTED_WITHOUT_DETAILS');
    process.exitCode=1;
  });
