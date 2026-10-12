import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../common/public.decorator';
import { TenantRcloneService } from './tenant-rclone.service';

function escapeHtml(value:string):string {
  return value.replace(/[&<>"']/g,c=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  })[c] || '');
}

/**
 * This HTTPS enrollment form is a NestNyx-operated credential collector, NOT
 * an official MEGA OAuth page (MEGA's Rclone backend has no OAuth flow).
 * Never send a user's MEGA password, email or OTP through ChatGPT/MCP.
 */
@Public()
@Controller('connect/mega')
export class MegaConnectController {
  constructor(private readonly storage:TenantRcloneService) {}

  private headers(res:Response) {
    res.setHeader('Cache-Control','no-store, max-age=0');
    res.setHeader('Pragma','no-cache');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',"default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; style-src 'unsafe-inline'");
  }
  private page(title:string,message:string) {
    return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
      '<title>'+escapeHtml(title)+'</title><main style="max-width:35rem;margin:3rem auto;font:16px system-ui">'+
      '<h1>'+escapeHtml(title)+'</h1><p>'+escapeHtml(message)+'</p></main></html>';
  }

  @Get()
  async show(@Query('ticket') ticket:string,@Res() res:Response) {
    this.headers(res);
    try {
      const {name}=await this.storage.inspectMegaTicket(ticket);
      // Only ticket is placed in hidden field; never copy the password to HTML.
      res.status(200).type('html').send(
        '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
        '<title>Connect MEGA to NestNyx</title>'+
        '<main style="max-width:35rem;margin:3rem auto;font:16px system-ui">'+
        '<h1>Connect MEGA to NestNyx</h1><p>Connection: <strong>'+escapeHtml(name)+'</strong></p>'+
        '<p><strong>Security:</strong> This is a NestNyx-hosted form, not an official MEGA sign-in page. '+
        'NestNyx needs the MEGA credentials to authenticate Rclone on your behalf. '+
        'The login is validated server-side, and credentials are encrypted in the NestNyx database. '+
        'They are never sent to ChatGPT. Continue only if you trust this NestNyx deployment.</p>'+
        '<form method="post" action="/connect/mega/submit" autocomplete="off">'+
        '<input type="hidden" name="ticket" value="'+escapeHtml(ticket)+'">'+
        '<p><label>MEGA email<br><input type="email" name="user" required maxlength="320" autocomplete="username"></label></p>'+
        '<p><label>MEGA password<br><input type="password" name="password" required maxlength="1024" autocomplete="current-password"></label></p>'+
        '<p><label>6-digit 2FA code (if enabled)<br><input type="text" name="otp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code"></label></p>'+
        '<p><button type="submit">Connect MEGA securely</button></p>'+
        '<p>This one-time form expires in 10 minutes and becomes invalid after submitting. '+
        'MEGA authentication must already have been initialized by signing in to the MEGA website once.</p>'+
        '</form></main></html>');
    }catch {
      res.status(400).type('html').send(this.page('Connection expired','Return to NestNyx and create a new MEGA connection.'));
    }
  }

  @Post('submit')
  async submit(@Req() req:Request,@Body() form:Record<string,unknown>,@Res() res:Response) {
    this.headers(res);
    const base=process.env.NYX_PUBLIC_URL;
    let origin:string;
    try {origin=new URL(base||'').origin;}catch {
      res.status(503).type('html').send(this.page('Unavailable','MEGA enrollment is not configured.'));return;
    }
    if(req.headers.origin!==origin ||
      !(req.headers['content-type']||'').startsWith('application/x-www-form-urlencoded') ||
      Number(req.headers['content-length']||0)>4096) {
      res.status(403).type('html').send(this.page('Request blocked','Open the one-time form from NestNyx.'));return;
    }
    const ticket=form?.ticket,user=form?.user,password=form?.password,otp=form?.otp;
    if(typeof ticket!=='string'||typeof user!=='string'||typeof password!=='string'||
       (otp!==undefined&&typeof otp!=='string')) {
      res.status(400).type('html').send(this.page('Invalid form','Reopen the connection form.'));return;
    }
    try {
      await this.storage.completeMega(ticket,user,password,otp||undefined);
      res.status(200).type('html').send(this.page('MEGA connected','Return to NestNyx and refresh your connections. Test read/write access before using this storage account.'));
    }catch {
      // Neither passwords nor MEGA error responses are sent to the browser.
      res.status(400).type('html').send(this.page('Connection not completed','The one-time form was expired, invalid or the MEGA login failed. Check your credentials and begin again in NestNyx.'));
    }
  }
}
