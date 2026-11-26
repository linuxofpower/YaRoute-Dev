import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

// Build-time only; no user-supplied source URL, version or archive hash.
// Runtime execution is separately disabled unless the public pilot flag is on.
if(process.env.NYX_GITHUB_CLI_PILOT_ENABLED!=='true') {
  console.log('Restricted gh CLI not requested for this build.');
  process.exit(0);
}
const version='2.105.0';
const targets={
  x64:{arch:'amd64',sha:'79e7ab5db738c48777b696e374f8b428f0647debfb424f44d2f426370407fe2f'},
  arm64:{arch:'arm64',sha:'b1278c75107423d818f1937fd92cafc9e5e9b606631568f68d7fb816f5885a02'},
};
const target=targets[process.arch];
if(process.platform!=='linux'||!target)
  throw Error('GH_INSTALL_UNSUPPORTED_PLATFORM');
const url='https://github.com/cli/cli/releases/download/v'+version+
 '/gh_'+version+'_linux_'+target.arch+'.tar.gz';
const bin=path.resolve('.bin/gh');
const manifest=path.resolve('.bin/gh-manifest.json');
const work=await mkdtemp(path.join(os.tmpdir(),'nyx-gh-pinned-'));
try{
  const response=await fetch(url,{
    redirect:'follow',signal:AbortSignal.timeout(45000)});
  if(!response.ok)throw Error('GH_INSTALL_HTTP_ERROR');
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length>25*1024*1024||bytes.length<1024)
    throw Error('GH_INSTALL_ARCHIVE_SIZE_INVALID');
  const sha=createHash('sha256').update(bytes).digest('hex');
  if(sha!==target.sha)throw Error('GH_INSTALL_ARCHIVE_HASH_MISMATCH');
  const archive=path.join(work,'gh.tar.gz');
  await writeFile(archive,bytes,{mode:0o600,flag:'wx'});
  const rel='gh_'+version+'_linux_'+target.arch+'/bin/gh';
  const tar=spawnSync('/usr/bin/tar',['-xzf',archive,'-C',work,'--',rel],
    {stdio:'ignore',timeout:15000,env:{PATH:'/usr/bin:/bin'}});
  if(tar.status!==0)throw Error('GH_INSTALL_EXTRACT_FAILED');
  const extracted=path.join(work,rel);
  if(!fs.lstatSync(extracted).isFile())throw Error('GH_INSTALL_BINARY_INVALID');
  const binary=fs.readFileSync(extracted);
  const binSha=createHash('sha256').update(binary).digest('hex');
  fs.mkdirSync(path.dirname(bin),{recursive:true});
  fs.writeFileSync(bin,binary,{mode:0o755});
  fs.chmodSync(bin,0o755);
  fs.writeFileSync(manifest,JSON.stringify({version,sha256:binSha})+'\n',{mode:0o600});
  console.log('Installed pinned gh '+version+' (archive SHA-256 verified).');
}finally{await rm(work,{recursive:true,force:true});}
