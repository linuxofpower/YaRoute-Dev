import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common/public.decorator';
import { TenantRcloneService } from './tenant-rclone.service';

/** Google redirects here after the user authorizes a specific personal Drive. */
@Public()
@Controller('connect/google-drive')
export class GoogleDriveOAuthController {
  constructor(private readonly connections:TenantRcloneService){}

  @Get('callback')
  async callback(@Query('state') state:string,@Query('code') code:string,@Res() res:Response) {
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'");
    try{
      await this.connections.completeGoogle(state,code);
      res.status(200).type('html').send(
        '<!doctype html><meta charset="utf-8"><title>Google Drive connected</title>'+
        '<main style="font:16px system-ui;margin:3rem;max-width:36rem">'+
        '<h1>Google Drive connected to NestNyx</h1>'+
        '<p>Return to ChatGPT. Use your NestNyx storage tools to test the connection and choose MAIN. '+
        'Only files authorized for NestNyx are accessible.</p></main>');
    }catch{
      // Never include OAuth codes, secrets, email addresses or provider error text.
      res.status(400).type('html').send(
        '<!doctype html><meta charset="utf-8"><title>Connection failed</title>'+
        '<main style="font:16px system-ui;margin:3rem;max-width:36rem">'+
        '<h1>Google Drive connection not completed</h1>'+
        '<p>Authorization expired, was denied, or lacked the required permission. '+
        'Return to NestNyx and begin again.</p></main>');
    }
  }
}
