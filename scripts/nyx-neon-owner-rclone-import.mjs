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
      // Keep logical resource 'root' but do NOT emit root_folder_id for
      // a legacy account-root remote that omitted that Rclone option.
      profile={provider,token,rootFolderId:root};
      if(!existingRoot)profile.accountRoot=true;
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
/**
 * Offline import can stage pending tenant ciphertext while legacy operator
 * settings remain on Heroku. No live provider grants or cutover are implied.
 * Finalization remains gated: a public tenant runtime must be legacy-free.
 * This rule does NOT change TenantRcloneService's runtime isolation policy.
 */
export function validateImporterEnvironment(data,mode) {
  if(!isObject(data)||data.NYX_DEPLOYMENT_MODE!=='public'||
     data.NYX_PUBLIC_CONNECTORS_ENABLED!=='true'||
     data.NYX_MULTIUSER_RCLONE_ENABLED!=='true'||
     data.NYX_PUBLIC_TENANT_GOOGLE_MULTI_ENABLED!=='true')
    fail('PUBLIC_ISOLATION_NOT_READY');
  if(!['stage','stage-six','finalize','finalize-six'].includes(mode))
    fail('IMPORT_MODE_INVALID');
  const hasLegacy=['RCLONE_CONFIG_B64','RCLONE_CONFIG',
     'RCLONE_CONFIG_PATH','NYX_SHARED_ROOTS_JSON']
    .some(k=>Boolean(text(data[k])));
  if(hasLegacy && !['stage','stage-six'].includes(mode))
    fail('PUBLIC_ISOLATION_NOT_READY');
  if(typeof data.DATABASE_URL!=='string' ||
    !/^postgres(?:ql)?:\/\//.test(data.DATABASE_URL))fail('DATABASE_URL_INVALID');
  const keyText=data.NYX_STORAGE_ENCRYPTION_KEY;
  if(typeof keyText!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(keyText))
    fail('KEY_INVALID');
  const key=Buffer.from(keyText,'base64');
  if(key.length!==32||key.toString('base64')!==keyText)fail('KEY_INVALID');
  return {url:data.DATABASE_URL,key};
}
function appEnvironment(mode) {
  let data;
  try{data=JSON.parse(collect('heroku',['config','--json','-a','dev-nest-nyx']));}
  catch{fail('APP_CONFIG_UNAVAILABLE');}
  return validateImporterEnvironment(data,mode);
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


/**
 * Incremental import for an owner who already has exactly two verified active
 * MEGA remotes. Only stages six missing Google Drive credentials; the active
 * MEGA ciphertext and any pending MEGA rotation are deliberately untouched.
 */
export async function stageSixWithExistingMega(db,plan,key,ids=()=>randomUUID()) {
  if(plan.rows.length!==8||plan.rows.filter(r=>r.provider==='mega').length!==2||
     plan.rows.filter(r=>r.provider==='google-drive').length!==6)
    fail('SIX_DRIVE_PLAN_REQUIRED');
  const client=await db.connect();
  let began=false;
  try {
    await client.query('BEGIN');began=true;
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',
      ['nyx_owner_rclone_import_v1',plan.ownerId]);
    const r=await client.query(
      "SELECT id,display_name,provider,status,external_account_id,capabilities,"+
      "provider_capabilities,resources FROM nyx_connector_connections "+
      "WHERE owner_id=$1 AND provider IN ('google-drive','mega') FOR UPDATE",
      [plan.ownerId]);
    if(!Array.isArray(r.rows))fail('OWNER_STORAGE_UNAVAILABLE');
    const mega=r.rows.filter(c=>c.provider==='mega');
    const drive=r.rows.filter(c=>c.provider==='google-drive');
    if(mega.length!==2||drive.length>1||
       mega.some(c=>c.status!=='active')||
       drive.some(c=>c.status!=='pending'||c.external_account_id!=='pending'))
      fail('EXISTING_OWNER_STORAGE_UNEXPECTED');
    const v=await client.query(
      'SELECT connection_id,provider,state FROM nyx_rclone_tenant_credentials_v2 '+
      'WHERE owner_id=$1 FOR UPDATE',[plan.ownerId]);
    if(!Array.isArray(v.rows))fail('OWNER_VAULT_UNAVAILABLE');
    if(v.rows.some(c=>c.provider==='google-drive'))fail('DRIVE_VAULT_ALREADY_STAGED');
    for(const expected of plan.rows.filter(x=>x.provider==='mega')) {
      const found=mega.find(c=>c.external_account_id.toLowerCase()===
        expected.profile.user.toLowerCase());
      if(!found||v.rows.filter(x=>x.connection_id===found.id&&
        x.provider==='mega'&&x.state==='active').length!==1)
        fail('EXISTING_MEGA_BASELINE_MISMATCH');
    }
    for(const c of drive) {
      const expected=plan.rows.find(x=>x.provider==='google-drive' &&
        x.displayName===c.display_name);
      const res=typeof c.resources==='string'?JSON.parse(c.resources):c.resources;
      if(!expected||!Array.isArray(res)||res.length!==1||
         res[0]?.kind!=='drive'||res[0]?.id!==expected.root||
         JSON.stringify(res[0]?.capabilities)!==JSON.stringify(['storage:list'])||
         JSON.stringify(typeof c.capabilities==='string'?JSON.parse(c.capabilities):c.capabilities)
           !==JSON.stringify(['storage:list'])||
         JSON.stringify(typeof c.provider_capabilities==='string'?
           JSON.parse(c.provider_capabilities):c.provider_capabilities)!=='[]')
        fail('EXISTING_DRIVE_PENDING_MISMATCH');
    }
    for(const entry of plan.rows.filter(x=>x.provider==='google-drive')) {
      const reuse=drive.find(c=>c.display_name===entry.displayName);
      const id=reuse?reuse.id:ids();
      if(typeof id!=='string'||
         !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
        fail('CONNECTION_ID_INVALID');
      if(!reuse) {
        const resources=[{kind:'drive',id:entry.root,capabilities:['storage:list']}];
        const inserted=await client.query(
          'INSERT INTO nyx_connector_connections '+
          '(id,owner_id,display_name,provider,external_account_id,capabilities,'+
          'provider_capabilities,resources,status) '+
          "VALUES($1,$2,$3,'google-drive','pending',$4::jsonb,'[]'::jsonb,$5::jsonb,'pending')",
          [id,plan.ownerId,entry.displayName,JSON.stringify(['storage:list']),
            JSON.stringify(resources)]);
        if(inserted.rowCount!==1)fail('DRIVE_METADATA_INSERT_FAILED');
      }
      const sealed=sealForTenant(plan.ownerId,id,entry.profile,key);
      const inserted=await client.query(
        'INSERT INTO nyx_rclone_tenant_credentials_v2 '+
        '(owner_id,connection_id,provider,encrypted_profile,state) '+
        "VALUES($1,$2,'google-drive',$3,'pending')",
        [plan.ownerId,id,sealed]);
      if(inserted.rowCount!==1)fail('DRIVE_VAULT_INSERT_FAILED');
    }
    const checked=await client.query(
      "SELECT count(*)::int AS n FROM nyx_rclone_tenant_credentials_v2 "+
      "WHERE owner_id=$1 AND provider='google-drive' AND state='pending'",
      [plan.ownerId]);
    if(Number(checked.rows?.[0]?.n)!==6)fail('SIX_DRIVE_STAGE_READBACK_FAILED');
    await client.query('COMMIT');began=false;
    return {status:'SIX_DRIVES_PENDING_EXISTING_MEGA_PRESERVED',count:6,megaModified:false};
  }catch {
    if(began)await client.query('ROLLBACK').catch(()=>{});
    fail('SIX_DRIVE_STAGE_ROLLED_BACK_OR_UNCERTAIN');
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
    // A read probe alone does not prove that two differently named remotes
    // represent distinct Google Drives. Require independently verified, unique
    // provider namespace attestations before any of the eight becomes active.
    const identities=await client.query(
      'SELECT connection_id,owner_id,provider,namespace,external_id '+
      'FROM nyx_storage_verified_identity_v1 WHERE owner_id=$1 FOR UPDATE',
      [plan.ownerId]);
    if(identities.rowCount!==8)fail('FINALIZE_IDENTITY_ATTESTATION_REQUIRED');
    const identityById=new Map(identities.rows.map(r=>[r.connection_id,r]));
    if(identityById.size!==8)fail('FINALIZE_IDENTITY_DUPLICATE');
    const namespaces=new Set();
    for(const attestation of identities.rows) {
      if(attestation.owner_id!==plan.ownerId ||
         typeof attestation.namespace!=='string' ||
         !/^(?:my-drive:|shared-drive:|mega-account:)/.test(attestation.namespace) ||
         typeof attestation.external_id!=='string' || !attestation.external_id)
        fail('FINALIZE_IDENTITY_UNVERIFIED');
      const key=attestation.provider+'|'+attestation.namespace;
      if(namespaces.has(key))fail('FINALIZE_DUPLICATE_PHYSICAL_DRIVE');
      namespaces.add(key);
    }
    const byName=new Map(plan.rows.map(r=>[r.displayName,r]));
    const byConnection=new Map(vault.rows.map(r=>[r.connection_id,r]));
    if(byConnection.size!==8)fail('FINALIZE_DUPLICATE');
    const epoch=now.getTime();
    if(!Number.isFinite(epoch))fail('FINALIZE_CLOCK_INVALID');
    for(const c of all.rows){
      const expected=byName.get(c.display_name);
      const candidate=byConnection.get(c.id);
      const proof=identityById.get(c.id);
      if(!proof || !expected || proof.provider!==expected.provider)
        fail('FINALIZE_IDENTITY_UNVERIFIED');
      if(expected.provider==='google-drive' && expected.profile.teamDriveId &&
         proof.namespace!=='shared-drive:'+expected.profile.teamDriveId)
        fail('FINALIZE_SHARED_DRIVE_ID_CHANGED');
      if(expected.provider==='mega' &&
         proof.namespace!=='mega-account:'+expected.profile.user.toLowerCase())
        fail('FINALIZE_MEGA_ACCOUNT_CHANGED');
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
           Boolean(profile.accountRoot)!==Boolean(expected.profile.accountRoot)||
           (profile.teamDriveId||'')!==(expected.profile.teamDriveId||''))
          fail('FINALIZE_CREDENTIAL_ROOT_MISMATCH');
      }else if(profile.verifiedRoot!==expected.root)
        fail('FINALIZE_MEGA_ROOT_NOT_VERIFIED');
    }
    // Store the independently attested account identity, not an alias or
    // synthetic placeholder. Only storage:list is initially granted.
    for(const c of all.rows){
      const update=await client.query(
        "UPDATE nyx_connector_connections SET status='active',"+
        " provider_capabilities='[\"storage:list\"]'::jsonb,"+
        " external_account_id=$3,updated_at=now() "+
        "WHERE owner_id=$1 AND id=$2 AND status='pending' "+
        "AND external_account_id='pending'",
        [plan.ownerId,c.id,identityById.get(c.id).external_id]);
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


/**
 * Promotes only six fresh, server-attested Google Drive imports. Existing MEGA
 * metadata, active credentials and any MEGA pending rotation are never changed.
 */
export async function finalizeSixWithExistingMega(db,plan,key,now=new Date()) {
  if(plan.rows.length!==8||plan.rows.filter(r=>r.provider==='mega').length!==2||
     plan.rows.filter(r=>r.provider==='google-drive').length!==6)
    fail('SIX_DRIVE_PLAN_REQUIRED');
  const client=await db.connect();
  let began=false;
  try {
    await client.query('BEGIN');began=true;
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))',
      ['nyx_owner_rclone_import_v1',plan.ownerId]);
    const all=await client.query(
      "SELECT id,display_name,provider,status,external_account_id,capabilities,"+
      "provider_capabilities,resources FROM nyx_connector_connections "+
      "WHERE owner_id=$1 AND provider IN ('google-drive','mega') FOR UPDATE",
      [plan.ownerId]);
    if(all.rowCount!==8)fail('FINALIZE_EXPECTED_TOTAL_EIGHT');
    const megas=all.rows.filter(x=>x.provider==='mega');
    const drives=all.rows.filter(x=>x.provider==='google-drive');
    if(megas.length!==2||drives.length!==6||
       megas.some(x=>x.status!=='active')||
       drives.some(x=>x.status!=='pending'||x.external_account_id!=='pending'))
      fail('FINALIZE_EXISTING_OWNER_CHANGED');
    const vault=await client.query(
      'SELECT connection_id,provider,state,encrypted_profile,read_verified_at '+
      'FROM nyx_rclone_tenant_credentials_v2 WHERE owner_id=$1 FOR UPDATE',
      [plan.ownerId]);
    for(const expected of plan.rows.filter(x=>x.provider==='mega')) {
      const found=megas.find(x=>x.external_account_id.toLowerCase()===
        expected.profile.user.toLowerCase());
      if(!found||vault.rows.filter(x=>x.connection_id===found.id&&
        x.provider==='mega'&&x.state==='active').length!==1)
        fail('FINALIZE_MEGA_BASELINE_CHANGED');
    }
    const identities=await client.query(
      'SELECT connection_id,owner_id,provider,namespace,external_id '+
      "FROM nyx_storage_verified_identity_v1 WHERE owner_id=$1 AND provider='google-drive' FOR UPDATE",
      [plan.ownerId]);
    if(identities.rowCount!==6)fail('FINALIZE_SIX_DRIVE_IDENTITIES_REQUIRED');
    const proofById=new Map(identities.rows.map(x=>[x.connection_id,x]));
    if(proofById.size!==6)fail('FINALIZE_DRIVE_IDENTITY_DUPLICATE');
    const namespaces=new Set();
    const byName=new Map(plan.rows.filter(x=>x.provider==='google-drive').map(x=>[x.displayName,x]));
    const epoch=now.getTime();
    if(!Number.isFinite(epoch))fail('FINALIZE_CLOCK_INVALID');
    for(const c of drives) {
      const expected=byName.get(c.display_name);
      const versions=vault.rows.filter(x=>x.connection_id===c.id&&
        x.provider==='google-drive');
      const record=versions.length===1&&versions[0].state==='pending'?versions[0]:null;
      const proof=proofById.get(c.id);
      if(!expected||!record||!proof||proof.owner_id!==plan.ownerId||
         proof.provider!=='google-drive'||!proof.external_id||
         typeof proof.namespace!=='string'||
         !(proof.namespace.startsWith('my-drive:')||
           proof.namespace.startsWith('shared-drive:'))||
         namespaces.has(proof.namespace))
        fail('FINALIZE_DRIVE_ATTESTATION_MISMATCH');
      namespaces.add(proof.namespace);
      if(expected.profile.teamDriveId) {
        if(proof.namespace!=='shared-drive:'+expected.profile.teamDriveId)
          fail('FINALIZE_SHARED_DRIVE_ID_CHANGED');
      }else if(!proof.namespace.startsWith('my-drive:'))
        fail('FINALIZE_GOOGLE_NAMESPACE_MISMATCH');
      const resources=typeof c.resources==='string'?JSON.parse(c.resources):c.resources;
      const capabilities=typeof c.capabilities==='string'?JSON.parse(c.capabilities):c.capabilities;
      const providerCaps=typeof c.provider_capabilities==='string'?
        JSON.parse(c.provider_capabilities):c.provider_capabilities;
      if(!Array.isArray(resources)||resources.length!==1||
         resources[0]?.kind!=='drive'||resources[0]?.id!==expected.root||
         JSON.stringify(resources[0]?.capabilities)!=='["storage:list"]'||
         JSON.stringify(capabilities)!=='["storage:list"]'||
         JSON.stringify(providerCaps)!=='[]')fail('FINALIZE_DRIVE_GRANTS_CHANGED');
      const probeAt=new Date(record.read_verified_at).getTime();
      if(!Number.isFinite(probeAt)||probeAt>epoch+30000||
         epoch-probeAt>15*60*1000)fail('FINALIZE_STALE_PROBE');
      const profile=openForTenant(plan.ownerId,c.id,'google-drive',record.encrypted_profile,key);
      if(profile.rootFolderId!==expected.root||!profile.token||
         Boolean(profile.accountRoot)!==Boolean(expected.profile.accountRoot)||
         (profile.teamDriveId||'')!==(expected.profile.teamDriveId||''))
        fail('FINALIZE_DRIVE_CREDENTIAL_MISMATCH');
    }
    for(const c of drives) {
      const proof=proofById.get(c.id);
      const update=await client.query(
        "UPDATE nyx_connector_connections SET status='active',"+
        "provider_capabilities='[\"storage:list\"]'::jsonb,"+
        "external_account_id=$3,updated_at=now() "+
        "WHERE owner_id=$1 AND id=$2 AND provider='google-drive' AND status='pending' "+
        "AND external_account_id='pending'",
        [plan.ownerId,c.id,proof.external_id]);
      if(update.rowCount!==1)fail('FINALIZE_DRIVE_METADATA_RACE');
      const updated=await client.query(
        "UPDATE nyx_rclone_tenant_credentials_v2 SET state='active',updated_at=now() "+
        "WHERE owner_id=$1 AND connection_id=$2 AND provider='google-drive' "+
        "AND state='pending' AND read_verified_at>now()-interval '15 minutes'",
        [plan.ownerId,c.id]);
      if(updated.rowCount!==1)fail('FINALIZE_DRIVE_VAULT_RACE');
    }
    await client.query('COMMIT');began=false;
    return {status:'SIX_DRIVES_ACTIVE_EXISTING_MEGA_PRESERVED',count:6,megaModified:false,
      writeGrants:false};
  }catch{
    if(began)await client.query('ROLLBACK').catch(()=>{});
    fail('FINALIZE_SIX_DRIVES_ROLLED_BACK_OR_UNCERTAIN');
  }finally{client.release();}
}

function argsOf(argv) {
  if(argv.length===0||argv.length===1&&argv[0]==='--inventory')
    return {mode:'inventory'};
  if(argv.length===3&&argv[0]==='--plan'&&argv[1]==='--manifest')
    return {mode:'plan',manifest:argv[2]};
  if(argv.length===4&&['--stage','--finalize','--stage-six','--finalize-six'].includes(argv[0])&&argv[1]==='--manifest')
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
  const confirmation={stage:'STAGE_EIGHT_PENDING',finalize:'ACTIVATE_EIGHT_VERIFIED',
    'stage-six':'STAGE_SIX_DRIVES_PENDING','finalize-six':'ACTIVATE_SIX_DRIVES_VERIFIED'};
  if(options.confirmation!==confirmation[options.mode])
    fail('EXPLICIT_CONFIRMATION_REQUIRED');
  if(process.env.NYX_IMPORT_APPROVED_OWNER!==plan.ownerId)
    fail('OWNER_ATTESTATION_REQUIRED');
  const app=appEnvironment(options.mode);
  const {Pool}=await import('pg');
  const db=new Pool({connectionString:app.url,max:1,connectionTimeoutMillis:5000,
    statement_timeout:15000});
  try{
    const result=options.mode==='stage'?await stageWithDb(db,plan,app.key):
      options.mode==='finalize'?await finalizeReadVerified(db,plan,app.key):
      options.mode==='stage-six'?await stageSixWithExistingMega(db,plan,app.key):
      await finalizeSixWithExistingMega(db,plan,app.key);
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
