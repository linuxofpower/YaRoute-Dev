import { createHash } from 'node:crypto';

/**
 * Phase A: a pure, read-only transformation of ONE authorized directory listing.
 *
 * Caller MUST derive ownerId from the verified OAuth subject and use
 * TenantRcloneService.listAuthorizedRoot(ownerId, connectionId, provider, rootId,
 * relativePath) for data. Never feed this helper legacy global rclone listings.
 *
 * There is intentionally no provider access, file mutation, database write,
 * scheduling, or authorization bypass in this module.
 */
export type IndexedProvider = 'google-drive' | 'mega';

export type AuthorizedDirectoryListing = {
  readOnly: boolean;
  truncated: boolean;
  items: Array<{ path: string; isDir: boolean; size: number | null }>;
};

export type MetadataScope = {
  ownerId: string;
  connectionId: string;
  provider: IndexedProvider;
  rootId: string;
  relativePath: string;
};

export type MetadataEntry = {
  path: string;
  type: 'directory' | 'file';
  sizeBytes: number | null;
};

export type MetadataBatch = {
  schema: 'nyx.tenant-metadata-batch.v1';
  scopeKey: string;
  scope: MetadataScope;
  entries: MetadataEntry[];
  directoryComplete: boolean;
  mayDeleteMissing: false;
  readOnly: true;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function relativePath(value: unknown, allowEmpty: boolean): string {
  if (typeof value !== 'string' || value.length > 2048 ||
      (!allowEmpty && value.length === 0) ||
      value.startsWith('/') || value.endsWith('/') ||
      value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value) ||
      (value !== '' && value.split('/').some(segment => !segment || segment === '.' || segment === '..'))) {
    throw new Error('INDEX_PATH_INVALID');
  }
  return value;
}

function checkedScope(scope: MetadataScope): MetadataScope {
  if (typeof scope.ownerId !== 'string' ||
      !scope.ownerId.startsWith('oauth:') || scope.ownerId.length > 512 ||
      scope.ownerId.length <= 'oauth:'.length || /[\u0000-\u001f\u007f]/.test(scope.ownerId)) {
    throw new Error('INDEX_OWNER_INVALID');
  }
  if (!UUID.test(scope.connectionId)) throw new Error('INDEX_CONNECTION_INVALID');
  if (scope.provider !== 'google-drive' && scope.provider !== 'mega') {
    throw new Error('INDEX_PROVIDER_INVALID');
  }
  if (typeof scope.rootId !== 'string' || scope.rootId.length === 0 ||
      scope.rootId.length > 256 || /[\u0000-\u001f\u007f]/.test(scope.rootId)) {
    throw new Error('INDEX_ROOT_INVALID');
  }
  return { ownerId: scope.ownerId, connectionId: scope.connectionId,
    provider: scope.provider, rootId: scope.rootId,
    relativePath: relativePath(scope.relativePath, true) };
}

/**
 * Preserve source ownership and accurately classify a capped directory sample.
 * "complete" refers only to this one directory, never an entire provider/drive.
 * Missing entries MUST NOT trigger deletion even in complete-directory responses.
 */
export function prepareAuthorizedMetadataBatch(
  scope: MetadataScope, listing: AuthorizedDirectoryListing,
): MetadataBatch {
  const verified = checkedScope(scope);
  if (!listing || listing.readOnly !== true || typeof listing.truncated !== 'boolean' ||
      !Array.isArray(listing.items) || listing.items.length > 100) {
    throw new Error('INDEX_SOURCE_UNTRUSTED_OR_UNBOUNDED');
  }
  const seen = new Set<string>();
  const entries = listing.items.map(item => {
    if (!item || typeof item !== 'object' || typeof item.isDir !== 'boolean') {
      throw new Error('INDEX_ITEM_INVALID');
    }
    const name = relativePath(item.path, false);
    const fullPath = verified.relativePath
      ? verified.relativePath + '/' + name : name;
    if (seen.has(fullPath)) throw new Error('INDEX_DUPLICATE_ENTRY');
    seen.add(fullPath);
    if (item.size !== null &&
        (typeof item.size !== 'number' || !Number.isSafeInteger(item.size) ||
         item.size < 0)) {
      throw new Error('INDEX_SIZE_INVALID');
    }
    return { path: fullPath, type: item.isDir ? 'directory' as const : 'file' as const,
      sizeBytes: item.isDir ? null : item.size };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  // Scope digest is for indexing/deduplication ONLY, not an authorization token.
  const scopeKey = createHash('sha256').update(JSON.stringify([
    verified.ownerId, verified.connectionId, verified.provider, verified.rootId,
    verified.relativePath,
  ])).digest('hex');
  return {
    schema: 'nyx.tenant-metadata-batch.v1', scopeKey, scope: verified,
    entries, directoryComplete: !listing.truncated,
    mayDeleteMissing: false, readOnly: true,
  };
}
