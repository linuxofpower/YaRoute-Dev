const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  INDEX_BUDGETS, startIndexTraversal, advanceIndexTraversal,
} = require('../dist/indexing/index-depth-policy.js');

const scope = {
  ownerId: 'oauth:auth0|index-owner-A',
  connectionId: '4dc262bd-f27a-43b5-8e2d-d5fa761cb88f',
  provider: 'mega', rootId: 'MEGA_ROOT', relativePath: '',
};
const one = (path, isDir=false, size=10) => ({path,isDir,size});
const listing = (items=[], truncated=false) => ({readOnly:true,truncated,items});
function step(s, source, counts=[0,0,0], currentScope=scope) {
  return advanceIndexTraversal(currentScope, s, source, ...counts);
}

test('three depth budgets are finite and ordered', () => {
  assert.equal(INDEX_BUDGETS.shallow.maxDepth, 1);
  assert.equal(INDEX_BUDGETS.normal.maxDepth, 3);
  assert.ok(INDEX_BUDGETS.deep.maxDepth > INDEX_BUDGETS.normal.maxDepth);
  for (const b of Object.values(INDEX_BUDGETS)) {
    assert.ok(Number.isInteger(b.maxEntriesPerRun) && b.maxEntriesPerRun <= 4000);
    assert.ok(Number.isInteger(b.maxRuntimeMs) && b.maxRuntimeMs <= 120000);
  }
});

test('shallow collects only the root immediate entries, then finishes', () => {
  const origin = startIndexTraversal(scope, 'shallow');
  const x = step(origin, listing([one('root.txt'),one('Subfolder',true,0)]));
  assert.equal(x.status,'COMPLETE');
  assert.equal(x.batch.entries.length, 2);
  assert.equal(x.traversal.pending.length,0);
  assert.equal(x.traversal.processedDirectories,1);
  assert.equal(x.traversal.processedEntries,2);
  assert.equal(x.batch.mayDeleteMissing,false);
  assert.deepEqual(origin.pending,[{path:'',depth:0}]);
});

test('normal traverses to depth 3 and never follows deeper directories', () => {
  let s=startIndexTraversal(scope,'normal');
  s=step(s,listing([one('A',true)])).traversal;
  assert.deepEqual(s.pending,[{path:'A',depth:1}]);
  s=step(s,listing([one('B',true),one('file.txt')])).traversal;
  assert.deepEqual(s.pending,[{path:'A/B',depth:2}]);
  const last=step(s,listing([one('C',true)]));
  assert.equal(last.status,'COMPLETE');
  assert.equal(last.traversal.pending.length,0);
  assert.equal(last.traversal.processedDirectories,3);
  assert.equal(last.batch.entries[0].path,'A/B/C');
});

test('deep is recursive but remains resumable across bounded runs', () => {
  const s=startIndexTraversal(scope,'deep');
  const a=step(s,listing([one('A',true)]));
  assert.equal(a.status,'PROGRESSED');
  const paused=step(a.traversal,listing([one('B',true)]),[
    INDEX_BUDGETS.deep.maxDirectoriesPerRun,0,0,
  ]);
  assert.equal(paused.status,'PAUSED_BUDGET');
  assert.equal(paused.batch,null);
  assert.deepEqual(paused.traversal,a.traversal);
  const resumed=step(paused.traversal,listing([one('B',true)]));
  assert.equal(resumed.status,'PROGRESSED');
  assert.deepEqual(resumed.traversal.pending,[{path:'A/B',depth:2}]);
});

test('truncation blocks all levels without consuming cursor or claiming full inventory', () => {
  for(const mode of ['shallow','normal','deep']){
    const s=startIndexTraversal(scope,mode);
    const result=step(s,listing([one('file.txt')],true));
    assert.equal(result.status,'BLOCKED_TRUNCATED');
    assert.equal(result.batch,null);
    assert.equal(result.reason,'INDEX_DIRECTORY_PAGINATION_REQUIRED');
    assert.deepEqual(result.traversal,s);
  }
});

test('cross-user scopes and replaced roots fail before state advancement', () => {
  const s=startIndexTraversal(scope,'deep');
  const other={...scope,ownerId:'oauth:auth0|index-owner-B'};
  assert.notEqual(s.scopeKey,startIndexTraversal(other,'deep').scopeKey);
  assert.throws(()=>step(s,listing(),[0,0,0],other),/INDEX_SCOPE_MISMATCH/);
  assert.throws(()=>step(s,listing(),[0,0,0],{...scope,rootId:'other-root'}),
    /INDEX_SCOPE_MISMATCH/);
});

test('non-root traversal initialization and invalid mode fail closed', () => {
  assert.throws(()=>startIndexTraversal({...scope,relativePath:'Documents'},'deep'),
    /INDEX_SCOPE_MUST_BE_ROOT/);
  assert.throws(()=>startIndexTraversal(scope,'unbounded'),/INDEX_DEPTH_INVALID/);
  assert.throws(()=>startIndexTraversal({...scope,ownerId:'owner'},'normal'),
    /INDEX_OWNER_INVALID/);
});

test('timeouts, item quotas and unexpected nested paths prevent commits', () => {
  const s=startIndexTraversal(scope,'normal');
  let paused=step(s,listing([one('file')]),[0,0,90000]);
  assert.equal(paused.status,'PAUSED_BUDGET');
  assert.equal(paused.batch,null);
  paused=step(s,listing([one('file')]),[0,1200,0]);
  assert.equal(paused.status,'PAUSED_BUDGET');
  paused=step(s,listing([one('file')]),[0,1199,0]);
  assert.equal(paused.status,'COMPLETE');
  assert.throws(()=>step(s,listing([one('a/b.txt')])),/INDEX_ENTRY_NOT_IMMEDIATE_CHILD/);
  assert.throws(()=>step(s,listing([one('f')]),[-1,0,0]),/INDEX_BUDGET_INPUT_INVALID/);
});

test('visited and pending directory checkpoint cannot overlap or contain traversal', () => {
  const s=startIndexTraversal(scope,'deep');
  assert.throws(()=>step({...s,pending:[{path:'../secret',depth:0}]},listing()),
    /INDEX_CHECKPOINT_INVALID/);
  assert.throws(()=>step({...s,visited:['']},listing()),
    /INDEX_CHECKPOINT_INVALID/);
  assert.throws(()=>step({...s,pending:[{path:'',depth:0},{path:'',depth:0}]},listing()),
    /INDEX_CHECKPOINT_INVALID/);
});

test('cap of 100 source entries propagates and cannot claim completed index', () => {
  const s=startIndexTraversal(scope,'deep');
  assert.throws(()=>step(s,listing(Array.from({length:101},(_,i)=>one('f'+i)))),
    /INDEX_SOURCE_UNTRUSTED_OR_UNBOUNDED/);
});

test('deep mode cannot certify completion when descendants exceed safety depth', () => {
  let s=startIndexTraversal(scope,'deep');
  for(let depth=0;depth<63;depth++){
    const r=step(s,listing([one('d'+depth,true)]));
    assert.equal(r.status,'PROGRESSED');
    s=r.traversal;
  }
  const last=step(s,listing([one('overflow',true)]));
  assert.equal(last.status,'INCOMPLETE_DEPTH_LIMIT');
  assert.equal(last.reason,'INDEX_DEPTH_LIMIT_REACHED');
  assert.equal(last.traversal.pending.length,0);
  assert.equal(last.traversal.depthLimitReached,true);
  assert.equal(step(last.traversal,listing()).status,'INCOMPLETE_DEPTH_LIMIT');
});
