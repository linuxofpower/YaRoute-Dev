import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Pool, PoolClient } from 'pg';

type DriveToken = {
  access_token: string; refresh_token: string; token_type: 'Bearer'; expiry: string;
};
type Provider = 'drive' | 'mega';
type Row = {
  id:string; owner_id:string; provider:Provider; display_name:string;
  provider_identity:string|null; encrypted_credential:string|null;
  status:string; is_main:boolean; read_verified_at:Date|null; write_verified_at:Date|null;
};

/**
 * Completely separate from the operator's legacy Rclone config. This service
 * never accepts a user-chosen remote/config path or owner ID through MCP.
 * Disabled by default; requires deliberate tenant storage activation.
 */
@Injectable()
export class TenantRcloneService implements OnModuleInit, OnModuleDestroy {
  private pool?:Pool;
  private key?:Buffer;
  private active=0;
  private readonly activeOwners=new Set<string>();
  private readonly binary=process.env.RCLONE_BINARY || path.resolve('.bin/rclone');
  private readonly maxActive=4;

  async onModuleInit() {
    if(process.env.NYX_TENANT_STORAGE_ENABLED!=='true') return;
    if(process.env.NYX_DEPLOYMENT_MODE!=='public' ||
       process.env.NYX_PUBLIC_CONNECTORS_ENABLED!=='true')
      throw new Error('TENANT_STORAGE_REQUIRES_PUBLIC_CONNECTOR_MODE');
    const raw=process.env.NYX_STORAGE_ENCRYPTION_KEY || '';
    if(!/^[A-Za-z0-9+/]{43}=$/.test(raw))throw new Error('NYX_STORAGE_ENCRYPTION_KEY_REQUIRED');
    this.key=Buffer.from(raw,'base64');
    if(this.key.length!==32)throw new Error('INVALID_TENANT_STORAGE_KEY');
    if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL_REQUIRED');
    this.pool=new Pool({connectionString:process.env.DATABASE_URL,max:8,connectionTimeoutMillis:5000});
    await this.db().query(`CREATE TABLE IF NOT EXISTS nyx_tenant_rclone (
      id uuid PRIMARY KEY,
      owner_id text NOT NULL,
      provider text NOT NULL CHECK(provider IN ('drive','mega')),
      display_name text NOT NULL,
      provider_identity text,
      encrypted_credential text,
      status text NOT NULL DEFAULT 'pending',
      is_main boolean NOT NULL DEFAULT false,
      read_verified_at timestamptz,
      write_verified_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await this.db().query(`CREATE UNIQUE INDEX IF NOT EXISTS nyx_tenant_rclone_owner_name
      ON nyx_tenant_rclone(owner_id,lower(display_name))`);
    await this.db().query(`CREATE UNIQUE INDEX IF NOT EXISTS nyx_tenant_rclone_one_main
      ON nyx_tenant_rclone(owner_id) WHERE is_main`);
    await this.db().query(`CREATE TABLE IF NOT EXISTS nyx_tenant_rclone_usage (
      owner_id text NOT NULL,
      kind text NOT NULL,
      hour timestamptz NOT NULL,
      count integer NOT NULL,
      PRIMARY KEY(owner_id,kind,hour)
    )`);
    await this.db().query(`CREATE TABLE IF NOT EXISTS nyx_tenant_rclone_oauth_state (
      state_hash text PRIMARY KEY,
      connection_id uuid NOT NULL,
      owner_id text NOT NULL,
      verifier_cipher text NOT NULL,
      expires_at timestamptz NOT NULL
    )`);
  }

  async onModuleDestroy(){await this.pool?.end();}
  private db():Pool {
    if(!this.pool || !this.key) throw new Error('TENANT_STORAGE_NOT_ENABLED');
    return this.pool;
  }
  private owner(ownerId:string):string {
    if(typeof ownerId!=='string'||!ownerId.startsWith('oauth:')||ownerId.length>512)
      throw new Error('AUTHENTICATED_OWNER_REQUIRED');
    return ownerId;
  }
  private displayName(name:string):string {
    if(typeof name!=='string'||name.trim().length<1||name.trim().length>80||
       /[\x00-\x1F\x7F]/.test(name))throw new Error('STORAGE_NAME_INVALID');
    return name.trim();
  }
  private id(id:string):string{
    if(typeof id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id))
      throw new Error('CONNECTION_ID_INVALID');
    return id;
  }
  private encrypt(owner:string,id:string,provider:string,value:unknown):string {
    const iv=randomBytes(12);
    const cipher=createCipheriv('aes-256-gcm',this.key!,iv);
    cipher.setAAD(Buffer.from(JSON.stringify([owner,id,provider])));
    const ct=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
    return Buffer.concat([iv,cipher.getAuthTag(),ct]).toString('base64');
  }
  private decrypt<T>(owner:string,id:string,provider:string,ciphertext:string):T {
    const value=Buffer.from(ciphertext,'base64');
    if(value.length<29)throw new Error('STORAGE_CREDENTIAL_INVALID');
    const decipher=createDecipheriv('aes-256-gcm',this.key!,value.subarray(0,12));
    decipher.setAAD(Buffer.from(JSON.stringify([owner,id,provider])));
    decipher.setAuthTag(value.subarray(12,28));
    return JSON.parse(Buffer.concat([decipher.update(value.subarray(28)),decipher.final()]).toString('utf8')) as T;
  }
  /** Atomic per-owner hourly limits across all NestJS replicas. */
  private async budget(owner:string,kind:'oauth'|'probe',max:number) {
    this.owner(owner);
    const result=await this.db().query(`INSERT INTO nyx_tenant_rclone_usage
      (owner_id,kind,hour,count) VALUES($1,$2,date_trunc('hour',now()),1)
      ON CONFLICT(owner_id,kind,hour) DO UPDATE
      SET count=nyx_tenant_rclone_usage.count+1
      WHERE nyx_tenant_rclone_usage.count<$3
      RETURNING count`,[owner,kind,max]);
    if(result.rowCount!==1)throw Error('STORAGE_OWNER_RATE_LIMIT');
  }
  private view(row:Row) {
    return {id:row.id,name:row.display_name,provider:row.provider==='drive'?'google-drive':'mega',
      status:row.status,isMain:row.is_main,
      configured:row.status==='connected',readVerified:!!row.read_verified_at,
      writeVerified:!!row.write_verified_at};
  }
  async list(owner:string) {
    this.owner(owner);
    const found=await this.db().query<Row>(`SELECT * FROM nyx_tenant_rclone
      WHERE owner_id=$1 ORDER BY created_at,id`,[owner]);
    return found.rows.map(row=>this.view(row));
  }
  private async get(owner:string,id:string):Promise<Row> {
    this.owner(owner);this.id(id);
    const r=await this.db().query<Row>(`SELECT * FROM nyx_tenant_rclone WHERE id=$1 AND owner_id=$2`,[id,owner]);
    if(r.rowCount!==1)throw new Error('STORAGE_CONNECTION_NOT_FOUND');
    return r.rows[0];
  }
  async rename(owner:string,id:string,name:string) {
    await this.get(owner,id);
    const r=await this.db().query<Row>(`UPDATE nyx_tenant_rclone SET display_name=$3,updated_at=now()
      WHERE owner_id=$1 AND id=$2 RETURNING *`,[owner,id,this.displayName(name)]);
    return this.view(r.rows[0]);
  }
  async disconnect(owner:string,id:string) {
    await this.get(owner,id);
    await this.db().query(`DELETE FROM nyx_tenant_rclone WHERE owner_id=$1 AND id=$2`,[owner,id]);
    // Deletes local authorization. Google provider-wide token revocation must be
    // handled separately, as it may affect other remotes of the same account.
    return {disconnected:true};
  }
  private clientId(){const value=process.env.NYX_GOOGLE_CLIENT_ID;if(!value)throw Error('GOOGLE_OAUTH_NOT_CONFIGURED');return value;}
  private clientSecret(){const value=process.env.NYX_GOOGLE_CLIENT_SECRET;if(!value)throw Error('GOOGLE_OAUTH_NOT_CONFIGURED');return value;}
  private callbackUrl(){
    const base=process.env.NYX_PUBLIC_URL;
    if(!base || !/^https:\/\//.test(base))throw Error('GOOGLE_OAUTH_HTTPS_REQUIRED');
    return base.replace(/\/$/,'')+'/connect/google-drive/callback';
  }
  async beginGoogle(owner:string,name:string) {
    this.owner(owner);this.db();
    await this.budget(owner,'oauth',10);
    const id=randomUUID(),state=randomBytes(32).toString('base64url');
    const verifier=randomBytes(48).toString('base64url');
    const digest=createHash('sha256').update(state).digest('hex');
    const challenge=createHash('sha256').update(verifier).digest('base64url');
    const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id',this.clientId());
    url.searchParams.set('redirect_uri',this.callbackUrl());
    url.searchParams.set('response_type','code');
    url.searchParams.set('scope','openid email https://www.googleapis.com/auth/drive.file');
    url.searchParams.set('access_type','offline');
    url.searchParams.set('prompt','consent');
    url.searchParams.set('state',state);
    url.searchParams.set('code_challenge',challenge);
    url.searchParams.set('code_challenge_method','S256');
    const client=await this.db().connect();
    try{
      await client.query('BEGIN');
      await client.query(`INSERT INTO nyx_tenant_rclone(id,owner_id,provider,display_name,status)
        VALUES($1,$2,'drive',$3,'pending')`,[id,owner,this.displayName(name)]);
      await client.query(`INSERT INTO nyx_tenant_rclone_oauth_state
        (state_hash,connection_id,owner_id,verifier_cipher,expires_at)
        VALUES($1,$2,$3,$4,now()+interval '10 minutes')`,
        [digest,id,owner,this.encrypt(owner,id,'pkce',verifier)]);
      await client.query('COMMIT');
    }catch(error){await client.query('ROLLBACK');throw error;}
    finally{client.release();}
    return {id,url:url.toString(),expiresInSeconds:600};
  }
  /** Called ONLY by public Google callback; state is single use, owner bound and short lived. */
  async completeGoogle(state:string,code:string) {
    if(!state||state.length>256||!code||code.length>4096)throw Error('GOOGLE_OAUTH_INVALID');
    const digest=createHash('sha256').update(state).digest('hex');
    const found=await this.db().query<{owner_id:string;connection_id:string;verifier_cipher:string}>(
      `DELETE FROM nyx_tenant_rclone_oauth_state WHERE state_hash=$1 AND expires_at>now()
       RETURNING owner_id,connection_id,verifier_cipher`,[digest]);
    if(found.rowCount!==1)throw Error('GOOGLE_OAUTH_STATE_INVALID');
    const pending=found.rows[0];
    const row=await this.get(pending.owner_id,pending.connection_id);
    if(row.status!=='pending'||row.provider!=='drive')throw Error('GOOGLE_OAUTH_NOT_PENDING');
    const verifier=this.decrypt<string>(pending.owner_id,row.id,'pkce',pending.verifier_cipher);
    const response=await fetch('https://oauth2.googleapis.com/token',{
      method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({client_id:this.clientId(),client_secret:this.clientSecret(),
        code,grant_type:'authorization_code',redirect_uri:this.callbackUrl(),code_verifier:verifier}),
      signal:AbortSignal.timeout(15000),
    });
    if(!response.ok)throw Error('GOOGLE_OAUTH_EXCHANGE_FAILED');
    const token=await response.json() as Record<string,unknown>;
    const scopes=typeof token.scope==='string'?token.scope.split(' '):[];
    if(!scopes.includes('https://www.googleapis.com/auth/drive.file')||
       typeof token.access_token!=='string'||typeof token.refresh_token!=='string'||
       token.token_type!=='Bearer'||typeof token.expires_in!=='number')
      throw Error('GOOGLE_OAUTH_SCOPE_OR_OFFLINE_ACCESS_MISSING');
    const identity=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{
      headers:{Authorization:'Bearer '+token.access_token},
      signal:AbortSignal.timeout(15000),
    });
    if(!identity.ok)throw Error('GOOGLE_IDENTITY_VERIFICATION_FAILED');
    const profile=await identity.json() as Record<string,unknown>;
    if(typeof profile.sub!=='string'||!profile.sub)throw Error('GOOGLE_IDENTITY_INVALID');
    const credential:DriveToken={
      access_token:token.access_token,refresh_token:token.refresh_token,
      token_type:'Bearer',
      expiry:new Date(Date.now()+Math.max(0,token.expires_in-60)*1000).toISOString(),
    };
    const stored=this.encrypt(pending.owner_id,row.id,'drive',credential);
    await this.db().query(`UPDATE nyx_tenant_rclone
      SET provider_identity=$3,encrypted_credential=$4,status='connected',
          read_verified_at=NULL,write_verified_at=NULL,updated_at=now()
      WHERE owner_id=$1 AND id=$2 AND status='pending'`,
      [pending.owner_id,row.id,profile.sub,stored]);
    return {connected:true};
  }
  private async runIsolated(row:Row,kind:'read'|'write') {
    if(!row.encrypted_credential||row.provider!=='drive'||row.status!=='connected')
      throw Error('STORAGE_CONNECTION_NOT_READY');
    const token=this.decrypt<DriveToken>(row.owner_id,row.id,'drive',row.encrypted_credential);
    if(!token.access_token||!token.refresh_token||!token.expiry)
      throw Error('STORAGE_CREDENTIAL_INVALID');
    if(this.active>=this.maxActive || this.activeOwners.has(row.owner_id))
      throw Error('STORAGE_PROBE_BUSY');
    this.active++;this.activeOwners.add(row.owner_id);
    let dir:string|undefined;
    try {
      dir=await fs.mkdtemp(path.join(os.tmpdir(),'nyx-tenant-rclone-'));
      await fs.chmod(dir,0o700);
      const config=path.join(dir,'rclone.conf');
      // Only one synthetic remote exists in this per-operation config.
      const lines=['[tenant]','type = drive','scope = drive.file',
        'client_id = '+this.clientId(),'client_secret = '+this.clientSecret(),
        'token = '+JSON.stringify(token),''];
      await fs.writeFile(config,lines.join('\n'),{mode:0o600,flag:'wx'});
      const exec=(args:string[])=>new Promise<boolean>(resolve=>{
        let done=false,bytes=0;
        const env:{[key:string]:string}={PATH:process.env.PATH||'',HOME:dir!,XDG_CACHE_HOME:dir!};
        const child=spawn(this.binary,['--config',config,...args],
          {cwd:dir,env,stdio:['ignore','pipe','pipe']});
        const finish=(ok:boolean)=>{if(done)return;done=true;clearTimeout(timer);resolve(ok);};
        const timer=setTimeout(()=>{child.kill('SIGKILL');finish(false);},25000);
        const count=(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>1024*1024){child.kill('SIGKILL');finish(false);}};
        child.stdout.on('data',count);child.stderr.on('data',count);
        child.once('error',()=>finish(false));
        child.once('close',code=>finish(code===0));
      });
      if(kind==='read')return exec(['lsf','tenant:','--max-depth','1','--format','p']);
      // Explicit user-requested write test; disposable unique folder, never delete user files.
      const name='.nestnyx-test-'+randomUUID();
      const created=await exec(['mkdir','tenant:'+name]);
      if(!created)return false;
      const cleaned=await exec(['rmdir','tenant:'+name]);
      return cleaned;
    }finally{
      if(dir)await fs.rm(dir,{recursive:true,force:true});
      this.active--;this.activeOwners.delete(row.owner_id);
    }
  }
  async probe(owner:string,id:string,mode:'read'|'write') {
    if(mode!=='read'&&mode!=='write')throw Error('STORAGE_PROBE_INVALID');
    const row=await this.get(owner,id);
    await this.budget(owner,'probe',20);
    const verified=await this.runIsolated(row,mode);
    const column=mode==='read'?'read_verified_at':'write_verified_at';
    await this.db().query(`UPDATE nyx_tenant_rclone SET ${column}=$3,updated_at=now()
      WHERE owner_id=$1 AND id=$2 AND status='connected'`,[owner,id,verified?new Date():null]);
    return {id,mode,verified,writeAccess:mode==='write'?(verified?'verified':'failed'):'not-tested'};
  }
  async setMain(owner:string,id:string) {
    const row=await this.get(owner,id);
    if(row.provider!=='drive'||!row.write_verified_at||
       Date.now()-new Date(row.write_verified_at).getTime()>15*60*1000||row.status!=='connected')
      throw Error('MAIN_REQUIRES_VERIFIED_WRITABLE_DRIVE');
    const client:PoolClient=await this.db().connect();
    try{
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[owner]);
      const found=await client.query(`SELECT id FROM nyx_tenant_rclone
        WHERE owner_id=$1 AND id=$2 AND provider='drive'
        AND status='connected' AND write_verified_at>now()-interval '15 minutes' FOR UPDATE`,[owner,id]);
      if(found.rowCount!==1)throw Error('MAIN_NOT_ELIGIBLE');
      await client.query('UPDATE nyx_tenant_rclone SET is_main=false WHERE owner_id=$1 AND is_main',[owner]);
      await client.query('UPDATE nyx_tenant_rclone SET is_main=true WHERE owner_id=$1 AND id=$2',[owner,id]);
      await client.query('COMMIT');
      return {id,isMain:true};
    }catch(error){await client.query('ROLLBACK');throw error;}
    finally{client.release();}
  }
}
