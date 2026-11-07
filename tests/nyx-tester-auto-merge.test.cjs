const {test}=require('node:test');
const assert=require('node:assert/strict');
const HEAD='a'.repeat(40),BASE='b'.repeat(40),MASTER='c'.repeat(40),SRC='d'.repeat(40);
let mod;
test('load automatic Tester merger without calling GitHub',async()=>{
 mod=await import('../scripts/nyx-tester-auto-merge.mjs');
 assert.equal(typeof mod.validatePull,'function');
 assert.equal(typeof mod.validateChecks,'function');
 assert.equal(typeof mod.validateReviews,'function');
});
function candidate(){
 const target='yaMorozYaroslav/YaRoute';
 const branch={name:'tester',protected:false,commit:{sha:BASE}},master={name:'master',protected:true,commit:{sha:MASTER}};
 const pr={state:'open',draft:true,mergeable:true,base:{ref:'tester',sha:BASE,repo:{full_name:target}},
  head:{ref:'nyx/promote-'+SRC.slice(0,10)+'-'+BASE.slice(0,10),sha:HEAD,repo:{full_name:target}},
  changed_files:2,requested_reviewers:[],requested_teams:[]};
 return {pr,branch,master,sourceSha:SRC,files:[{filename:'src/tenant.ts',status:'added'},
  {filename:'tests/tenant.test.cjs',status:'modified'}],commit:{sha:HEAD,parents:[{sha:BASE}]}};
}
function checks(){
 return {total_count:2,check_runs:[
  {name:'GitGuardian Security Checks',status:'completed',conclusion:'success'},
  {name:'build',status:'completed',conclusion:'success'}
 ]};
}
test('accept exact-sha safe tester candidate and passing security CI',()=>{
 assert.equal(mod.validatePull(candidate()),true);
 assert.equal(mod.validateChecks(checks()),true);
});
test('refuse master/main or any different target, even if tests passed',()=>{
 const c=candidate();
 assert.throws(()=>mod.validatePull({...c,pr:{...c.pr,base:{...c.pr.base,ref:'master'}}}),/TARGET_CHANGED/);
 assert.throws(()=>mod.validatePull({...c,branch:{...c.branch,protected:true}}),/PROTECTION_CHANGED/);
 assert.throws(()=>mod.validatePull({...c,master:{...c.master,protected:false}}),/PROTECTION_CHANGED/);
 assert.throws(()=>mod.validatePull({...c,pr:{...c.pr,base:{...c.pr.base,sha:MASTER}}}),/TARGET_CHANGED/);
});
test('reject stale branch head, non-Taster ancestry and non-generated PR',()=>{
 const c=candidate();
 assert.throws(()=>mod.validatePull({...c,commit:{...c.commit,parents:[{sha:MASTER}]}}),/PARENT_UNVERIFIED/);
 assert.throws(()=>mod.validatePull({...c,pr:{...c.pr,head:{...c.pr.head,ref:'feature/unsafe'}}}),/SOURCE_UNVERIFIED/);

});
test('Tester reviewer requests do not require manual approval when CI is green',()=>{
 const c=candidate();
 const requested={...c,pr:{...c.pr,requested_reviewers:[{login:'owner'}]}};
 assert.equal(mod.validatePull(requested),true);
 assert.equal(mod.validateChecks(checks()),true);
 assert.doesNotThrow(()=>mod.validateReviews([{state:'COMMENTED'}]));
 assert.doesNotThrow(()=>mod.validateReviews([{state:'APPROVED'}]));
});
test('actual blocking reviews and incomplete review inventory still stop Tester',()=>{
 assert.throws(()=>mod.validateReviews([{state:'CHANGES_REQUESTED'}]),/REVIEW_BLOCKED/);
 assert.throws(()=>mod.validateReviews([{state:'PENDING'}]),/REVIEW_BLOCKED/);
 assert.throws(()=>mod.validateReviews(null),/REVIEWS_INCOMPLETE/);
 assert.throws(()=>mod.validateReviews(Array(100).fill({state:'COMMENTED'})),/REVIEWS_INCOMPLETE/);
});

test('never auto-merge edits to hosting, workflow, keys, or default branches',()=>{
 for(const path of ['app.json','.github/workflows/release.yml','scripts/install-rclone.mjs','config/nyx-runtime-profile.json','../outside','src/../../bad']){
  const c=candidate();c.files[0].filename=path;
  assert.throws(()=>mod.validatePull(c),/UNSAFE_PATH/);
 }
});
test('require all exact-sha check runs to be green',()=>{
 const c=checks();
 for(const [name,change] of [
  ['pending',{status:'queued',conclusion:null}],
  ['failure',{status:'completed',conclusion:'failure'}],
  ['skipped',{status:'completed',conclusion:'skipped'}]
 ])assert.throws(()=>mod.validateChecks({...c,check_runs:[c.check_runs[0],{...c.check_runs[1],...change}]}),/CHECK_NOT_GREEN/,name);
 assert.throws(()=>mod.validateChecks({...c,check_runs:[c.check_runs[0]],total_count:1}),/CHECK_INVENTORY_INCOMPLETE/);
 assert.throws(()=>mod.validateChecks({...c,check_runs:[c.check_runs[0],{...c.check_runs[0]}]}),/DUPLICATE_OR_UNNAMED_CHECK/);
});

test('profile change requires independent exact-mode verification',()=>{
 const c=candidate();c.files.push({filename:'config/nyx-runtime-profile.json',status:'modified'});c.pr.changed_files=3;
 assert.throws(()=>mod.validatePull(c),/UNSAFE_PATH/);
 assert.equal(mod.validatePull({...c,profileReviewed:true}),true);
 const bad={...c,files:[...c.files.slice(0,2),{filename:'config/heroku-public.json',status:'modified'}]};
 assert.throws(()=>mod.validatePull({...bad,profileReviewed:true}),/UNSAFE_PATH/);
});


test('allow only exact stale Dev-only test removal, reject every other deletion',()=>{
 const c=candidate();
 c.files[0]={filename:'tests/nyx-dev-public-plan.test.mjs',status:'removed'};
 assert.equal(mod.validatePull(c),true);
 for(const path of ['tests/tenant.test.cjs','src/mcp/mcp.service.ts',
   'scripts/nyx-tester-stage.mjs','config/nyx-runtime-profile.json']){
   const bad=candidate();
   bad.files[0]={filename:path,status:'removed'};
   assert.throws(()=>mod.validatePull(bad),/UNSAFE_PATH/);
 }
 assert.equal(mod.safeTesterChange({filename:'tests/nyx-dev-public-plan.test.mjs',status:'removed'}),true);
});
