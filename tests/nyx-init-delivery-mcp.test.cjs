const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
require('reflect-metadata');
const {McpService}=require('../dist/mcp/mcp.service');
const {INIT_DOCUMENTS_HTML,INIT_DOCUMENTS_URI}=require('../dist/mcp/init-documents');

test('all init depths enforce six required visible files, regardless of target',()=>{
  const profile=JSON.parse(fs.readFileSync(path.join(__dirname,'..','config','nyx-runtime-profile.json'),'utf8'));
  const expected=['maps','nyxcli','todo','todo_10','toget'];
  for(const depth of ['basic','normal','deep']){
    const sources=profile.commands.ini.sources[depth];
    for(const key of expected){
      const matches=sources.filter(s=>s.key===key);
      assert.equal(matches.length,1,depth+':'+key);
      assert.equal(matches[0].required,true);
      assert.equal(matches[0].visible,true);
      assert.equal(matches[0].when,'always');
    }
    for(const key of ['FileFilter.area_paths','FileFilter.state','FileFilter.config']){
      const item=sources.find(s=>s.key===key);
      assert.ok(item&&item.required&&!item.visible&&item.forTarget==='FileFilter');
    }
  }
  assert.equal(profile.commands.ini.pathsVisible,true);
});

test('MCP init gives GPT explicit first-part instructions and complete second-part documents',async()=>{
  const packet={
    metadata:{command:'ini'},status:'COMPLETE',
    delivery:{markdown:'### paths.md\n\n~~~~text\nCOMPLETE SOURCE\n~~~~',status:'PENDING_USER_VISIBLE_RENDER',gpt_instructions:'GPT, paste all verified initialization documents into the ACTIVE chat. Do not summarize.',expected:[{key:'paths',name:'paths.md',sha256:'abc'}],sha256:'def'},
    files_to_paste:[{key:'paths',name:'paths.md',content:'COMPLETE SOURCE',sha256:'abc'}]
  };
  const service=Object.create(McpService.prototype);
  service.safeTool=async()=>({content:[{type:'text',text:JSON.stringify(packet)}],structuredContent:{result:packet}});
  const reply=await service.safeInitTool(async()=>packet);
  assert.ok(reply.content[0].text.startsWith('NYX → GPT — REQUIRED ACTION'));
  assert.ok(reply.content[0].text.includes(packet.delivery.gpt_instructions));
  assert.ok(reply.content[0].text.includes('next MCP text part'));
  assert.ok(!reply.content[0].text.includes('COMPLETE SOURCE'));
  assert.equal(reply.content[1].text,packet.delivery.markdown);
  assert.ok(reply.content[1].text.includes('COMPLETE SOURCE'));
  assert.equal(reply.structuredContent.result,packet);
  assert.equal(JSON.parse(reply.content[2].text).visible_delivery_status,'PENDING_USER_VISIBLE_RENDER');
});

test('MCP Apps initialization widget renders only validated source content as plain text',()=>{
  assert.equal(INIT_DOCUMENTS_URI,'ui://nestnyx/init-documents/v1.html');
  assert.match(INIT_DOCUMENTS_HTML,/ui\/notifications\/tool-result/);
  assert.match(INIT_DOCUMENTS_HTML,/delivery\.expected/);
  assert.match(INIT_DOCUMENTS_HTML,/hexSha256/);
  assert.match(INIT_DOCUMENTS_HTML,/body\.textContent=item\.content/);
  assert.doesNotMatch(INIT_DOCUMENTS_HTML,/innerHTML\s*=/);
});
