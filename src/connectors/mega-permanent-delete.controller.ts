import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common/public.decorator';
import { TenantRcloneService } from './tenant-rclone.service';

function safe(res:Response) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
}
function escapeHtml(value:string) {
  return value.replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function render(title:string, content:string) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'+
    '<meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>'+escapeHtml(title)+' · NestNyx Dev</title><style>'+
    ':root{font:16px system-ui,sans-serif;color-scheme:light dark}*{box-sizing:border-box}'+
    'body{margin:0;padding:clamp(18px,5vw,60px);background:#f1f5f9;color:#172437}'+
    'main{max-width:600px;margin:auto;background:white;border-radius:18px;padding:27px;'+
    'border:1px solid #dce5ef}p{line-height:1.55}'+
    '.danger{padding:17px;border:2px solid #ba2020;background:#fff0f0;border-radius:11px}'+
    'label{display:block;margin:22px 0 7px;font-weight:700}input{width:100%;padding:11px;'+
    'border:1px solid #77869a;border-radius:8px;font:inherit}button{margin-top:18px;'+
    'background:#b42318;color:white;border:0;border-radius:9px;padding:13px;'+
    'width:100%;font:inherit;font-weight:700;cursor:pointer}'+
    'button:focus-visible,input:focus-visible{outline:3px solid #cc5a3c;outline-offset:2px}'+
    '@media(prefers-color-scheme:dark){body{background:#141d2c;color:#f5f7fa}'+
    'main{background:#202d3f;border-color:#405067}'+
    '.danger{background:#3f2025;border-color:#e35c55}'+
    'input{background:#16263b;color:white;border-color:#8193ad}}'+
    '</style></head><body><main>'+content+'</main></body></html>';
}

@Public()
@Controller('connect/mega')
export class MegaPermanentDeleteController {
  constructor(private readonly storage:TenantRcloneService) {}

  @Get('permanent-delete')
  async preview(@Query('state') state:string,@Res() res:Response) {
    safe(res);
    let record:null|{filePath:string;fileSize:number}=null;
    try{record=await this.storage.megaHardDeletePilotPreview(state);}
    catch{return res.status(404).type('html').send(render('Not available',
      '<h1>Permanent deletion unavailable</h1><p>No deletion occurred.</p>'));}
    if(!record)return res.status(400).type('html').send(render('Expired approval',
      '<h1>Approval expired or was used</h1><p>No deletion occurred.</p>'));
    const label='PERMANENT DELETE '+record.filePath;
    return res.status(200).type('html').send(render('Confirm permanent deletion',
      '<h1>Irreversible deletion</h1>'+
      '<div class="danger"><strong>PERMANENT FILE REMOVAL — NOT TRASH</strong>'+
      '<p>This deletes exactly one disposable pilot file from the active MEGA root. '+
      'It will NOT be recoverable from the MEGA rubbish bin.</p></div>'+
      '<p>File: <strong>'+escapeHtml(record.filePath)+'</strong></p>'+
      '<p>Size: '+Number(record.fileSize)+' bytes. Approval expires after five minutes.</p>'+
      '<form method="post" action="/connect/mega/permanent-delete/confirm" autocomplete="off">'+
      '<input type="hidden" name="state" value="'+escapeHtml(state)+'">'+
      '<label for="confirmation">Type <code>'+escapeHtml(label)+'</code> exactly</label>'+
      '<input id="confirmation" name="confirmation" required maxlength="120"'+
      ' autocomplete="off" spellcheck="false">'+
      '<button type="submit">Permanently delete this single test file</button></form>'+
      '<p>No directories, existing archives, provider rubbish-bin items, or other accounts can be selected in this pilot.</p>'
    ));
  }

  @Post('permanent-delete/confirm')
  async confirm(@Body() body:{state?:string;confirmation?:string},@Res() res:Response) {
    safe(res);
    if(!body || typeof body.state!=='string' || typeof body.confirmation!=='string' ||
       body.confirmation.length>120)
      return res.status(400).type('html').send(render('Invalid approval',
        '<h1>Approval invalid</h1><p>No deletion was authorized.</p>'));
    try{
      const result=await this.storage.confirmMegaHardDeletePilot(
        body.state,body.confirmation);
      return res.status(200).type('html').send(render('Permanent deletion verified',
        '<h1>Single-file permanent deletion verified</h1>'+
        '<p>File: <strong>'+escapeHtml(result.sourcePath)+'</strong></p>'+
        '<p>Receipt: '+escapeHtml(result.receiptId)+'</p>'+
        '<p><strong>This action cannot be undone.</strong></p>'));
    }catch{
      return res.status(409).type('html').send(render('Approval not completed',
        '<h1>Deletion not confirmed</h1>'+
        '<p>The approval failed, expired, or the backend returned an uncertain result. '+
        'Do not retry without checking the audit receipt and file state. '+
        'No broad cleanup or rubbish-bin purge was attempted.</p>'));
    }
  }
}
