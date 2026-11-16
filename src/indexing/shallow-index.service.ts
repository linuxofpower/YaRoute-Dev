import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createCipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { ConnectorsService } from '../connectors/connectors.service';
import { TenantRcloneService, type TenantRcloneProvider } from '../connectors/tenant-rclone.service';
import { prepareAuthorizedMetadataBatch } from './metadata-batch';

type IndexJob = {
  id: string; owner_id: string; connection_id: string;
  provider: TenantRcloneProvider; root_id: string;
  lease_token: string; enabled: boolean;
};

/**
 * Independent, opt-in, shallow-only public tenant worker.
 *
 * This service MUST NOT run the legacy global indexer. It never receives
 * credentials or a caller-controlled OAuth subject through its public MCP API.
 * Only the signed OAuth subject can opt into an exact activated connection/root.
 *
 * It does NOT perform provider mutations, deep recursion, NLP or GPT work.
 */
@Injectable()
export class ShallowIndexService implements OnModuleInit, OnModuleDestroy {
  private pool?: Pool;
  private encryptionKey?: Buffer;

  constructor(
    private readonly connections: ConnectorsService,
    private readonly storage: TenantRcloneService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.NYX_TENANT_SHALLOW_INDEX_ENABLED !== 'true') return;
    if (process.env.NYX_DEPLOYMENT_MODE !== 'public' ||
        process.env.NYX_PUBLIC_CONNECTORS_ENABLED !== 'true' ||
        process.env.NYX_MULTIUSER_RCLONE_ENABLED !== 'true' ||
        !process.env.DATABASE_URL) {
      throw new Error('INDEX_PUBLIC_ISOLATION_REQUIRED');
    }
    const value = process.env.NYX_STORAGE_ENCRYPTION_KEY || '';
    const key = Buffer.from(value, 'base64');
    if (!/^[A-Za-z0-9+/]{43}=$/.test(value) ||
        key.length !== 32 || key.toString('base64') !== value) {
      throw new Error('INDEX_ENCRYPTION_KEY_INVALID');
    }
    this.encryptionKey = key;
    this.pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
    // Fail closed until the reviewed SQL migration is explicitly applied.
    const {rows} = await this.pool.query(
      "SELECT to_regclass('public.nyx_tenant_index_jobs_v1') IS NOT NULL AS jobs, " +
      "to_regclass('public.nyx_tenant_index_items_v1') IS NOT NULL AS items");
    if (rows[0]?.jobs !== true || rows[0]?.items !== true) {
      await this.pool.end();
      this.pool = undefined;
      throw new Error('INDEX_SCHEMA_MIGRATION_REQUIRED');
    }
  }

  async onModuleDestroy() { await this.pool?.end(); }

  private db(): Pool {
    if (!this.pool || !this.encryptionKey) throw new Error('INDEX_NOT_ENABLED');
    return this.pool;
  }

  private key(): Buffer {
    if (!this.encryptionKey) throw new Error('INDEX_NOT_ENABLED');
    return this.encryptionKey;
  }

  private assertOwner(owner: string) {
    if (!/^oauth:[^\x00-\x1f\x7f]{1,506}$/.test(owner)) {
      throw new Error('INDEX_AUTHENTICATED_OWNER_REQUIRED');
    }
  }

  /** Only an authenticated MCP tool may call this; owner is server-derived. */
  async optIn(owner: string, connectionId: string,
              provider: TenantRcloneProvider, rootId: string) {
    this.assertOwner(owner);
    this.db();
    // This verifies the active provider credentials and exact root for this
    // immutable OAuth owner. A mere stored connection row is not sufficient.
    const result = await this.storage.probeAuthorizedRoot(
      owner, connectionId, provider, rootId, '');
    if (result !== 'verified') throw new Error('INDEX_AUTHORIZED_ROOT_NOT_VERIFIED');

    const q = await this.db().query(
      `INSERT INTO nyx_tenant_index_jobs_v1
         (owner_id,connection_id,provider,root_id,mode,enabled,state,next_due_at)
       VALUES ($1,$2,$3,$4,'shallow',true,'idle',now())
       ON CONFLICT (owner_id,connection_id,root_id,mode)
       DO UPDATE SET enabled=true,state='idle',next_due_at=now(),
                     lease_token=NULL,lease_expires_at=NULL,updated_at=now()
       RETURNING id`,
      [owner, connectionId, provider, rootId]);
    return {jobId:q.rows[0].id,mode:'shallow',enabled:true,
      scope:'one-authorized-root',provider,readOnly:true};
  }

  async optOut(owner: string, jobId: string) {
    this.assertOwner(owner);
    const client = await this.db().connect();
    try {
      await client.query('BEGIN');
      const job = await client.query(
        'SELECT connection_id,root_id FROM nyx_tenant_index_jobs_v1 ' +
        'WHERE id=$1 AND owner_id=$2 FOR UPDATE', [jobId,owner]);
      if (!job.rowCount) throw new Error('INDEX_JOB_NOT_FOUND');
      const {connection_id,root_id} = job.rows[0];
      await client.query(
        "UPDATE nyx_tenant_index_jobs_v1 SET enabled=false,state='revoked', " +
        'lease_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1',
        [jobId]);
      await client.query(
        'DELETE FROM nyx_tenant_index_items_v1 ' +
        'WHERE owner_id=$1 AND connection_id=$2 AND root_id=$3',
        [owner,connection_id,root_id]);
      await client.query('COMMIT');
      return {jobId,enabled:false,metadataDeleted:true,providerFilesUnchanged:true};
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async status(owner: string) {
    this.assertOwner(owner);
    const {rows} = await this.db().query(
      `SELECT id,connection_id,provider,root_id,mode,enabled,state,
              item_count,last_finished_at,last_error_code,next_due_at
         FROM nyx_tenant_index_jobs_v1
        WHERE owner_id=$1 ORDER BY updated_at DESC LIMIT 30`,[owner]);
    return {schema:'nyx.index.status.v1',jobs:rows,ownerScoped:true};
  }

  private sealedPath(job: IndexJob, path: string) {
    const identity=JSON.stringify([
      job.owner_id,job.connection_id,job.root_id,path]);
    const digest=createHmac('sha256',this.key()).update(identity).digest('hex');
    const nonce=randomBytes(12);
    const cipher=createCipheriv('aes-256-gcm',this.key(),nonce);
    cipher.setAAD(Buffer.from(JSON.stringify([
      job.owner_id,job.connection_id,job.root_id])));
    const encrypted=Buffer.concat([cipher.update(path,'utf8'),cipher.final()]);
    const sealed=Buffer.concat([nonce,cipher.getAuthTag(),encrypted]).toString('base64');
    return {pathKey:digest,sealed};
  }

  /** One bounded, leased job for Heroku one-off CLI; never auto-runs on web boot. */
  async runOnce(): Promise<Record<string,unknown>> {
    const token=randomUUID();
    const claim=await this.db().query<IndexJob>(
      `WITH due AS (
         SELECT id FROM nyx_tenant_index_jobs_v1
         WHERE enabled=true AND next_due_at<=now()
           AND (state<>'running' OR lease_expires_at<now())
         ORDER BY next_due_at,id LIMIT 1 FOR UPDATE SKIP LOCKED
       )
       UPDATE nyx_tenant_index_jobs_v1 j
          SET state='running',lease_token=$1,lease_expires_at=now()+interval '150 seconds',
              updated_at=now()
         FROM due WHERE j.id=due.id
       RETURNING j.id,j.owner_id,j.connection_id,j.provider,j.root_id,
                 j.lease_token,j.enabled`,
      [token]);
    const job=claim.rows[0];
    if (!job) return {status:'NO_DUE_JOB',readOnly:true,dispatched:0};
    try {
      // Revalidate provider grant on EACH one-off; no global Rclone credentials.
      const source=await this.storage.listAuthorizedRoot(
        job.owner_id,job.connection_id,job.provider,job.root_id,'');
      const batch=prepareAuthorizedMetadataBatch({
        ownerId:job.owner_id,connectionId:job.connection_id,
        provider:job.provider,rootId:job.root_id,relativePath:'',
      },source);
      if (!batch.directoryComplete) {
        await this.db().query(
          `UPDATE nyx_tenant_index_jobs_v1
             SET state='blocked_truncated',enabled=false,lease_token=NULL,
                 lease_expires_at=NULL,last_error_code='INDEX_DIRECTORY_PAGINATION_REQUIRED',
                 updated_at=now()
           WHERE id=$1 AND lease_token=$2 AND enabled=true`,[job.id,token]);
        return {status:'BLOCKED_TRUNCATED',jobId:job.id,
          reason:'INDEX_DIRECTORY_PAGINATION_REQUIRED',readOnly:true};
      }

      // Recheck authorization after provider I/O before writing a cached copy.
      await this.connections.registryPolicy().requireResource(
        job.owner_id,job.connection_id,'storage:list',
        {kind:job.provider==='mega'?'mega-root':'drive',id:job.root_id,path:''});

      const client=await this.db().connect();
      try {
        await client.query('BEGIN');
        const current=await client.query(
          'SELECT enabled FROM nyx_tenant_index_jobs_v1 ' +
          'WHERE id=$1 AND lease_token=$2 FOR UPDATE',[job.id,token]);
        if (!current.rowCount || current.rows[0].enabled!==true) {
          throw new Error('INDEX_JOB_LEASE_OR_CONSENT_CHANGED');
        }
        // Only an independently verified COMPLETE root listing may replace
        // an old snapshot. This deletes cached index rows, never provider files.
        await client.query(
          'DELETE FROM nyx_tenant_index_items_v1 ' +
          'WHERE owner_id=$1 AND connection_id=$2 AND root_id=$3',
          [job.owner_id,job.connection_id,job.root_id]);
        for (const entry of batch.entries) {
          const path=this.sealedPath(job,entry.path);
          await client.query(
            `INSERT INTO nyx_tenant_index_items_v1
              (owner_id,connection_id,root_id,path_key,sealed_path,is_directory,size_bytes)
             VALUES ($1,$2,$3,$4,$5,$6,$7)`,
            [job.owner_id,job.connection_id,job.root_id,path.pathKey,
             path.sealed,entry.type==='directory',entry.sizeBytes]);
        }
        const updated=await client.query(
          `UPDATE nyx_tenant_index_jobs_v1 SET state='complete',lease_token=NULL,
                  lease_expires_at=NULL,last_error_code=NULL,last_finished_at=now(),
                  next_due_at=now()+interval '1 hour',item_count=$3,updated_at=now()
            WHERE id=$1 AND lease_token=$2 AND enabled=true RETURNING id`,
          [job.id,token,batch.entries.length]);
        if (updated.rowCount!==1) throw new Error('INDEX_JOB_LEASE_OR_CONSENT_CHANGED');
        await client.query('COMMIT');
      } catch(error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
      return {status:'COMPLETE_SHALLOW',jobId:job.id,
        items:batch.entries.length,readOnly:true,providerMutation:false};
    } catch {
      // Do not persist provider error messages, paths, token text or secrets.
      await this.db().query(
        `UPDATE nyx_tenant_index_jobs_v1
           SET state='retry',last_error_code='INDEX_READ_OR_AUTH_FAILED',
               lease_token=NULL,lease_expires_at=NULL,
               next_due_at=now()+interval '1 hour',updated_at=now()
         WHERE id=$1 AND lease_token=$2 AND enabled=true`,[job.id,token]);
      return {status:'RETRY_PENDING',jobId:job.id,
        reason:'INDEX_READ_OR_AUTH_FAILED',readOnly:true};
    }
  }
}
