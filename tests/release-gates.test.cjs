const test = require('node:test');
const assert = require('node:assert/strict');
const {prepareStagingHandoff,checkProductionGate,checkEnvironmentIsolation,assessBranchCleanup} =
  require('../dist/release/release-gates');
const a='a'.repeat(40),b='b'.repeat(40);
const handoff=()=>({developmentRepo:'devuser/Widget-Dev',developmentBranch:'main',
  developmentSha:a,productionRepo:'produser/Widget',stagingBaseBranch:'tester',
  expectedStagingSha:b,targetDefaultBranch:'master',changedFiles:['src/app.ts']});
test('staging manifest is deterministic, immutable, nonexecuting',()=>{
 const x=prepareStagingHandoff(handoff()), y=prepareStagingHandoff(handoff());
 assert.equal(x.manifestSha256,y.manifestSha256);assert.equal(x.execution,'not-authorized');
 assert.equal(x.stagingBaseBranch,'tester');assert.ok(Object.isFrozen(x));
});
test('reject wrong repository pairing and protected staging base',()=>{
 assert.throws(()=>prepareStagingHandoff({...handoff(),productionRepo:'produser/Other'}),/REPO_PAIR/);
 assert.throws(()=>prepareStagingHandoff({...handoff(),stagingBaseBranch:'master'}),/STAGING_BASE/);
});
test('reject bad SHA, traversal and sensitive paths',()=>{
 assert.throws(()=>prepareStagingHandoff({...handoff(),developmentSha:'123'}),/SHA/);
 assert.throws(()=>prepareStagingHandoff({...handoff(),changedFiles:['src/../secret.ts']}),/FILE_PATH/);
 assert.throws(()=>prepareStagingHandoff({...handoff(),changedFiles:['.env.production']}),/SECRET_PATH/);
 assert.throws(()=>prepareStagingHandoff({...handoff(),changedFiles:['.github/private.pem']}),/SECRET_PATH/);
});
test('workflow and installer edits require external review evidence',()=>{
 assert.throws(()=>prepareStagingHandoff({...handoff(),changedFiles:['.github/workflows/ci.yml']}),/SENSITIVE_REVIEW/);
 assert.throws(()=>prepareStagingHandoff({...handoff(),changedFiles:['scripts/install-rclone.mjs']}),/SENSITIVE_REVIEW/);
 const x=prepareStagingHandoff({...handoff(),changedFiles:['scripts/install-rclone.mjs','.github/workflows/ci.yml'],
   sensitiveChangeReviewRef:'PR-12345'});
 assert.deepEqual(x.changedFiles,['.github/workflows/ci.yml','scripts/install-rclone.mjs']);
});
test('canonical file list yields same digest independent of input order',()=>{
 const x=prepareStagingHandoff({...handoff(),changedFiles:['src/b.ts','src/a.ts','src/a.ts']});
 const y=prepareStagingHandoff({...handoff(),changedFiles:['src/a.ts','src/b.ts']});
 assert.equal(x.manifestSha256,y.manifestSha256);
});
const release=()=>({expectedTesterSha:a,actualTesterSha:a,deployedStagingSha:a,
 testerCi:'success',testerSecurity:'success',isolatedStagingConfigVerified:true,
 protectedDefaultVerified:true,independentReviewApproved:true,reviewerIsNotAuthor:true});
test('release gate refuses mismatched commit, missing CI or independent reviewer',()=>{
 assert.equal(checkProductionGate(release()).ok,true);
 const r=checkProductionGate({...release(),actualTesterSha:b,deployedStagingSha:null,
   testerCi:'failure',reviewerIsNotAuthor:false});
 assert.equal(r.ok,false);assert.ok(r.blockers.includes('TESTER_CI_NOT_GREEN'));
 assert.ok(r.blockers.includes('REVIEW_NOT_VERIFIED'));
});
const isolation=()=>({devApp:'devapp',stagingApp:'stageapp',productionApp:'prodapp',
 devPublicUrl:'https://dev.example.com',stagingPublicUrl:'https://stage.example.com',
 productionPublicUrl:'https://prod.example.com',separateDatabaseVerified:true,
 separateStorageVerified:true,separateOAuthAudienceVerified:true,
 separateEncryptionKeysVerified:true,providerReadOnlyInspectionVerified:true});
test('environment gate requires distinct identities and provider-side evidence',()=>{
 assert.equal(checkEnvironmentIsolation(isolation()).ok,true);
 const r=checkEnvironmentIsolation({...isolation(),stagingApp:'prodapp',separateStorageVerified:false});
 assert.equal(r.ok,false);assert.ok(r.blockers.includes('STORAGE_ISOLATION_NOT_VERIFIED'));
});
test('cleanup refuses core branches and unknown reachability',()=>{
 assert.equal(assessBranchCleanup({name:'feat/example',protected:false}).status,'preserve');
 assert.equal(assessBranchCleanup({name:'master',protected:false,reachableFromDefault:true,
  uniqueCommits:0,openPullRequests:0,referencedByRelease:false,referencedByDeployment:false,
  referencedByNyxContinuity:false,explicitUserApproval:true}).status,'preserve');
});
test('cleanup requires human approval even for reachable merged branches',()=>{
 const e={name:'feat/old',protected:false,reachableFromDefault:true,uniqueCommits:0,
  openPullRequests:0,referencedByRelease:false,referencedByDeployment:false,
  referencedByNyxContinuity:false};
 assert.equal(assessBranchCleanup(e).status,'audit-required');
 assert.equal(assessBranchCleanup({...e,explicitUserApproval:true}).status,'eligible');
 assert.equal(assessBranchCleanup({...e,uniqueCommits:1,explicitUserApproval:true}).status,'preserve');
});
