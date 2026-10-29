const {test}=require('node:test');
const assert=require('node:assert/strict');
const {NyxExecutionProfileService}=require('../dist/nyx/execution-profile.service');
const {sha256}=require('../dist/nyx/resource-store.service');
const ref=path=>({area:'MAIN',path});
const cli={schema:'nyx.yarocli.v1',version:'test',commands:{}};
const cliHash=sha256(JSON.stringify(cli));
function fixture(){
 const files=new Map();
 const profile={schema:'nyx.runtime-profile.v1',authority:'user-authorized-runtime-configuration',
  cliSha256:cliHash,commands:{},keySources:[
   {key:'temp_paths',ref:ref('paths'),sha256:sha256('original')},
   {key:'temp_nyxcli',ref:ref('nyxcli'),sha256:sha256('original')},
  ]};
 files.set('profile',JSON.stringify(profile));
 files.set('paths','private changed text');
 const service=new NyxExecutionProfileService({read:async r=>{
  if(!files.has(r.path))throw Error('private provider error');
  return files.get(r.path);
 }});
 return {service,files,locator:{executionProfile:ref('profile')}};
}
test('diagnostics report every mismatched or unavailable pin without source contents',async()=>{
 const {service,locator}=fixture();
 const result=await service.inspect(locator,cliHash);
 assert.equal(result.ready,false);
 assert.deepEqual(result.keys.map(k=>[k.key,k.status]),[
  ['temp_paths','changed'],['temp_nyxcli','unavailable'],
 ]);
 assert.equal(result.keys[0].actual,sha256('private changed text'));
 assert.doesNotMatch(JSON.stringify(result),/private changed text|private provider error/);
 // Inspection does not reconcile or bypass the execution check.
 await assert.rejects(()=>service.apply(locator,cli,cliHash),/KEY_PREFLIGHT_CHANGED_REQUIRES_CHATGPT:temp_paths/);
});
test('matching pins permit preflight but a stale CLI fingerprint still blocks it',async()=>{
 const {service,files,locator}=fixture();
 files.set('paths','original');files.set('nyxcli','original');
 assert.equal((await service.inspect(locator,cliHash)).ready,true);
 const stale=await service.inspect(locator,'0'.repeat(64));
 assert.equal(stale.ready,false);assert.equal(stale.authorityMatches,false);
});
test('invalid profile returns bounded diagnostics and execution remains fail-closed',async()=>{
 const {service,files,locator}=fixture();
 files.set('profile','not JSON');
 assert.equal((await service.inspect(locator,cliHash)).error,'EXECUTION_PROFILE_INVALID_OR_UNAVAILABLE');
 await assert.rejects(()=>service.apply(locator,cli,cliHash),/EXECUTION_PROFILE_INVALID_OR_UNAVAILABLE/);
});
