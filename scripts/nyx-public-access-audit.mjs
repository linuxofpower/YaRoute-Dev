import { readFileSync } from 'node:fs';

export function validatePublicMcpMetadata(baseUrl, metadata) {
  const base = new URL(baseUrl);
  if (base.protocol !== 'https:' || !base.hostname.endsWith('.herokuapp.com') ||
      base.username || base.password || base.search || base.hash || base.pathname !== '/')
    throw Error('SECURITY_UNEXPECTED_PUBLIC_URL');
  if (!metadata || metadata.resource !== base.origin + '/mcp' ||
      !Array.isArray(metadata.authorization_servers) || !metadata.authorization_servers.length ||
      metadata.authorization_servers.some(v => {
        try { const u=new URL(v); return u.protocol !== 'https:' || !!u.username || !!u.password; }
        catch {return true;}
      }) ||
      !Array.isArray(metadata.scopes_supported) ||
      !['nyx.read','nyx.write'].every(s => metadata.scopes_supported.includes(s)))
    throw Error('SECURITY_MCP_OAUTH_METADATA_INVALID');
  return true;
}

export function assertUnauthorizedMcp(status, challenge, origin) {
  if (status !== 401) throw Error('SECURITY_UNAUTHENTICATED_MCP_NOT_DENIED');
  if (typeof challenge !== 'string' ||
      !challenge.includes(origin+'/.well-known/oauth-protected-resource') ||
      !challenge.includes('Bearer')) throw Error('SECURITY_MCP_CHALLENGE_MISSING');
  return true;
}

async function run() {
  const settings=JSON.parse(readFileSync('config/heroku-public.json','utf8'));
  const base=settings.NYX_PUBLIC_URL;
  const u=new URL(base);
  const host=u.origin;
  const report={schema:'nyx.public-access-audit.v1',endpoint:'configured-dev-public-origin',
    checks:{metadata:'UNVERIFIED',anonymousMcp:'UNVERIFIED'},credentialsUsed:false};
  const get=async(url,init={})=>fetch(url,{redirect:'error',signal:AbortSignal.timeout(15000),...init});
  try {
    validatePublicMcpMetadata(base,{resource:host+'/mcp',authorization_servers:['https://example.com'],scopes_supported:['nyx.read','nyx.write']});
    const metadataResponse=await get(host+'/.well-known/oauth-protected-resource');
    const metadata=metadataResponse.ok ? await metadataResponse.json() : null;
    if (!metadataResponse.ok) throw Error('SECURITY_MCP_METADATA_UNAVAILABLE');
    validatePublicMcpMetadata(base,metadata);
    report.checks.metadata='PASS';
    const unauthorized=await get(host+'/mcp',{method:'POST',
      headers:{'Content-Type':'application/json','Accept':'application/json, text/event-stream'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',
        params:{protocolVersion:'2025-03-26',capabilities:{},
          clientInfo:{name:'public-security-probe',version:'1'}}})});
    assertUnauthorizedMcp(unauthorized.status,unauthorized.headers.get('www-authenticate'),host);
    report.checks.anonymousMcp='PASS';
    console.log(JSON.stringify(report));
  } catch(e) {
    report.error=e instanceof Error?e.message:'SECURITY_AUDIT_FAILED';
    console.log(JSON.stringify(report));
    process.exitCode=1;
  }
}
if (process.argv[1] && new URL('file://'+process.argv[1]).href===import.meta.url) await run();
