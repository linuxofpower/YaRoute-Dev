import test from 'node:test';
import assert from 'node:assert/strict';
import {validNeonUrl, inspectState, buildPatch, encryptedDevRecoveryPayload, matchesLegacyGoogleClient} from '../scripts/nyx-termux-public-cutover.mjs';
import {scryptSync, createDecipheriv} from 'node:crypto';

const devUrl = 'https://dev-nest-nyx-0df80c227630.herokuapp.com';
const proUrl = 'https://nest-nyx-pro-example.herokuapp.com';
const at=String.fromCharCode(64);
const neon = `postgresql://u:pw${at}ep-falling-silence-b9rcrzay-pooler.c-7.eu-central-1.aws.neon.tech/neondb?sslmode=require`;
const devDb = `postgresql://u:pw${at}private-dev.invalid/neondb?sslmode=require`;
const proDb = `postgresql://u:pw${at}private-pro.invalid/neondb?sslmode=require`;
const owner={email:'operator'+at+'example.invalid'};
const devApp={web_url:devUrl,owner};
const proApp={web_url:proUrl,owner};
const dev = {NYX_DEPLOYMENT_MODE:'private',NYX_PUBLIC_URL:devUrl,
  NYX_OAUTH_ISSUER:'https://dev-q8g77208l2kp7iqu.eu.auth0.com/',
  RCLONE_CONFIG_B64:'private-dev-secret',NYX_PRIVATE_OAUTH_SUBJECTS:'legacy',
  NYX_PRIVATE_BROKER_SHARED_KEY_B64:'legacy-key',NYX_API_KEY:'legacy-api',DATABASE_URL:devDb};
const pro = {NYX_DEPLOYMENT_MODE:'private',NYX_PUBLIC_URL:proUrl,
  RCLONE_CONFIG_B64:'private-pro-secret',
  NYX_PRIVATE_OAUTH_SUBJECTS:'google-oauth2|12345678901234567890',
  NYX_PRIVATE_LEGACY_OWNER_MCP_SUBJECT:'google-oauth2|12345678901234567890',
  NYX_PRIVATE_SINGLE_GOOGLE_OWNER:'true',
  DATABASE_URL:proDb,NYX_STORAGE_ENCRYPTION_KEY:'pro-key'};
const state = () => inspectState(dev,pro,devApp,proApp,[],[{size:'eco',quantity:1}]);
const input = () => ({databaseUrl:neon,proDatabaseUrl:proDb,
  googleClientId:'1234567890-abc.apps.googleusercontent.com',
  googleClientSecret:'somegoogleclientsecret',encryptionKey:'fresh-key'});

test('requires distinct Neon URL with TLS and approved public Neon hostname',()=>{
  assert.ok(validNeonUrl(neon,devDb,proDb));
  assert.equal(validNeonUrl(proDb,devDb,proDb),false);
  assert.equal(validNeonUrl(devDb,devDb,proDb),false);
  assert.equal(validNeonUrl(neon.replace('sslmode=require','sslmode=disable'),devDb,proDb),false);
  assert.equal(validNeonUrl(neon.replace('neon.tech','herokuapp.com'),devDb,proDb),false);
});
test('strips Dev-only legacy private variables and never changes Pro',()=>{
  const original=structuredClone(pro);
  const patch=buildPatch(dev,state(),input());
  for(const key of ['RCLONE_CONFIG_B64','NYX_PRIVATE_OAUTH_SUBJECTS',
    'NYX_PRIVATE_BROKER_SHARED_KEY_B64','NYX_API_KEY']) assert.equal(patch[key],null);
  assert.equal(patch.DATABASE_URL,neon);
  assert.equal(patch.NYX_DEPLOYMENT_MODE,'public');
  assert.equal(patch.NYX_PRIVATE_OWNER_LINK_ENABLED,'false');
  assert.equal(patch.NYX_PRIVATE_BROKER_CLIENT_ENABLED,'false');
  assert.deepEqual(pro,original);
});
test('Heroku API capitalized Eco is accepted without exceeding existing budget',()=>{
  assert.doesNotThrow(()=>inspectState(dev,pro,devApp,proApp,[],[{size:'Eco',quantity:1}]));
  assert.doesNotThrow(()=>inspectState(dev,pro,devApp,proApp,[],[{size:'eco',quantity:1}]));
});
test('blocks Heroku Postgres and non-Eco formation',()=>{
  assert.throws(()=>inspectState(dev,pro,devApp,proApp,
    [{plan:{name:'heroku-postgresql:essential-0'}}],[]),/HEROKU_POSTGRES_ADDON_PRESENT/);
  assert.throws(()=>inspectState(dev,pro,devApp,proApp,
    [],[{size:'standard-1x',quantity:1}]),/NON_ECO_DYNO_PRESENT/);
});
test('blocks missing Pro private credentials or incorrect owner',()=>{
  assert.throws(()=>inspectState(dev,{...pro,RCLONE_CONFIG_B64:''},
    devApp,proApp),/PRO_PRIVATE_BASELINE_INCOMPLETE/);
  assert.throws(()=>inspectState(dev,pro,devApp,
    {web_url:devUrl,owner}),/HEROKU_ORIGINS_NOT_VERIFIED/);
});
test('public cutover requires a sole, pinned Google owner on private Pro',()=>{
  for(const overrides of [
    {NYX_PRIVATE_SINGLE_GOOGLE_OWNER:'false'},
    {NYX_PRIVATE_LEGACY_OWNER_MCP_SUBJECT:''},
    {NYX_PRIVATE_OAUTH_SUBJECTS:pro.NYX_PRIVATE_OAUTH_SUBJECTS+',google-oauth2|222222222222'},
    {NYX_PRIVATE_OAUTH_SUBJECTS:pro.NYX_PRIVATE_OAUTH_SUBJECTS+','+pro.NYX_PRIVATE_OAUTH_SUBJECTS},
    {NYX_PRIVATE_OAUTH_SUBJECTS:'auth0|some-other-identity',
      NYX_PRIVATE_LEGACY_OWNER_MCP_SUBJECT:'auth0|some-other-identity'},
  ]) assert.throws(()=>inspectState(dev,{...pro,...overrides},devApp,proApp),
    /PRO_SINGLE_GOOGLE_OWNER_NOT_VERIFIED/);
});
test('prevents silent encryption-key rotation after successful public cutover',()=>{
  const first=buildPatch(dev,state(),input());
  const configured={...dev,...first};
  for(const [key,value] of Object.entries(configured)) if(value===null)delete configured[key];
  const inspected=inspectState(configured,pro,devApp,proApp);
  assert.equal(inspected.alreadyPublic,true);
  assert.throws(()=>buildPatch(configured,inspected,input()),/ALREADY_PUBLIC_NO_KEY_ROTATION/);
});
test('rejects ambiguous partial public environment',()=>{
  assert.throws(()=>inspectState({...dev,NYX_DEPLOYMENT_MODE:'public'},pro,
    devApp,proApp),/PARTIAL_PUBLIC_CONFIG_REQUIRES_MANUAL_REVIEW/);
});

test('explicit Dev-only pilot defers Pro singleton without allowing any Pro mutation',()=>{
  const privatePro={...pro,NYX_PRIVATE_SINGLE_GOOGLE_OWNER:'false'};
  assert.throws(()=>inspectState(dev,privatePro,devApp,proApp),/PRO_SINGLE_GOOGLE_OWNER_NOT_VERIFIED/);
  const before=structuredClone(privatePro);
  const state=inspectState(dev,privatePro,devApp,proApp,[],[{size:'eco',quantity:1}],{deferProOwnerLock:true});
  const patch=buildPatch(dev,state,input());
  assert.equal(patch.NYX_DEPLOYMENT_MODE,'public');
  assert.equal(patch.NYX_MULTIUSER_RCLONE_ENABLED,'true');
  assert.equal(patch.NYX_PRIVATE_OWNER_LINK_ENABLED,'false');
  assert.equal(patch.NYX_PRIVATE_BROKER_CLIENT_ENABLED,'false');
  for(const key of ['RCLONE_CONFIG_B64','NYX_PRIVATE_OAUTH_SUBJECTS',
      'NYX_PRIVATE_BROKER_SHARED_KEY_B64','NYX_API_KEY']) assert.equal(patch[key],null);
  assert.deepEqual(privatePro,before);
});

test('Dev-only override cannot bypass Pro baseline, same Heroku origin or unsafe paid plan',()=>{
  const options={deferProOwnerLock:true};
  const priv={...pro,NYX_PRIVATE_SINGLE_GOOGLE_OWNER:'false'};
  assert.throws(()=>inspectState(dev,{...priv,RCLONE_CONFIG_B64:''},devApp,proApp,[],[],options),
    /PRO_PRIVATE_BASELINE_INCOMPLETE/);
  assert.throws(()=>inspectState(dev,priv,devApp,{...proApp,web_url:devUrl},[],[],options),
    /HEROKU_ORIGINS_NOT_VERIFIED/);
  assert.throws(()=>inspectState(dev,priv,devApp,proApp,
    [{plan:{name:'heroku-postgresql:essential-0'}}],[],options),/HEROKU_POSTGRES_ADDON_PRESENT/);
});

test('Dev recovery backup encrypts private config and detects tampering',()=>{
  const config={RCLONE_CONFIG_B64:'test-private-rclone-placeholder',DATABASE_URL:devDb};
  const passphrase='test-only-recovery-passphrase';
  const payload=encryptedDevRecoveryPayload(config,passphrase);
  assert.equal(payload.algorithm,'aes-256-gcm+scrypt');
  assert.doesNotMatch(JSON.stringify(payload),/test-private-rclone-placeholder|private-dev.invalid/);
  const decipher=createDecipheriv('aes-256-gcm',
    scryptSync(passphrase,Buffer.from(payload.salt,'base64'),32),
    Buffer.from(payload.iv,'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag,'base64'));
  const plain=Buffer.concat([decipher.update(Buffer.from(payload.data,'base64')),decipher.final()]);
  const recovered=JSON.parse(plain.toString('utf8'));
  assert.deepEqual(recovered.config,config);
  const altered=Buffer.from(payload.data,'base64');
  altered[0]^=0x01;
  const reject=createDecipheriv('aes-256-gcm',
    scryptSync(passphrase,Buffer.from(payload.salt,'base64'),32),
    Buffer.from(payload.iv,'base64'));
  reject.setAuthTag(Buffer.from(payload.tag,'base64'));
  assert.throws(()=>Buffer.concat([reject.update(altered),reject.final()]));
  assert.throws(()=>encryptedDevRecoveryPayload(config,'short'),/DEV_RECOVERY_PASSPHRASE_TOO_SHORT/);
});

test('new public RclonePnP OAuth client never reuses detectable legacy Rclone client',()=>{
  const fresh='1111111111-newpnp.apps.googleusercontent.com';
  const legacy='2222222222-legacy.apps.googleusercontent.com';
  const config=Buffer.from('[oldremote]\ntype = drive\nclient_id = '+legacy+'\n','utf8').toString('base64');
  assert.equal(matchesLegacyGoogleClient(fresh,{RCLONE_CONFIG_B64:config}),false);
  assert.equal(matchesLegacyGoogleClient(legacy,{RCLONE_CONFIG_B64:config}),true);
  assert.equal(matchesLegacyGoogleClient(legacy,{RCLONE_CONFIG_OLD_CLIENT_ID:legacy}),true);
  assert.equal(matchesLegacyGoogleClient(legacy,{NYX_GOOGLE_CLIENT_ID:legacy}),true);
  const stateNow=state();
  assert.throws(()=>buildPatch({...dev,RCLONE_CONFIG_B64:config},
    stateNow,{...input(),googleClientId:legacy}),/PUBLIC_GOOGLE_CLIENT_REUSES_LEGACY/);
  assert.throws(()=>buildPatch(dev,stateNow,
    {...input(),googleClientId:legacy,proConfig:{NYX_GOOGLE_CLIENT_ID:legacy}}),
    /PUBLIC_GOOGLE_CLIENT_REUSES_LEGACY/);
  assert.equal(buildPatch(dev,stateNow,{...input(),googleClientId:fresh,
    proConfig:{RCLONE_CONFIG_B64:config}}).NYX_GOOGLE_CLIENT_ID,fresh);
});
