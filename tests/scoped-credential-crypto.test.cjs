const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCipheriv, randomBytes } = require('node:crypto');
const {
  encryptScopedCredential,
  decryptScopedCredential,
} = require('../dist/storage/scoped-credential-crypto');

const master = Buffer.alloc(32, 31);
const alice = ['oauth:alice','account-001','drive'];
const bob = ['oauth:bob','account-001','drive'];
const payload = { access_token: 'test-only-not-a-real-credential', flags: ['read'] };

test('v2 encrypts with a non-deterministic nonce and restores original payload', () => {
  const x = encryptScopedCredential(master, alice, payload);
  const y = encryptScopedCredential(master, alice, payload);
  assert.match(x, /^v2:/);
  assert.notEqual(x, y);
  assert.deepEqual(decryptScopedCredential(master, alice, x), payload);
  assert.ok(!x.includes(payload.access_token));
});

test('v2 cannot be decrypted using a different owner, account, provider or master key', () => {
  const x = encryptScopedCredential(master, alice, payload);
  for (const binding of [
    bob, ['oauth:alice','account-002','drive'],
    ['oauth:alice','account-001','mega'],
  ]) {
    assert.throws(() => decryptScopedCredential(master, binding, x));
  }
  assert.throws(() => decryptScopedCredential(Buffer.alloc(32, 44), alice, x));
  assert.throws(() => decryptScopedCredential(master, alice, x.slice(0, -3)+'AAA'));
  assert.throws(() => decryptScopedCredential(master, alice, 'v3:AAAA'), /VERSION_UNSUPPORTED/);
});

test('legacy unprefixed AES-GCM records remain decryptable until key rotation', () => {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', master, nonce);
  cipher.setAAD(Buffer.from(JSON.stringify(alice)));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload),'utf8'),cipher.final()]);
  const legacy = Buffer.concat([nonce,cipher.getAuthTag(),ciphertext]).toString('base64');
  assert.deepEqual(decryptScopedCredential(master, alice, legacy), payload);
  assert.throws(() => decryptScopedCredential(master, bob, legacy));
});

test('credential records reject invalid key sizes and empty binding fields', () => {
  assert.throws(() => encryptScopedCredential(Buffer.alloc(4), alice, payload), /KEY_INVALID/);
  assert.throws(() => encryptScopedCredential(master, ['oauth:alice','','drive'], payload), /BINDING_INVALID/);
});
