/**
 * Cryptographic utilities using Web Crypto API (native in Bun).
 * AES-256-GCM encryption/decryption for secrets.
 */

const ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;
const IV_LENGTH = 12; // 96 bits, recommended for GCM

export interface EncryptedData {
  iv: Uint8Array;
  ciphertext: Uint8Array;
  tag: Uint8Array;
}

/**
 * Generate a new 256-bit AES key for use as master key.
 */
export async function generateKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: ALGORITHM, length: KEY_LENGTH },
    true, // extractable
    ["encrypt", "decrypt"]
  );
}

/**
 * Export a CryptoKey to raw bytes (Base64).
 */
export async function exportKey(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return Buffer.from(raw).toString("base64");
}

/**
 * Import a raw key from Base64 string.
 */
export async function importKey(base64Key: string): Promise<CryptoKey> {
  const raw = Buffer.from(base64Key, "base64");
  return crypto.subtle.importKey("raw", raw, { name: ALGORITHM, length: KEY_LENGTH }, true, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Encrypt plaintext using AES-256-GCM.
 * Returns iv, ciphertext, and authentication tag as separate buffers.
 */
export async function encrypt(
  plaintext: string,
  key: CryptoKey
): Promise<EncryptedData> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv, tagLength: 128 },
    key,
    encoded
  );

  // In Web Crypto, ciphertext includes the tag at the end (last 16 bytes)
  const ct = new Uint8Array(ciphertext, 0, ciphertext.byteLength - 16);
  const tag = new Uint8Array(ciphertext, ciphertext.byteLength - 16);

  return { iv, ciphertext: ct, tag };
}

/**
 * Decrypt ciphertext using AES-256-GCM.
 */
export async function decrypt(
  data: EncryptedData,
  key: CryptoKey
): Promise<string> {
  // Web Crypto expects ciphertext + tag concatenated
  const combined = new Uint8Array(data.ciphertext.length + data.tag.length);
  combined.set(data.ciphertext);
  combined.set(data.tag, data.ciphertext.length);

  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv: data.iv, tagLength: 128 },
    key,
    combined
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Pack encrypted data into a single binary buffer for storage.
 * Format: [iv (12 bytes)] [tag (16 bytes)] [ciphertext (variable)]
 */
export function pack(data: EncryptedData): Uint8Array {
  const packed = new Uint8Array(data.iv.length + data.tag.length + data.ciphertext.length);
  packed.set(data.iv, 0);
  packed.set(data.tag, data.iv.length);
  packed.set(data.ciphertext, data.iv.length + data.tag.length);
  return packed;
}

/**
 * Unpack a binary buffer back into EncryptedData.
 */
export function unpack(buffer: Uint8Array): EncryptedData {
  const iv = buffer.slice(0, IV_LENGTH);
  const tag = buffer.slice(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = buffer.slice(IV_LENGTH + 16);
  return { iv, ciphertext, tag };
}
