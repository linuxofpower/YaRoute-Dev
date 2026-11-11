// NYX guarded Dev -> Tester candidate builder. Creates a CI-gated draft PR.
// Credentials are supplied by the runner from a repository-scoped GitHub App.
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {appendFileSync} from 'node:fs';
import {reconcileObservedDraftProfile} from './nyx-runtime-draft-profile.mjs';
import {reconcileReviewedProfileMigration,reviewedProfileBlobs} from './nyx-reviewed-profile-migration.mjs';
const SHA=/^[a-f0-9]{40}$/,REPO=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const fail=x=>{throw Error('NYX_TESTER_STAGE_'+x)};
const TARGET='yaMorozYaroslav/YaRoute';
const IGNORE=new Set([
 'src/app.module.ts',
 'tests/branding.test.cjs','tests/devpronestnyx-stage.test.cjs',
 'tests/nyx-promotion-pipeline.test.cjs','tests/nyx-tester-stage.test.cjs',
 'tests/github-api-writes.test.cjs',
  // This test imports Dev-only release script, never copied to Tester.
  'tests/nyx-bot-master-release.test.cjs',
 // Imports the Dev-only reviewed migration helper; never ship this test to Tester.
 'tests/nyx-reviewed-profile-migration.test.cjs',
 // Dev-only offline audit planner is intentionally excluded from Tester.
 'tests/nyx-dev-public-plan.test.mjs',
 // Dev-only Heroku operator cutover test must not stage without its script.
 'tests/nyx-termux-public-cutover.test.mjs',
 // Dev-only Heroku preflight uploader must not stage without its script.
 'tests/nyx-termux-dev-preflight-capture.test.mjs',
 // Dev operator-only deployed release probe must not stage without its script.
 'tests/nyx-dev-deployment-guard.test.mjs',
 // Dev-only Git deployment history diagnostic must not promote without its script.
 'tests/nyx-heroku-git-divergence.test.mjs',
]);
// Only explicitly approved blue Dev/Tester assets may cross the binary stage.
const TESTER_BLUE_BRANDING=new Set(['public/branding/icon.png','public/branding/nestnyx-dev.png']);
// The MCP registry grew beyond the old 64 KiB textual staging cap. Raise
// only its text limit, while keeping every other path at the original bound.
export const maxTesterSourceBlobBytes=(path)=>path==='src/mcp/mcp.service.ts'?98304:65536;
const NO_COPY=/^(\.github\/|app\.json$|Procfile$|README\.md$|config\/|scripts\/|docs\/|public\/|broker\/|package(?:-lock)?\.json$)/;
/** Runtime profiles are target-owned, but silently omitting drift can deploy
 * code with obsolete authority/key pins. Reconcile through a reviewed PR first. */
export function assertRuntimeProfileParity(source,target){
 if(source.truncated!==false||target.truncated!==false)fail('TRUNCATED_TREE');
 const profile=tree=>tree.tree?.find(x=>x.type==='blob'&&x.path==='config/nyx-runtime-profile.json')?.sha;
 const a=profile(source),b=profile(target);
 if(!SHA.test(a??'')||!SHA.test(b??'')||a!==b)
  fail('RUNTIME_PROFILE_RECONCILIATION_REQUIRED');
}
export function candidatePaths(source,target){
 const a=new Map(source.tree?.filter(x=>x.type==='blob').map(x=>[x.path,x.sha])??[]);
 const b=new Map(target.tree?.filter(x=>x.type==='blob').map(x=>[x.path,x.sha])??[]);
 if(source.truncated!==false||target.truncated!==false)fail('TRUNCATED_TREE');
 return [...a.entries()].filter(([p,sha])=>
  (p.startsWith('src/')||p.startsWith('tests/')||TESTER_BLUE_BRANDING.has(p))&&
  !IGNORE.has(p)&&!(p.startsWith('tests/nyx-tester-')&&p.endsWith('.test.cjs'))&&
  (!NO_COPY.test(p)||TESTER_BLUE_BRANDING.has(p))&&
  /^[A-Za-z0-9._/-]+$/.test(p)&&
  !p.includes('..')&&
  SHA.test(sha)&&b.get(p)!==sha
 ).map(([path,sourceBlob])=>({path,sourceBlob,targetBlob:b.get(path)??null}));
}
/** The Tester app module is target-owned. Add ONLY the reviewed blue
 * branding route registration, preserving every unrelated provider/import. */
export function adaptTesterAppBranding(source,target){
 if(typeof source!=='string'||!source.includes("import { BrandingController } from './branding.controller';")||
    !source.includes('controllers: [HealthController, BrandingController]'))
   fail('DEV_BRANDING_MODULE_NOT_READY');
 if(typeof target!=='string')fail('TESTER_MODULE_MISSING');
 if(target.includes("import { BrandingController } from './branding.controller';")&&
    target.includes('controllers: [HealthController, BrandingController]'))return null;
 if(target.includes('BrandingController')||
    !target.includes("import { HealthController } from './health.controller';")||
    !target.includes('controllers: [HealthController],'))fail('TESTER_MODULE_BRANDING_REVIEW_REQUIRED');
 return target.replace(
   "import { HealthController } from './health.controller';",
   "import { HealthController } from './health.controller';\nimport { BrandingController } from './branding.controller';")
   .replace('controllers: [HealthController],','controllers: [HealthController, BrandingController],');
}

export function adaptMcpForTester(src){
 if(typeof src!=='string'||!src.includes("server.registerTool('nyx_connection_github_branch_create'"))fail('MCP_SOURCE_INVALID');
 const begin=src.indexOf("server.registerTool('nyx_connection_github_branch_create'");
 const end=src.indexOf("server.registerTool('nyx_connection_github_issue_create'",begin);
 if(end<=begin)fail('MCP_SECTION_MISSING');
 const before=src.slice(0,begin),after=src.slice(end);
 let middle=src.slice(begin,end);
 // General working-branch commands must preserve Tester's short-name behavior.
 // Specialized tester release commands retain their stricter nyx/ checks.
 for(const needle of ["server.registerTool('nyx_connection_github_branch_create'",
  "server.registerTool('nyx_connection_github_commit_file'",
  "server.registerTool('nyx_connection_github_draft_pr'"]){
  const n=middle.indexOf(needle);if(n<0)fail('GENERAL_COMMAND_MISSING');
  const start=middle.indexOf('inputSchema:z.object(',n);
  const finish=middle.indexOf('annotations:',start);
  if(start<0||finish<0)fail('SCHEMA_MISSING');
  const part=middle.slice(start,finish);
  if(!part.includes('branch:z.string().min(5).max(100)'))fail('GENERAL_SCHEMA_CHANGED');
  middle=middle.slice(0,start)+part.replace('branch:z.string().min(5).max(100)',
    'branch:z.string().min(1).max(100)')+middle.slice(finish);
 }
 middle=middle.replaceAll('nyx/*','nyx-prefixed');
 if(!middle.includes('main/master/default'))middle=middle.replace(
  "title:'Create a NYX GitHub review branch'",
  "title:'Create a non-default GitHub working branch (not main/master/default)'");
 const schemas=(middle.match(/branch:z\.string\(\)\.min\(1\)\.max\(100\)/g)||[]).length;
 if(schemas!==3||middle.includes('nyx/*')||!middle.includes('main/master/default'))fail('TESTER_SCHEMA_CONTRACT_UNSATISFIED');
 return before+middle+after;
}
/** One-time exact-blob cleanup of an unexecuted Dev-only test accidentally
 * copied to Tester. Any changed target blob aborts rather than delete. */
const STALE_TESTER_BLOB='facb3c3eb418dc7a7ad40820e1a7492f7fe39a9a';
const STALE_TESTER_PATH='tests/nyx-dev-public-plan.test.mjs';
export function staleDevOnlyTesterCleanup(target){
 if(target?.truncated!==false||!Array.isArray(target.tree))fail('TRUNCATED_TREE');
 const matches=target.tree.filter(x=>x.path===STALE_TESTER_PATH);
 if(matches.length===0)return [];
 if(matches.length!==1||matches[0].type!=='blob'||matches[0].sha!==STALE_TESTER_BLOB)
   fail('OBSOLETE_TESTER_FILE_CHANGED_REVIEW_REQUIRED');
 return [{path:STALE_TESTER_PATH,sourceBlob:null,targetBlob:STALE_TESTER_BLOB}];
}
export function validateCandidate({sourceSha,testerSha,sourceRef,testerRef,masterRef,paths}){
 if(![sourceSha,testerSha,sourceRef,testerRef,masterRef].every(x=>SHA.test(x??'')))fail('SHA_INVALID');
 if(sourceSha!==sourceRef||testerSha!==testerRef)fail('BRANCH_MOVED');
 if(!Array.isArray(paths)||paths.length<1||paths.length>100||new Set(paths.map(x=>x.path)).size!==paths.length)fail('FILES_INVALID');
 if(paths.some(x=>x.path==='app.json'||x.path.startsWith('.github/')||x.path.startsWith('config/')||x.path.startsWith('scripts/')))fail('TARGET_OWNED_FILE');
 return true;
}
async function api(repo,path,token,method='GET',body){
 if(!REPO.test(repo)||typeof token!=='string'||token.length<10)fail('TOKEN_NOT_AVAILABLE');
 const response=await fetch('https://api.github.com/repos/'+repo+path,{
   method,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json',
      'X-GitHub-Api-Version':'2022-11-28','User-Agent':'NYX-Tester-Promotion'},
   ...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)
 });
 if(!response.ok)fail('GITHUB_'+response.status+'_'+path.split('?')[0].slice(0,55));
 return response.json();
}
async function sourceBlobText(repo,blobSha,token){
 if(!SHA.test(blobSha??''))fail('PROFILE_BLOB_INVALID');
 const blob=await api(repo,'/git/blobs/'+blobSha,token);
 if(blob.encoding!=='base64'||blob.size>65536||typeof blob.content!=='string')fail('PROFILE_BLOB_NOT_TEXT');
 const bytes=Buffer.from(blob.content.replace(/\s/g,''),'base64');
 const text=bytes.toString('utf8');
 if(bytes.includes(0)||!Buffer.from(text,'utf8').equals(bytes))fail('PROFILE_NON_UTF8');
 return text;
}
export function hasEffectiveTreeChange(baseTreeSha,newTreeSha){
 if(!SHA.test(baseTreeSha??'')||!SHA.test(newTreeSha??''))fail('STAGING_TREE_INVALID');
 return baseTreeSha!==newTreeSha;
}
export function stageRequired(paths,profileUpgrade){return (Array.isArray(paths)&&paths.length>0)||Boolean(profileUpgrade)}
function stageReceipt(ready){if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,'candidate='+String(ready)+'\n')}
async function stage(){
 const sourceRepo=process.env.GITHUB_REPOSITORY;
 const sourceSha=process.env.NYX_SOURCE_SHA;
 const sourceToken=process.env.GITHUB_TOKEN;
 const testerToken=process.env.NYX_TESTER_TOKEN;
 if(!REPO.test(sourceRepo??'')||!sourceRepo.endsWith('/YaRoute-Dev')||
    sourceRepo===TARGET||!SHA.test(sourceSha??''))fail('SOURCE_INVALID');
 // The source token is only used for read access to Dev; the target token is
 // restricted to the YaRoute repo. No default branch writes or deployment.
 const [devBranch,dstRepo,testerBranch,masterBranch]=await Promise.all([
  api(sourceRepo,'/branches/main',sourceToken),
  api(TARGET,'',testerToken),
  api(TARGET,'/branches/tester',testerToken),
  api(TARGET,'/branches/master',testerToken),
 ]);
 if(dstRepo.default_branch!=='master'||testerBranch.protected!==false||
    masterBranch.protected!==true)fail('REPOSITORY_GOVERNANCE_CHANGED');
 const targetSha=testerBranch.commit?.sha;
 if(!SHA.test(targetSha??'')||!SHA.test(masterBranch.commit?.sha??''))fail('REF_INVALID');
 const [source,target,stagingCommit]=await Promise.all([
  api(sourceRepo,'/git/trees/'+sourceSha+'?recursive=1',sourceToken),
  api(TARGET,'/git/trees/'+targetSha+'?recursive=1',testerToken),
  api(TARGET,'/git/commits/'+targetSha,testerToken),
 ]);
 const srcProfile=source.tree?.find(x=>x.type==='blob'&&x.path==='config/nyx-runtime-profile.json')?.sha;
 const dstProfile=target.tree?.find(x=>x.type==='blob'&&x.path==='config/nyx-runtime-profile.json')?.sha;
 if(source.truncated!==false||target.truncated!==false||!SHA.test(srcProfile??'')||!SHA.test(dstProfile??''))fail('PROFILE_TREE_INCOMPLETE');
 // Routine upgrades preserve Tester pins. The single, exact-hash reviewed
 // migration also corrects stale CLI/NoteFlow paths and verified enforced key.
 let profileUpgrade=null,reviewedMigration=false;
 if(srcProfile!==dstProfile){
  const [sourceText,targetText]=await Promise.all([
   sourceBlobText(sourceRepo,srcProfile,sourceToken),
   sourceBlobText(TARGET,dstProfile,testerToken)]);
  const migrationPair=srcProfile===reviewedProfileBlobs.source&&dstProfile===reviewedProfileBlobs.target;
  const resolution=migrationPair?reconcileReviewedProfileMigration(sourceText,targetText,{
    source:srcProfile,target:dstProfile,
    sourceSchema:source.tree?.find(x=>x.type==='blob'&&x.path==='src/nyx/runtime.schema.ts')?.sha,
    targetSchema:target.tree?.find(x=>x.type==='blob'&&x.path==='src/nyx/runtime.schema.ts')?.sha,
  }):reconcileObservedDraftProfile(sourceText,targetText);
  reviewedMigration=migrationPair;
  if(resolution.changed)profileUpgrade=resolution.content;
 }
 const paths=candidatePaths(source,target);
 let brandingModuleUpgrade=null;
 if(paths.some(p=>p.path==='src/branding.controller.ts'||TESTER_BLUE_BRANDING.has(p.path))){
   const srcApp=source.tree?.find(x=>x.type==='blob'&&x.path==='src/app.module.ts')?.sha;
   const dstApp=target.tree?.find(x=>x.type==='blob'&&x.path==='src/app.module.ts')?.sha;
   if(!SHA.test(srcApp??'')||!SHA.test(dstApp??''))fail('BRANDING_MODULE_BLOB_MISSING');
   brandingModuleUpgrade=adaptTesterAppBranding(
     await sourceBlobText(sourceRepo,srcApp,sourceToken),
     await sourceBlobText(TARGET,dstApp,testerToken));
 }
 const staleCleanup=staleDevOnlyTesterCleanup(target);
 const candidate=[...paths,...staleCleanup];
 if(reviewedMigration&&!paths.some(p=>p.path==='src/nyx/runtime.schema.ts'&&
   p.sourceBlob===reviewedProfileBlobs.sourceSchema&&p.targetBlob===reviewedProfileBlobs.targetSchema))
   fail('REVIEWED_MIGRATION_SCHEMA_NOT_STAGED');
 if(!stageRequired(candidate,profileUpgrade||brandingModuleUpgrade)){
  stageReceipt(false);console.log(JSON.stringify({status:'NO_TESTER_CODE_CHANGES',sourceSha,targetSha}));
  return;
 }
 validateCandidate({sourceSha,testerSha:targetSha,sourceRef:devBranch.commit?.sha,
   testerRef:testerBranch.commit?.sha,masterRef:masterBranch.commit?.sha,paths:candidate});
 if(!SHA.test(stagingCommit.tree?.sha??''))fail('TESTER_BASE_TREE_INVALID');
 const reviewBranch='nyx/promote-'+sourceSha.slice(0,10)+'-'+targetSha.slice(0,10);
 const prs=await api(TARGET,'/pulls?state=open&base=tester&per_page=100',testerToken);
 if(!Array.isArray(prs)||prs.length===100)fail('PR_INVENTORY_INCOMPLETE');
 const existing=prs.find(x=>x.head?.ref===reviewBranch && x.base?.ref==='tester');
 if(existing){stageReceipt(true);console.log(JSON.stringify({status:'EXISTING_DRAFT',url:existing.html_url,number:existing.number,branch:reviewBranch}));return}
 const tree=[];
 if(profileUpgrade)tree.push({path:'config/nyx-runtime-profile.json',mode:'100644',type:'blob',content:profileUpgrade});
 if(brandingModuleUpgrade)tree.push({path:'src/app.module.ts',mode:'100644',type:'blob',content:brandingModuleUpgrade});
 for(const p of paths){
  const blob=await api(sourceRepo,'/git/blobs/'+p.sourceBlob,sourceToken);
  if(blob.encoding!=='base64'||typeof blob.content!=='string'||blob.size>maxTesterSourceBlobBytes(p.path))fail('NON_TEXT_OR_OVERSIZED_'+p.path);
  const bytes=Buffer.from(blob.content.replace(/\s/g,''),'base64');
  if(TESTER_BLUE_BRANDING.has(p.path)){
    if(bytes.length>10000||bytes.length<24||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'||
       bytes.readUInt32BE(16)!==96||bytes.readUInt32BE(20)!==96)fail('BLUE_ICON_INVALID');
    const uploaded=await api(TARGET,'/git/blobs',testerToken,'POST',{
      content:bytes.toString('base64'),encoding:'base64'});
    if(uploaded.sha!==p.sourceBlob)fail('BLUE_ICON_BLOB_MISMATCH');
    tree.push({path:p.path,mode:'100644',type:'blob',sha:uploaded.sha});
    continue;
  }
  const content=bytes.toString('utf8');
  if(bytes.includes(0)||!Buffer.from(content,'utf8').equals(bytes))fail('NON_UTF8_'+p.path);
  const adjusted=p.path==='src/mcp/mcp.service.ts'?adaptMcpForTester(content):content;
  tree.push({path:p.path,mode:'100644',type:'blob',content:adjusted});
 }
 // Delete only the explicitly SHA-pinned stale test path, never arbitrary files.
 for(const item of staleCleanup) tree.push({path:item.path,mode:'100644',type:'blob',sha:null});
 // Recheck both refs immediately before *any* write.
 const [devAgain,testAgain]=await Promise.all([
  api(sourceRepo,'/branches/main',sourceToken),api(TARGET,'/branches/tester',testerToken)]);
 if(devAgain.commit?.sha!==sourceSha||testAgain.commit?.sha!==targetSha)fail('SOURCE_OR_TARGET_DRIFT');
 const newTree=await api(TARGET,'/git/trees',testerToken,'POST',{base_tree:stagingCommit.tree.sha,tree});
 if(!SHA.test(newTree.sha??''))fail('TREE_WRITE_UNVERIFIED');
 if(!hasEffectiveTreeChange(stagingCommit.tree.sha,newTree.sha)){
   stageReceipt(false);
   console.log(JSON.stringify({status:'NO_EFFECTIVE_TESTER_CHANGE',sourceSha,targetSha,selectionCount:tree.length}));
   return;
 }
 const commit=await api(TARGET,'/git/commits',testerToken,'POST',{
   message:'stage(nyx): exact Dev source for CI-gated Tester promotion',
   tree:newTree.sha,parents:[targetSha],
 });
 if(!SHA.test(commit.sha??''))fail('COMMIT_WRITE_UNVERIFIED');
 const ref=await api(TARGET,'/git/refs',testerToken,'POST',{ref:'refs/heads/'+reviewBranch,sha:commit.sha});
 if(ref.ref!=='refs/heads/'+reviewBranch||ref.object?.sha!==commit.sha)fail('REF_WRITE_UNVERIFIED');
 const pr=await api(TARGET,'/pulls',testerToken,'POST',{
  title:'NYX exact-SHA Dev candidate to Tester — automated CI gates',
  head:reviewBranch,base:'tester',draft:true,maintainer_can_modify:false,
  body:'NYX automatic candidate: merge only through the verified CI/security-gated Tester promoter. A review request alone does not require manual approval; an actual blocking submitted review stops promotion.\n\n'+
   '- Dev: '+sourceRepo+' @ '+sourceSha+'\n- Tester parent: '+targetSha+
   '\n- Existing Tester-specific files preserved: workflows, install-rclone, deployment config, app metadata, CODEOWNERS, github-api-writes contract test.'+
   '\n- No modification to master/main, live secrets or Heroku config.\n- Reviewed exact-blob NoteFlow profile migration: '+reviewedMigration+
   '\n- Routine warning-only draft profile upgrade: '+Boolean(profileUpgrade&&!reviewedMigration)+'\n- Changed source/test paths: '+paths.length+
   '\n- Exact stale-test cleanup: '+staleCleanup.length+ '\n- Auth and tenant isolation require separate runtime acceptance before production.\n',
 });
 if(pr.draft!==true||pr.base?.ref!=='tester'||pr.head?.ref!==reviewBranch)fail('PR_RESPONSE_INVALID');
 stageReceipt(true);
 console.log(JSON.stringify({status:'DRAFT_REVIEW_READY',number:pr.number,url:pr.html_url,
  sourceSha,testerParentSha:targetSha,stagedSha:commit.sha,fileCount:tree.length,
  fingerprint:createHash('sha256').update(JSON.stringify(candidate)).digest('hex')}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
 stage().catch(error=>{console.error(error.message);process.exitCode=1});
