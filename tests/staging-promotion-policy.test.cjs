const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {execFileSync,spawnSync}=require('node:child_process');
const {join}=require('node:path');
const path=join(__dirname,'../scripts/promote-yaroute-tester.sh');
const script=readFileSync(path,'utf8');

test('promotion script has valid Bash syntax and refuses unknown execution modes',()=>{
 assert.doesNotThrow(()=>execFileSync('bash',['-n',path]));
 const result=spawnSync('bash',[path,'--invalid'],{encoding:'utf8'});
 assert.equal(result.status,2);
 assert.match(result.stderr,/Usage:/);
});

test('promotion requires reviewed development main, exact CI and security success',()=>{
 assert.match(script,/merged_at=.*gh pr view 26/);
 assert.match(script,/headSha==\$sha.*\.name=="CI"/);
 assert.match(script,/Public repository security audit/);
 assert.match(script,/source_sha.*gh api/);
 assert.match(script,/current_source/);
});

test('promotion is non-force and excludes production refs and staging-specific files',()=>{
 assert.match(script,/STAGING_REF="tester"/);
 assert.match(script,/SOURCE_REF="main"/);
 assert.match(script,/git push origin HEAD:refs\/heads\/tester/);
 assert.doesNotMatch(script,/git push[^\n]*(--force|-f |master)/);
 assert.match(script,/STAGING_ONLY=/);
 for(const allowed of ['.github/CODEOWNERS','.github/workflows/ci.yml',
   '.github/workflows/security-audit.yml','README.md','app.json',
   '.nyx/staging-source.json'])assert.ok(script.includes('"'+allowed+'"'));
 assert.match(script,/git diff --cached --quiet source-reviewed/);
 assert.match(script,/master_after/);
});

test('promotion records exact upstream sha and offers dry-run without deployment',()=>{
 assert.match(script,/NYX-Source-SHA: \$source_sha/);
 assert.match(script,/sourceSha:\$sha/);
 assert.match(script,/if \[\[ "\$MODE" == "--plan" \]\]/);
 assert.doesNotMatch(script,/(heroku (deploy|releases|config)|curl[^\n]*herokuapp\.com)/);
});
