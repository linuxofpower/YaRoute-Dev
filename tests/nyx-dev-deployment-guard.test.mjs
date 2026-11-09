import test from 'node:test';
import assert from 'node:assert/strict';
import {safeDevDeployment,safeTesterBranch} from '../scripts/nyx-dev-deployment-guard.mjs';

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
