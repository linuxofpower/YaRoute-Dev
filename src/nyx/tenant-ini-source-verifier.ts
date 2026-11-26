import { createHash } from 'node:crypto';

/**
 * Internal source-byte verifier for a future public INI adapter.
 * Neither this verifier nor an untrusted request can grant a tenant access:
 * the supplied reader MUST enforce connection ownership on every read.
 * Specs and expected hashes must come from an independently verified
 * canonical/tenant configuration, never a caller assertion.
 */
export type TenantIniSourceSpec = Readonly<{
  key: string;
  connectionId: string;
  path: string;
  expectedSha256: string;
  required: boolean;
  visible: boolean;
}>;
export type TenantIniOwnedRead = Readonly<{
  owner: string;
  connectionId: string;
  path: string;
  content: Buffer | string;
}>;
export interface TenantIniOwnedReader {
  readOwned(owner: string, connectionId: string, path: string): Promise<TenantIniOwnedRead | null>;
}
export type TenantIniSourceReceipt = Readonly<{
  key: string;
  connectionId: string;
  path: string;
  sha256: string;
  bytes: number;
  ownerVerified: true;
  digestVerified: true;
  visibleRenderVerified: false;
}>;

function validPath(path: string): boolean {
  return typeof path === 'string' && path.length > 0 && path.length <= 2048 &&
    !path.startsWith('/') && !/[\\:\x00-\x1f]/.test(path) &&
    path.split('/').every(part => part && part !== '.' && part !== '..');
}

/** Produces receipts only after real owner-scoped byte reads and digest verification. */
export async function verifyTenantIniSources(
  owner: string, specs: readonly TenantIniSourceSpec[], reader: TenantIniOwnedReader,
): Promise<{ receipts: TenantIniSourceReceipt[]; missing: string[]; rendered: false }> {
  if (!/^oauth:[A-Za-z0-9._:@|\\-]{1,300}$/.test(owner))
    throw Error('INI_TENANT_OWNER_INVALID');
  if (!Array.isArray(specs) || !specs.length || specs.length > 64)
    throw Error('INI_TENANT_SOURCE_LIST_INVALID');
  const seen = new Set<string>();
  const receipts: TenantIniSourceReceipt[] = [];
  const missing: string[] = [];
  for (const spec of specs) {
    if (!spec || typeof spec.key !== 'string' ||
      !/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(spec.key) ||
      !/^[0-9a-f-]{36}$/i.test(spec.connectionId) ||
      !validPath(spec.path) ||
      !/^[a-f0-9]{64}$/.test(spec.expectedSha256) ||
      typeof spec.required !== 'boolean' || typeof spec.visible !== 'boolean' ||
      seen.has(spec.key)) throw Error('INI_TENANT_SOURCE_SPEC_INVALID');
    seen.add(spec.key);
    const result = await reader.readOwned(owner, spec.connectionId, spec.path);
    if (!result) {
      if (spec.required) throw Error('INI_TENANT_REQUIRED_SOURCE_MISSING:' + spec.key);
      missing.push(spec.key);
      continue;
    }
    if (result.owner !== owner ||
      result.connectionId !== spec.connectionId || result.path !== spec.path)
      throw Error('INI_TENANT_READ_OWNER_MISMATCH');
    if (!Buffer.isBuffer(result.content) && typeof result.content !== 'string')
      throw Error('INI_TENANT_READ_CONTENT_INVALID');
    const bytes = Buffer.isBuffer(result.content) ? result.content : Buffer.from(result.content, 'utf8');
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== spec.expectedSha256) throw Error('INI_TENANT_SOURCE_HASH_CHANGED:' + spec.key);
    receipts.push({
      key: spec.key, connectionId: spec.connectionId, path: spec.path,
      sha256: digest, bytes: bytes.length,
      ownerVerified: true, digestVerified: true,
      // Rendering is a separate host-visible gate; a byte read does NOT satisfy it.
      visibleRenderVerified: false,
    });
  }
  return { receipts, missing, rendered: false };
}
