// NYX Dev -> Tester reconciliation: read-only, SHA-pinned, fail-closed.
import {createHash} from 'node:crypto';
import {writeFile,readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const SHA=/^[a-f0-9]{40}$/,REPO=/^[\w.-]+\/[\w.-]+$/;
const FORBIDDEN=/(^|\/)(\.env(?:\.[^/]*)?|rclone\.conf|credentials(?:\.[^/]*)?|[^/]*\.(?:pem|key|p12|pfx|tfvars))$/i;
const TARGET_OWNED=new Set(['app.json','Procfile','.github/CODEOWNERS']);
const INFRA=/^(\.github\/|scripts\/|config\/|broker\/|package(?:-lock)?\.json$|README\.md$)/;
const SECURITY=/^(src\/(?:main\.ts|connectors\/(?:tenant-|google-oauth|mega-enrollment)|storage\/public-rclone-isolation)|tests\/(?:tenant-|public-))/;
const bad=s=>{throw Error('NYX_PROMOTION_'+s)};
function tree(data,label){
 if(!data||data.truncated!==false||!Array.isArray(data.tree))bad(label+'_TREE_INCOMPLETE');
 const m=new Map();
 for(const x of data.tree){if(x.type!=='blob')continue;
  if(typeof x.path!=='string'||!x.path||x.path.startsWith('/')||x.path.includes('..')||x.path.includes('\\')||/[\x00-\x1f]/.test(x.path)||!SHA.test(x.sha)||m.has(x.path))bad(label+'_INVALID_BLOB');
  m.set(x.path,x.sha);
 }return m;
}
function kind(path){return FORBIDDEN.test(path)?'forbidden':TARGET_OWNED.has(path)?'target_owned':INFRA.test(path)?'infrastructure_review':SECURITY.test(path)?'security_review':'code_review'}
export function plan({source,target,sourceRepo,targetRepo,sourceSha,targetSha,decisions={}}){
 if(!REPO.test(sourceRepo)||!REPO.test(targetRepo)||sourceRepo===targetRepo||!SHA.test(sourceSha)||!SHA.test(targetSha))bad('REF_INVALID');
 const a=tree(source,'SOURCE'),b=tree(target,'TARGET');
 if(!decisions||typeof decisions!=='object'||Array.isArray(decisions))bad('DECISIONS_INVALID');
 const actions=[],unresolved=[],entries=[];let identical=0,targetOnly=0;
 for(const path of [...new Set([...a.keys(),...b.keys()])].sort()){
  const sourceBlob=a.get(path)??null,targetBlob=b.get(path)??null;
  if(sourceBlob===targetBlob){identical++;continue}
  if(sourceBlob===null){targetOnly++;entries.push({path,kind:'target_only',resolution:'preserve',targetBlob});continue}
  const category=kind(path),decision=decisions[path],change=targetBlob?'different':'source_only';
  if(decision!==undefined&&(!decision||!['copy_source','preserve_target'].includes(decision.action)||decision.sourceBlob!==sourceBlob||(decision.targetBlob??null)!==targetBlob||typeof decision.rationale!=='string'||decision.rationale.trim().length<12))bad('STALE_DECISION');
  let resolution='requires_review';
  if(category==='forbidden')resolution='forbidden';
  else if(category==='target_owned'||(decision?.action==='preserve_target'&&targetBlob))resolution='preserve';
  else if(decision?.action==='copy_source')resolution='copy_source';
  const entry={path,change,category,sourceBlob,targetBlob,resolution};entries.push(entry);
  if(resolution==='copy_source')actions.push({path,sourceBlob,expectedTargetBlob:targetBlob,category});
  else if(resolution!=='preserve')unresolved.push(entry);
 }
 for(const path of Object.keys(decisions))if(!entries.some(x=>x.path===path))bad('EXTRANEOUS_DECISION');
 const output={schema:'nyx.promotion.plan.v1',source:{repo:sourceRepo,sha:sourceSha},target:{repo:targetRepo,branch:'tester',sha:targetSha},
  status:actions.length>0&&unresolved.length===0&&actions.length<=40?'REVIEW_READY':'BLOCKED',
  summary:{identical,targetOnly,changedOrAdded:entries.length-targetOnly,approvedCopies:actions.length,unresolved:unresolved.length,existingStagingToolLimit:40},
  actions,unresolved,entries,noGitWrites:true,requiresTesterCI:true,requiresLiveTenantSecurityVerification:true};
 output.planSha256=createHash('sha256').update(JSON.stringify(output)).digest('hex');return output;
}
async function github(path){const headers={Accept:'application/vnd.github+json','User-Agent':'NYX-plan-readonly'};
 if(process.env.GITHUB_TOKEN)headers.Authorization='Bearer '+process.env.GITHUB_TOKEN;
 const response=await fetch('https://api.github.com/'+path,{headers,redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok)bad('GITHUB_HTTP_'+response.status);return response.json();}
async function shaFor(repo,branch){const data=await github('repos/'+repo+'/branches/'+branch);const sha=data?.commit?.sha;if(!SHA.test(sha??''))bad('BRANCH_SHA_INVALID');return sha}
async function run(args){
 const opt=new Map();for(let i=0;i<args.length;i+=2){if(!args[i]?.startsWith('--')||!args[i+1])bad('ARGS_INVALID');opt.set(args[i].slice(2),args[i+1])}
 const sourceRepo=opt.get('source-repo')??'linuxofpower/YaRoute-Dev',targetRepo=opt.get('target-repo')??'yaMorozYaroslav/YaRoute';
 if(!REPO.test(sourceRepo)||!REPO.test(targetRepo))bad('REPO_INVALID');
 const sourceSha=opt.get('source-sha')??await shaFor(sourceRepo,'main'),targetSha=opt.get('target-sha')??await shaFor(targetRepo,'tester');
 if(!SHA.test(sourceSha)||!SHA.test(targetSha))bad('SHA_INVALID');
 const decisions=opt.has('decisions')?JSON.parse(await readFile(opt.get('decisions'),'utf8')):{};
 const [source,target]=await Promise.all([github('repos/'+sourceRepo+'/git/trees/'+sourceSha+'?recursive=1'),github('repos/'+targetRepo+'/git/trees/'+targetSha+'?recursive=1')]);
 const result=plan({source,target,sourceRepo,targetRepo,sourceSha,targetSha,decisions});
 if(opt.has('out'))await writeFile(opt.get('out'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({status:result.status,summary:result.summary,source:result.source,target:result.target,digest:result.planSha256}));
 if(opt.get('require-ready')==='true'&&result.status!=='REVIEW_READY')process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)run(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1});
