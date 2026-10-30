const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
let mod;
const source=JSON.parse(fs.readFileSync('config/nyx-runtime-profile.json','utf8'));
const text=o=>JSON.stringify(o,null,2)+'\n';
const target=()=>{const x=JSON.parse(JSON.stringify(source));for(const p of x.keySources){if(['temp_paths','temp_nyxcli'].includes(p.key)){delete p.mode;p.sha256='d'.repeat(64)}}return x};
test('import safe profile reconciliation',async()=>{mod=await import('../scripts/nyx-runtime-draft-profile.mjs')});
test('only observe designated two drafts; preserve Tester recorded sha256',()=>{
 const base=target(),receipt=mod.reconcileObservedDraftProfile(text(source),text(base));
 assert.equal(receipt.changed,true);
 const updated=JSON.parse(receipt.content);
 assert.equal(mod.validateTargetDraftModeUpgrade(text(base),receipt.content).valid,true);
 assert.equal(updated.keySources.find(p=>p.key==='temp_paths').sha256,'d'.repeat(64));
 assert.equal(updated.keySources.find(p=>p.key==='active_key').sha256,source.keySources.find(p=>p.key==='active_key').sha256);
 assert.equal(mod.reconcileObservedDraftProfile(text(source),receipt.content).changed,false);
});
test('refuse CLI/command or trusted key modification',()=>{
 for(const change of [
  x=>x.cliSha256='e'.repeat(64),
  x=>x.keySources.find(p=>p.key==='active_key').sha256='f'.repeat(64),
  x=>x.keySources.find(p=>p.key==='temp_paths').ref.path='other/secret.json',
  x=>x.commands={},
 ]){const base=target();change(base);assert.throws(()=>mod.reconcileObservedDraftProfile(text(source),text(base)),/NYX_DRAFT_PROFILE_/);}
});
test('refuse tampered proposal even if mode is observe',()=>{
 const base=target(),ok=mod.reconcileObservedDraftProfile(text(source),text(base));
 const altered=JSON.parse(ok.content);
 altered.keySources.find(p=>p.key==='active_key').sha256='e'.repeat(64);
 assert.throws(()=>mod.validateTargetDraftModeUpgrade(text(base),text(altered)),/UNREVIEWED_PROFILE_CHANGE/);
});
test('untrusted source cannot enable arbitrary observe mode',()=>{
 const s=JSON.parse(JSON.stringify(source)),t=target();
 s.keySources.find(p=>p.key==='active_key').mode='observe';
 assert.throws(()=>mod.reconcileObservedDraftProfile(text(s),text(t)),/PROFILE_AUTHORITY_OR_TRUSTED_PIN_DIFFERENCE/);
});
