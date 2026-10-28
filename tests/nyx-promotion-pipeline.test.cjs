const {test}=require('node:test');
const assert=require('node:assert/strict');
const A='a'.repeat(40),B='b'.repeat(40),C='c'.repeat(40),D='d'.repeat(40);
const tree=files=>({truncated:false,tree:Object.entries(files).map(([path,sha])=>({path,sha,type:'blob'}))});
const meta={sourceRepo:['linux','ofpower/YaRoute-Dev'].join(''),targetRepo:'yaMorozYaroslav/YaRoute',sourceSha:A,targetSha:B};
let promotion,adapter;
test('import promotion and target adapter',async()=>{
 promotion=await import('../scripts/nyx-promotion-plan.mjs');
 adapter=await import('../scripts/nyx-deployment-adapter.mjs');
 assert.equal(typeof promotion.plan,'function');assert.equal(typeof adapter.proposal,'function');
});
test('unreviewed differences fail closed and preserve tester-only',()=>{
 const p=promotion.plan({...meta,source:tree({'src/x.ts':C,'src/brand.ts':B}),
 target:tree({'src/x.ts':D,'.github/CODEOWNERS':A})});
 assert.equal(p.status,'BLOCKED');assert.equal(p.actions.length,0);
 assert.equal(p.summary.targetOnly,1);assert.equal(p.summary.unresolved,2);
 assert.equal(p.entries.find(x=>x.path==='.github/CODEOWNERS').resolution,'preserve');
});
test('approved actions require exact source and tester blob pins',()=>{
 const source=tree({'src/x.ts':C,'src/new.ts':B}),target=tree({'src/x.ts':D});
 const decisions={
  'src/x.ts':{action:'copy_source',sourceBlob:C,targetBlob:D,rationale:'Reviewed the diff and preserved tests'},
  'src/new.ts':{action:'copy_source',sourceBlob:B,targetBlob:null,rationale:'Reviewed new module for tester safety'}
 };
 const p=promotion.plan({...meta,source,target,decisions});
 assert.equal(p.status,'REVIEW_READY');assert.equal(p.actions.length,2);
 assert.equal(p.planSha256,promotion.plan({...meta,source,target,decisions}).planSha256);
 assert.throws(()=>promotion.plan({...meta,source,target,decisions:{'src/x.ts':{...decisions['src/x.ts'],sourceBlob:A}}}),/STALE_DECISION/);
});
test('refuse tree truncation, traversal, duplicate paths and unexpected decisions',()=>{
 const source=tree({'src/x.ts':C}),target=tree({});
 assert.throws(()=>promotion.plan({...meta,source:{truncated:true,tree:[]},target}),/TREE_INCOMPLETE/);
 assert.throws(()=>promotion.plan({...meta,source:tree({'../escape':C}),target}),/INVALID_BLOB/);
 assert.throws(()=>promotion.plan({...meta,source,target,decisions:{'src/unrelated.ts':{}}}),/EXTRANEOUS_DECISION/);
});
test('credentials and target-owned metadata never copied, even with explicit decision',()=>{
 const source=tree({'config/credentials.json':C,'app.json':D,'src/main.ts':D});
 const target=tree({'app.json':C,'src/main.ts':C});
 const decisions={
  'config/credentials.json':{action:'copy_source',sourceBlob:C,targetBlob:null,rationale:'Rejected credential copy attempt'},
  'app.json':{action:'copy_source',sourceBlob:D,targetBlob:C,rationale:'Rejected production settings overwrite attempt'}
 };
 const p=promotion.plan({...meta,source,target,decisions});
 assert.equal(p.actions.length,0);
 assert.equal(p.status,'BLOCKED');
 assert.equal(p.entries.find(x=>x.path==='config/credentials.json').resolution,'forbidden');
 assert.equal(p.entries.find(x=>x.path==='app.json').resolution,'preserve');
});
test('production adaptation emits only non-secret proposals',()=>{
 const p=adapter.proposal('production');
 assert.equal(p.branch,'master');assert.equal(p.safeDefaults.NYX_DEPLOYMENT_MODE,'private');
 assert.equal(p.safeDefaults.NYX_PUBLIC_CONNECTORS_ENABLED,'false');
 assert.equal(p.safeDefaults.NYX_SERVICE_NAME,'NestNyx');
 assert.equal(p.safeDefaults.DATABASE_URL,undefined);
 assert.ok(p.externalSecretKeyNames.includes('DATABASE_URL'));
 assert.ok(p.preserveTargetPaths.includes('app.json'));
});
test('profile validation rejects sensitive values; distinguishes proposal from runtime proof',()=>{
 const expected=adapter.proposal('tester').safeDefaults;
 assert.equal(adapter.validateProfile('tester',expected).status,'PROPOSED_PROFILE_MATCH');
 assert.equal(adapter.validateProfile('tester',{...expected,NYX_DEPLOYMENT_MODE:'public'}).status,'BLOCKED');
 assert.throws(()=>adapter.validateProfile('tester',{...expected,DATABASE_URL:'secret'}),/SENSITIVE_ENV_INPUT_REFUSED/);
});
