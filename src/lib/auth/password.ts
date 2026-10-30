import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// OWASP's 32 MiB scrypt profile. Node supplies the maintained crypto primitive.
const COST = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const PREFIX = "scrypt$32768$8$3";
const DUMMY_SALT = Buffer.alloc(16, 1);

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, COST, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function isValidUsername(username: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{2,63}$/.test(username);
}

export function validatePassword(password: string): string | null {
  if (password.length < 12 || password.length > 128) {
    return "Use a password or passphrase between 12 and 128 characters.";
  }
  if (!password.trim()) return "The password cannot contain only spaces.";
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const error = validatePassword(password);
  if (error) throw new Error(error);
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `${PREFIX}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string | null): Promise<boolean> {
  // Missing/corrupt hashes still do comparable work, without trusting stored costs.
  const parts = encoded?.split("$");
  const valid = parts?.length === 6 && parts.slice(0, 4).join("$") === PREFIX &&
    /^[A-Za-z0-9_-]{22}$/.test(parts[4]) && /^[A-Za-z0-9_-]{86}$/.test(parts[5]);
  const salt = valid ? Buffer.from(parts![4], "base64url") : DUMMY_SALT;
  const expected = valid ? Buffer.from(parts![5], "base64url") : Buffer.alloc(64);
  const bounded = password.length <= 128;
  const actual = await derive(bounded ? password : "", salt);
  return timingSafeEqual(actual, expected) && Boolean(valid) && bounded;
}
