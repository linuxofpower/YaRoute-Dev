/**
 * NYX non-secret environment contract: no Heroku mutation, no credential copying.
 * Target-owned app metadata is preserved; values require runtime verification.
 */
export const PROFILES=Object.freeze({
 dev:{repo:'linuxofpower/YaRoute-Dev',branch:'main',name:'DevNestNyx'},
 tester:{repo:'yaMorozYaroslav/YaRoute',branch:'tester',name:'NestNyx'},
 production:{repo:'yaMorozYaroslav/YaRoute',branch:'master',name:'NestNyx'},
});
export const KEEP_TARGET=Object.freeze(['app.json','Procfile','.github/CODEOWNERS',
 '.github/workflows/ci.yml','.github/workflows/security-audit.yml',
 'scripts/install-rclone.mjs','README.md']);
export const EXTERNAL_SECRET_NAMES=Object.freeze(['DATABASE_URL','NYX_STORAGE_ENCRYPTION_KEY',
 'RCLONE_CONFIG_B64','RCLONE_CONFIG_PATH','NYX_GOOGLE_CLIENT_SECRET',
 'NYX_GITHUB_APP_PRIVATE_KEY','NYX_OAUTH_CLIENT_SECRET','NYX_SHARED_ROOTS_JSON']);
const SENSITIVE=/(TOKEN|SECRET|PASSWORD|PRIVATE_KEY|CREDENTIAL|RCLONE_CONFIG|DATABASE_URL|SHARED_ROOTS)/i;
const SAFE_DEFAULTS=Object.freeze({NYX_DEPLOYMENT_MODE:'private',
 NYX_PUBLIC_CONNECTORS_ENABLED:'false',NYX_MULTIUSER_RCLONE_ENABLED:'false'});
export function proposal(name){
 const p=PROFILES[name];if(!p)throw Error('NYX_PROFILE_INVALID');
 return {schema:'nyx.environment.proposal.v1',profile:name,repo:p.repo,branch:p.branch,
  safeDefaults:{...SAFE_DEFAULTS,NYX_SERVICE_NAME:p.name},preserveTargetPaths:[...KEEP_TARGET],
  externalSecretKeyNames:[...EXTERNAL_SECRET_NAMES],
  advisory:'Proposed configuration only; no live environment or secrets were inspected or modified.'};
}
export function validateProfile(name,provided){
 if(!PROFILES[name]||!provided||typeof provided!=='object'||Array.isArray(provided))throw Error('NYX_PROFILE_INVALID');
 if(Object.keys(provided).some(k=>SENSITIVE.test(k)))throw Error('NYX_SENSITIVE_ENV_INPUT_REFUSED');
 const expected=proposal(name).safeDefaults,mismatches=[];
 for(const [key,value] of Object.entries(expected))
  if(provided[key]!==value)mismatches.push({key,expected:value,actual:provided[key]===undefined?'MISSING':'DIFFERENT'});
 return {schema:'nyx.environment.validation.v1',profile:name,status:mismatches.length?'BLOCKED':'PROPOSED_PROFILE_MATCH',
  mismatches,advisory:'This does not verify deployed Heroku settings.'};
}
