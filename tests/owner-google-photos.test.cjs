const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {assertOwnerGooglePhotos,googlePhotosRelativePath} =
  require('../dist/connectors/owner-google-photos.policy');
const {OwnerGooglePhotosService} = require('../dist/connectors/owner-google-photos.service');
const {RcloneService} = require('../dist/storage/rclone.service');

const subject = 'google-oauth2|12345678901234567890';
const owner = 'oauth:' + subject;
const settings = {
  NYX_GPHOTOS_OWNER_READ_ENABLED:'true',
  NYX_GPHOTOS_OWNER_MCP_SUBJECT:subject,
  NYX_GPHOTOS_OWNER_GOOGLE_EMAIL:'owner@example.com',
  NYX_PRIVATE_LEGACY_OWNER_GOOGLE_EMAIL:'owner@example.com',
  NYX_DEPLOYMENT_MODE:'private',
  NYX_SERVICE_NAME:'DevNestNyx',
  NYX_OAUTH_ISSUER:'https://trusted.example.org',
  NYX_PRIVATE_OAUTH_SUBJECTS:subject,
  NYX_PRIVATE_LEGACY_OWNER_MCP_SUBJECT:subject,
};
const denied = /GPHOTOS_OWNER_ACCESS_DENIED/;

test('only the single explicitly configured private Google identity may read', () => {
  assert.doesNotThrow(() => assertOwnerGooglePhotos(owner,settings));
  for (const actor of ['oauth:google-oauth2|88888888888888888888',
    'oauth:auth0|12345678901234567890', 'oauth:', '',
    'linuxofpower@gmail.com']) {
    assert.throws(() => assertOwnerGooglePhotos(actor,settings),denied);
  }
});

test('Google Photos denies public tenants, Pro, ambiguous subjects and other email', () => {
  const overrides = [
    {NYX_GPHOTOS_OWNER_READ_ENABLED:'false'},
    {NYX_DEPLOYMENT_MODE:'public'},
    {NYX_SERVICE_NAME:'NestNyxPro'},
    {NYX_GPHOTOS_OWNER_GOOGLE_EMAIL:'other@example.com'},
    {NYX_PRIVATE_LEGACY_OWNER_GOOGLE_EMAIL:'other@example.com'},
    {NYX_GPHOTOS_OWNER_GOOGLE_EMAIL:undefined},
    {NYX_PRIVATE_OAUTH_SUBJECTS:subject + ',' + subject},
    {NYX_PRIVATE_OAUTH_SUBJECTS:subject + ',google-oauth2|99999999'},
    {NYX_PRIVATE_LEGACY_OWNER_MCP_SUBJECT:'google-oauth2|99999999'},
    {NYX_GPHOTOS_OWNER_MCP_SUBJECT:'auth0|12345678901234567890'},
    {NYX_OAUTH_ISSUER:'http://untrusted.example.com'},
  ];
  for(const change of overrides) {
    assert.throws(() => assertOwnerGooglePhotos(owner,{...settings,...change}),denied,
      JSON.stringify(change));
  }
});

test('reject remote escapes, config injection and path traversal', () => {
  for(const unsafe of ['../elsewhere','a/../b','/absolute','other:photos','a\\b',
    'a\n[secret]', 'a/./b']) {
    assert.throws(() => googlePhotosRelativePath(unsafe),/GPHOTOS_PATH_INVALID/);
  }
  assert.equal(googlePhotosRelativePath('media/by-year/2026'),'media/by-year/2026');
});

test('the private remote requires an unambiguous read-only Google Photos config', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'gphotos-test-'));
  t.after(() => fs.rmSync(directory,{recursive:true,force:true}));
  const config = path.join(directory,'rclone.conf');
  const svc = new RcloneService();
  svc.configPath = config;
  const original = process.env.NYX_DEPLOYMENT_MODE;
  process.env.NYX_DEPLOYMENT_MODE = 'private';
  t.after(()=>{if(original === undefined)delete process.env.NYX_DEPLOYMENT_MODE;
    else process.env.NYX_DEPLOYMENT_MODE=original;});
  const write = s => fs.writeFileSync(config,s,{mode:0o600});
  write('[gphotos_yaro]\ntype = google photos\nread_only = true\ntoken = test\n');
  assert.equal(svc.isGooglePhotosRemoteReadOnly('gphotos_yaro'),true);
  for(const unsafe of [
    '[gphotos_yaro]\ntype = google photos\nread_only = false\n',
    '[gphotos_yaro]\ntype = drive\nread_only = true\n',
    '[gphotos_yaro]\ntype = google photos\nread_only = true\nread_only = false\n',
    '[gphotos_yaro]\ntype = google photos\nread_only = true\n[gphotos_yaro]\nread_only = false\n',
  ]) {
    write(unsafe);
    assert.equal(svc.isGooglePhotosRemoteReadOnly('gphotos_yaro'),false);
  }
  write('[gphotos_yaro]\ntype = google photos\nread_only = true\n');
  process.env.RCLONE_CONFIG_GPHOTOS_YARO_READ_ONLY = 'false';
  assert.equal(svc.isGooglePhotosRemoteReadOnly('gphotos_yaro'),false);
  delete process.env.RCLONE_CONFIG_GPHOTOS_YARO_READ_ONLY;
  process.env.NYX_DEPLOYMENT_MODE = 'public';
  assert.equal(svc.isGooglePhotosRemoteReadOnly('gphotos_yaro'),false);
});

test('no subprocess starts for non-owner; owner gets metadata, no credentials', async t => {
  const keys=Object.keys(settings);
  const previous=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  Object.assign(process.env,settings);
  t.after(()=>keys.forEach(k=>{if(previous[k]===undefined)delete process.env[k];
    else process.env[k]=previous[k];}));
  const calls=[];
  const rclone={
    isGooglePhotosRemoteReadOnly: () => true,
    probeRemoteRead: async name => {calls.push(['probe',name]);return 'verified';},
    run: async (args,limit,timeout) => {calls.push(['run',args,limit,timeout]);return {
      stdout:JSON.stringify([{Path:'2026/11/image.jpg',IsDir:false,Size:45,
        ModTime:'2026-11-08T12:00:00Z'}]),stderr:''};},
  };
  const svc=new OwnerGooglePhotosService(rclone);
  await assert.rejects(()=>svc.list('oauth:someone-else'),denied);
  await assert.rejects(()=>svc.probe('oauth:someone-else'),denied);
  assert.equal(calls.length,0);
  assert.equal((await svc.probe(owner)).readOnly,true);
  const result=await svc.list(owner,'media/by-year/2026');
  assert.equal(result.entries.length,1);
  assert.equal(result.entries[0].captureDateCandidate,'2026-11-08T12:00:00Z');
  assert.deepEqual(calls[1],['run',['lsjson','gphotos_yaro:media/by-year/2026',
    '--max-depth','1'],512*1024,25000]);
  assert.equal(JSON.stringify(result).includes('token'),false);
  await assert.rejects(()=>svc.list(owner,'other:remote'),/GPHOTOS_PATH_INVALID/);
  assert.equal(calls.length,2);
});
