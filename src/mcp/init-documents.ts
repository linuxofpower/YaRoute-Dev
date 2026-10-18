/**
 * Mandatory read-only delivery surface for YaRoCLI ini.
 * The MCP client controls whether a component is displayed; the widget itself
 * never trusts a model-generated list of files or sends storage credentials.
 */
export const INIT_DOCUMENTS_URI = 'ui://nestnyx/init-documents/v1.html';
export const INIT_DOCUMENTS_HTML = String.raw`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>NYX Initialization Documents</title>
<style>
:root { color-scheme: light dark; font: 14px/1.5 system-ui,sans-serif; }
body { margin: 0; padding: 14px; }
h1 { font-size: 18px; margin: 0 0 6px; }
p { margin: 0 0 10px; }
small { opacity:.7; }
details { border:1px solid #8885; border-radius:9px; padding:9px 12px; margin:8px 0; }
summary { cursor:pointer; font-weight:650; }
pre { margin:8px 0; padding:10px; white-space:pre-wrap; overflow-wrap:anywhere; font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace; background:#8882; border-radius:6px; }
.ok { border-left:3px solid #2d8b62; padding-left:8px; }
.warning { border-left:3px solid #b56c16; padding-left:8px; }
#error { color:#b33; }
</style></head><body>
<h1>🪼 NYX initialization · mandatory documents</h1>
<p id="status" aria-live="polite">Receiving verified initialization packet…</p>
<div id="documents"></div><p id="error" role="alert"></p>
<script>
(function(){
  'use strict';
  const documents=document.getElementById('documents');
  const status=document.getElementById('status');
  const error=document.getElementById('error');
  let handled=false;
  function fail(message){status.textContent='Initialization documents unavailable';status.className='warning';error.textContent=message;documents.replaceChildren();}
  async function hexSha256(content) {
    if(!globalThis.crypto?.subtle) return null;
    const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(content));
    return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
  }
  function unwrap(msg){return msg?.structuredContent?.result || msg?.structuredContent || msg?.result || msg;}
  async function render(message){
    const packet=unwrap(message);
    if(!packet || packet.metadata?.command!=='ini')return;
    if(!Array.isArray(packet.files_to_paste)||!packet.delivery||packet.delivery.status!=='PENDING_USER_VISIBLE_RENDER')
      return fail('Server did not include a complete mandatory delivery contract.');
    const files=packet.files_to_paste;
    if(!files.length || packet.delivery.required_file_count!==files.length ||
       !Array.isArray(packet.delivery.expected)||packet.delivery.expected.length!==files.length)
      return fail('Required document count mismatch. Do not treat initialization as complete.');
    for(let i=0;i<files.length;i++){
      const item=files[i], expected=packet.delivery.expected[i];
      if(!item||typeof item.content!=='string'||!expected||item.key!==expected.key||
         item.sha256!==expected.sha256||item.name!==expected.name)
        return fail('Mandatory document receipt/order mismatch. No partial packet displayed.');
      const actual=await hexSha256(item.content);
      if(actual && actual!==expected.sha256)
        return fail('Mandatory document checksum mismatch for '+item.name);
    }
    documents.replaceChildren();
    for(const item of files){
      const section=document.createElement('details');
      section.open=true;
      const heading=document.createElement('summary');heading.textContent=item.name;
      const body=document.createElement('pre');body.textContent=item.content;
      const receipt=document.createElement('small');receipt.textContent='sha256: '+item.sha256;
      section.append(heading,body,receipt);documents.append(section);
    }
    handled=true;
    status.textContent=files.length+' complete documents rendered from the verified backend packet. Model chat-paste verification is separate.';
    status.className='ok';error.textContent='';
  }
  window.addEventListener('message',event=>{
    if(event.source!==window.parent||event.data?.jsonrpc!=='2.0')return;
    if(event.data.method==='ui/notifications/tool-result')render(event.data.params).catch(e=>fail(String(e)));
  });
  if(window.openai?.toolOutput)render({structuredContent:window.openai.toolOutput}).catch(e=>fail(String(e)));
  const id=1;
  window.addEventListener('message',event=>{
    if(event.source!==window.parent||event.data?.jsonrpc!=='2.0'||event.data.id!==id)return;
    if(event.data.error)return fail('MCP Apps host initialization failed.');
    window.parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized',params:{}},'*');
  });
  window.parent.postMessage({jsonrpc:'2.0',id,method:'ui/initialize',
    params:{appInfo:{name:'NYX mandatory initialization documents',version:'1.0.0'},
      appCapabilities:{},protocolVersion:'2026-01-26'}},'*');
})();
</script></body></html>`;
