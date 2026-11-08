#!/usr/bin/env node
/** Read-only Dev source/deployment parity. Never print HTTP payloads, headers, tokens or errors. */
import {spawnSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const COMMIT=/^[0-9a-f]{7,40}$/;
const EXACT_ORIGIN='https://dev-nest-nyx-0df80c227630.herokuapp.com';

export function safeDevDeployment(health, localCommit) {
  if(typeof localCommit!=='string'||!/^[0-9a-f]{40}$/.test(localCommit))
    return {status:'LOCAL_COMMIT_UNAVAILABLE',deployedCurrentSource:false};
  if(!health||health.ok!==true||typeof health.commit!=='string'||
     !COMMIT.test(health.commit)||!localCommit.startsWith(health.commit))
    return {status:'DEPLOYMENT_NOT_CURRENT',deployedCurrentSource:false,
      localCommit, deployedCommit:COMMIT.test(health?.commit||'')?health.commit:null};
  return {status:'CURRENT_SOURCE_VERIFIED',deployedCurrentSource:true,
    localCommit,deployedCommit:health.commit};
}

function localHead() {
  const r=spawnSync('git',['-C',ROOT,'rev-parse','HEAD'],{
    encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:12000,maxBuffer:8192});
  if(r.error||r.status!==0)return '';
  return r.stdout.trim();
}

export async function inspectDevDeployment(origin=EXACT_ORIGIN) {
  const commit=localHead();
  if(origin!==EXACT_ORIGIN)return {status:'DEV_ORIGIN_UNEXPECTED',deployedCurrentSource:false};
  try {
    const response=await fetch(origin+'/health',{
      redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{Accept:'application/json'},cache:'no-store',
    });
    if(!response.ok)return {status:'HEALTH_READ_UNAVAILABLE',deployedCurrentSource:false};
    const body=await response.text();
    if(body.length>8192)return {status:'HEALTH_READ_UNAVAILABLE',deployedCurrentSource:false};
    const health=JSON.parse(body);
    return safeDevDeployment(health,commit);
  }catch{return {status:'HEALTH_READ_UNAVAILABLE',deployedCurrentSource:false};}
}

export async function requireCurrentDevDeployment(origin) {
  const current=await inspectDevDeployment(origin);
  if(!current.deployedCurrentSource)throw Error('DEV_DEPLOYED_RELEASE_NOT_CURRENT');
  return current;
}
