#!/usr/bin/env node
/** Read-only remote Git history diagnostic. Fetches into local FETCH_HEAD only.
 * Does not run pull, merge, reset, push, force, or any Heroku config changes.
 * Never captures commit messages, source code, file lists or CLI error text.
 */
import {spawnSync} from 'node:child_process';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const FULL_SHA=/^[0-9a-f]{40}$/;
const EXPECTED_REMOTE='https://git.heroku.com/dev-nest-nyx.git';

function git(args,timeout=20000){
 return spawnSync('git',args,{cwd:ROOT,encoding:'utf8',timeout,maxBuffer:16384,
   stdio:['ignore','pipe','pipe']});
}
function out(r){return !r.error&&r.status===0?String(r.stdout||'').trim():''}

export function safeGitRelationship(localSha,remoteSha,ancestorFlags,treeEqual,shallow=false){
 if(!FULL_SHA.test(localSha||'')||!FULL_SHA.test(remoteSha||''))
   return {status:'INVALID_GIT_REF'};
 if(shallow)return {status:'LOCAL_HISTORY_SHALLOW',localSha,remoteSha};
 const a=ancestorFlags.remoteIsAncestor===true;
 const b=ancestorFlags.localIsAncestor===true;
 const c=ancestorFlags.hasCommonAncestor===true;
 const relation=localSha===remoteSha?'ALREADY_SYNCED':
   a?'REMOTE_BEHIND_LOCAL':
   b?'LOCAL_BEHIND_REMOTE':
   c?'DIVERGED':'UNRELATED_HISTORIES';
 return {status:'READ',relation,localSha,remoteSha,treeEqual:treeEqual===true,
   pushMainWouldFastForward:a||localSha===remoteSha};
}

export function inspectHerokuGit(){
 const remote=out(git(['remote','get-url','nyx-dev-heroku']));
 if(!remote)return {status:'DEV_HEROKU_REMOTE_MISSING'};
 if(remote!==EXPECTED_REMOTE)return {status:'DEV_HEROKU_REMOTE_URL_UNEXPECTED'};
 const localSha=out(git(['rev-parse','refs/heads/main']));
 const activeSha=out(git(['rev-parse','HEAD']));
 if(!FULL_SHA.test(localSha)||activeSha!==localSha)
   return {status:'LOCAL_CHECKOUT_NOT_MAIN'};
 const dirty=out(git(['status','--porcelain','--untracked-files=no']));
 if(dirty)return {status:'LOCAL_TRACKED_CHANGES_PRESENT'};
 const fetched=git(['fetch','--quiet','--no-tags','nyx-dev-heroku','main'],90000);
 if(fetched.error||fetched.status!==0)return {status:'HEROKU_GIT_FETCH_UNAVAILABLE'};
 const remoteSha=out(git(['rev-parse','FETCH_HEAD']));
 if(!FULL_SHA.test(remoteSha))return {status:'REMOTE_GIT_COMMIT_UNAVAILABLE'};
 const shallow=out(git(['rev-parse','--is-shallow-repository']))==='true';
 const remoteTree=out(git(['rev-parse','FETCH_HEAD^{tree}']));
 const localTree=out(git(['rev-parse','refs/heads/main^{tree}']));
 const flags={
   remoteIsAncestor:git(['merge-base','--is-ancestor','FETCH_HEAD','refs/heads/main']).status===0,
   localIsAncestor:git(['merge-base','--is-ancestor','refs/heads/main','FETCH_HEAD']).status===0,
   hasCommonAncestor:git(['merge-base','FETCH_HEAD','refs/heads/main']).status===0,
 };
 return safeGitRelationship(localSha,remoteSha,flags,
   FULL_SHA.test(remoteTree)&&remoteTree===localTree,shallow);
}
