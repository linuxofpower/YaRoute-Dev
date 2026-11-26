const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ConnectorsService } = require('../dist/connectors/connectors.service');

const vars = [
  'NYX_DEPLOYMENT_MODE', 'NYX_PUBLIC_CONNECTORS_ENABLED',
  'NYX_MULTIUSER_RCLONE_ENABLED', 'NYX_PUBLIC_TENANT_MEGA_ONLY',
  'NYX_PUBLIC_TENANT_GOOGLE_MULTI_ENABLED', 'NYX_PUBLIC_GOOGLE_WRITE_ENABLED',
  'NYX_PUBLIC_MEGA_WRITE_ENABLED',
];
function flags(t, overrides={}) {
  const saved = Object.fromEntries(vars.map(k=>[k,process.env[k]]));
  t.after(()=>{
    for(const [k,v] of Object.entries(saved)){
      if(v===undefined)delete process.env[k];
      else process.env[k]=v;
    }
  });
  const target={
    NYX_DEPLOYMENT_MODE:'public',
    NYX_PUBLIC_CONNECTORS_ENABLED:'true',
    NYX_MULTIUSER_RCLONE_ENABLED:'true',
    NYX_PUBLIC_TENANT_MEGA_ONLY:'false',
    NYX_PUBLIC_TENANT_GOOGLE_MULTI_ENABLED:'true',
    NYX_PUBLIC_GOOGLE_WRITE_ENABLED:'false',
    NYX_PUBLIC_MEGA_WRITE_ENABLED:'false',
    ...overrides,
  };
  Object.assign(process.env,target);
}
const rw=['storage:list','storage:write','storage:move','storage:delete'];

test('public Google + MEGA RO runtime advertises list only', t=>{
  flags(t);
  const svc=new ConnectorsService();
  assert.deepEqual(svc.enabledCapabilities('google-drive'),['storage:list']);
  assert.deepEqual(svc.enabledCapabilities('mega'),['storage:list']);
  assert.deepEqual(svc.enabledCapabilities('heroku'),[]);
});

test('public Google and MEGA RW flags independently advertise supported tool surface', t=>{
  flags(t,{NYX_PUBLIC_GOOGLE_WRITE_ENABLED:'true'});
  const svc=new ConnectorsService();
  assert.deepEqual(svc.enabledCapabilities('google-drive'),rw);
  assert.deepEqual(svc.enabledCapabilities('mega'),['storage:list']);
  process.env.NYX_PUBLIC_GOOGLE_WRITE_ENABLED='false';
  process.env.NYX_PUBLIC_MEGA_WRITE_ENABLED='true';
  assert.deepEqual(svc.enabledCapabilities('google-drive'),['storage:list']);
  assert.deepEqual(svc.enabledCapabilities('mega'),rw);
});

test('MEGA-only mode never advertises Google Drive despite enabled RW flag', t=>{
  flags(t,{
    NYX_PUBLIC_TENANT_GOOGLE_MULTI_ENABLED:'false',
    NYX_PUBLIC_TENANT_MEGA_ONLY:'true',
    NYX_PUBLIC_GOOGLE_WRITE_ENABLED:'true',
    NYX_PUBLIC_MEGA_WRITE_ENABLED:'true',
  });
  const svc=new ConnectorsService();
  assert.deepEqual(svc.enabledCapabilities('google-drive'),[]);
  assert.deepEqual(svc.enabledCapabilities('mega'),rw);
});

test('private, disabled and contradictory tenant modes never advertise tenant operations', t=>{
  flags(t,{NYX_PUBLIC_GOOGLE_WRITE_ENABLED:'true',NYX_PUBLIC_MEGA_WRITE_ENABLED:'true'});
  const svc=new ConnectorsService();
  for(const update of [
    {NYX_DEPLOYMENT_MODE:'private'},
    {NYX_DEPLOYMENT_MODE:'public',NYX_PUBLIC_CONNECTORS_ENABLED:'false'},
    {NYX_PUBLIC_CONNECTORS_ENABLED:'true',NYX_MULTIUSER_RCLONE_ENABLED:'false'},
    {NYX_MULTIUSER_RCLONE_ENABLED:'true',NYX_PUBLIC_TENANT_MEGA_ONLY:'true'},
    {NYX_PUBLIC_TENANT_MEGA_ONLY:'false',NYX_PUBLIC_TENANT_GOOGLE_MULTI_ENABLED:'false'},
  ]){
    Object.assign(process.env,update);
    assert.deepEqual(svc.enabledCapabilities('google-drive'),[]);
    assert.deepEqual(svc.enabledCapabilities('mega'),[]);
  }
});

test('advertised RW tools never convert a read-only imported connection to RW',t=>{
  flags(t,{NYX_PUBLIC_GOOGLE_WRITE_ENABLED:'true',NYX_PUBLIC_MEGA_WRITE_ENABLED:'true'});
  const svc=new ConnectorsService();
  for(const provider of ['mega','google-drive']){
    const onlyList=['storage:list'];
    const source={
      id:'12345678-1234-4234-8234-123456789abc',
      ownerId:'oauth:synthetic-owner',
      displayName:'synthetic-RO',
      provider,externalAccountId:'synthetic',
      capabilities:onlyList,
      providerCapabilities:onlyList,
      resources:[{kind:provider==='mega'?'mega-root':'drive',id:'test-root',capabilities:onlyList}],
      status:'active',
    };
    const result=svc.view(source);
    assert.deepEqual(result.availableCapabilities,rw);
    assert.deepEqual(result.capabilities,onlyList);
    assert.deepEqual(result.providerCapabilities,onlyList);
    assert.deepEqual(result.resources[0].capabilities,onlyList);
  }
});
