import test from 'node:test';
import assert from 'node:assert/strict';
import {safeDevDeployment,safeTesterBranch,assessLiveIniPreflight} from '../scripts/nyx-dev-deployment-guard.mjs';

const TESTER='61554c5698f09bf45ee064e9c3add99d414e1a24';
const DEV='267b8e29b963475146bd185c6ffd6f36507f2bdf';

test('Heroku Dev is compared against Tester, not GitHub Dev main',()=>{
 const result=safeDevDeployment({ok:true,commit:TESTER,rawSecret:'DO_NOT_INCLUDE'},TESTER);
 assert.equal(result.deployedCurrentSource,true);
 assert.equal(result.status,'CURRENT_TESTER_SOURCE_VERIFIED');
 assert.equal(result.sourceBranch,'tester');
 assert.equal(result.expectedTesterCommit,TESTER);
 assert.doesNotMatch(JSON.stringify(result),/DO_NOT_INCLUDE/);
 assert.equal(safeDevDeployment({ok:true,commit:TESTER},DEV).deployedCurrentSource,false);
});

test('mismatched, unreadable, or old deployments are not authorized',()=>{
 for(const health of [null,{}, {ok:false,commit:TESTER},
   {ok:true,commit:'not-a-commit'}, {ok:true,commit:DEV},
   {ok:true,commit:'61554c'}]){
   assert.equal(safeDevDeployment(health,TESTER).deployedCurrentSource,false);
 }
});

test('GitHub Tester SHA is strict, with a supported deployed prefix',()=>{
 assert.equal(safeTesterBranch({commit:{sha:TESTER}}),TESTER);
 assert.equal(safeTesterBranch({commit:{sha:'invalid'}}),'');
 assert.equal(safeTesterBranch({commit:{sha:TESTER.slice(0,7)}}),'');
 assert.equal(safeDevDeployment({ok:true,commit:TESTER.slice(0,12)},TESTER).deployedCurrentSource,true);
 assert.equal(safeDevDeployment({ok:true,commit:TESTER},'unknown').status,'TESTER_COMMIT_UNAVAILABLE');
});

test('live INI preflight never passes from green health and CI alone',()=>{
 const minimal=assessLiveIniPreflight({health:{ok:true,commit:TESTER},testerCommit:TESTER});
 assert.equal(minimal.status,'PREFLIGHT_NOT_LIVE');
 assert.equal(minimal.fullInitializationVerified,false);
 assert.ok(minimal.missing.includes('live_capabilities_missing_ini_plan'));
 assert.ok(minimal.missing.includes('authenticated_ini_plan_call_unverified'));
});

test('preflight requires exact advertised feature, real discovery and safe invocation receipt',()=>{
 const snapshot={
  health:{ok:true,commit:TESTER},testerCommit:TESTER,
  capabilities:{initialization:{available:false,assisted:{
    tool:'nyx_ini_plan',status:'PARTIAL_DIAGNOSTIC'}},auxiliaryTools:['nyx_ini_plan']},
  toolDiscovered:true,
  planResult:{schema:'nyx.public-ini-preflight.v1',status:'PARTIAL_DIAGNOSTIC',
              fif:null,canonicalReadVerified:false,privateBootstrapUsed:false},
 };
 const ok=assessLiveIniPreflight(snapshot);
 assert.equal(ok.status,'PREFLIGHT_LIVE_VERIFIED');
 assert.equal(ok.fullInitializationVerified,false);
 const mismatches=[
   {...snapshot,toolDiscovered:false},
   {...snapshot,capabilities:{initialization:{assisted:{tool:'nyx_ini_plan'}},auxiliaryTools:['nyx_ini_plan']}},
   {...snapshot,health:{ok:true,commit:DEV}},
   {...snapshot,planResult:{...snapshot.planResult,status:'READY'}},
   {...snapshot,planResult:{...snapshot.planResult,fif:'FAKE'}},
   {...snapshot,planResult:{...snapshot.planResult,canonicalReadVerified:true}},
 ];
 for(const candidate of mismatches){
  assert.equal(assessLiveIniPreflight(candidate).status,'PREFLIGHT_NOT_LIVE');
 }
});
