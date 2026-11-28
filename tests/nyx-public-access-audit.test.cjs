const { test }=require('node:test');
const assert=require('node:assert/strict');
const host='https://dev-nest-nyx-0df80c227630.herokuapp.com';
const load=()=>import('../scripts/nyx-public-access-audit.mjs');
test('valid public MCP metadata requires exact resource, HTTPS issuer, both scopes',async()=>{
 const {validatePublicMcpMetadata:f}=await load();
 const good={resource:host+'/mcp',authorization_servers:['https://auth.example.com/'],
   scopes_supported:['nyx.read','nyx.write']};
 assert.equal(f(host,good),true);
 assert.throws(()=>f(host,{...good,resource:'https://other.invalid/mcp'}),/SECURITY_MCP_OAUTH_METADATA_INVALID/);
 assert.throws(()=>f(host,{...good,authorization_servers:['http://auth.example.com']}),/SECURITY_MCP_OAUTH_METADATA_INVALID/);
 assert.throws(()=>f(host,{...good,scopes_supported:['nyx.read']}),/SECURITY_MCP_OAUTH_METADATA_INVALID/);
 assert.throws(()=>f('https://attacker.invalid',good),/SECURITY_UNEXPECTED_PUBLIC_URL/);
});
test('anonymous MCP must challenge with exact 401 and protected-resource URL',async()=>{
 const {assertUnauthorizedMcp:f}=await load();
 const challenge='Bearer resource_metadata="'+host+'/.well-known/oauth-protected-resource"';
 assert.equal(f(401,challenge,host),true);
 for (const status of [200,201,302,403,405,500]) {
   assert.throws(()=>f(status,challenge,host),/SECURITY_UNAUTHENTICATED_MCP_NOT_DENIED/);
 }
 assert.throws(()=>f(401,'Bearer',host),/SECURITY_MCP_CHALLENGE_MISSING/);
});
