// NYX guarded Dev -> Tester candidate builder. Creates a draft PR only.
// Credentials are supplied by the runner from a repository-scoped GitHub App.
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const SHA=/^[a-f0-9]{40}$/,REPO=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const fail=x=>{throw Error('NYX_TESTER_STAGE_'+x)};
const TARGET='yaMorozYaroslav/YaRoute';
const IGNORE=new Set([
 'src/app.module.ts','src/branding.controller.ts',
 'tests/branding.test.cjs','tests/devpronestnyx-stage.test.cjs',
 'tests/nyx-promotion-pipeline.test.cjs','tests/github-api-writes.test.cjs',
 // Dev-only test imports scripts/nyx-tester-stage.mjs, which is never copied.
 'tests/nyx-tester-stage.test.cjs',
]);
const NO_COPY=/^(\.github\/|app\.json$|Procfile$|README\.md$|config\/|scripts\/|docs\/|public\/|broker\/|package(?:-lock)?\.json$)/;
export function candidatePaths(source,target){
 const a=new Map(source.tree?.filter(x=>x.type==='blob').map(x=>[x.path,x.sha])??[]);
 const b=new Map(target.tree?.filter(x=>x.type==='blob').map(x=>[x.path,x.sha])??[]);
 if(source.truncated!==false||target.truncated!==false)fail('TRUNCATED_TREE');
 return [...a.entries()].filter(([p,sha])=>
  (p.startsWith('src/')||p.startsWith('tests/'))&&
  !IGNORE.has(p)&&!NO_COPY.test(p)&&
  /^[A-Za-z0-9._/-]+$/.test(p)&&
  !p.includes('..')&&
  SHA.test(sha)&&b.get(p)!==sha
 ).map(([path,sourceBlob])=>({path,sourceBlob,targetBlob:b.get(path)??null}));
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
 const paths=candidatePaths(source,target);
 validateCandidate({sourceSha,testerSha:targetSha,sourceRef:devBranch.commit?.sha,
   testerRef:testerBranch.commit?.sha,masterRef:masterBranch.commit?.sha,paths});
 if(!SHA.test(stagingCommit.tree?.sha??''))fail('TESTER_BASE_TREE_INVALID');
 const reviewBranch='nyx/promote-'+sourceSha.slice(0,10)+'-'+targetSha.slice(0,10);
 const prs=await api(TARGET,'/pulls?state=open&base=tester&per_page=100',testerToken);
 if(!Array.isArray(prs)||prs.length===100)fail('PR_INVENTORY_INCOMPLETE');
 const existing=prs.find(x=>x.head?.ref===reviewBranch && x.base?.ref==='tester');
 if(existing){console.log(JSON.stringify({status:'EXISTING_DRAFT',url:existing.html_url,number:existing.number,branch:reviewBranch}));return}
 const tree=[];
 for(const p of paths){
  const blob=await api(sourceRepo,'/git/blobs/'+p.sourceBlob,sourceToken);
  if(blob.encoding!=='base64'||typeof blob.content!=='string'||blob.size>65536)fail('NON_TEXT_OR_OVERSIZED_'+p.path);
  const bytes=Buffer.from(blob.content.replace(/\s/g,''),'base64');
  const content=bytes.toString('utf8');
  if(bytes.includes(0)||!Buffer.from(content,'utf8').equals(bytes))fail('NON_UTF8_'+p.path);
  const adjusted=p.path==='src/mcp/mcp.service.ts'?adaptMcpForTester(content):content;
  tree.push({path:p.path,mode:'100644',type:'blob',content:adjusted});
 }
 // Recheck both refs immediately before *any* write.
 const [devAgain,testAgain]=await Promise.all([
  api(sourceRepo,'/branches/main',sourceToken),api(TARGET,'/branches/tester',testerToken)]);
 if(devAgain.commit?.sha!==sourceSha||testAgain.commit?.sha!==targetSha)fail('SOURCE_OR_TARGET_DRIFT');
 const newTree=await api(TARGET,'/git/trees',testerToken,'POST',{base_tree:stagingCommit.tree.sha,tree});
 if(!SHA.test(newTree.sha??''))fail('TREE_WRITE_UNVERIFIED');
 const commit=await api(TARGET,'/git/commits',testerToken,'POST',{
   message:'stage(nyx): reviewed Dev source for Tester CI (approval required)',
   tree:newTree.sha,parents:[targetSha],
 });
 if(!SHA.test(commit.sha??''))fail('COMMIT_WRITE_UNVERIFIED');
 const ref=await api(TARGET,'/git/refs',testerToken,'POST',{ref:'refs/heads/'+reviewBranch,sha:commit.sha});
 if(ref.ref!=='refs/heads/'+reviewBranch||ref.object?.sha!==commit.sha)fail('REF_WRITE_UNVERIFIED');
 const pr=await api(TARGET,'/pulls',testerToken,'POST',{
  title:'WIP: NYX exact-SHA Dev candidate to Tester — approval required',
  head:reviewBranch,base:'tester',draft:true,maintainer_can_modify:false,
  body:'NYX automatic candidate only. DO NOT MERGE until user confirmation and passing exact-PR Tester CI/security checks.\n\n'+
   '- Dev: '+sourceRepo+' @ '+sourceSha+'\n- Tester parent: '+targetSha+
   '\n- Existing Tester-specific files preserved: workflows, install-rclone, deployment config, app metadata, CODEOWNERS, github-api-writes contract test.'+
   '\n- No modification to master/main, live secrets or Heroku config.\n- Changed source/test paths: '+paths.length+
   '\n- Auth and tenant isolation require separate runtime acceptance before production.\n',
 });
 if(pr.draft!==true||pr.base?.ref!=='tester'||pr.head?.ref!==reviewBranch)fail('PR_RESPONSE_INVALID');
 console.log(JSON.stringify({status:'DRAFT_REVIEW_READY',number:pr.number,url:pr.html_url,
  sourceSha,testerParentSha:targetSha,stagedSha:commit.sha,fileCount:tree.length,
  fingerprint:createHash('sha256').update(JSON.stringify(paths)).digest('hex')}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
 stage().catch(error=>{console.error(error.message);process.exitCode=1});
