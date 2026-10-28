/**
 * NYX: merge only a verified, machine-generated draft PR into YaRoute/tester.
 * No workflow, deployment, credential, main or master writes are possible here.
 */
const TARGET='yaMorozYaroslav/YaRoute';
const SHA=/^[0-9a-f]{40}$/;
const fail=code=>{throw Error('NYX_TESTER_AUTOMERGE_'+code)};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const targetPath=path=>/^(src|tests)\/[A-Za-z0-9._/-]+$/.test(path)&&!path.includes('..')&&!path.includes('//')&&!path.endsWith('/');

export function validatePull({pr,branch,master,sourceSha,files,commit}){
 if(!SHA.test(sourceSha??'')||!SHA.test(branch?.commit?.sha??'')||!SHA.test(master?.commit?.sha??''))fail('REF_INVALID');
 if(master.protected!==true||branch.protected!==false||branch.name!=='tester'||master.name!=='master')fail('PROTECTION_CHANGED');
 if(pr?.state!=='open'||pr.base?.ref!=='tester'||pr.base?.sha!==branch.commit.sha||pr.base?.repo?.full_name!==TARGET)fail('TARGET_CHANGED');
 if(pr.head?.repo?.full_name!==TARGET||!SHA.test(pr.head?.sha??'')||
    pr.head.ref!=='nyx/promote-'+sourceSha.slice(0,10)+'-'+branch.commit.sha.slice(0,10))fail('SOURCE_UNVERIFIED');
 if(!pr.draft&&pr.mergeable===false)fail('NOT_MERGEABLE');
 if(pr.changed_files!==files?.length||!files.length||files.length>=100)fail('FILE_INVENTORY_INCOMPLETE');
 if(files.some(f=>!targetPath(f.filename)||!['added','modified'].includes(f.status)))fail('UNSAFE_PATH');
 if(commit?.sha!==pr.head.sha||commit.parents?.length!==1||commit.parents[0]?.sha!==branch.commit.sha)fail('PARENT_UNVERIFIED');
 if(pr.requested_reviewers?.length||pr.requested_teams?.length)fail('REVIEW_PENDING');
 return true;
}
export function validateChecks(list){
 if(!list||!Array.isArray(list.check_runs)||list.total_count!==list.check_runs.length||
    list.total_count<2||list.total_count>100)fail('CHECK_INVENTORY_INCOMPLETE');
 const byName=new Map();
 for(const c of list.check_runs){
  if(!c.name||byName.has(c.name))fail('DUPLICATE_OR_UNNAMED_CHECK');
  byName.set(c.name,c);
  if(c.status!=='completed'||c.conclusion!=='success')fail('CHECK_NOT_GREEN_'+c.name.replace(/[^A-Za-z0-9]/g,'_'));
 }
 for(const required of ['build','GitGuardian Security Checks'])
   if(!byName.has(required))fail('REQUIRED_CHECK_MISSING_'+required.replace(/[^A-Za-z0-9]/g,'_'));
 return true;
}
function validateReviews(reviews){
 if(!Array.isArray(reviews)||reviews.length>=100)fail('REVIEWS_INCOMPLETE');
 if(reviews.some(r=>r.state==='CHANGES_REQUESTED'||r.state==='PENDING'))fail('REVIEW_BLOCKED');
}
async function request(path,method='GET',body){
 const token=process.env.NYX_TESTER_TOKEN;
 if(typeof token!=='string'||token.length<10)fail('TOKEN_NOT_CONFIGURED');
 const resp=await fetch('https://api.github.com'+path,{method,
  headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json',
    'X-GitHub-Api-Version':'2022-11-28','User-Agent':'NYX-Tester-Verified-Merge'},
  ...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!resp.ok)fail('PROVIDER_HTTP_'+resp.status+'_'+path.split('?')[0].slice(0,50));
 return resp.json();
}
const gh=(path,method,body)=>request('/repos/'+TARGET+path,method,body);
async function graphql(query,variables){
 const data=await request('/graphql','POST',{query,variables});
 if(data.errors?.length||!data.data)fail('GRAPHQL_REJECTED');
 return data.data;
}
async function inspect(prNum,sourceSha){
 const [repo,branch,master,pr,files,reviews]=await Promise.all([
  gh(''),gh('/branches/tester'),gh('/branches/master'),
  gh('/pulls/'+prNum),gh('/pulls/'+prNum+'/files?per_page=100'),
  gh('/pulls/'+prNum+'/reviews?per_page=100')]);
 if(repo.default_branch!=='master')fail('DEFAULT_BRANCH_CHANGED');
 const commit=await gh('/git/commits/'+pr.head.sha);
 validatePull({pr,branch,master,sourceSha,files,commit});
 validateReviews(reviews);
 return {pr,branch};
}
async function waitForGreen(prNum,sha,sourceSha){
 for(let attempt=0;attempt<36;attempt++){
  const {pr}=await inspect(prNum,sourceSha);
  if(pr.head.sha!==sha)fail('HEAD_CHANGED');
  if(pr.mergeable===false)fail('MERGE_CONFLICT');
  const checks=await gh('/commits/'+sha+'/check-runs?per_page=100');
  try{
   validateChecks(checks);
   if(pr.mergeable===true)return;
  }catch(e){
   if(!/CHECK_NOT_GREEN|CHECK_INVENTORY_INCOMPLETE|REQUIRED_CHECK_MISSING/.test(e.message))throw e;
   if(checks.check_runs?.some(c=>c.status==='completed'&&c.conclusion&&!['success'].includes(c.conclusion)))throw e;
  }
  await pause(12000);
 }
 fail('CHECKS_TIMEOUT');
}
async function execute(){
 const sourceSha=process.env.NYX_SOURCE_SHA;
 if(!SHA.test(sourceSha??''))fail('SOURCE_SHA_INVALID');
 const branch=await gh('/branches/tester');
 if(branch.name!=='tester'||!SHA.test(branch.commit?.sha??''))fail('TARGET_REF_INVALID');
 const wanted='nyx/promote-'+sourceSha.slice(0,10)+'-'+branch.commit.sha.slice(0,10);
 const pulls=await gh('/pulls?state=open&base=tester&per_page=100');
 if(!Array.isArray(pulls)||pulls.length===100)fail('PR_INVENTORY_INCOMPLETE');
 const candidates=pulls.filter(p=>p.head?.ref===wanted&&p.base?.ref==='tester');
 if(candidates.length!==1)fail('EXPECTED_PR_NOT_FOUND');
 const num=candidates[0].number;
 const verified=await inspect(num,sourceSha);
 const sha=verified.pr.head.sha;
 await waitForGreen(num,sha,sourceSha);
 const again=await inspect(num,sourceSha);
 if(again.pr.head.sha!==sha||again.pr.mergeable!==true)fail('FINAL_PR_CHANGED');
 if(again.pr.draft){
  if(!again.pr.node_id||typeof again.pr.node_id!=='string')fail('PR_NODE_ID_MISSING');
  const result=await graphql('mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{id isDraft number}}}',{id:again.pr.node_id});
  if(result.markPullRequestReadyForReview?.pullRequest?.isDraft!==false)fail('READY_NOT_CONFIRMED');
 }
 const latest=await inspect(num,sourceSha);
 if(latest.pr.draft||latest.pr.head.sha!==sha||latest.pr.mergeable!==true)fail('MERGE_PREFLIGHT_CHANGED');
 // Verify the exact green check set again after ready-for-review mutation.
 validateChecks(await gh('/commits/'+sha+'/check-runs?per_page=100'));
 const merged=await gh('/pulls/'+num+'/merge','PUT',{sha,merge_method:'merge'});
 if(merged.merged!==true||!SHA.test(merged.sha??''))fail('MERGE_NOT_CONFIRMED');
 const [receipt,destination]=await Promise.all([gh('/pulls/'+num),gh('/branches/tester')]);
 if(!receipt.merged||receipt.merge_commit_sha!==merged.sha||destination.commit.sha!==merged.sha)fail('MERGE_READBACK_MISMATCH');
 console.log(JSON.stringify({status:'TESTER_MERGED_VERIFIED',pr:receipt.html_url,number:num,
  headSha:sha,baseBefore:verified.branch.commit.sha,mergeSha:merged.sha,
  targetBranch:'tester',masterUntouchedByThisWorkflow:true}));
}
if(process.argv[1]?.endsWith('nyx-tester-auto-merge.mjs'))
 execute().catch(e=>{console.error(e.message);process.exitCode=1});
