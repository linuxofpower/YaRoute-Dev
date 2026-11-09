#!/usr/bin/env node
/** Read-only Dev deployment proof against YaRoute TESTER, never Dev main.
 * Source authority: yaMorozYaroslav/YaRoute branch tester -> dev-nest-nyx.
 * Protected master -> Pro is out of scope. Only public commit SHAs are emitted.
 */
const COMMIT=/^[0-9a-f]{7,40}$/;
const FULL_COMMIT=/^[0-9a-f]{40}$/;
const EXACT_ORIGIN='https://dev-nest-nyx-0df80c227630.herokuapp.com';
const TESTER_API='https://api.github.com/repos/yaMorozYaroslav/YaRoute/branches/tester';

export function safeTesterBranch(data) {
  const sha=data?.commit?.sha;
  return typeof sha==='string' && FULL_COMMIT.test(sha) ? sha : '';
}

export function safeDevDeployment(health, testerCommit) {
  if(typeof testerCommit!=='string'||!FULL_COMMIT.test(testerCommit))
    return {status:'TESTER_COMMIT_UNAVAILABLE',sourceBranch:'tester',
      deployedCurrentSource:false};
  const deployed=typeof health?.commit==='string' && COMMIT.test(health.commit)
    ? health.commit : null;
  if(health?.ok!==true||!deployed||!testerCommit.startsWith(deployed))
    return {status:'DEPLOYMENT_NOT_TESTER',sourceBranch:'tester',
      deployedCurrentSource:false,expectedTesterCommit:testerCommit,
      deployedCommit:deployed};
  return {status:'CURRENT_TESTER_SOURCE_VERIFIED',sourceBranch:'tester',
    deployedCurrentSource:true,expectedTesterCommit:testerCommit,
    deployedCommit:deployed};
}

async function readSmallJson(url) {
  try {
    const response=await fetch(url,{redirect:'error',
      signal:AbortSignal.timeout(15000),headers:{
        Accept:'application/vnd.github+json, application/json',
        'User-Agent':'Nyx-Dev-Deployment-Preflight',
      },cache:'no-store'});
    if(!response.ok)return null;
    const body=await response.text();
    if(body.length>8192)return null;
    return JSON.parse(body);
  }catch{return null;}
}

export async function inspectDevDeployment(origin=EXACT_ORIGIN) {
  if(origin!==EXACT_ORIGIN)
    return {status:'DEV_ORIGIN_UNEXPECTED',deployedCurrentSource:false};
  const tester=safeTesterBranch(await readSmallJson(TESTER_API));
  if(!tester)return {status:'TESTER_COMMIT_UNAVAILABLE',
    sourceBranch:'tester',deployedCurrentSource:false};
  const health=await readSmallJson(origin+'/health');
  if(!health)return {status:'HEALTH_READ_UNAVAILABLE',sourceBranch:'tester',
    expectedTesterCommit:tester,deployedCurrentSource:false};
  return safeDevDeployment(health,tester);
}

export async function requireCurrentDevDeployment(origin) {
  const current=await inspectDevDeployment(origin);
  if(!current.deployedCurrentSource)throw Error('DEV_DEPLOYED_TESTER_RELEASE_NOT_VERIFIED');
  return current;
}
