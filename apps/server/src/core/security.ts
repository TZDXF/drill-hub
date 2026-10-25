import {
  randomBytes,
  createHash,
  scryptSync,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from 'node:crypto';
import { AppError } from './errors.js';
export const randomSecret = () => randomBytes(32).toString('base64url');
export const hashSecret = (value: string) => createHash('sha256').update(value).digest('hex');
export function sameSecret(value: string, expectedHash: string) {
  const actual = Buffer.from(hashSecret(value), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export function validatePassword(password: unknown): asserts password is string {
  if (typeof password !== 'string' || password.length < 4)
    throw new AppError(422, 'INVALID_PASSWORD', '密码长度至少需要 4 个字符');
}
export function passwordHash(password: string) {
  validatePassword(password);
  const salt = randomBytes(16).toString('hex');
  return (
    'scrypt$' +
    salt +
    '$' +
    scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString(
      'hex',
    )
  );
}
export function verifyPassword(password: string, stored: string) {
  const [algorithm, salt, hex] = stored.split('$');
  if (algorithm !== 'scrypt' || !salt || !hex) return false;
  try {
    const actual = scryptSync(password, salt, 64, {
      N: 16384,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
    const expected = Buffer.from(hex, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
export class SecretVault {
  private key: Buffer;
  constructor(hexKey: string) {
    if (!/^[0-9a-fA-F]{64}$/.test(hexKey))
      throw new Error('DRILL_HUB_ENCRYPTION_KEY must be 32 bytes encoded as 64 hex characters');
    this.key = Buffer.from(hexKey, 'hex');
  }
  encrypt(text: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return [
      'v1',
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      encrypted.toString('base64url'),
    ].join('.');
  }
  decrypt(envelope: string) {
    try {
      const [version, iv, tag, data] = envelope.split('.');
      if (version !== 'v1' || !iv || !tag || data === undefined) throw new Error('invalid');
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(data, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new AppError(503, 'SECRET_UNAVAILABLE', '无法解密服务端凭据，请联系管理员检查主密钥');
    }
  }
  encryptJson(value: unknown) {
    return this.encrypt(JSON.stringify(value));
  }
  decryptJson(envelope: string): unknown {
    return JSON.parse(this.decrypt(envelope)) as unknown;
  }
}
