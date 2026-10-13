const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const panel=fs.readFileSync(path.join(__dirname,'..','src','connectors','connections-panel.ts'),'utf8');
const mcp=fs.readFileSync(path.join(__dirname,'..','src','mcp','mcp.service.ts'),'utf8');

test('command panel has icons, accessible tone labels and gray/yellow/green styles',()=>{
 assert.match(panel,/glyphs=\{hel:'📖',ini:'🚀'/);
 assert.match(panel,/toneGlyphs=\{gray:'⚪',yellow:'🟡',green:'🟢'/);
 assert.match(panel,/nyx-command-button nyx-command-/);
 assert.match(panel,/aria-label',label\+': '\+meanings\[tone\]/);
 assert.match(panel,/call\('nyx_help',\{\}\)/);
 assert.match(panel,/call\('nyx_hea',\{\}\)/);
 assert.doesNotMatch(panel,/call\('nyx_execute'/);
});

test('health auxiliary is private-only, read-only, and retains hel as CLI authority',()=>{
 const gate=mcp.indexOf("if (process.env.NYX_DEPLOYMENT_MODE==='public') return server;");
 const start=mcp.indexOf("server.registerTool('nyx_hea'");
 const end=mcp.indexOf("server.registerTool(\n      'nyx_execute'",start);
 assert.ok(start>gate&&end>start);
 const sub=mcp.slice(start,end);
 assert.match(sub,/readOnlyHint:true/);
 assert.match(sub,/this.commands.execute\(\{command:'hel'\}/);
 assert.match(sub,/requestedCliCommandCanonical:false/);
 assert.match(sub,/probesExecuted:false,mutations:'none'/);
 assert.doesNotMatch(sub,/\b(?:createCopy|createGlobalIndex|writeFile|insert|deleteFile|move|remove)\(/i);
});

test('first-party brand icon and resource CSP survived colorized panel',()=>{
 assert.match(panel,/iconMarkup/);
 assert.match(panel,/branding\/icon\.png/);
 assert.match(mcp,/icons: CONNECTIONS_PANEL_BRAND_ORIGIN/);
 assert.match(mcp,/resourceDomains:CONNECTIONS_PANEL_BRAND_ORIGIN/);
});
