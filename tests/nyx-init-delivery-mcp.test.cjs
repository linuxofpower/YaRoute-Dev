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
  const filenames=['paths.md','maps.md','nyxcli.md','todo.md','todo_10.md','toget.md'];
  const files=filenames.map((name,i)=>({
    key:name.replace('.md',''),name,content:'COMPLETE SOURCE '+i+'\\n',sha256:'hash-'+i
  }));
  const markdown=files.map(f=>'### '+f.name+'\\n\\n~~~~text\\n'+f.content+'~~~~').join('\\n\\n');
  const packet={
    metadata:{command:'ini'},status:'COMPLETE',
    delivery:{
      markdown,
      status:'PENDING_USER_VISIBLE_RENDER',
      gpt_instructions:'GPT, paste all six verified initialization documents into the ACTIVE chat. Do not summarize.',
      required_file_count:6,
      expected:files.map(({key,name,sha256})=>({key,name,sha256})),
      sha256:'packet-hash',
    },
    files_to_paste:files,
  };
  const service=Object.create(McpService.prototype);
  service.safeTool=async action=>{
    const result=await action();
    return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:{result}};
  };
  const reply=await service.safeInitTool(async()=>packet);
  assert.ok(reply.content[0].text.startsWith('NYX → GPT — REQUIRED ACTION'));
  assert.ok(reply.content[0].text.includes(packet.delivery.gpt_instructions));
  assert.ok(reply.content[0].text.includes('next MCP text part'));
  assert.ok(!reply.content[0].text.includes('COMPLETE SOURCE'));
  assert.equal(reply.content[1].text,packet.delivery.markdown);
  assert.ok(reply.content[1].text.includes('COMPLETE SOURCE 5'));
  assert.equal(reply.structuredContent.result,packet);
  assert.equal(JSON.parse(reply.content[2].text).visible_delivery_status,'PENDING_USER_VISIBLE_RENDER');

  const missingInstruction=await service.safeInitTool(async()=>({
    ...packet,delivery:{...packet.delivery,gpt_instructions:''},
  }));
  assert.equal(missingInstruction.isError,true);
  assert.equal(missingInstruction.content[0].text,'INIT_DELIVERY_CONTRACT_MISSING');
  const missingFile=await service.safeInitTool(async()=>({
    ...packet,files_to_paste:files.slice(1),
  }));
  assert.equal(missingFile.isError,true);
  assert.equal(missingFile.content[0].text,'INIT_DELIVERY_CONTRACT_MISSING');
});

test('MCP Apps initialization widget renders only validated source content as plain text',()=>{
  assert.equal(INIT_DOCUMENTS_URI,'ui://nestnyx/init-documents/v1.html');
  assert.match(INIT_DOCUMENTS_HTML,/ui\/notifications\/tool-result/);
  assert.match(INIT_DOCUMENTS_HTML,/delivery\.expected/);
  assert.match(INIT_DOCUMENTS_HTML,/hexSha256/);
  assert.match(INIT_DOCUMENTS_HTML,/body\.textContent=item\.content/);
  assert.doesNotMatch(INIT_DOCUMENTS_HTML,/innerHTML\s*=/);
});
