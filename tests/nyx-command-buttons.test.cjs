const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const panel=fs.readFileSync(path.join(__dirname,'../src/connectors/connections-panel.ts'),'utf8');

function classify(command,cliSha='a'.repeat(64)){
 const start=panel.indexOf('function commandHealthTone(command,cliSha){');
 const end=panel.indexOf('function renderCommandButtons(data){',start);
 assert.ok(start>=0&&end>start,'command health function exists');
 const fn=vm.runInNewContext('('+panel.slice(start,end).trim()+')');
 return fn(command,cliSha);
}
const bound=(health)=>({name:'ini',status:'runtime-contract-available',executable:true,health});
const receipt=(name)=>({name,status:'COMPLETE',sha256:'b'.repeat(64)});
const health=(required,verified)=>({
 schema:'nyx.command.verification.v1',cli_sha256:'a'.repeat(64),
 required_variations:required,verified_variations:verified,
});

test('panel shows one compact button per canonical command with status colors',()=>{
 assert.match(panel,/nyx-command-health/);
 assert.match(panel,/id="nyx-command-buttons"/);
 assert.match(panel,/id="nyx-command-refresh"/);
 assert.match(panel,/\.nyx-command-gray\{/);
 assert.match(panel,/\.nyx-command-yellow\{/);
 assert.match(panel,/\.nyx-command-green\{/);
 assert.match(panel,/call\('nyx_help',\{\}\)/);
 assert.match(panel,/data\.commands/);
 assert.match(panel,/data\.metadata\.cli\.sha256/);
 assert.doesNotMatch(panel,/call\('nyx_execute'/);
 assert.doesNotMatch(panel,/call\('nyx_ini'/);
});

test('gray only denotes Head-only/no executable command contract',()=>{
 assert.equal(classify({name:'key',status:'canonical-only',executable:false}),'gray');
 assert.equal(classify({name:'ini',status:'canonical-only',executable:true}),'gray');
});

test('yellow denotes missing, incomplete, problematic, or stale variation evidence',()=>{
 assert.equal(classify(bound()),'yellow');
 assert.equal(classify(bound(health(['oLB','oGN'],[receipt('oLB')]))),'yellow');
 assert.equal(classify(bound({...health(['oLB'],[receipt('oLB')]),issues:['read failed']})),'yellow');
 assert.equal(classify(bound({...health(['oLB'],[receipt('oLB')]),cli_sha256:'c'.repeat(64)})),'yellow');
 assert.equal(classify(bound(health([],[]))),'yellow');
 assert.equal(classify(bound(health(['oLB','oLB'],[receipt('oLB'),receipt('oLB')]))),'yellow');
 assert.equal(classify(bound(health(['oLB','oGN'],[receipt('oLB'),receipt('oLB')]))),'yellow');
 assert.equal(classify(bound(health(['oLB'],[{name:'oLB',status:'COMPLETE',sha256:'bad'}]))),'yellow');
 assert.equal(classify(bound(health(['oLB'],[{name:'oLB',status:'FAILED',sha256:'b'.repeat(64)}]))),'yellow');
});

test('green requires COMPLETE hashed receipts for every distinct required variation',()=>{
 assert.equal(classify(bound(health(['oLB','oGN'],[receipt('oLB'),receipt('oGN')]))),'green');
 assert.equal(classify(bound(health(['hel'],[receipt('hel')]))),'green');
});

test('panel stays informational even when commands are clickable',()=>{
 assert.match(panel,/Buttons inspect status only; they never execute commands/);
 assert.match(panel,/b\.addEventListener\('click',\(\)=>\{commandNote\.textContent=/);
 assert.match(panel,/Command health unavailable/);
 assert.match(panel,/Invalid Nyx command inventory/);
 assert.doesNotMatch(panel,/innerHTML\s*=/);
});
