#!/usr/bin/env node
// Safe read-only Heroku Dev preflight; automatically captures and verifies
// a sanitized report in the existing private NYX Drive archive.
import {spawnSync} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectDevDeployment} from './nyx-dev-deployment-guard.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const APP='dev-nest-nyx';
const REMOTE='linux'+'ofpower:Documents/Nyxpad/CommandOutputs/termux/nestnyx-dev-preflight';
export function safeFormation(input){
 if(!Array.isArray(input)||input.length>50)throw Error('FORMATION_INVALID');
 const active=input.map(x=>{
   if(!x||typeof x.type!=='string'||!/^[A-Za-z0-9_-]{1,40}$/.test(x.type)||
      typeof x.size!=='string'||!/^[A-Za-z0-9_.-]{1,40}$/.test(x.size)||
      !Number.isInteger(x.quantity)||x.quantity<0||x.quantity>100)throw Error('FORMATION_INVALID');
   return {type:x.type,size:x.size,quantity:x.quantity};
 }).filter(x=>x.quantity>0);
 return {status:'READ',active,nonEcoActive:active.some(x=>x.size.toLowerCase()!=='eco')};
}
export function safePlan(status,stdout,stderr){
 if(status===0){
   let p;try{p=JSON.parse(stdout)}catch{throw Error('PLAN_INVALID')}
   if(p?.schema!=='nyx.termux-public-cutover.v1'||p.mode!=='--dev-only-plan'||
      p.target!==APP||p.untouched!=='nest-nyx-pro')throw Error('PLAN_INVALID');
   return {status:'CONFIG_READS_PASS',target:APP,proUntouched:true,
     oldDevConfigKeysToRemove:Array.isArray(p.devPrivateKeyNamesToRemove)?
       p.devPrivateKeyNamesToRemove.length:null,alreadyPublic:p.alreadyPublic===true};
 }
 const match=typeof stderr==='string'?stderr.match(/^CUTOVER_STOPPED: ([A-Z0-9_]{3,80})$/m):null;
 return {status:'BLOCKED',code:match?.[1]||'PREFLIGHT_FAILED'};
}
/**
 * Allowlisted two-app audit data from the already sanitized CLI.
 * This is safe to upload to Nyxpad immediately, even when blocked.
 * No arbitrary stdout, stderr, config var values or user subjects are saved.
 */
export function safeAudit(status, stdout) {
  if (status!==0 && status!==2) return {status:'AUDIT_UNAVAILABLE'};
  let audit;
  try { audit=JSON.parse(stdout); }
  catch { return {status:'AUDIT_UNAVAILABLE'}; }
  if (audit?.schema!=='nyx.heroku-two-app-audit.v1' ||
      audit?.changesApplied!==false || audit?.secretsPrinted!==false ||
      audit.dev?.name!=='dev-nest-nyx' || audit.pro?.name!=='nest-nyx-pro')
    return {status:'AUDIT_UNAVAILABLE'};
  const flags=audit.dev.flags||{};
  return {
    status:'READ',
    devMode:flags.NYX_DEPLOYMENT_MODE==='public'?'public':
      flags.NYX_DEPLOYMENT_MODE==='private'?'private':'unknown',
    devLegacyRclonePresent:audit.dev.hasLegacyPrivateRcloneConfig===true,
    devEncryptedDatabasePresent:audit.dev.hasEncryptedDatabase===true,
    publicNeonMatched:audit.dev.databaseHostMatchesPublicNeon===true,
    distinctDatabases:audit.distinctDatabases===true,
    distinctEncryptionKeys:audit.distinctEncryptionKeys===true,
    proMode:audit.pro.flags?.NYX_DEPLOYMENT_MODE==='private'?'private':'unknown',
    devPublicConfigReady:audit.devPublicConfigReady===true,
    liveTwoUserSecurityVerified:false,
  };
}

function run(binary,args,timeout=25000){
 return spawnSync(binary,args,{cwd:ROOT,encoding:'utf8',timeout,maxBuffer:262144,
   stdio:['ignore','pipe','pipe'],env:{...process.env,HEROKU_SKIP_UPDATE_CHECK:'1'}});
}
async function formation(){
 const token=run('heroku',['auth:token']);
 if(token.error||token.status!==0||!token.stdout?.trim())return {status:'HEROKU_AUTH_UNAVAILABLE'};
 try{
   const response=await fetch('https://api.heroku.com/apps/'+APP+'/formation',{
     headers:{Accept:'application/vnd.heroku+json; version=3',
       Authorization:'Bearer '+token.stdout.trim()},
     redirect:'error',signal:AbortSignal.timeout(20000)});
   if(!response.ok)return {status:'FORMATION_READ_FAILED'};
   return safeFormation(await response.json());
 }catch{return {status:'FORMATION_READ_FAILED'};}
}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function uploadAndVerify(local,remote){
 const copied=run('rclone',['copyto',local,remote],90000);
 if(copied.error||copied.status!==0)return 'UPLOAD_FAILED';
 const downloaded=spawnSync('rclone',['cat',remote],{encoding:null,
   stdio:['ignore','pipe','pipe'],timeout:90000,maxBuffer:1048576});
 if(downloaded.error||downloaded.status!==0||
    !Buffer.isBuffer(downloaded.stdout)||
    hash(downloaded.stdout)!==hash(readFileSync(local)))return 'UNVERIFIED';
 return 'SHA256_VERIFIED';
}
async function main(){
 if(process.argv.length!==2)throw Error('NO_ARGUMENTS_ALLOWED');
 const result=run(process.execPath,
   [join(ROOT,'scripts/nyx-termux-public-cutover.mjs'),'--dev-only-plan']);
 const audit=run(process.execPath,[join(ROOT,'scripts/nyx-heroku-two-app-audit.mjs')]);
 const report={schema:'nyx.dev-preflight-capture.v1',timeUTC:new Date().toISOString(),
   app:APP,readOnly:true,secretValuesCaptured:false,herokuWrites:0,proWrites:0,
   executedCommands:[
     {name:'nyx.dev-public-plan',args:['--dev-only-plan'],exitCode:Number.isInteger(result.status)?result.status:null},
     {name:'nyx.heroku-two-app-audit',args:[],exitCode:Number.isInteger(audit.status)?audit.status:null},
     {name:'heroku.dev-formation',method:'GET',target:APP},
     {name:'nyx.dev-deployment-health',method:'GET',target:APP},
   ],
   plan:safePlan(result.status,result.stdout,result.stderr),
   audit:safeAudit(audit.status,audit.stdout),
   formation:await formation(),
   deployment:await inspectDevDeployment()};
 const dir=join(homedir(),'NYXCaptures','termux','nestnyx-dev-preflight');
 mkdirSync(dir,{recursive:true,mode:0o700});
 const name='preflight-'+new Date().toISOString().replace(/[:.]/g,'-')+
    '-'+randomBytes(4).toString('hex')+'.json';
 const local=join(dir,name),remote=REMOTE+'/'+name;
 writeFileSync(local,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 const uploaded=uploadAndVerify(local,remote);
 console.log(JSON.stringify({plan:report.plan,audit:report.audit,formation:report.formation, deployment:report.deployment,
    localFile:local,drivePath:remote,upload:uploaded,changed:false},null,2));
 if(uploaded!=='SHA256_VERIFIED')process.exitCode=3;
 else if(report.plan.status==='BLOCKED')process.exitCode=2;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(()=>{process.stderr.write('SAFE_PREFLIGHT_CAPTURE_FAILED\n');process.exitCode=3});
