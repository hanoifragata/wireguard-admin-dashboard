/**
 * AES-256-GCM encryption/decryption utilities for storing SSH credentials.
 * The encryption key is derived from the ENCRYPTION_KEY env var (64 hex chars = 32 bytes).
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT = 'wg-manager-static-salt-v1'; // non-secret salt for key derivation

function getEncryptionKey(): Buffer {
  const keyHex = process.env['ENCRYPTION_KEY'];
  if (keyHex && keyHex.length === 64) {
    return Buffer.from(keyHex, 'hex');
  }
  // Derive a key from ENCRYPTION_KEY (passphrase) or fall back to a deterministic default
  const passphrase = keyHex ?? 'default-insecure-key-change-in-production';
  return scryptSync(passphrase, SALT, 32);
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns a base64 string: iv (16B) + authTag (16B) + ciphertext
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/**
 * Decrypts a base64 string previously encrypted with {@link encrypt}.
 */
export function decrypt(ciphertext: string): string {
  const key = getEncryptionKey();
  const buf = Buffer.from(ciphertext, 'base64');

  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return decipher.update(encrypted) + decipher.final('utf8');
}

// ─── Password Hashing ─────────────────────────────────────────────────────────

const BCRYPT_ROUNDS = 12;

/**
 * Hashes a password using a simple PBKDF2 scheme (no bcrypt dep needed).
 * For production, swap this with the `bcrypt` package.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Verifies a plaintext password against a stored hash.
 */
export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const derived = scryptSync(password, salt, 64);
  const storedBuf = Buffer.from(hash, 'hex');
  try {
    return timingSafeEqual(derived, storedBuf);
  } catch {
    return false;
  }
}

/**
 * Hashes a refresh token for safe storage (SHA-256).
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
