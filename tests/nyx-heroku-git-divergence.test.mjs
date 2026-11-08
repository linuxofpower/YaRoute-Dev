import test from 'node:test';
import assert from 'node:assert/strict';
import {safeGitRelationship} from '../scripts/nyx-heroku-git-divergence.mjs';
const a='a'.repeat(40),b='b'.repeat(40);
test('non-fast-forward divergences never suggest a force push',()=>{
 const x=safeGitRelationship(a,b,{
   remoteIsAncestor:false,localIsAncestor:false,hasCommonAncestor:true},false);
 assert.equal(x.status,'READ');
 assert.equal(x.relation,'DIVERGED');
 assert.equal(x.pushMainWouldFastForward,false);
 assert.doesNotMatch(JSON.stringify(x),/force|token|password/i);
});
test('unrelated Git trees require review before deployment',()=>{
 const x=safeGitRelationship(a,b,{
   remoteIsAncestor:false,localIsAncestor:false,hasCommonAncestor:false},false);
 assert.equal(x.relation,'UNRELATED_HISTORIES');
 assert.equal(x.pushMainWouldFastForward,false);
});
test('safe relation classification for synced and fast-forward branches',()=>{
 const synced=safeGitRelationship(a,a,{},true);
 assert.equal(synced.relation,'ALREADY_SYNCED');
 assert.equal(synced.pushMainWouldFastForward,true);
 const ahead=safeGitRelationship(a,b,{remoteIsAncestor:true},false);
 assert.equal(ahead.relation,'REMOTE_BEHIND_LOCAL');
 assert.equal(ahead.pushMainWouldFastForward,true);
 const behind=safeGitRelationship(a,b,{localIsAncestor:true},false);
 assert.equal(behind.relation,'LOCAL_BEHIND_REMOTE');
 assert.equal(behind.pushMainWouldFastForward,false);
});
test('invalid commits and shallow history fail closed',()=>{
 assert.equal(safeGitRelationship('wrong',b,{},false).status,'INVALID_GIT_REF');
 assert.equal(safeGitRelationship(a,b,{},false,true).status,'LOCAL_HISTORY_SHALLOW');
});
