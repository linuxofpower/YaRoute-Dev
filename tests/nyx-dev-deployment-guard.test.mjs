import test from 'node:test';
import assert from 'node:assert/strict';
import {safeDevDeployment} from '../scripts/nyx-dev-deployment-guard.mjs';

const SHA='a'.repeat(40);
test('current deployed source matches the authenticated local checkout',()=>{
 const result=safeDevDeployment({ok:true,commit:SHA,rawSecret:'never-capture'},SHA);
 assert.equal(result.deployedCurrentSource,true);
 assert.equal(result.status,'CURRENT_SOURCE_VERIFIED');
 assert.doesNotMatch(JSON.stringify(result),/never-capture/);
});
test('unknown and old deployed commits cannot authorize cutover',()=>{
 for(const health of [null,{}, {ok:false,commit:SHA},
   {ok:true,commit:'not-a-commit'}, {ok:true,commit:'b'.repeat(40)},
   {ok:true,commit:'a'.repeat(6)}]){
   assert.equal(safeDevDeployment(health,SHA).deployedCurrentSource,false);
 }
});
test('short but uniquely matching source prefixes and local git validation',()=>{
 assert.equal(safeDevDeployment({ok:true,commit:SHA.slice(0,12)},SHA).deployedCurrentSource,true);
 assert.equal(safeDevDeployment({ok:true,commit:SHA},'unknown').deployedCurrentSource,false);
});
