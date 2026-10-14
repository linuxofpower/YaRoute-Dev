import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Encrypted Rclone connection credentials.
 *
 * v2 derives an independent AES key for each authenticated owner + resource +
 * provider binding, with the root key staying in protected server configuration.
 * Existing unprefixed AES-GCM records are read for backward compatibility.
 *
 * IMPORTANT: Derived keys are not an external KMS. Anyone who gains the root
 * encryption key and ciphertexts can derive every user key. Never log either.
 */
const V2_PREFIX = 'v2:';
const INFO = Buffer.from('nestnyx/storage/credential/aes-256-gcm/v2', 'utf8');

function bind(binding: readonly string[]): Buffer {
  if (binding.length !== 3 ||
      binding.some(item => typeof item !== 'string' || item.length === 0)) {
    throw new Error('STORAGE_CREDENTIAL_BINDING_INVALID');
  }
  return Buffer.from(JSON.stringify(binding), 'utf8');
}

function assertMasterKey(key: Buffer): void {
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error('STORAGE_ENCRYPTION_KEY_INVALID');
  }
}

function derivedKey(masterKey: Buffer, aad: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey, aad, INFO, 32));
}

export function encryptScopedCredential(
  masterKey: Buffer, binding: readonly string[], credential: unknown,
): string {
  assertMasterKey(masterKey);
  const aad = bind(binding);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', derivedKey(masterKey, aad), iv);
  cipher.setAAD(aad);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(credential), 'utf8'), cipher.final(),
  ]);
  return V2_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64');
}

export function decryptScopedCredential<T>(
  masterKey: Buffer, binding: readonly string[], encryptedCredential: string,
): T {
  assertMasterKey(masterKey);
  const aad = bind(binding);
  if (typeof encryptedCredential !== 'string' ||
      /^v\\d+:/.test(encryptedCredential) && !encryptedCredential.startsWith(V2_PREFIX)) {
    throw new Error('STORAGE_CREDENTIAL_VERSION_UNSUPPORTED');
  }
  const isV2 = encryptedCredential.startsWith(V2_PREFIX);
  const encoded = isV2 ? encryptedCredential.slice(V2_PREFIX.length) : encryptedCredential;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error('STORAGE_CREDENTIAL_INVALID');
  }
  const packed = Buffer.from(encoded, 'base64');
  if (packed.length < 29) throw new Error('STORAGE_CREDENTIAL_INVALID');
  const key = isV2 ? derivedKey(masterKey, aad) : masterKey;
  const decipher = createDecipheriv('aes-256-gcm', key, packed.subarray(0, 12));
  decipher.setAAD(aad);
  decipher.setAuthTag(packed.subarray(12, 28));
  // Never expose the caller-provided ciphertext, binding or decrypt error.
  try {
    const result = Buffer.concat([
      decipher.update(packed.subarray(28)), decipher.final(),
    ]).toString('utf8');
    return JSON.parse(result) as T;
  } catch {
    throw new Error('STORAGE_CREDENTIAL_INVALID');
  }
}
