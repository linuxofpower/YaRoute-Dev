const {test}=require('node:test');
const assert=require('node:assert/strict');
const SHA='a'.repeat(40),DST='b'.repeat(40),C='c'.repeat(40);
const blob=(path,sha)=>({path,sha,type:'blob'});
let m;
test('load staging module without making network requests',async()=>{
 m=await import('../scripts/nyx-tester-stage.mjs');
 assert.equal(typeof m.candidatePaths,'function');
});
test('candidate preserves target-owned configuration, workflows and regression tests',()=>{
 const source={truncated:false,tree:[
  blob('src/mcp/mcp.service.ts',SHA),blob('tests/tenant-rclone-auth.test.cjs',SHA),
  blob('tests/github-api-writes.test.cjs',SHA),blob('tests/nyx-bot-master-release.test.cjs',SHA),blob('tests/nyx-tester-stage.test.cjs',SHA),blob('tests/nyx-tester-auto-merge.test.cjs',SHA),blob('tests/branding.test.cjs',SHA),
  blob('tests/nyx-reviewed-profile-migration.test.cjs',SHA),
  blob('tests/nyx-dev-public-plan.test.mjs',SHA),
  blob('tests/nyx-termux-public-cutover.test.mjs',SHA),
  blob('tests/nyx-termux-dev-preflight-capture.test.mjs',SHA),
  blob('tests/nyx-dev-deployment-guard.test.mjs',SHA),
  blob('tests/nyx-heroku-git-divergence.test.mjs',SHA),
  blob('scripts/install-rclone.mjs',SHA),blob('app.json',SHA),
  blob('.github/workflows/ci.yml',SHA),blob('config/nyx-runtime-profile.json',SHA)]};
 const target={truncated:false,tree:[
  blob('src/mcp/mcp.service.ts',DST),blob('tests/github-api-writes.test.cjs',DST)]};
 const p=m.candidatePaths(source,target);
 assert.deepEqual(p.map(x=>x.path),['src/mcp/mcp.service.ts','tests/tenant-rclone-auth.test.cjs']);
 assert.equal(p[0].targetBlob,DST);
 assert.equal(p[1].targetBlob,null);
});
test('all refs and candidate inputs are SHA-pinned and never permit target-owned paths',()=>{
 const input={sourceSha:SHA,testerSha:DST,sourceRef:SHA,testerRef:DST,masterRef:C,
  paths:[{path:'src/main.ts'}]};
 assert.equal(m.validateCandidate(input),true);
 assert.throws(()=>m.validateCandidate({...input,testerRef:SHA}),/BRANCH_MOVED/);
 assert.throws(()=>m.validateCandidate({...input,paths:[{path:'app.json'}]}),/TARGET_OWNED_FILE/);
 assert.throws(()=>m.validateCandidate({...input,paths:[]}),/FILES_INVALID/);
});
test('reviewed MCP adapter preserves short generic working branches and special staging tools',()=>{
 const handler=(name)=>"server.registerTool('"+name+"',{title:'Create a NYX GitHub review branch',description:'Review nyx/* branches',inputSchema:z.object({branch:z.string().min(5).max(100)}),annotations:{}});\n";
 const src=handler('nyx_connection_github_branch_create')+
   handler('nyx_connection_github_commit_file')+
   handler('nyx_connection_github_draft_pr')+
   handler('nyx_connection_github_issue_create');
 const result=m.adaptMcpForTester(src);
 assert.equal((result.match(/branch:z\.string\(\)\.min\(1\)\.max\(100\)/g)||[]).length,3);
 assert.equal((result.match(/branch:z\.string\(\)\.min\(5\)\.max\(100\)/g)||[]).length,1);
 assert.equal(result.slice(0,result.indexOf("server.registerTool('nyx_connection_github_issue_create'")).includes('nyx/*'),false);
 assert.match(result,/main\/master\/default/);
});
test('incomplete tree or unexpected schema stops planning',()=>{
 assert.throws(()=>m.candidatePaths({truncated:true,tree:[]},{truncated:false,tree:[]}),/TRUNCATED_TREE/);
 assert.throws(()=>m.adaptMcpForTester('some untrusted code'),/MCP_SOURCE_INVALID/);
});

test('promotion refuses silently omitted runtime authority/profile drift',async()=>{
 const {assertRuntimeProfileParity}=await import('../scripts/nyx-tester-stage.mjs');
 const tree=sha=>({truncated:false,tree:sha?[{type:'blob',path:'config/nyx-runtime-profile.json',sha}]:[]});
 assert.doesNotThrow(()=>assertRuntimeProfileParity(tree('a'.repeat(40)),tree('a'.repeat(40))));
 for(const target of [tree('b'.repeat(40)),tree(null)]) {
  assert.throws(()=>assertRuntimeProfileParity(tree('a'.repeat(40)),target),/RUNTIME_PROFILE_RECONCILIATION_REQUIRED/);
 }
 assert.throws(()=>assertRuntimeProfileParity({truncated:true,tree:[]},tree('a'.repeat(40))),/TRUNCATED_TREE/);
});

test('workflow-only commits must exit as successful no-op instead of creating an empty Tester PR',()=>{
 assert.equal(m.stageRequired([],null),false);
 assert.equal(m.stageRequired([],''),false);
 assert.equal(m.stageRequired([{path:'src/x.ts'}],null),true);
 assert.equal(m.stageRequired([],JSON.stringify({mode:'observe'})),true);
});

test('normalized source identical to Tester tree is a no-op, even with a differing source blob',()=>{
 const a='a'.repeat(40),b='b'.repeat(40);
 assert.equal(m.hasEffectiveTreeChange(a,a),false);
 assert.equal(m.hasEffectiveTreeChange(a,b),true);
 assert.throws(()=>m.hasEffectiveTreeChange('not-sha',b),/STAGING_TREE_INVALID/);
});


test('public activation preflight runtime and tests stage together; Dev script stays target-owned',()=>{
 const src={truncated:false,tree:[
   blob('src/runtime/public-mega-activation-preflight.ts',SHA),
   blob('tests/public-mega-activation-preflight.test.cjs',SHA),
   blob('scripts/nyx-public-mega-activation-preflight.mjs',SHA),
 ]};
 const dst={truncated:false,tree:[]};
 assert.deepEqual(m.candidatePaths(src,dst).map(x=>x.path),[
   'src/runtime/public-mega-activation-preflight.ts',
   'tests/public-mega-activation-preflight.test.cjs',
 ]);
});


test('one-time stale Tester test cleanup is SHA pinned and never deletes changed files',()=>{
 const path='tests/nyx-dev-public-plan.test.mjs';
 const expected='facb3c3eb418dc7a7ad40820e1a7492f7fe39a9a';
 const target=(sha)=>({truncated:false,tree:sha?[{path,type:'blob',sha}]:[]});
 assert.deepEqual(m.staleDevOnlyTesterCleanup(target(expected)),[{path,sourceBlob:null,targetBlob:expected}]);
 assert.deepEqual(m.staleDevOnlyTesterCleanup(target(null)),[]);
 assert.throws(()=>m.staleDevOnlyTesterCleanup(target(SHA)),/OBSOLETE_TESTER_FILE_CHANGED_REVIEW_REQUIRED/);
 assert.throws(()=>m.staleDevOnlyTesterCleanup({truncated:true,tree:[]}),/TRUNCATED_TREE/);
 assert.equal(m.stageRequired(m.staleDevOnlyTesterCleanup(target(expected)),null),true);
});


test('stage only the two approved blue icons, not Pro purple or arbitrary public files',()=>{
 const src={truncated:false,tree:[
  blob('public/branding/icon.png',SHA),
  blob('public/branding/nestnyx-dev.png',SHA),
  blob('public/branding/nestnyx-prod.png',SHA),
  blob('public/readme.html',SHA),
  blob('src/branding.controller.ts',SHA),
  blob('tests/branding-runtime.test.cjs',SHA),
 ]};
 const dst={truncated:false,tree:[]};
 assert.deepEqual(m.candidatePaths(src,dst).map(x=>x.path),[
  'public/branding/icon.png','public/branding/nestnyx-dev.png',
  'src/branding.controller.ts','tests/branding-runtime.test.cjs'
 ]);
});

test('target-owned tester module gains only exact branding import and controller',()=>{
 const dev=String.raw`import { HealthController } from './health.controller';
import { BrandingController } from './branding.controller';
controllers: [HealthController, BrandingController]`;
 const original=String.raw`import { HealthController } from './health.controller';
import { PersistentService } from './persistent.service';
controllers: [HealthController],
providers: [PersistentService]`;
 const changed=m.adaptTesterAppBranding(dev,original);
 assert.match(changed,/import \{ BrandingController \}/);
 assert.match(changed,/controllers: \[HealthController, BrandingController\]/);
 assert.match(changed,/providers: \[PersistentService\]/);
 assert.equal(m.adaptTesterAppBranding(dev,changed),null);
 assert.throws(()=>m.adaptTesterAppBranding(dev,'controllers: [HealthController, OtherController],'),/TESTER_MODULE_BRANDING_REVIEW_REQUIRED/);
 assert.throws(()=>m.adaptTesterAppBranding('',original),/DEV_BRANDING_MODULE_NOT_READY/);
});
