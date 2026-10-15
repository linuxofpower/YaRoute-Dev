const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');

const root=(...parts)=>readFileSync(join(__dirname,'..',...parts),'utf8');

test('Procfile defines web and dedicated HeartBit process types',()=>{
 const proc=root('Procfile');
 assert.match(proc,/^web: npm run start:prod$/m);
 assert.match(proc,/^heartbit: npm run start:heartbit$/m);
 const pkg=JSON.parse(root('package.json'));
 assert.equal(pkg.scripts['start:heartbit'],'node dist/heartbit.js');
});

test('HeartBit runner is a non-HTTP durable canonical-authority loop',()=>{
 const entry=root('src','heartbit.ts');
 const runner=root('src','heartbit','heartbit-runner.service.ts');
 const store=root('src','heartbit','heartbit-store.service.ts');
 assert.match(entry,/createApplicationContext\(HeartbitRunnerModule/);
 assert.doesNotMatch(entry,/\.listen\(/);
 assert.match(entry,/NYX_PROCESS_ROLE.*heartbit/);
 assert.match(runner,/this\.bootstrap\.locate\(\)/);
 assert.match(runner,/this\.cliRegistry\.current\(locator\)/);
 assert.match(runner,/observeSlot\(slot\)/);
 assert.match(runner,/claimSlot\(slot/);
 assert.match(runner,/completeSlot\(/);
 assert.match(runner,/failSlot\(/);
 assert.match(store,/DATABASE_URL_REQUIRED_FOR_HEARTBIT/);
 assert.match(store,/pg_advisory_xact_lock/);
 assert.match(store,/generate_series/);
 assert.match(store,/'missed'/);
});

test('HeartBit hour slots are stable and UTC-hour aligned',()=>{
 const {heartbitSlot}=require('../dist/heartbit/heartbit-runner.service.js');
 assert.equal(
   heartbitSlot(new Date('2026-10-15T10:59:59.999Z')).toISOString(),
   '2026-10-15T10:00:00.000Z',
 );
 assert.equal(
   heartbitSlot(new Date('2026-10-15T11:00:00.000Z')).toISOString(),
   '2026-10-15T11:00:00.000Z',
 );
});

test('HeartBit dyno cannot claim or recover legacy storage jobs',()=>{
 const worker=root('src','storage','job-worker.service.ts');
 const store=root('src','storage','job-store.service.ts');
 assert.match(worker,/NYX_PROCESS_ROLE === 'heartbit'\) return/);
 assert.match(store,/NYX_PROCESS_ROLE !== 'heartbit'/);
});

test('HeartBit status stays private in MCP and protected in REST',()=>{
 const mcp=root('src','mcp','mcp.service.ts');
 const privateGate=mcp.indexOf("if (process.env.NYX_DEPLOYMENT_MODE==='public') return server;");
 const tool=mcp.indexOf("server.registerTool('nyx_heartbit_status'");
 assert.ok(privateGate>0);
 assert.ok(tool>privateGate);
 assert.match(mcp.slice(tool,tool+900),/readOnlyHint:true/);
 const controller=root('src','heartbit','heartbit.controller.ts');
 assert.match(controller,/@Controller\('heartbit'\)/);
 assert.match(controller,/@Get\('status'\)/);
});
