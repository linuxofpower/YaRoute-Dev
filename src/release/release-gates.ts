/** Pure fail-closed release preflight. No GitHub/Heroku calls or mutations. */
import { createHash } from 'node:crypto';
const sha = /^[a-f0-9]{40}$/;
const repo = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const branch = /^[A-Za-z0-9][A-Za-z0-9_./-]{0,119}$/;
const deny = (reason:string):never => { throw new Error('RELEASE_PREFLIGHT_DENIED:' + reason); };
const validPath = (path:string):boolean => path.length > 0 && path.length <= 400 &&
  path === path.trim() && !path.startsWith('/') && !path.includes('\\') &&
  !/[\x00-\x1f]/.test(path) && path.split('/').every(x => !!x && x !== '.' && x !== '..');
const secretPath = (path:string):boolean => {
  const p=path.toLowerCase(), base=p.split('/').pop() ?? '';
  return base === '.env' || (base.startsWith('.env.') && base !== '.env.example') ||
    /\.(pem|key|p12|pfx|b64)$/.test(base) || /(^|\/)(secrets|credentials)[^/]*\.json$/.test(p) ||
    base === 'rclone.conf' || p.startsWith('.git/') || p.startsWith('node_modules/');
};
const sensitive = (p:string):boolean => p.startsWith('.github/workflows/') ||
  p.startsWith('scripts/') || ['app.json','Procfile','Dockerfile'].includes(p);
export type StagingHandoff = {
  developmentRepo:string; developmentBranch:string; developmentSha:string;
  productionRepo:string; stagingBaseBranch:'tester'; expectedStagingSha:string;
  targetDefaultBranch:'master'|'main'; changedFiles:string[]; sensitiveChangeReviewRef?:string;
};
/** Creates a SHA-pinned, reviewable handoff. Does NOT transfer code. */
export function prepareStagingHandoff(i:StagingHandoff) {
  if (!repo.test(i.developmentRepo) || !repo.test(i.productionRepo)) deny('REPO_NAME');
  if (i.developmentRepo.split('/')[1] !== i.productionRepo.split('/')[1] + '-Dev') deny('REPO_PAIR');
  if (!branch.test(i.developmentBranch) || i.developmentBranch.includes('..') ||
      i.developmentBranch.endsWith('/')) deny('DEV_BRANCH');
  if (!sha.test(i.developmentSha) || !sha.test(i.expectedStagingSha)) deny('SHA');
  if (i.stagingBaseBranch !== 'tester') deny('STAGING_BASE_MUST_BE_TESTER');
  if (!['master','main'].includes(i.targetDefaultBranch)) deny('DEFAULT_BRANCH');
  if (!i.changedFiles?.length || i.changedFiles.length > 100) deny('CHANGED_FILES_COUNT');
  if (!i.changedFiles.every(validPath)) deny('FILE_PATH');
  if (i.changedFiles.some(secretPath)) deny('SECRET_PATH');
  const changedFiles=[...new Set(i.changedFiles)].sort();
  const requiresReview=changedFiles.some(sensitive);
  if (requiresReview && (!i.sensitiveChangeReviewRef ||
      !/^[A-Za-z0-9][A-Za-z0-9_\/#.-]{5,127}$/.test(i.sensitiveChangeReviewRef))) deny('SENSITIVE_REVIEW_REQUIRED');
  const manifest = {
    schema:'nyx.release-handoff.v1' as const,
    developmentRepo:i.developmentRepo, developmentBranch:i.developmentBranch, developmentSha:i.developmentSha,
    productionRepo:i.productionRepo, stagingBaseBranch:'tester' as const,
    expectedStagingSha:i.expectedStagingSha, targetDefaultBranch:i.targetDefaultBranch,
    changedFiles, ...(requiresReview ? {sensitiveChangeReviewRef:i.sensitiveChangeReviewRef} : {}),
  };
  return Object.freeze({...manifest, manifestSha256:createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
    requiresManualReview:true as const, execution:'not-authorized' as const});
}
export type Gate = {ok:boolean;blockers:string[]};
export type ProductionGate = {
 expectedTesterSha:string;actualTesterSha:string;deployedStagingSha:string|null;
 testerCi:'success'|'failure'|'pending'|'unknown';
 testerSecurity:'success'|'failure'|'pending'|'unknown';
 isolatedStagingConfigVerified:boolean;protectedDefaultVerified:boolean;
 independentReviewApproved:boolean;reviewerIsNotAuthor:boolean;
};
/** Only checks if a PR can be PROPOSED. Never merges or deploys. */
export function checkProductionGate(e:ProductionGate):Gate {
 const blockers:string[]=[];
 if (!sha.test(e.expectedTesterSha) || !sha.test(e.actualTesterSha) ||
     e.expectedTesterSha !== e.actualTesterSha) blockers.push('TESTER_SHA_UNVERIFIED');
 if (!e.deployedStagingSha || e.deployedStagingSha !== e.expectedTesterSha)
   blockers.push('STAGING_RELEASE_SHA_UNVERIFIED');
 if (e.testerCi !== 'success') blockers.push('TESTER_CI_NOT_GREEN');
 if (e.testerSecurity !== 'success') blockers.push('TESTER_SECURITY_NOT_GREEN');
 if (!e.isolatedStagingConfigVerified) blockers.push('STAGING_CONFIG_ISOLATION_UNVERIFIED');
 if (!e.protectedDefaultVerified) blockers.push('DEFAULT_BRANCH_PROTECTION_UNVERIFIED');
 if (!e.independentReviewApproved || !e.reviewerIsNotAuthor) blockers.push('REVIEW_NOT_VERIFIED');
 return {ok:blockers.length===0,blockers};
}
export type EnvironmentEvidence = {
 devApp:string;stagingApp:string;productionApp:string;
 devPublicUrl:string;stagingPublicUrl:string;productionPublicUrl:string;
 separateDatabaseVerified:boolean;separateStorageVerified:boolean;
 separateOAuthAudienceVerified:boolean;separateEncryptionKeysVerified:boolean;
 providerReadOnlyInspectionVerified:boolean;
};
/** Requires verified presence/separation evidence, never credential values. */
export function checkEnvironmentIsolation(e:EnvironmentEvidence):Gate {
 const blockers:string[]=[];
 const apps=[e.devApp,e.stagingApp,e.productionApp], urls=[e.devPublicUrl,e.stagingPublicUrl,e.productionPublicUrl];
 if (new Set(apps).size!==3 || apps.some(x=> !/^[a-z][a-z0-9-]{1,99}$/.test(x)))
   blockers.push('APP_IDENTITIES_NOT_DISTINCT');
 if (urls.some(x=> !/^https:\/\/[a-z0-9.-]+\/?$/.test(x)) ||
     new Set(urls.map(x=>x.replace(/\/$/,''))).size!==3)
   blockers.push('PUBLIC_ORIGINS_NOT_DISTINCT');
 if (!e.separateDatabaseVerified) blockers.push('DATABASE_ISOLATION_NOT_VERIFIED');
 if (!e.separateStorageVerified) blockers.push('STORAGE_ISOLATION_NOT_VERIFIED');
 if (!e.separateOAuthAudienceVerified) blockers.push('OAUTH_ISOLATION_NOT_VERIFIED');
 if (!e.separateEncryptionKeysVerified) blockers.push('ENCRYPTION_ISOLATION_NOT_VERIFIED');
 if (!e.providerReadOnlyInspectionVerified) blockers.push('HOSTING_READ_ONLY_INSPECTION_UNVERIFIED');
 return {ok:blockers.length===0,blockers};
}
export type CleanupEvidence = {
 name:string;protected:boolean;reachableFromDefault?:boolean;uniqueCommits?:number;openPullRequests?:number;
 referencedByRelease?:boolean;referencedByDeployment?:boolean;referencedByNyxContinuity?:boolean;
 explicitUserApproval?:boolean;
};
/** Returns eligibility only. Never deletes or rewrites a branch. */
export function assessBranchCleanup(e:CleanupEvidence) {
 const blockers:string[]=[];
 if (e.protected || ['master','main','tester','gh-pages'].includes(e.name))
   blockers.push('PROTECTED_OR_CORE');
 if (e.reachableFromDefault !== true || !Number.isSafeInteger(e.uniqueCommits) || e.uniqueCommits !== 0)
   blockers.push('UNREACHABLE_OR_UNIQUE_COMMITS');
 if (!Number.isSafeInteger(e.openPullRequests) || e.openPullRequests !== 0)
   blockers.push('OPEN_PR_OR_UNVERIFIED');
 if (e.referencedByRelease !== false || e.referencedByDeployment !== false || e.referencedByNyxContinuity !== false)
   blockers.push('RELEASE_OR_CONTINUITY_REFERENCE');
 if (blockers.length) return {status:'preserve' as const,blockers};
 if (!e.explicitUserApproval) return {status:'audit-required' as const,blockers:['DELETION_APPROVAL_REQUIRED']};
 return {status:'eligible' as const,blockers:[]};
}
