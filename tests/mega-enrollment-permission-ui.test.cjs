const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {MegaEnrollmentController}=require('../dist/connectors/mega-enrollment.controller');
const {TenantMegaEnrollmentService}=require('../dist/connectors/tenant-mega-enrollment.service');

function response(){
 const out={headers:{},statusCode:200,html:null,
  setHeader(key,value){this.headers[key]=value;return this;},
  status(n){this.statusCode=n;return this;},
  type(value){this.contentType=value;return this;},
  send(value){this.html=value;return this;}};
 return out;
}
const chosen=['storage:list','storage:move','storage:delete'];
test('styled MEGA authorization page displays requested permissions, not an unearned write success',async()=>{
 const enrollment={describe:async()=>({rootPath:'MEGA_ROOT',selectedCapabilities:chosen,providerVerifiedCapabilities:['storage:list']})};
 const controller=new MegaEnrollmentController(enrollment),res=response();
 await controller.setup('sample_safe_state',res);
 assert.equal(res.statusCode,200);
 assert.equal(res.headers['Cache-Control'],'no-store');
 assert.match(res.headers['Content-Security-Policy'],/form-action 'self'/);
 assert.match(res.html,/MEGA account email/);
 assert.match(res.html,/MEGA password/);
 assert.match(res.html,/authenticator code \(only if 2FA is enabled\)/);
 assert.match(res.html,/Rename and move individual files/);
 assert.match(res.html,/Move individual files to the MEGA rubbish bin/);
 assert.match(res.html,/not yet granted by submitting this form/i);
 assert.match(res.html,/<style>/);
 assert.doesNotMatch(res.html,/https:\/\/[^"']+\.css/);
});
test('successful callback reports selected and provider-verified grants separately',async()=>{
 const enrollment={complete:async()=>({status:'pending_activation',provider:'mega',rootPath:'MEGA_ROOT',
  selectedCapabilities:chosen,providerVerifiedCapabilities:['storage:list','storage:move'],
  readProbeVerified:true,writeProbeVerified:false})};
 const controller=new MegaEnrollmentController(enrollment),res=response();
 await controller.complete({state:'example',email:['fixture','example.invalid'].join('@'),password:'fixture'},res);
 assert.equal(res.statusCode,200);
 assert.match(res.html,/Read probe: passed. Write probe: not attempted/);
 assert.match(res.html,/Permissions requested for this connection/);
 assert.match(res.html,/Provider-verified grants after login/);
 assert.match(res.html,/Permanent deletion and whole-trash cleanup remain disabled/);
 assert.doesNotMatch(res.html,/fixture@example\.invalid/);
 assert.doesNotMatch(res.html,/fixture.*fixture/);
});
test('expired link and HTML special characters cannot produce active content',async()=>{
 const missing=new MegaEnrollmentController({describe:async()=>null}),missingRes=response();
 await missing.setup('expired',missingRes);
 assert.equal(missingRes.statusCode,400);
 const controller=new MegaEnrollmentController({describe:async()=>({
  rootPath:'<script>alert(1)</script>',
  selectedCapabilities:['storage:list'],providerVerifiedCapabilities:[]})});
 const res=response();await controller.setup('valid_state',res);
 assert.ok(!res.html.includes('<script>alert(1)</script>'));
 assert.match(res.html,/&lt;script&gt;/);
});
test('owner-bound description keeps connection details behind expiring state',async()=>{
 const owner='oauth:google-oauth2|fixture',id='a1111111-2222-4333-8444-555555555555';
 const connection={provider:'mega',status:'active',capabilities:chosen,
  providerCapabilities:['storage:list'],
  resources:[{kind:'mega-root',id:'MEGA_ROOT',capabilities:['storage:list']}]};
 const service=new TenantMegaEnrollmentService({getOwned:async(o,i)=>{
  assert.equal(o,owner);assert.equal(i,id);return connection;}},{});
 let sqlParams;
 service.pool={query:async(sql,params)=>{
  sqlParams={sql,params};return {rowCount:1,rows:[{
   owner_id:owner,connection_id:id,root_path:'MEGA_ROOT'}]};}};
 const info=await service.describe('a'.repeat(43));
 assert.deepEqual(info.selectedCapabilities,chosen);
 assert.deepEqual(info.providerVerifiedCapabilities,['storage:list']);
 assert.equal(info.rootPath,'MEGA_ROOT');
 assert.match(sqlParams.sql,/expires_at>now\(\)/);
 assert.deepEqual(await service.describe('invalid'),null);
});
