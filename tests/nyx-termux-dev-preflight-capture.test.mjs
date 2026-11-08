import test from 'node:test';
import assert from 'node:assert/strict';
import {safeFormation,safePlan} from '../scripts/nyx-termux-dev-preflight-capture.mjs';
test('only allowed process fields are captured, stopped dynos ignored',()=>{
 const r=safeFormation([{type:'web',size:'basic',quantity:1,secret:'DO_NOT_COPY'},
    {type:'worker',size:'eco',quantity:0}]);
 assert.deepEqual(r,{status:'READ',active:[{type:'web',size:'basic',quantity:1}],nonEcoActive:true});
 assert.doesNotMatch(JSON.stringify(r),/DO_NOT_COPY/);
 assert.equal(safeFormation([{type:'web',size:'eco',quantity:1}]).nonEcoActive,false);
});
test('invalid provider formation cannot be captured',()=>{
 for(const bad of [null,{},[{type:'web',size:'basic',quantity:-1}],
  [{type:'web',size:'malformed\nsecret',quantity:1}],Array(51).fill({type:'web',size:'eco',quantity:0})])
   assert.throws(()=>safeFormation(bad),/FORMATION_INVALID/);
});
test('blocked preflight captures only its named blocker',()=>{
 const r=safePlan(1,'SECRET','KEY\nCUTOVER_STOPPED: NON_ECO_DYNO_PRESENT\n');
 assert.deepEqual(r,{status:'BLOCKED',code:'NON_ECO_DYNO_PRESENT'});
 assert.doesNotMatch(JSON.stringify(r),/SECRET|KEY/);
});
test('passing preflight filters untrusted extra fields',()=>{
 const p={schema:'nyx.termux-public-cutover.v1',mode:'--dev-only-plan',
   target:'dev-nest-nyx',untouched:'nest-nyx-pro',
   devPrivateKeyNamesToRemove:['RCLONE_CONFIG_B64'],extra:'SECRET'};
 const r=safePlan(0,JSON.stringify(p),'');
 assert.equal(r.status,'CONFIG_READS_PASS');
 assert.equal(r.oldDevConfigKeysToRemove,1);
 assert.doesNotMatch(JSON.stringify(r),/SECRET/);
 assert.throws(()=>safePlan(0,JSON.stringify({...p,mode:'--apply'}),''),/PLAN_INVALID/);
});
