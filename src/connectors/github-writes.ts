import { ConnectorRegistry, type ConnectorCapability } from './connector-registry';
import type { GithubInstallationCredentials, GithubHttp } from './github-readonly';

/**
 * Deliberately bounded GitHub API writes: non-protected working branches, no
 * default-branch changes, no workflow/deployment/config edits and no merges.
 * Provider and per-owner grants are enforced BEFORE a scoped token is minted.
 */
export class GithubWriteConnector {
  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly credentials: GithubInstallationCredentials,
    private readonly http: GithubHttp = fetch,
  ) {}

  private repoName(repo:string):void {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || repo.includes('..'))
      throw new Error('GITHUB_REPOSITORY_INVALID');
  }
  private workingBranch(branch:string):void {
    if (typeof branch !== 'string' || branch.length > 100 ||
        !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) ||
        branch.includes('..') || branch.includes('//') ||
        branch.endsWith('/') || branch.endsWith('.') || branch.startsWith('refs/') ||
        branch.split('/').some(p=>p.startsWith('.') || p.endsWith('.lock')) ||
        ['main','master'].includes(branch.toLowerCase()))
      throw new Error('GITHUB_PROTECTED_OR_INVALID_BRANCH');
  }
  private writablePath(path:string):void {
    if (typeof path !== 'string' || !path || path.length > 400 ||
        path.startsWith('/') || path.includes('\\') ||
        /[?#\x00-\x1f]/.test(path) ||
        path.split('/').some(piece=>!piece || piece==='.' || piece==='..'))
      throw new Error('GITHUB_WRITE_PATH_INVALID');
    const lower=path.toLowerCase();
    const root=lower.split('/')[0];
    // Block all repo automation/hosting entrypoints, provider brokers and
    // checked-in credentials. Writes are still staged for human review.
    if (['.github','.git','scripts','broker','config'].includes(root) ||
        ['procfile','app.json','package.json','package-lock.json','.gitignore',
         '.npmrc','.gitmodules','dockerfile','heroku.yml'].includes(lower) ||
        /(^|\/)(\.env[^/]*|[^/]*\.(?:pem|key|p12|pfx|crt|cer|tf|tfvars))$/.test(lower) ||
        lower.startsWith('src/connectors/heroku-') ||
        lower.startsWith('src/connectors/heroku.'))
      throw new Error('GITHUB_INFRASTRUCTURE_WRITE_FORBIDDEN');
  }
  private async call(owner:string,id:string,repo:string,
    capability:ConnectorCapability,method:'GET'|'POST'|'PUT',suffix:string,
    body?:unknown,boundary?:{branch?:string;path?:string}) {
    this.repoName(repo);
    const conn=await this.registry.requireResource(owner,id,capability,
      {kind:'repository',id:repo,...boundary});
    if(conn.provider!=='github'||!conn.installationId) throw new Error('GITHUB_INSTALLATION_REQUIRED');
    const token=await this.credentials.tokenFor(owner,id,conn.installationId,repo,capability,boundary);
    if(!token)throw new Error('GITHUB_CREDENTIAL_UNAVAILABLE');
    // Empty suffix is the safe GET repository-metadata endpoint only.
    if((suffix==='' && method!=='GET') ||
       (suffix!=='' && !suffix.startsWith('/')) ||
       (suffix.includes('..') && !(method==='GET' &&
         /^\/compare\/(?:main|master)\.\.\.tester$/.test(suffix))) ||
       /[?#]/.test(suffix)) throw new Error('GITHUB_API_PATH_INVALID');
    const response=await this.http('https://api.github.com/repos/'+repo+suffix,{
      method,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json',
        'Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),
      redirect:'error',signal:AbortSignal.timeout(10000),
    });
    if(!response.ok)throw new Error(response.status===409?'GITHUB_CONFLICT':'GITHUB_API_FAILED');
    const raw=await response.text();
    if(raw.length>100000)throw new Error('GITHUB_RESPONSE_TOO_LARGE');
    try{return JSON.parse(raw);}catch{throw new Error('GITHUB_RESPONSE_INVALID');}
  }
  private async defaultBranch(owner:string,id:string,repo:string,
    capability:ConnectorCapability,boundary?:{branch?:string}) {
    const data=await this.call(owner,id,repo,capability,'GET','',undefined,boundary);
    const ref=data?.default_branch;
    if(typeof ref!=='string'||!/^[A-Za-z0-9_.-]{1,100}$/.test(ref))
      throw new Error('GITHUB_DEFAULT_BRANCH_UNVERIFIED');
    return ref;
  }
  /** Create a working branch from the current default HEAD; never update that ref. */
  async createBranch(owner:string,id:string,repo:string,branch:string) {
    this.workingBranch(branch);
    const boundary={branch};
    const base=await this.defaultBranch(owner,id,repo,'contents:write',boundary);
    if(branch===base)throw new Error('GITHUB_DEFAULT_BRANCH_WRITE_FORBIDDEN');
    const source=await this.call(owner,id,repo,'contents:write','GET',
      '/git/ref/heads/'+encodeURIComponent(base),undefined,boundary);
    const sha=source?.object?.sha;
    if(typeof sha!=='string'||!/^[a-f0-9]{40}$/.test(sha))
      throw new Error('GITHUB_BASE_SHA_INVALID');
    const created=await this.call(owner,id,repo,'contents:write','POST','/git/refs',
      {ref:'refs/heads/'+branch,sha},boundary);
    if(created?.ref!=='refs/heads/'+branch)throw new Error('GITHUB_BRANCH_RESPONSE_INVALID');
    return {repo,branch,from:base,baseSha:sha,created:true};
  }
  /**
   * Create a review branch from an exact non-default, non-protected branch tip.
   * Never rewrites its source branch. Fail closed if staging moved since review.
   */
  async createFromNonDefault(owner:string,id:string,repo:string,branch:string,
    baseBranch:string,expectedBaseSha:string) {
    this.workingBranch(branch);
    this.workingBranch(baseBranch);
    if(!branch.startsWith('nyx/') || branch===baseBranch)
      throw new Error('GITHUB_REVIEW_BRANCH_REQUIRED');
    if(!/^[a-f0-9]{40}$/.test(expectedBaseSha))
      throw new Error('GITHUB_BASE_SHA_INVALID');
    const defaultRef=await this.defaultBranch(owner,id,repo,'contents:write',{branch});
    if(branch===defaultRef || baseBranch===defaultRef)
      throw new Error('GITHUB_DEFAULT_BRANCH_WRITE_FORBIDDEN');
    const source=await this.call(owner,id,repo,'contents:write','GET',
      '/git/ref/heads/'+encodeURIComponent(baseBranch),undefined,{branch:baseBranch});
    const actualSha=source?.object?.sha;
    if(typeof actualSha!=='string'||!/^[a-f0-9]{40}$/.test(actualSha))
      throw new Error('GITHUB_BASE_SHA_INVALID');
    if(actualSha!==expectedBaseSha)throw new Error('GITHUB_STAGING_BASE_CHANGED');
    // Metadata only: enforce provider-reported non-protected source.
    const details=await this.call(owner,id,repo,'contents:write','GET',
      '/branches/'+encodeURIComponent(baseBranch),undefined,{branch:baseBranch});
    if(details?.name!==baseBranch || details?.protected!==false)
      throw new Error('GITHUB_SOURCE_PROTECTION_UNVERIFIED');
    const created=await this.call(owner,id,repo,'contents:write','POST','/git/refs',
      {ref:'refs/heads/'+branch,sha:actualSha},{branch});
    if(created?.ref!=='refs/heads/'+branch)
      throw new Error('GITHUB_BRANCH_RESPONSE_INVALID');
    return {repo,branch,from:baseBranch,baseSha:actualSha,created:true,
      defaultBranchUntouched:true};
  }

  /**
   * Prepare a DRAFT review into a verified non-default branch (e.g. tester).
   * No merge, workflow dispatch, deployment or default-branch changes.
   */
  async draftPullToNonDefault(owner:string,id:string,repo:string,branch:string,
    baseBranch:string,title:string,body='') {
    this.workingBranch(branch);
    this.workingBranch(baseBranch);
    if(!branch.startsWith('nyx/') || branch===baseBranch)
      throw new Error('GITHUB_REVIEW_BRANCH_REQUIRED');
    if(typeof title!=='string'||!title.trim()||title.length>200 ||
       typeof body!=='string'||body.length>10000)
      throw new Error('GITHUB_PULL_INPUT_INVALID');
    const defaultRef=await this.defaultBranch(owner,id,repo,'pulls:write',{branch});
    if(branch===defaultRef || baseBranch===defaultRef)
      throw new Error('GITHUB_DEFAULT_BRANCH_WRITE_FORBIDDEN');
    const data=await this.call(owner,id,repo,'pulls:write','POST','/pulls',{
      head:branch,base:baseBranch,title:title.trim(),body,draft:true,
      maintainer_can_modify:false,
    },{branch});
    if(data?.draft!==true||!Number.isSafeInteger(data?.number)||
       data?.base?.ref!==baseBranch || data?.head?.ref!==branch)
      throw new Error('GITHUB_PULL_RESPONSE_INVALID');
    return {repo,number:data.number,url:data.html_url,branch,base:baseBranch,draft:true};
  }

  /**
   * Review-only release PR from the current non-default tester branch to a
   * GitHub-protected default (main/master). Never updates either ref.
   * The accepted source commit must be rechecked immediately before PR create.
   */
  async draftTesterRelease(owner:string,id:string,repo:string,
                           expectedTesterSha:string,title:string,body='') {
    const source='tester';
    if(!/^[a-f0-9]{40}$/.test(expectedTesterSha) ||
       typeof title!=='string'||!title.trim()||title.length>200 ||
       typeof body!=='string'||body.length>10000)
      throw new Error('GITHUB_RELEASE_INPUT_INVALID');
    const base=await this.defaultBranch(owner,id,repo,'pulls:write',{branch:source});
    if(!['main','master'].includes(base) || base===source)
      throw new Error('GITHUB_RELEASE_DEFAULT_BRANCH_UNSUPPORTED');
    const inspect=async(branch:string)=>{
      const item=await this.call(owner,id,repo,'resources:read','GET',
        '/branches/'+encodeURIComponent(branch),undefined,{branch:source});
      const sha=item?.commit?.sha;
      if(item?.name!==branch || typeof sha!=='string'||!/^[a-f0-9]{40}$/.test(sha))
        throw new Error('GITHUB_RELEASE_BRANCH_UNVERIFIED');
      return {sha,protected:item.protected};
    };
    const dest=await inspect(base);
    if(dest.protected!==true)throw new Error('GITHUB_RELEASE_BASE_NOT_PROTECTED');
    const src=await inspect(source);
    if(src.protected!==false)throw new Error('GITHUB_RELEASE_SOURCE_PROTECTED');
    if(src.sha!==expectedTesterSha)throw new Error('GITHUB_RELEASE_SOURCE_CHANGED');
    const comparison=await this.call(owner,id,repo,'resources:read','GET',
      '/compare/'+encodeURIComponent(base)+'...'+encodeURIComponent(source),
      undefined,{branch:source});
    if(comparison?.status!=='ahead' || !Number.isSafeInteger(comparison.ahead_by) ||
       comparison.ahead_by<1 || comparison.behind_by!==0 ||
       !Array.isArray(comparison.files) || !comparison.files.length ||
       comparison.files.length>100)
      throw new Error('GITHUB_RELEASE_DIFF_UNVERIFIED');
    // Avoid duplicate open PRs; refuse when first page cannot prove uniqueness.
    const existing=await this.call(owner,id,repo,'pulls:read','GET','/pulls',
      undefined,{branch:source});
    if(!Array.isArray(existing) || existing.length>=30)
      throw new Error('GITHUB_RELEASE_PR_INVENTORY_INCOMPLETE');
    const current=existing.find(pr=>pr?.state==='open' &&
      pr?.head?.ref===source && pr?.base?.ref===base);
    if(current){
      if(!Number.isSafeInteger(current.number)||typeof current.html_url!=='string')
        throw new Error('GITHUB_RELEASE_PR_RESPONSE_INVALID');
      return {repo,number:current.number,url:current.html_url,branch:source,
        base,draft:current.draft===true,alreadyOpen:true,
        sourceSha:src.sha,changedFiles:comparison.files.length};
    }
    if((await inspect(source)).sha!==expectedTesterSha)
      throw new Error('GITHUB_RELEASE_SOURCE_CHANGED');
    const result=await this.call(owner,id,repo,'pulls:write','POST','/pulls',{
      head:source,base,title:title.trim(),body,draft:true,
      maintainer_can_modify:false,
    },{branch:source});
    if(!Number.isSafeInteger(result?.number)||result?.draft!==true||
       result?.head?.ref!==source||result?.base?.ref!==base ||
       result?.head?.sha!==expectedTesterSha ||
       typeof result?.html_url!=='string')
      throw new Error('GITHUB_RELEASE_PR_RESPONSE_INVALID');
    return {repo,number:result.number,url:result.html_url,branch:source,
      base,draft:true,alreadyOpen:false,sourceSha:expectedTesterSha,
      changedFiles:comparison.files.length};
  }

  /** Create/update exactly one text file with GitHub's optimistic SHA check. */
  async commitFile(owner:string,id:string,repo:string,branch:string,
    path:string,content:string,message:string,sha?:string) {
    this.workingBranch(branch);this.writablePath(path);
    if(typeof content!=='string' || Buffer.byteLength(content,'utf8')>65536 ||
       content.includes('\x00'))throw new Error('GITHUB_FILE_SIZE_OR_ENCODING_INVALID');
    if(typeof message!=='string'||!message.trim()||message.length>160)
      throw new Error('GITHUB_COMMIT_MESSAGE_INVALID');
    if(sha!==undefined && !/^[a-f0-9]{40}$/.test(sha))
      throw new Error('GITHUB_FILE_SHA_INVALID');
    // All default branches remain protected, even if not named main/master.
    const base=await this.defaultBranch(owner,id,repo,'contents:write',{branch});
    if(branch===base)throw new Error('GITHUB_DEFAULT_BRANCH_WRITE_FORBIDDEN');
    const suffix='/contents/'+path.split('/').map(encodeURIComponent).join('/');
    const result=await this.call(owner,id,repo,'contents:write','PUT',suffix,{
      message:message.trim(),content:Buffer.from(content,'utf8').toString('base64'),
      branch,...(sha?{sha}:{}),
    },{branch,path});
    const commitSha=result?.commit?.sha;
    if(typeof commitSha!=='string'||!/^[a-f0-9]{40}$/.test(commitSha))
      throw new Error('GITHUB_COMMIT_RESPONSE_INVALID');
    return {repo,branch,path,commitSha,mode:sha?'update':'create'};
  }
  /** Open a DRAFT pull request only, targeting the repository's default branch. */
  async draftPull(owner:string,id:string,repo:string,branch:string,
    title:string,body='') {
    this.workingBranch(branch);
    if(typeof title!=='string'||!title.trim()||title.length>200 ||
       typeof body!=='string'||body.length>10000)
      throw new Error('GITHUB_PULL_INPUT_INVALID');
    const base=await this.defaultBranch(owner,id,repo,'pulls:write',{branch});
    if(branch===base)throw new Error('GITHUB_DEFAULT_BRANCH_WRITE_FORBIDDEN');
    const data=await this.call(owner,id,repo,'pulls:write','POST','/pulls',{
      head:branch,base,title:title.trim(),body,draft:true,maintainer_can_modify:false,
    },{branch});
    if(data?.draft!==true||!Number.isSafeInteger(data?.number))
      throw new Error('GITHUB_PULL_RESPONSE_INVALID');
    return {repo,number:data.number,url:data.html_url,branch,base,draft:true};
  }
  async createIssue(owner:string,id:string,repo:string,title:string,body='') {
    if(typeof title!=='string'||!title.trim()||title.length>200 ||
       typeof body!=='string'||body.length>10000)
      throw new Error('GITHUB_ISSUE_INPUT_INVALID');
    const data=await this.call(owner,id,repo,'issues:write','POST','/issues',
      {title:title.trim(),body});
    if(!Number.isSafeInteger(data?.number)||data?.pull_request)
      throw new Error('GITHUB_ISSUE_RESPONSE_INVALID');
    return {repo,number:data.number,title:data.title,url:data.html_url};
  }
}
