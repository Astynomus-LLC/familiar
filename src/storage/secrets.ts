import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

export function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function matchesSecret(value: string, hash: string): boolean {
  const actual = Buffer.from(hashSecret(value), 'hex');
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function randomSecret(): string {
  return randomBytes(32).toString('base64url');
}

export class SecretBox {
  private readonly key: Buffer;

  constructor(masterSecret: string) {
    if (masterSecret.length < 32)
      throw new Error('MASTER_SECRET must contain at least 32 characters.');
    this.key = createHash('sha256').update(masterSecret).digest();
  }

  encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);
    return [iv, cipher.getAuthTag(), ciphertext]
      .map((part) => part.toString('base64url'))
      .join('.');
  }

  decrypt(value: string): string {
    const [iv, tag, ciphertext] = value
      .split('.')
      .map((part) => Buffer.from(part, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
  }
}
