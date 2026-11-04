import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';

/** The key is 32 random bytes, base64-encoded (validated at boot). */
export function decodeKey(base64: string): Buffer | null {
  const key = Buffer.from(base64, 'base64');
  return key.length === 32 && key.toString('base64') === base64.trim() ? key : null;
}

/**
 * AES-256-GCM for credentials stored in the database (WhatsApp tokens and secrets).
 * Format: v1.<iv>.<auth tag>.<ciphertext>, each base64url. GCM authenticates the ciphertext, so a
 * tampered value fails to decrypt instead of producing garbage.
 */
@Injectable()
export class CredentialCipher {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const key = decodeKey(config.getOrThrow<string>('CREDENTIALS_ENCRYPTION_KEY'));
    if (!key) throw new Error('CREDENTIALS_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
    this.key = key;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return [VERSION, iv, cipher.getAuthTag(), data].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
  }

  decrypt(value: string): string {
    const [version, iv, tag, data] = value.split('.');
    if (version !== VERSION || !iv || !tag || data === undefined) throw new Error('Unrecognised credential format');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  }
}
