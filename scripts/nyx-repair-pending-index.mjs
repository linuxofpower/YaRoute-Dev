#!/usr/bin/env node
/**
 * One-time, explicitly confirmed Neon Dev repair.
 * A previous index made external_account_id='pending' unique within a
 * provider, preventing a second MEGA or Google Drive pending connection.
 * Only active, independently verified external account IDs must be unique.
 *
 * Run in the Heroku Dev app with its existing DATABASE_URL. No connection
 * string, password, or credential is printed or embedded in argv.
 */
import pg from 'pg';
import readline from 'node:readline/promises';

const name='nyx_rclone_owner_remote_uq';
const expectedHost=/^ep-summer-fire-b9obdo3n(?:-pooler)?\.c-7\.eu-central-1\.aws\.neon\.tech$/;

export function classifyIndex(indexdef) {
  if(indexdef===null || indexdef===undefined)return 'missing';
  if(typeof indexdef!=='string' ||
     !/^CREATE UNIQUE INDEX nyx_rclone_owner_remote_uq ON (?:public\.)?nyx_connector_connections USING btree \(owner_id, provider, external_account_id\) WHERE/.test(indexdef))
    return 'unexpected';
  if(/\bstatus\s*<>\s*'revoked'/.test(indexdef))return 'legacy';
  if(/\bstatus\s*=\s*'active'/.test(indexdef))return 'active_only';
  return 'unexpected';
}

async function current(client){
  const r=await client.query(
    'SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND tablename=$2 AND indexname=$3',
    ['public','nyx_connector_connections',name]);
  if(r.rowCount>1)throw Error('UNEXPECTED_INDEX_COUNT');
  return classifyIndex(r.rows[0]?.indexdef);
}
async function main(argv){
  if(argv.length>1 || (argv[0] && !['--check','--apply'].includes(argv[0])))
    throw Error('USAGE: --check or --apply');
  const mode=argv[0]||'--check';
  if(!process.env.DATABASE_URL)throw Error('DATABASE_URL_REQUIRED');
  let host;
  try{host=new URL(process.env.DATABASE_URL).hostname;}catch{throw Error('DATABASE_URL_INVALID');}
  if(!expectedHost.test(host))throw Error('NEON_DEV_HOST_MISMATCH');
  if(process.env.NYX_DEPLOYMENT_MODE!=='public' ||
     process.env.NYX_MULTIUSER_RCLONE_ENABLED!=='true')
    throw Error('DEV_TENANT_RUNTIME_REQUIRED');

  const client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:8000,statement_timeout:15000});
  await client.connect();
  let began=false;
  try{
    const before=await current(client);
    const duplicates=await client.query(
      "SELECT provider,external_account_id,count(*)::int AS n FROM nyx_connector_connections "+
      "WHERE provider IN ('mega','google-drive') AND status='active' "+
      "GROUP BY provider,external_account_id HAVING count(*)>1 LIMIT 1");
    if(duplicates.rowCount)throw Error('ACTIVE_EXTERNAL_ACCOUNT_DUPLICATE');
    console.log('DEV_PENDING_INDEX_STATE: '+before);
    if(before==='unexpected')throw Error('UNEXPECTED_INDEX_DEFINITION');
    if(mode==='--check'){
      console.log('CHECK_COMPLETE: no database mutations');
      return;
    }
    if(before==='active_only'){
      console.log('ALREADY_REPAIRED: no database mutations');
      return;
    }
    if(!process.stdin.isTTY)throw Error('INTERACTIVE_TTY_REQUIRED');
    const prompts=readline.createInterface({input:process.stdin,output:process.stdout});
    let answer;
    try{answer=await prompts.question('Type REPAIR DEV PENDING INDEX to change only this Dev index: ');}
    finally{prompts.close();}
    if(answer.trim()!=='REPAIR DEV PENDING INDEX')throw Error('CONFIRMATION_NOT_GIVEN');
    await client.query('BEGIN');began=true;
    await client.query("SET LOCAL lock_timeout='10s'");
    await client.query('LOCK TABLE nyx_connector_connections IN SHARE ROW EXCLUSIVE MODE');
    const locked=await current(client);
    if(locked!==before)throw Error('INDEX_STATE_CHANGED_RETRY');
    if(locked==='legacy')await client.query('DROP INDEX public.nyx_rclone_owner_remote_uq');
    await client.query(
      "CREATE UNIQUE INDEX nyx_rclone_owner_remote_uq "+
      "ON nyx_connector_connections(owner_id,provider,external_account_id) "+
      "WHERE provider IN ('google-drive','mega') AND status='active'");
    if(await current(client)!=='active_only')throw Error('INDEX_POSTCHECK_FAILED');
    await client.query('COMMIT');began=false;
    console.log('DEV_PENDING_INDEX_REPAIRED: active identities unique; multiple pending remotes allowed');
  }catch(e){
    if(began)await client.query('ROLLBACK').catch(()=>{});
    throw e;
  }finally{await client.end();}
}

if(process.argv[1]?.endsWith('nyx-repair-pending-index.mjs')){
  main(process.argv.slice(2)).catch(e=>{
    console.error('REPAIR_STOPPED: '+(e?.message||'UNKNOWN_ERROR'));
    process.exitCode=1;
  });
}
