const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {
 ACCOUNT_VIEW_URI,ACCOUNT_VIEW_HTML,signStorageView,verifyStorageView,
 storageSnapshotItem,summarizeVerifiedDuplicates,
}=require('../dist/connectors/multi-account-view');

const key=Buffer.alloc(32,19).toString('base64');
const wrong=Buffer.alloc(32,20).toString('base64');
const connections=[{displayName:'MEGA research',provider:'mega',status:'active',
 selected:['storage:list','storage:move','storage:delete'],
 providerVerified:['storage:list'],resourceCount:1}];

test('separate OAuth principals yield distinct signed, read-only 3-minute views',()=>{
 const a=signStorageView('oauth:google-oauth2|primary','Google account A',connections,key,10000);
 const b=signStorageView('oauth:google-oauth2|personal','Google account B',[],key,10000);
 const va=verifyStorageView(a,key,10001),vb=verifyStorageView(b,key,10001);
 assert.notEqual(va.ownerHint,vb.ownerHint);
 assert.equal(va.connections[0].provider,'mega');
 assert.deepEqual(va.connections[0].providerVerified,['storage:list']);
 assert.deepEqual(vb.connections,[]);
 assert.equal(va.expiresAt-va.issuedAt,180);
 assert.deepEqual(Object.keys(va).sort(),['connections','display','expiresAt','issuedAt','ownerHint','schema'].sort());
 assert.doesNotMatch(JSON.stringify(va),/oauth:google-oauth2\|primary|obscuredPassword|rclone\.conf/);
});

test('snapshot rejects wrong secret, edited bits, expiry, future issuance and bad owner input',()=>{
 const snap=signStorageView('oauth:alice','Account',connections,key,10000);
 assert.throws(()=>verifyStorageView(snap,wrong,10001),/SIGNATURE_INVALID/);
 assert.throws(()=>verifyStorageView(snap+'A',key,10001),/TOKEN_INVALID/);
 assert.throws(()=>verifyStorageView(snap,key,10181),/EXPIRED_OR_INVALID/);
 assert.throws(()=>verifyStorageView(snap,key,9990),/EXPIRED_OR_INVALID/);
 assert.throws(()=>signStorageView('unverified','Account',connections,key,10000),/OWNER_REQUIRED/);
 assert.throws(()=>signStorageView('oauth:alice','Account',[{
   ...connections[0],providerVerified:['storage:permanent-delete']
 }],key,10000),/VIEW_INVALID/);
});

test('viewer is display-only and requires signed, distinct, caller-included owners',()=>{
 const source=fs.readFileSync(path.join(__dirname,'..','src/mcp/mcp.service.ts'),'utf8');
 assert.match(source,/registerTool\('nyx_account_view_snapshot'/);
 assert.match(source,/registerTool\('nyx_accounts_view'/);
 assert.match(source,/publicConnections=await this\.connections\.listStorage\(owner\)/);
 assert.match(source,/linkedRemotes=await privateRemotesForOwner\(owner\)/);
 assert.match(source,/verifyStorageView\(a\.snapshot,key\)/);
 assert.match(source,/NYX_ACCOUNT_VIEW_DUPLICATE_OWNER/);
 assert.match(source,/NYX_ACCOUNT_VIEW_CALLER_NOT_INCLUDED/);
 assert.match(source,/readOnly:true,noCrossTenantAuthorization:true/);
 assert.match(source,/ACCOUNT_VIEW_URI/);
 assert.equal(ACCOUNT_VIEW_URI,'ui://nestnyx/dev/connections/multi-v3.html');
 assert.match(ACCOUNT_VIEW_HTML,/role="tablist"/);
 assert.match(ACCOUNT_VIEW_HTML,/signed account snapshots/);
 assert.ok(ACCOUNT_VIEW_HTML.includes('envelope?.result??envelope'));
 assert.ok(ACCOUNT_VIEW_HTML.includes("v.label+' ('+v.connections.length+')'"));
 assert.match(ACCOUNT_VIEW_HTML,/payload\.accounts\.length>3/);
 assert.match(source,/\.min\(2\)\.max\(3\)/);
 assert.match(ACCOUNT_VIEW_HTML,/role="tabpanel"/);
 assert.match(ACCOUNT_VIEW_HTML,/Verified duplicate MEGA accounts/);
 assert.match(ACCOUNT_VIEW_HTML,/Switching tabs changes only what you see/);
 assert.match(ACCOUNT_VIEW_HTML,/does not switch OAuth credentials/);
 assert.doesNotMatch(ACCOUNT_VIEW_HTML,/localStorage|sessionStorage|document\.cookie|fetch\(/);
 assert.doesNotMatch(ACCOUNT_VIEW_HTML,/window\.openai\.callTool|tools\/call/);
});


function mega(name,email,selected,providerVerified=selected,resources=[
  {kind:'mega-root',id:'MEGA_ROOT',capabilities:selected}
]) {
 return storageSnapshotItem({displayName:name,provider:'mega',status:'active',
   externalAccountId:email,capabilities:selected,providerCapabilities:providerVerified,
   resources},key,true);
}
test('exact same verified MEGA identity gets an opaque duplicate hint but labels never do',()=>{
 const a=mega('Primary MEGA',['same','example.invalid'].join('@'),
   ['storage:list','storage:move','storage:delete']);
 const b=mega('Another alias',['SAME','EXAMPLE.INVALID'].join('@'),
   ['storage:list']);
 assert.equal(a.duplicateKey,b.duplicateKey);
 assert.match(a.duplicateKey,/^[a-f0-9]{32}$/);
 assert.ok(!JSON.stringify(a).includes('example.invalid'));
 const other=mega('Primary MEGA',['other','example.invalid'].join('@'),
   ['storage:list']);
 assert.notEqual(a.duplicateKey,other.duplicateKey);
 const notExactRoot=mega('Subfolder',['same','example.invalid'].join('@'),
   ['storage:list'],['storage:list'],[
   {kind:'mega-root',id:'MyFolder',capabilities:['storage:list']}
 ]);
 assert.equal(notExactRoot.duplicateKey,null);
});
test('preferred duplicate is a single strongest effective grant; Primary wins ties',()=>{
 const email=['same','example.invalid'].join('@');
 const read=mega('Personal alias',email,['storage:list']);
 const deep=mega('Primary alias',email,['storage:list','storage:move','storage:delete']);
 const accountA={label:'Primary',ownerHint:'aaaaaaaaaaaaaaaa',connections:[deep]};
 const accountB={label:'Personal',ownerHint:'bbbbbbbbbbbbbbbb',connections:[read]};
 let results=summarizeVerifiedDuplicates([accountB,accountA]);
 assert.equal(results.length,1);
 assert.equal(results[0].preferred.label,'Primary');
 assert.deepEqual(results[0].preferred.effective,['storage:list','storage:move','storage:delete']);
 assert.deepEqual(results[0].alternatives[0].effective,['storage:list']);
 assert.equal(results[0].preferred.ownerHint,'aaaaaaaaaaaaaaaa');
 // A weaker Primary cannot override a more powerful Personal connection.
 results=summarizeVerifiedDuplicates([
   {...accountA,connections:[read]}, {...accountB,connections:[deep]}
 ]);
 assert.equal(results[0].preferred.label,'Personal');
 // A connection to the same MEGA through only one OAuth owner is NOT
 // cross-profile proof, regardless of labels.
 assert.deepEqual(summarizeVerifiedDuplicates([
   {...accountA,connections:[deep,read]}]),[]);
});
test('unverified writes, pending accounts and server policy never create fake permission',()=>{
 const email=['same','example.invalid'].join('@');
 const c=mega('Unverified delete',email,
   ['storage:list','storage:move','storage:delete'],['storage:list']);
 assert.deepEqual(c.effective,['storage:list']);
 const unavailable=storageSnapshotItem({
   displayName:'pending',provider:'mega',status:'pending',
   externalAccountId:email,capabilities:['storage:list','storage:delete'],
   providerCapabilities:['storage:list','storage:delete'],
   resources:[{kind:'mega-root',id:'MEGA_ROOT',capabilities:['storage:list','storage:delete']}]
 },key,true);
 assert.deepEqual(unavailable.effective,[]);
 assert.equal(unavailable.duplicateKey,null);
 const readOnlyPolicy=storageSnapshotItem({
   displayName:'read policy',provider:'mega',status:'active',
   externalAccountId:email,capabilities:['storage:list','storage:delete'],
   providerCapabilities:['storage:list','storage:delete'],
   resources:[{kind:'mega-root',id:'MEGA_ROOT',capabilities:['storage:list','storage:delete']}]
 },key,false);
 assert.deepEqual(readOnlyPolicy.effective,['storage:list']);
 const wrongRoot=mega('Wrong exact root',email,['storage:list','storage:delete'],
   ['storage:list','storage:delete'],[{kind:'mega-root',id:'Any',
   capabilities:['storage:list','storage:delete']}]);
 assert.equal(wrongRoot.duplicateKey,null);
 // Display-only HTML cannot dispatch actions or swap OAuth identities.
 assert.match(ACCOUNT_VIEW_HTML,/A tab never authorizes another account/);
 assert.doesNotMatch(ACCOUNT_VIEW_HTML,/window\.openai\.callTool|tools\/call|fetch\(/);
});
test('three accounts remain separate, and the fourth is rejected by viewer schema',()=>{
 const source=fs.readFileSync('src/mcp/mcp.service.ts','utf8');
 assert.match(source,/accounts:z\.array/);
 assert.match(source,/\.min\(2\)\.max\(3\)/);
 assert.match(ACCOUNT_VIEW_HTML,/payload\.accounts\.length<2\|\|payload\.accounts\.length>3/);
 assert.match(ACCOUNT_VIEW_HTML,/verifiedDuplicates/);
 assert.match(source,/NYX_ACCOUNT_VIEW_DUPLICATE_OWNER/);
 assert.match(source,/NYX_ACCOUNT_VIEW_CALLER_NOT_INCLUDED/);
});
