import * as argon2 from 'argon2';

// argon2id with the library's OWASP-aligned defaults (64 MiB, t=3).
export const hashPassword = (password: string): Promise<string> => argon2.hash(password, { type: argon2.argon2id });

export const verifyPassword = (hash: string, password: string): Promise<boolean> =>
  argon2.verify(hash, password).catch(() => false);
