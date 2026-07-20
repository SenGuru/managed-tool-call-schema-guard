import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  timingSafeEqual,
  verify,
} from 'node:crypto';
import { canonicalJson } from '@schema-guard/core';

export function hmac(secret: string, purpose: string, value: unknown): string {
  return `hmac-sha256:${createHmac('sha256', secret).update(purpose).update('\0').update(canonicalJson(value)).digest('hex')}`;
}

export function hashApiKey(secret: string, key: string): string {
  return hmac(secret, 'api-key-v1', key);
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function generateApiKey(): string {
  return `sg_live_${randomBytes(24).toString('base64url')}`;
}

function encryptionKey(secret: string): Buffer {
  return createHash('sha256').update('schema-guard-signing-key-v1\0').update(secret).digest();
}

function sealedValueKey(secret: string, purpose: string): Buffer {
  return createHash('sha256')
    .update('schema-guard-sealed-value-v1\0')
    .update(purpose)
    .update('\0')
    .update(secret)
    .digest();
}

export function sealValue(secret: string, purpose: string, value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sealedValueKey(secret, purpose), iv);
  cipher.setAAD(Buffer.from(purpose));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

export function openSealedValue(secret: string, purpose: string, sealed: string): string {
  const packed = Buffer.from(sealed, 'base64url');
  if (packed.length < 29) throw new Error('sealed value is malformed');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    sealedValueKey(secret, purpose),
    packed.subarray(0, 12),
  );
  decipher.setAAD(Buffer.from(purpose));
  decipher.setAuthTag(packed.subarray(12, 28));
  return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8');
}
export function createEncryptedSigningKey(secret: string): {
  keyId: string;
  publicKey: string;
  encryptedPrivateKey: string;
} {
  const pair = generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' });
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' });
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(privateKey, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    keyId: `ed25519_${sha256Text(publicKey).slice(0, 16)}`,
    publicKey,
    encryptedPrivateKey: Buffer.concat([iv, tag, ciphertext]).toString('base64url'),
  };
}
export function signRuleset(secret: string, encryptedPrivateKey: string, value: unknown): string {
  const packed = Buffer.from(encryptedPrivateKey, 'base64url');
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const ciphertext = packed.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(secret), iv);
  decipher.setAuthTag(tag);
  const privatePem = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    'utf8',
  );
  return `ed25519:${sign(null, Buffer.from(canonicalJson(value)), createPrivateKey(privatePem)).toString('base64url')}`;
}
export function verifyRulesetSignature(
  publicKey: string,
  value: unknown,
  signature: string,
): boolean {
  if (!signature.startsWith('ed25519:')) return false;
  try {
    return verify(
      null,
      Buffer.from(canonicalJson(value)),
      createPublicKey(publicKey),
      Buffer.from(signature.slice(8), 'base64url'),
    );
  } catch {
    return false;
  }
}
function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
