#!/usr/bin/env node
/**
 * READ ONLY: Never output Heroku config values, process.env, URL passwords,
 * OAuth secrets, tokens, authentication errors, or file contents.
 * Heroku CLI must already be authenticated on the operator's own machine.
 * This tool neither opens a dyno nor changes config, addons, or formation.
 */
import { spawnSync } from 'node:child_process';

const DEV = 'dev-nest-nyx';
const PRO = 'nest-nyx-pro';
const NON_SECRET_KEYS = [
  'NYX_DEPLOYMENT_MODE','NYX_PUBLIC_CONNECTORS_ENABLED',
  'NYX_MULTIUSER_RCLONE_ENABLED','NYX_PUBLIC_TENANT_GOOGLE_MULTI_ENABLED',
  'NYX_PUBLIC_TENANT_MEGA_ONLY','NYX_SERVICE_NAME',
];
const PRIVATE_KEY_NAMES = [
  'RCLONE_CONFIG_B64','RCLONE_CONFIG_PATH','RCLONE_CONFIG',
  'NYX_SHARED_ROOTS_JSON','NYX_PRIVATE_OAUTH_SUBJECTS',
  'NYX_PRIVATE_SINGLE_GOOGLE_OWNER',
];
function fetchJson(args) {
  const result = spawnSync('heroku', args, {
    shell:false, encoding:'utf8', timeout:20_000, maxBuffer:4*1024*1024,
    env:{...process.env,HEROKU_SKIP_UPDATE_CHECK:'1'},
  });
  if (result.error || result.status !== 0) throw new Error('HEROKU_READ_FAILED');
  try { return JSON.parse(result.stdout); }
  catch { throw new Error('HEROKU_JSON_INVALID'); }
}
function origin(value) {
  try {
    const u = new URL(String(value));
    if (u.protocol !== 'https:' || u.username || u.password) return '';
    return u.origin;
  } catch { return ''; }
}
function dbHost(value) {
  try { return new URL(String(value)).hostname.toLowerCase(); }
  catch { return ''; }
}
function keyPresent(c,key) {
  return typeof c[key] === 'string' && c[key].trim().length>0;
}
function singleGoogleOwnerConfigured(c) {
  const subjects=c.NYX_PRIVATE_OAUTH_SUBJECTS;
  return c.NYX_DEPLOYMENT_MODE==='private' &&
    c.NYX_PRIVATE_SINGLE_GOOGLE_OWNER==='true' &&
    typeof subjects==='string' &&
    /^google-oauth2\|[A-Za-z0-9_-]{8,128}$/.test(subjects) &&
    subjects===c.NYX_PRIVATE_LEGACY_OWNER_MCP_SUBJECT;
}
function reportApp(name,config,meta) {
  const flags=Object.fromEntries(NON_SECRET_KEYS.map(k=>[k,config[k]||null]));
  const actualOrigin=origin(meta.web_url || meta.webUrl || meta.app?.web_url);
  return {
    name, publicUrlMatchesHeroku:Boolean(actualOrigin && actualOrigin===origin(config.NYX_PUBLIC_URL)),
    flags,
    hasLegacyPrivateRcloneConfig:PRIVATE_KEY_NAMES.some(k=>keyPresent(config,k)) ||
      Object.keys(config).some(k=>k.startsWith('RCLONE_CONFIG_') && keyPresent(config,k)),
    hasEncryptedDatabase:Boolean(keyPresent(config,'DATABASE_URL') &&
      keyPresent(config,'NYX_STORAGE_ENCRYPTION_KEY')),
    hasOwnerAllowlist:keyPresent(config,'NYX_PRIVATE_OAUTH_SUBJECTS'),
    singleGoogleOwnerConfigured:singleGoogleOwnerConfigured(config),
    // A public broker client legitimately holds a dedicated delegation key and
    // an approved MCP subject; neither is the private legacy Rclone config.
    // The private broker SERVER, however, must never run on public Dev.
    hasBrokerDelegationKey:keyPresent(config,'NYX_PRIVATE_BROKER_SHARED_KEY_B64'),
    hasPrivateBrokerServerEnabled:config.NYX_PRIVATE_BROKER_SERVER_ENABLED==='true',
    databaseHostMatchesPublicNeon:Boolean(dbHost(config.DATABASE_URL) &&
      config.NYX_PUBLIC_NEON_HOST &&
      [String(config.NYX_PUBLIC_NEON_HOST).toLowerCase(),
       String(config.NYX_PUBLIC_NEON_HOST).toLowerCase().replace(/^([^.]+)(\.)/,'$1-pooler$2')]
      .includes(dbHost(config.DATABASE_URL))),
  };
}
function main() {
  const devCfg=fetchJson(['config','--app',DEV,'--json']);
  const proCfg=fetchJson(['config','--app',PRO,'--json']);
  const devMeta=fetchJson(['apps:info','--app',DEV,'--json']);
  const proMeta=fetchJson(['apps:info','--app',PRO,'--json']);
  const dev=reportApp(DEV,devCfg,devMeta);
  const pro=reportApp(PRO,proCfg,proMeta);
  const proPrivateConfigured=pro.flags.NYX_DEPLOYMENT_MODE==='private' &&
    pro.hasLegacyPrivateRcloneConfig && pro.hasOwnerAllowlist &&
    pro.hasEncryptedDatabase && pro.singleGoogleOwnerConfigured;
  const devPublicConfigReady=dev.flags.NYX_DEPLOYMENT_MODE==='public' &&
    dev.flags.NYX_PUBLIC_CONNECTORS_ENABLED==='true' &&
    dev.flags.NYX_MULTIUSER_RCLONE_ENABLED==='true' &&
    dev.flags.NYX_PUBLIC_TENANT_GOOGLE_MULTI_ENABLED==='true' &&
    dev.flags.NYX_PUBLIC_TENANT_MEGA_ONLY==='false' &&
    !dev.hasLegacyPrivateRcloneConfig &&
    !dev.hasPrivateBrokerServerEnabled &&
    dev.hasEncryptedDatabase && dev.databaseHostMatchesPublicNeon;
  const distinctDatabases=dbHost(devCfg.DATABASE_URL)!=='' &&
    dbHost(proCfg.DATABASE_URL)!=='' &&
    dbHost(devCfg.DATABASE_URL)!==dbHost(proCfg.DATABASE_URL);
  const distinctEncryptionKeys=keyPresent(devCfg,'NYX_STORAGE_ENCRYPTION_KEY') &&
    keyPresent(proCfg,'NYX_STORAGE_ENCRYPTION_KEY') &&
    devCfg.NYX_STORAGE_ENCRYPTION_KEY!==proCfg.NYX_STORAGE_ENCRYPTION_KEY;
  const differentOrigins=origin(devCfg.NYX_PUBLIC_URL)!=='' &&
    origin(proCfg.NYX_PUBLIC_URL)!=='' &&
    origin(devCfg.NYX_PUBLIC_URL)!==origin(proCfg.NYX_PUBLIC_URL);
  const safe={
    schema:'nyx.heroku-two-app-audit.v1',
    changesApplied:false,
    secretsPrinted:false,
    legacyProRemotesOnlineVerified:false,
    twoRealPublicGoogleUsersVerified:false,
    privateOwnerIdentityLinked:false,
    dev,pro,
    proPrivateConfigured,devPublicConfigReady,
    distinctDatabases,distinctEncryptionKeys,differentOrigins,
    publicCutoverReadyForLiveAcceptance:
      proPrivateConfigured && devPublicConfigReady && distinctDatabases &&
      distinctEncryptionKeys && differentOrigins &&
      dev.publicUrlMatchesHeroku && pro.publicUrlMatchesHeroku,
    note:'This is a config-only audit. Remote-read, deployment, OAuth and multi-user acceptance are NOT verified.',
  };
  process.stdout.write(JSON.stringify(safe,null,2)+'\n');
  if (!safe.publicCutoverReadyForLiveAcceptance) process.exitCode=2;
}
try { main(); }
catch { process.stderr.write('HEROKU_CLI_READ_ONLY_AUDIT_UNAVAILABLE\n'); process.exitCode=3; }
