import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { NyxResourceStore } from './resource-store.service';
import { refSchema } from './runtime.schema';

export type WarningQueueResult = {
  status: 'NO_WARNINGS' | 'PERSISTED' | 'NOT_CONFIGURED' | 'PERSISTENCE_FAILED';
  count: number;
  verified: boolean;
};

// Template remains the mutable queue owner. Never write to Head, Body or Footer.
// The runtime operator must explicitly configure a current verified Template path.
export function warningQueueRoot(configured: string | undefined) {
  if (!configured) return undefined;
  const root = configured.replace(/\/+$/, '');
  if (!/^YaRoute\/0_repository\/3_template\/staging\/drafts\/temp_files\/[A-Za-z0-9_./-]+$/.test(root) ||
      root.split('/').some(part => part === '.' || part === '..')) throw new Error('WARNING_QUEUE_PATH_INVALID');
  return root;
}

/** Immutable, idempotent daily issue receipts: no mutable merge or clobber race. */
@Injectable()
export class NyxWarningQueueService {
  constructor(private readonly store: NyxResourceStore) {}

  async persist(owner: string, command: string, warnings: string[], day = new Date().toISOString().slice(0, 10)): Promise<WarningQueueResult> {
    const distinct = [...new Set(warnings)];
    if (!distinct.length) return { status: 'NO_WARNINGS', count: 0, verified: true };
    // Public tenant requests must never write through the legacy private MAIN connector.
    if (process.env.NYX_DEPLOYMENT_MODE === 'public') return { status: 'NOT_CONFIGURED', count: distinct.length, verified: false };
    let root: string | undefined;
    try { root = warningQueueRoot(process.env.NYX_WARNING_QUEUE_ROOT); }
    catch { return { status: 'PERSISTENCE_FAILED', count: distinct.length, verified: false }; }
    if (!root) return { status: 'NOT_CONFIGURED', count: distinct.length, verified: false };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { status: 'PERSISTENCE_FAILED', count: distinct.length, verified: false };
    try {
      for (const code of distinct) {
        // Do not persist arbitrary source text or errors that might include credentials.
        if (!/^[A-Z][A-Z0-9_]+:[A-Za-z0-9_.:-]{1,96}$/.test(code)) throw new Error('WARNING_CODE_UNSAFE');
        const fingerprint = createHash('sha256').update(JSON.stringify([owner, command, code])).digest('hex');
        const ref = refSchema.parse({ area: 'MAIN', path: path.posix.join(root, day, `${fingerprint}.json`) });
        const record = JSON.stringify({ schema: 'nyx.warning-queue.daily.v1', day, fingerprint,
          severity: 'DEFERRED_WARNING', code, command, ownerFingerprint: createHash('sha256').update(owner).digest('hex'),
          state: 'OPEN', source: 'runtime_issued_warning', canonicalAuthorityChanged: false }) + '\n';
        const receipt = await this.store.createVerified(ref, record);
        if (!receipt.verified) throw new Error('WARNING_QUEUE_VERIFY_FAILED');
      }
      return { status: 'PERSISTED', count: distinct.length, verified: true };
    } catch { return { status: 'PERSISTENCE_FAILED', count: distinct.length, verified: false }; }
  }
}
