// NYX: bot-authored exact-tree draft release PR. Never merge or deploy master.
const REPO='yaMorozYaroslav/YaRoute',SHA=/^[a-f0-9]{40}$/;
const fail=s=>{throw Error('NYX_MASTER_RELEASE_'+s)};
export const releaseBranch=sha=>'nyx/release-tester-'+sha.slice(0,12);
export function validateChecks(obj){
 const rows=obj?.check_runs;
 if(!Array.isArray(rows)||rows.length<2||rows.length>=100||obj.total_count!==rows.length)
   fail('CHECK_INVENTORY_INCOMPLETE');
 const names=new Set();
 for(const x of rows){
   if(!x.name||names.has(x.name))fail('DUPLICATE_CHECK');
   names.add(x.name);
   if(x.status!=='completed'||x.conclusion!=='success')fail('CHECK_NOT_GREEN');
 }
 for(const name of ['build','GitGuardian Security Checks'])
   if(!names.has(name))fail('REQUIRED_CHECK_MISSING');
 return true;
}
export function validateCandidate({repo,tester,master,commit,compare,sha,pulls,checks}){
 if(repo?.full_name!==REPO||repo.default_branch!=='master')fail('WRONG_REPOSITORY');
 if(tester?.name!=='tester'||tester.protected!==false||
   master?.name!=='master'||master.protected!==true)fail('BRANCH_PROTECTION_CHANGED');
 if(!SHA.test(sha||'')||tester.commit?.sha!==sha||
    !SHA.test(master.commit?.sha||''))fail('BRANCH_SHA_CHANGED');
 if(commit?.sha!==sha||!SHA.test(commit.tree?.sha||''))fail('SOURCE_TREE_INVALID');
 if(compare?.status!=='ahead'||compare.behind_by!==0||!(compare.ahead_by>0))
   fail('SOURCE_HISTORY_UNSAFE_OR_EMPTY');
 if(!Array.isArray(pulls)||pulls.length>=100)fail('PR_INVENTORY_INCOMPLETE');
 if(pulls.some(p=>p.base?.ref==='master' &&
   (p.head?.ref==='tester'||p.head?.ref?.startsWith('nyx/release-tester-'))))
    fail('EXISTING_RELEASE_PR_REQUIRES_REVIEW');
 validateChecks(checks);
 return {sha,tree:commit.tree.sha,base:master.commit.sha,branch:releaseBranch(sha)};
}
export function validateDraft(p,expected){
 if(p?.state!=='open'||p.draft!==true||p.base?.ref!=='master'||
   p.base?.sha!==expected.base||p.head?.ref!==expected.branch||
   p.head?.sha!==expected.commit||p.head?.repo?.full_name!==REPO||
   !/\[bot\]$/.test(p.user?.login||''))fail('BOT_DRAFT_READBACK_INVALID');
 return true;
}
async function execute(){
 const token=process.env.NYX_MASTER_RELEASE_TOKEN,sha=process.env.NYX_TESTER_SHA;
 if(typeof token!=='string'||token.length<20)fail('SCOPED_APP_TOKEN_REQUIRED');
 if(!SHA.test(sha||''))fail('EXACT_TESTER_SHA_REQUIRED');
 const root='https://api.github.com/repos/'+REPO;
 const request=async(path,method='GET',body,allow404=false)=>{
   const response=await fetch(root+path,{method,redirect:'error',signal:AbortSignal.timeout(20000),
     headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json',
       'X-GitHub-Api-Version':'2022-11-28','User-Agent':'NYX-Bot-Release-Review'},
     ...(body?{body:JSON.stringify(body)}:{})});
   if(allow404&&response.status===404)return null;
   if(!response.ok)fail('GITHUB_'+response.status+'_'+method+'_'+path.split('?')[0].slice(0,60));
   return response.json();
 };
 const [repo,tester,master,commit,pulls,checks]=await Promise.all([
   request(''),request('/branches/tester'),request('/branches/master'),
   request('/git/commits/'+sha),request('/pulls?state=open&base=master&per_page=100'),
   request('/commits/'+sha+'/check-runs?per_page=100')]);
 const compare=await request('/compare/'+master.commit.sha+'...'+sha);
 const planned=validateCandidate({repo,tester,master,commit:{...commit,sha},compare,sha,pulls,checks});
 if(await request('/git/ref/heads/'+encodeURIComponent(planned.branch),'GET',undefined,true))
   fail('RELEASE_BRANCH_ALREADY_EXISTS');
 const [latestTester,latestMaster]=await Promise.all([request('/branches/tester'),request('/branches/master')]);
 if(latestTester.commit.sha!==sha||latestMaster.commit.sha!==planned.base)
   fail('BRANCH_MOVED_BEFORE_WRITE');
 // Attestation commit has identical Git tree and direct Tester parent; bot pushes it.
 const attestation=await request('/git/commits','POST',{
   message:'chore(release): exact Tester attestation '+sha+' (no file edits)',
   tree:planned.tree,parents:[sha]});
 if(!SHA.test(attestation.sha||'')||attestation.tree?.sha!==planned.tree||
    attestation.parents?.length!==1||attestation.parents[0].sha!==sha)
   fail('ATTESTATION_TREE_MISMATCH');
 await request('/git/refs','POST',{ref:'refs/heads/'+planned.branch,sha:attestation.sha});
 const ref=await request('/git/ref/heads/'+encodeURIComponent(planned.branch));
 if(ref.object?.sha!==attestation.sha)fail('RELEASE_REF_READBACK_INVALID');
 const body=[
   '## BOT-AUTHORED DRAFT — NOT PRODUCTION-APPROVED','',
   '- Source Tester SHA: '+sha,
   '- Identical source tree: '+planned.tree,
   '- Bot attestation commit: '+attestation.sha,
   '- Protected master baseline: '+planned.base,'',
   '### Mandatory release gates',
   '- [ ] Owner reviews entire diff and scope.',
   '- [ ] Two real distinct users: isolated public MEGA 2FA, exact roots, cross-tenant denial, revocation, restart, replacement and rollback.',
   '- [ ] Verify all current CI/security checks, runtime commit, credentials and deployment target.',
   '- [ ] Owner provides independent code-owner approval after draft becomes review-ready.',
   'No automatic master merge, rule bypass, Heroku deployment or credential changes.'
 ].join('\n');
 const created=await request('/pulls','POST',{title:'Draft bot release: Tester '+sha.slice(0,12),
   head:planned.branch,base:'master',draft:true,body,maintainer_can_modify:false});
 const p=await request('/pulls/'+created.number);
 validateDraft(p,{base:planned.base,branch:planned.branch,commit:attestation.sha});
 if((await request('/branches/master')).commit?.sha!==planned.base)fail('MASTER_MOVED_AFTER_DRAFT');
 console.log(JSON.stringify({status:'BOT_DRAFT_READBACK_VERIFIED',pr:p.html_url,
   number:p.number,author:p.user?.login,sourceSha:sha,releaseSha:attestation.sha,
   sourceTree:planned.tree,merged:false,deployed:false,masterUnchanged:true}));
}
if(process.argv[1]?.endsWith('nyx-bot-master-release.mjs'))
 execute().catch(e=>{console.error(String(e?.message||e));process.exitCode=1});
