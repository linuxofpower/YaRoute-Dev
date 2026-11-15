import { Body, Controller, Get, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common/public.decorator';
import { TenantMegaEnrollmentService } from './tenant-mega-enrollment.service';

function noCache(res: Response) {
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
}
function escapeHtml(value: string) {
  return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
const css=[
  ':root{color-scheme:light dark;font-family:system-ui,sans-serif}',
  '*{box-sizing:border-box}',
  'body{margin:0;min-height:100vh;padding:clamp(18px,5vw,62px);',
  'background:#f1f5f9;color:#15243c}',
  'main{max-width:570px;margin:0 auto;padding:clamp(22px,4vw,36px);',
  'background:#fff;border:1px solid #dce5ed;border-radius:18px;box-shadow:0 12px 35px #1c41621a}',
  'h1{font-size:clamp(22px,4vw,29px);line-height:1.2;margin:6px 0 14px}',
  'h2{font-size:16px;margin:24px 0 9px}',
  'p,li{font-size:14px;line-height:1.55}',
  '.hint{color:#526274}.eyebrow{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#047b6e;font-weight:750}',
  '.status{padding:12px;border-radius:10px;background:#edf8f4;border:1px solid #bce4d9}',
  '.caution{padding:12px;border-radius:10px;background:#fff5e2;border:1px solid #f5d49b}',
  '.status strong,.caution strong{display:block;margin-bottom:4px}',
  '.permissions{padding:10px 14px;border:1px solid #d4dee8;border-radius:11px;margin:12px 0}',
  '.permissions ul{margin:8px 0 0;padding-left:23px}.permissions li{margin:6px 0}',
  'label{display:block;font-size:13px;font-weight:700;margin:16px 0 6px}',
  'input{display:block;width:100%;padding:12px;border:1px solid #acbdcc;border-radius:9px;font:inherit}',
  'input:focus-visible,button:focus-visible{outline:3px solid #24a58e;outline-offset:2px}',
  'button{border:0;border-radius:10px;cursor:pointer;width:100%;padding:13px;',
  'background:#087d70;color:white;font:inherit;font-weight:700;margin-top:21px}',
  '.foot{border-top:1px solid #dde6ec;margin-top:23px;padding-top:16px}',
  '@media(prefers-color-scheme:dark){body{background:#0f1725;color:#edf3fa}',
  'main{background:#192535;border-color:#354a60;box-shadow:none}',
  '.hint{color:#b4c2d2}.status{background:#14352f;border-color:#2e7362}',
  '.caution{background:#402f18;border-color:#8f6d34}',
  '.permissions{border-color:#40536a}input{background:#152235;color:white;border-color:#64748b}}',
].join('');
function page(title: string, body: string) {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>'+escapeHtml(title)+' · NestNyx Dev</title><style>'+css+'</style></head>' +
    '<body><main><div class="eyebrow">NestNyx Dev · MEGA authorization</div>' +
    body+'</main></body></html>';
}
function capabilities(values: readonly string[]) {
  const rows=[
    ['storage:list','Read and list files in the selected MEGA root'],
    ['storage:move','Rename and move individual files (separate write test required)'],
    ['storage:delete','Move individual files to the MEGA rubbish bin (reversible trash)'],
  ] as const;
  const selected=rows.filter(([id])=>values.includes(id));
  return selected.length ? '<ul>'+selected.map(([,name])=>
    '<li>'+escapeHtml(name)+'</li>').join('')+'</ul>' :
    '<p>No capabilities verified for this stage.</p>';
}
function permissionCard(heading: string, values: readonly string[]) {
  return '<div class="permissions"><strong>'+escapeHtml(heading)+'</strong>' +
    capabilities(values)+'</div>';
}

@Public()
@Controller('connect/mega')
export class MegaEnrollmentController {
  constructor(private readonly enrollment:TenantMegaEnrollmentService) {}

  @Get('setup')
  async setup(@Query('state') state:string,@Res() res:Response) {
    noCache(res);
    const info=state ? await this.enrollment.describe(state) : null;
    if(!info){
      return res.status(400).type('html').send(page('Expired MEGA connection',
        '<h1>Connection link expired</h1><p>Return to NestNyx and request a fresh, single-use authorization link.</p>'));
    }
    return res.status(200).type('html').send(page('Connect MEGA account',
      '<h1>Verify your MEGA account</h1>' +
      '<p class="hint">Enter your MEGA credentials only on this first-party HTTPS form. ' +
      'This is a read-verification and grant-check step, not a file modification.</p>' +
      '<p>Selected root: <strong>'+escapeHtml(info.rootPath)+'</strong></p>' +
      permissionCard('Requested for this exact connection',info.selectedCapabilities) +
      '<div class="caution"><strong>Not yet granted by submitting this form</strong>' +
      'Provider-verified capabilities are checked after login; new credentials must then ' +
      'be activated. No file rename, move or trash operation runs during sign-in.</div>' +
      '<form method="post" action="/connect/mega/complete" autocomplete="off">' +
      '<input type="hidden" name="state" value="'+escapeHtml(state)+'">' +
      '<label for="mega-email">MEGA account email</label><input id="mega-email" required type="email" name="email" maxlength="200" autocomplete="username">' +
      '<label for="mega-password">MEGA password</label><input id="mega-password" required type="password" name="password" maxlength="1024" autocomplete="current-password">' +
      '<label for="mega-code">Six-digit authenticator code (only if 2FA is enabled)</label>' +
      '<input id="mega-code" type="text" name="twoFactorCode" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" minlength="6" autocomplete="one-time-code" placeholder="Optional">' +
      '<button type="submit">Verify login and selected permissions</button></form>' +
      '<p class="hint foot">A successful MEGA login verifies access to the selected root. ' +
      'Move/rename and reversible trash are separately gated. Permanent deletion is never authorized here. ' +
      'Do not share credentials, 2FA codes or recovery keys in chat.</p>'
    ));
  }

  @Post('complete')
  async complete(@Body() body:{state?:string;email?:string;password?:string;twoFactorCode?:string},@Res() res:Response) {
    noCache(res);
    try {
      if(!body||typeof body.state!=='string'||typeof body.email!=='string'||
         typeof body.password!=='string')throw new Error('TENANT_MEGA_FORM_INVALID');
      const result=await this.enrollment.complete(body.state,body.email,body.password,
        body.twoFactorCode||undefined);
      return res.status(200).type('html').send(page('MEGA login verified',
        '<h1>MEGA login and read connectivity verified</h1>' +
        '<div class="status"><strong>Credential verification passed</strong>' +
        'Read probe: passed. Write probe: not attempted. ' +
        'Activation in NestNyx is still required.</div>' +
        '<p>Selected root: <strong>'+escapeHtml(result.rootPath)+'</strong></p>' +
        permissionCard('Permissions requested for this connection',result.selectedCapabilities) +
        permissionCard('Provider-verified grants after login',result.providerVerifiedCapabilities) +
        '<div class="caution"><strong>What is not yet verified</strong>' +
        'Permission selection and provider grant verification do not prove a successful ' +
        'rename, move or trash. Test only on disposable files after activation. ' +
        'Permanent deletion and whole-trash cleanup remain disabled.</div>' +
        '<p class="hint foot">Return to NestNyx and activate this exact connection. ' +
        'Existing active credentials are preserved until the tested candidate is promoted.</p>'
      ));
    }catch{
      return res.status(400).type('html').send(page('MEGA connection incomplete',
        '<h1>MEGA authorization was not completed</h1>' +
        '<p>Login verification failed or the single-use link expired. Existing active credentials remain unchanged.</p>' +
        '<p>Return to NestNyx for a new sign-in link. If your account uses 2FA, enter a fresh authenticator code. Do not disable 2FA.</p>'));
    }
  }
}
