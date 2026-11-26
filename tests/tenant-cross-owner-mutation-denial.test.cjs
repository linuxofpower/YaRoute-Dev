const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TenantRcloneService } = require('../dist/connectors/tenant-rclone.service');

// Synthetic-only regression checks. Never instantiate the DB, OAuth server or
// rclone process and never touch an actual cloud object.
const OWNERS = [
  { owner:'oauth:google-oauth2|synthetic-alice', foreign:'oauth:google-oauth2|synthetic-bob',
    connection:'12345678-1234-4234-8234-123456789abc' },
  { owner:'oauth:google-oauth2|synthetic-bob', foreign:'oauth:google-oauth2|synthetic-alice',
    connection:'12345678-1234-4234-8234-123456789abd' },
];
const flags = [
  'NYX_DEPLOYMENT_MODE', 'NYX_PUBLIC_CONNECTORS_ENABLED',
  'NYX_MULTIUSER_RCLONE_ENABLED', 'NYX_PUBLIC_GOOGLE_WRITE_ENABLED',
  'NYX_PUBLIC_MEGA_WRITE_ENABLED', 'NYX_PUBLIC_TRASH_CLEANUP_ENABLED',
];
const originals = Object.fromEntries(flags.map(k => [k, process.env[k]]));
for (const k of flags) {
  process.env[k] = k === 'NYX_DEPLOYMENT_MODE' ? 'public' : 'true';
}
process.on('exit', () => {
  for (const k of flags) {
    if (originals[k] === undefined) delete process.env[k];
    else process.env[k] = originals[k];
  }
});

function guardedService(owner, connectionId, provider, rootId) {
  const calls={policy:[], downstream:0, database:0, getOwned:0};
  const kind = provider === 'mega' ? 'mega-root' : 'drive';
  const conn = {id:connectionId, ownerId:owner, provider, status:'active'};
  const connectors={
    getOwned:async(actor,id)=>{
      calls.getOwned++;
      if(actor!==owner || id!==connectionId)throw Error('TENANT_RCLONE_CONNECTION_FORBIDDEN');
      return conn;
    },
    registryPolicy:()=>({
      requireResource:async(actor,id,capability,resource)=>{
        calls.policy.push({actor,id,capability,resource});
        if(actor!==owner || id!==connectionId)throw Error('TENANT_RCLONE_CONNECTION_FORBIDDEN');
        if(resource?.kind!==kind || resource?.id!==rootId)
          throw Error('RESOURCE_DENIED');
        return conn;
      },
    }),
  };
  const service=new TenantRcloneService(connectors);
  service.authorizedTarget=async()=>{
    calls.downstream++;
    throw Error('PROVIDER_STAGE_SPY_REACHED');
  };
  service.db=()=>{
    calls.database++;
    throw Error('DATABASE_STAGE_SPY_REACHED');
  };
  return {service,calls};
}

const scenarios=[
  {
    name:'MEGA rename',provider:'mega',root:'MEGA_ROOT',capability:'storage:move',
    invoke:(s,o,c,r)=>s.mutateMegaFile(o,c,r,'rename','notes.txt','notes-renamed.txt'),
  },
  {
    name:'MEGA move',provider:'mega',root:'MEGA_ROOT',capability:'storage:move',
    invoke:(s,o,c,r)=>s.mutateMegaFile(o,c,r,'move','notes.txt','folder/notes.txt'),
  },
  {
    name:'MEGA trash',provider:'mega',root:'MEGA_ROOT',capability:'storage:delete',
    invoke:(s,o,c,r)=>s.mutateMegaFile(o,c,r,'trash','notes.txt'),
  },
  {
    name:'Google rename',provider:'google-drive',root:'root',capability:'storage:move',
    invoke:(s,o,c,r)=>s.mutateGoogleFile(o,c,r,'rename','notes.txt','notes-renamed.txt'),
  },
  {
    name:'Google move',provider:'google-drive',root:'root',capability:'storage:move',
    invoke:(s,o,c,r)=>s.mutateGoogleFile(o,c,r,'move','notes.txt','folder/notes.txt'),
  },
  {
    name:'Google trash',provider:'google-drive',root:'root',capability:'storage:delete',
    invoke:(s,o,c,r)=>s.mutateGoogleFile(o,c,r,'trash','notes.txt'),
  },
  {
    name:'MEGA create',provider:'mega',root:'MEGA_ROOT',capability:'storage:write',
    invoke:(s,o,c,r)=>s.createTenantTextFile(o,c,'mega',r,'dummy-new.txt','fixture only'),
  },
  {
    name:'Google create',provider:'google-drive',root:'root',capability:'storage:write',
    invoke:(s,o,c,r)=>s.createTenantTextFile(o,c,'google-drive',r,'dummy-new.txt','fixture only'),
  },
  {
    name:'MEGA permanent cleanup',provider:'mega',root:'MEGA_ROOT',capability:'storage:delete',
    invoke:(s,o,c,r)=>s.cleanupTenantTrash(o,c,'mega',r,true),
  },
  {
    name:'Google permanent cleanup',provider:'google-drive',root:'root',capability:'storage:delete',
    invoke:(s,o,c,r)=>s.cleanupTenantTrash(o,c,'google-drive',r,true),
  },
];

for (const {owner,foreign,connection} of OWNERS) {
  for (const scenario of scenarios) {
    test(scenario.name+' rejects foreign tenant '+foreign+' before provider/database access',async()=>{
      const {service,calls}=guardedService(owner,connection,scenario.provider,scenario.root);
      await assert.rejects(
        ()=>scenario.invoke(service,foreign,connection,scenario.root),
        /TENANT_RCLONE_CONNECTION_FORBIDDEN/);
      assert.equal(calls.policy.length,1);
      assert.equal(calls.policy[0].capability,scenario.capability);
      assert.equal(calls.policy[0].actor,foreign);
      assert.equal(calls.downstream,0);
      assert.equal(calls.database,0);
    });
  }
}

test('authorized synthetic owner reaches its provider preflight spy (positive control)',async()=>{
  for (const scenario of scenarios) {
    const {owner,connection}=OWNERS[0];
    const {service,calls}=guardedService(owner,connection,scenario.provider,scenario.root);
    await assert.rejects(
      ()=>scenario.invoke(service,owner,connection,scenario.root),
      /PROVIDER_STAGE_SPY_REACHED/);
    assert.equal(calls.policy[0].capability,scenario.capability);
    assert.equal(calls.downstream,1);
    assert.equal(calls.database,0);
  }
});

test('private-mode rollback blocks every public mutation before ownership/provider access',async()=>{
  const previous=process.env.NYX_DEPLOYMENT_MODE;
  process.env.NYX_DEPLOYMENT_MODE='private';
  try {
    const {owner,connection}=OWNERS[0];
    for(const scenario of scenarios) {
      const {service,calls}=guardedService(owner,connection,scenario.provider,scenario.root);
      await assert.rejects(
        ()=>scenario.invoke(service,owner,connection,scenario.root),
        /DISABLED/);
      assert.equal(calls.policy.length,0);
      assert.equal(calls.downstream,0);
      assert.equal(calls.database,0);
    }
  } finally { process.env.NYX_DEPLOYMENT_MODE=previous; }
});
