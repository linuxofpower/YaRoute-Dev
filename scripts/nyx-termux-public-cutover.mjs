#!/usr/bin/env node
/**
 * Guarded two-app Heroku cutover: existing Dev becomes the public tenant pilot;
 * existing Pro remains private. Read-only by default; --apply is interactive.
 *
 * Requires: Termux Node.js 20+, authenticated Heroku CLI, a separately created
 * FREE Neon project named nestnyx-public, and a Google Drive OAuth web client.
 *
 * Never prints, logs, saves, or passes credentials as shell arguments. Its
 * single Heroku PATCH contains config additions and removals atomically.
 * No Neon project, Heroku app/dyno/add-on, or private Pro config is changed.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const DEV = 'dev-nest-nyx';
const PRO = 'nest-nyx-pro';
const NEON_HOST = 'ep-falling-silence-b9rcrzay.c-7.eu-central-1.aws.neon.tech';
const AUTH0_HOST = 'dev-q8g77208l2kp7iqu.eu.auth0.com';
const API = 'https://api.heroku.com';
const HEADERS = {
  Accept: 'application/vnd.heroku+json; version=3',
  'Content-Type': 'application/json',
};

export function httpsOrigin(value) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:' || url.username || url.password ||
        url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) return '';
    return url.origin;
  } catch { return ''; }
}

function hostOfDatabase(value) {
  try { return new URL(String(value)).hostname.toLowerCase(); }
  catch { return ''; }
}

export function validNeonUrl(value, devOld = '', proOld = '') {
  try {
    const url = new URL(value);
    const allowed = [NEON_HOST, NEON_HOST.replace(/^([^.]+)/, '$1-pooler')];
    return ['postgres:', 'postgresql:'].includes(url.protocol) &&
      allowed.includes(url.hostname.toLowerCase()) &&
      Boolean(url.username && url.password && url.pathname && url.pathname !== '/') &&
      url.searchParams.get('sslmode') === 'require' &&
      value !== devOld && value !== proOld &&
      ![hostOfDatabase(devOld), hostOfDatabase(proOld)].includes(url.hostname.toLowerCase());
  } catch { return false; }
}

function privateKeyNames(config) {
  // These public-Dev flags/pointers are NOT credentials and are set explicitly
  // below. All other NYX_PRIVATE_* values are removed from public Dev.
  const publicSafe=new Set(['NYX_PRIVATE_OWNER_LINK_ENABLED',
    'NYX_PRIVATE_BROKER_CLIENT_ENABLED','NYX_PRIVATE_BROKER_SERVER_ENABLED',
    'NYX_PRIVATE_PRO_URL']);
  return Object.keys(config).filter(key =>
    key === 'RCLONE_CONFIG' || key.startsWith('RCLONE_CONFIG_') ||
    key === 'NYX_SHARED_ROOTS_JSON' || key === 'NYX_PRIVATE_OAUTH_SUBJECTS' ||
    (key.startsWith('NYX_PRIVATE_') && !publicSafe.has(key)) || key === 'NYX_API_KEY');
}

export function inspectState(dev, pro, devApp, proApp, addons = [], formations = []) {
  if (dev?.NYX_DEPLOYMENT_MODE !== 'private' && dev?.NYX_DEPLOYMENT_MODE !== 'public')
    throw Error('DEV_MODE_UNEXPECTED');
  if (pro?.NYX_DEPLOYMENT_MODE !== 'private' ||
      !privateKeyNames(pro).some(key=>key.startsWith('RCLONE_CONFIG') && Boolean(pro[key])) ||
      !pro.NYX_PRIVATE_OAUTH_SUBJECTS || !pro.DATABASE_URL || !pro.NYX_STORAGE_ENCRYPTION_KEY)
    throw Error('PRO_PRIVATE_BASELINE_INCOMPLETE');
  const devOrigin = httpsOrigin(devApp?.web_url);
  const proOrigin = httpsOrigin(proApp?.web_url);
  const devOwner = String(devApp?.owner?.email || '').toLowerCase();
  const proOwner = String(proApp?.owner?.email || '').toLowerCase();
  if (!devOwner || devOwner !== proOwner) throw Error('APP_OWNERS_DIFFER');
  if (!devOrigin || !proOrigin || devOrigin === proOrigin ||
      httpsOrigin(dev.NYX_PUBLIC_URL) !== devOrigin ||
      httpsOrigin(pro.NYX_PUBLIC_URL) !== proOrigin)
    throw Error('HEROKU_ORIGINS_NOT_VERIFIED');
  if (!/^https:\/\//.test(String(dev.NYX_OAUTH_ISSUER)) ||
      new URL(dev.NYX_OAUTH_ISSUER).hostname !== AUTH0_HOST)
    throw Error('AUTH0_ISSUER_UNEXPECTED');
  if (addons.some(addon => /^heroku-postgresql(?::|$)/.test(addon?.plan?.name || '')))
    throw Error('HEROKU_POSTGRES_ADDON_PRESENT');
  if (formations.some(f => Number(f?.quantity) > 0 && f?.size !== 'eco'))
    throw Error('NON_ECO_DYNO_PRESENT');
  const sensitiveKeys = privateKeyNames(dev).filter(key =>
    typeof dev[key] === 'string' && dev[key].length);
  const alreadyPublic = dev.NYX_DEPLOYMENT_MODE === 'public' &&
    sensitiveKeys.length === 0 && dev.NYX_MULTIUSER_RCLONE_ENABLED === 'true' &&
    dev.NYX_PUBLIC_CONNECTORS_ENABLED === 'true' &&
    dev.NYX_PUBLIC_TENANT_GOOGLE_MULTI_ENABLED === 'true' &&
    dev.NYX_PUBLIC_TENANT_MEGA_ONLY === 'false' &&
    dev.NYX_PRIVATE_OWNER_LINK_ENABLED === 'false' &&
    dev.NYX_PRIVATE_BROKER_CLIENT_ENABLED === 'false' &&
    dev.NYX_PRIVATE_BROKER_SERVER_ENABLED === 'false' &&
    dev.NYX_PUBLIC_NEON_HOST === NEON_HOST &&
    Boolean(dev.NYX_GOOGLE_CLIENT_ID && dev.NYX_GOOGLE_CLIENT_SECRET) &&
    dev.NYX_STORAGE_ENCRYPTION_KEY !== pro.NYX_STORAGE_ENCRYPTION_KEY &&
    hostOfDatabase(dev.DATABASE_URL).replace('-pooler.', '.') === NEON_HOST &&
    Boolean(dev.NYX_STORAGE_ENCRYPTION_KEY);
  if (dev.NYX_DEPLOYMENT_MODE === 'public' && !alreadyPublic)
    throw Error('PARTIAL_PUBLIC_CONFIG_REQUIRES_MANUAL_REVIEW');
  return {devOrigin, proOrigin, sensitiveKeys, alreadyPublic};
}

export function buildPatch(dev, state, secrets) {
  if (state.alreadyPublic) throw Error('ALREADY_PUBLIC_NO_KEY_ROTATION');
  if (!validNeonUrl(secrets.databaseUrl, dev.DATABASE_URL, secrets.proDatabaseUrl))
    throw Error('PUBLIC_NEON_DATABASE_URL_INVALID');
  if (!/^[0-9]+-[a-z0-9_-]+\.apps\.googleusercontent\.com$/.test(secrets.googleClientId))
    throw Error('GOOGLE_CLIENT_ID_INVALID');
  if (secrets.googleClientSecret.length < 12 || /[\r\n]/.test(secrets.googleClientSecret))
    throw Error('GOOGLE_CLIENT_SECRET_INVALID');
  const patch = Object.fromEntries(state.sensitiveKeys.map(key => [key, null]));
  Object.assign(patch, {
    NYX_DEPLOYMENT_MODE: 'public',
    NYX_SERVICE_NAME: 'NestNyxPublicPilot',
    NYX_PUBLIC_CONNECTORS_ENABLED: 'true',
    NYX_MULTIUSER_RCLONE_ENABLED: 'true',
    NYX_PUBLIC_TENANT_GOOGLE_MULTI_ENABLED: 'true',
    NYX_PUBLIC_TENANT_MEGA_ONLY: 'false',
    NYX_PRIVATE_OWNER_LINK_ENABLED: 'false',
    NYX_PRIVATE_BROKER_CLIENT_ENABLED: 'false',
    NYX_PRIVATE_BROKER_SERVER_ENABLED: 'false',
    NYX_PUBLIC_URL: state.devOrigin,
    NYX_PRIVATE_PRO_URL: state.proOrigin,
    NYX_PUBLIC_NEON_HOST: NEON_HOST,
    NYX_OAUTH_AUDIENCE: state.devOrigin + '/mcp',
    NYX_OAUTH_SCOPES: 'nyx.read,nyx.write',
    NYX_OAUTH_ALGORITHMS: 'RS256',
    NYX_GOOGLE_CLIENT_ID: secrets.googleClientId,
    NYX_GOOGLE_CLIENT_SECRET: secrets.googleClientSecret,
    DATABASE_URL: secrets.databaseUrl,
    NYX_STORAGE_ENCRYPTION_KEY: secrets.encryptionKey,
  });
  return patch;
}

function herokuIdentity(command) {
  const r = spawnSync('heroku', command, {encoding:'utf8', shell:false,
    env:{...process.env, HEROKU_SKIP_UPDATE_CHECK:'1'}, timeout:20000, maxBuffer:1024*1024});
  if (r.status !== 0 || r.error || !r.stdout?.trim()) throw Error('HEROKU_CLI_NOT_AUTHENTICATED');
  return r.stdout.trim();
}

async function apiJson(token, path, method = 'GET', body) {
  const result = await fetch(API + path, {method,
    headers:{...HEADERS, Authorization:'Bearer ' + token},
    body:body ? JSON.stringify(body) : undefined,
    signal:AbortSignal.timeout(20000), redirect:'error'}).catch(() => null);
  if (!result || !result.ok) throw Error('HEROKU_API_' + method + '_FAILED');
  try { return await result.json(); }
  catch { throw Error('HEROKU_API_INVALID_JSON'); }
}

async function prompt(label, hidden = false) {
  if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode)
    throw Error('INTERACTIVE_TERMUX_TTY_REQUIRED');
  process.stdout.write(label);
  return new Promise((resolve, reject) => {
    const bytes=[];
    const wasRaw=Boolean(process.stdin.isRaw);
    const end=()=>{
      process.stdin.removeListener('data',onData);
      process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const onData=chunk=>{
      for (const byte of chunk) {
        if (byte===3) {end();reject(Error('CANCELLED'));return;}
        if (byte===10 || byte===13) {end();resolve(Buffer.from(bytes).toString('utf8'));return;}
        if (byte===8 || byte===127) {
          if (bytes.length) {bytes.pop(); if (!hidden) process.stdout.write('\b \b');}
          continue;
        }
        if (byte>=32 && byte<=126 && bytes.length < 16384) {
          bytes.push(byte); if (!hidden) process.stdout.write(String.fromCharCode(byte));
        }
      }
    };
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data',onData);
  });
}

async function run() {
  const mode=process.argv[2] || '--plan';
  if (!['--plan','--apply'].includes(mode) || process.argv.length > 3)
    throw Error('USAGE_node_scripts_nyx-termux-public-cutover.mjs_[--plan|--apply]');
  const whoami=herokuIdentity(['auth:whoami']);
  const token=herokuIdentity(['auth:token']);
  const [dev,pro,devApp,proApp,addons,formation] = await Promise.all([
    apiJson(token,`/apps/${DEV}/config-vars`),
    apiJson(token,`/apps/${PRO}/config-vars`),
    apiJson(token,`/apps/${DEV}`),
    apiJson(token,`/apps/${PRO}`),
    apiJson(token,`/apps/${DEV}/addons`),
    apiJson(token,`/apps/${DEV}/formation`),
  ]);
  if (whoami.toLowerCase() !== String(devApp?.owner?.email || '').toLowerCase())
    throw Error('HEROKU_OPERATOR_UNEXPECTED');
  const state=inspectState(dev,pro,devApp,proApp,addons,formation);
  console.log(JSON.stringify({schema:'nyx.termux-public-cutover.v1', mode,
    target:DEV, untouched:PRO, existingNeonProject:'nestnyx-public',
    usesHerokuPostgres:false, createsDynos:false, addonsCreated:0,
    proPrivateVerified:true, proRemoteReadsNotTestedByThisScript:true,
    devPrivateKeyNamesToRemove:state.sensitiveKeys,
    publicOrigin:state.devOrigin, proOrigin:state.proOrigin,
    googleDriveCallback:state.devOrigin+'/connect/google/callback',
    alreadyPublic:state.alreadyPublic, secretsPrinted:false,
    warning:'This script does not verify Auth0 refresh, private Google owner linkage, or two real public users.'},null,2));
  if (mode==='--plan' || state.alreadyPublic) return;
  console.log('This will restart existing Dev via ONE config-var PATCH. Pro and Neon remain untouched.');
  console.log('Use the free Neon nestnyx-public project URL, NOT a Heroku Postgres URL.');
  const databaseUrl=await prompt('Free Neon nestnyx-public pooled DATABASE_URL (hidden): ',true);
  const googleClientId=await prompt('Drive-specific Google OAuth Web Client ID (hidden): ',true);
  const googleClientSecret=await prompt('Drive-specific Google OAuth Client Secret (hidden): ',true);
  const encryptionKey=randomBytes(32).toString('base64');
  const patch=buildPatch(dev,state,{databaseUrl,googleClientId,googleClientSecret,
    encryptionKey,proDatabaseUrl:pro.DATABASE_URL});
  const confirmation=await prompt(`Type CUTOVER ${DEV} to remove ONLY Dev legacy credentials: `);
  if (confirmation !== `CUTOVER ${DEV}`) throw Error('CUTOVER_NOT_CONFIRMED');
  // One atomic Heroku update: no transient public runtime with private secrets.
  // Ignore the returned values: Heroku's response contains ALL config secrets.
  await apiJson(token,`/apps/${DEV}/config-vars`,'PATCH',patch);
  const now=await apiJson(token,`/apps/${DEV}/config-vars`);
  const verified=Object.entries(patch).every(([key,value])=>
    value===null ? !now[key] : now[key]===value);
  if (!verified) throw Error('APPLIED_BUT_CONFIG_READBACK_MISMATCH');
  console.log(JSON.stringify({schema:'nyx.termux-public-cutover.result.v1',
    devConfigUpdated:true, devReadbackVerified:true, proConfigWriteCalls:0,
    secretValuesPrinted:false, newHerokuApps:0, newHerokuAddons:0,
    publicRuntimeOnlineTested:false, multiuserAcceptancePending:true,
    ownerGoogleIdentityLinkPending:true, monthlyOAuthRefreshProofPending:true},null,2));
  console.log('NEXT: node scripts/nyx-heroku-two-app-audit.mjs');
}

if (process.argv[1]?.endsWith('nyx-termux-public-cutover.mjs')) {
  run().catch(error=>{
    // Deliberately never print error.message from network/provider inputs.
    const known=String(error?.message??'');
    const code=/^[A-Z_0-9]+$/.test(known) ? known : 'CUTOVER_FAILED_CHECK_INPUTS';
    process.stderr.write('CUTOVER_STOPPED: '+code+'\n');
    process.exitCode=1;
  });
}
