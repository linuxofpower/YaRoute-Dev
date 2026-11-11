const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {BrandingController}=require('../dist/branding.controller');

const file=(name)=>fs.readFileSync(path.join(__dirname,'..','public','branding',name));

test('the exact blue and purple icons are checked in as distinct sub-10-KB PNGs',()=>{
 const blue=file('icon.png'),blueAlias=file('nestnyx-dev.png'),purple=file('nestnyx-prod.png');
 for(const [name,png] of [['blue',blue],['purple',purple]]) {
  assert.ok(png.byteLength<10000, name+' logo should be under 10 KB');
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16),96);
  assert.equal(png.readUInt32BE(20),96);
 }
 assert.deepEqual(blue,blueAlias);
 assert.notDeepEqual(blue,purple);
});

function response(){
 const r={statusCode:200,headers:{},sent:null,mime:null,redirectCode:null,redirectPath:null};
 r.setHeader=(k,v)=>{r.headers[k]=v;return r;};
 r.type=(mime)=>{r.mime=mime;return r;};
 r.send=(body)=>{r.sent=body;return r;};
 r.redirect=(code,p)=>{r.redirectCode=code;r.redirectPath=p;return r;};
 return r;
}
test('only DevNestNyx and NestNyx brand identities use independent icons',async()=>{
 const ctl=new BrandingController();
 const previous=process.env.NYX_BRAND_VARIANT;
 try {
  for (const [variant,asset,title] of [
    ['development','nestnyx-dev.png','DevNestNyx'],
    ['production','nestnyx-prod.png','NestNyx'],
  ]) {
   process.env.NYX_BRAND_VARIANT=variant;
   const res=response();await ctl.icon(res);
   assert.equal(res.mime,'image/png');
   assert.deepEqual(res.sent,file(asset));
   assert.equal(res.headers['X-Content-Type-Options'],'nosniff');
   const manifest=response();ctl.manifest(manifest);
   assert.equal(manifest.sent.name,title);
   assert.equal(manifest.sent.icons[0].src,'/branding/icon.png');
   assert.equal(manifest.sent.icons[0].sizes,'96x96');
  }
 } finally {
  if(previous===undefined)delete process.env.NYX_BRAND_VARIANT;
  else process.env.NYX_BRAND_VARIANT=previous;
 }
 const iconRedirect=response();ctl.favicon(iconRedirect);
 assert.equal(iconRedirect.redirectPath,'/branding/icon.png');
});
test('the public home page includes favicon and social preview but no secrets',()=>{
 const home=response();new BrandingController().home(home);
 assert.match(home.sent,/href="\/branding\/icon.png"/);
 assert.match(home.sent,/og:image/);
 assert.doesNotMatch(home.sent,/access_token|refresh_token|client_secret|RCLONE_CONFIG/);
 assert.match(home.headers['Content-Security-Policy'],/img-src 'self'/);
});
test('MCP and ChatGPT connections panel advertise the icon from its own HTTPS server',()=>{
 const mcp=fs.readFileSync(path.join(__dirname,'..','src','mcp','mcp.service.ts'),'utf8');
 const panel=fs.readFileSync(path.join(__dirname,'..','src','connectors','connections-panel.ts'),'utf8');
 const app=JSON.parse(fs.readFileSync(path.join(__dirname,'..','app.json'),'utf8'));
 assert.match(mcp,/icons: CONNECTIONS_PANEL_BRAND_ORIGIN/);
 assert.match(mcp,/resourceDomains:CONNECTIONS_PANEL_BRAND_ORIGIN/);
 assert.match(panel,/branding\/icon\.png/);
 assert.match(panel,/iconMarkup/);
 assert.match(app.logo,/\/branding\/icon\.png$/);
});
