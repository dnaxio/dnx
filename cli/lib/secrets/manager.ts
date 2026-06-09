import { encrypt, decrypt, pack, unpack } from "../utils/crypto.ts";
import { loadKey, hasKey } from "./keyring.ts";
import { getConnection, runMigrations } from "../db/connection.ts";
import { logger } from "../cli/output.ts";

interface SecretRow {
  id: string;
  key: string;
  value: Buffer;
  environment: string;
  created_at: string;
  updated_at: string;
}

/**
 * Initialize the secrets store (runs DB migrations).
 */
export function initStore(): void {
  runMigrations();
}

/**
 * Set a secret value, encrypted with the master key.
 */
export async function setSecret(
  name: string,
  value: string,
  environment: string = "all"
): Promise<void> {
  if (!hasKey()) {
    throw new Error("Clé maîtresse introuvable. Exécutez 'dnx secrets init'.");
  }

  const key = await loadKey();
  const encrypted = await encrypt(value, key);
  const packed = pack(encrypted);

  const db = getConnection();
  const existing = db
    .query("SELECT id FROM secrets WHERE key = ? AND environment = ?")
    .get(name, environment) as { id: string } | null;

  if (existing) {
    db.run(
      "UPDATE secrets SET value = ?, updated_at = datetime('now') WHERE id = ?",
      packed,
      existing.id
    );
    logger.success(`Secret "${name}" mis à jour [${environment}]`);
  } else {
    db.run(
      "INSERT INTO secrets (key, value, environment) VALUES (?, ?, ?)",
      name,
      packed,
      environment
    );
    logger.success(`Secret "${name}" créé [${environment}]`);
  }
}

/**
 * Get a decrypted secret value.
 */
export async function getSecret(
  name: string,
  environment: string = "all"
): Promise<string | null> {
  if (!hasKey()) return null;

  const key = await loadKey();
  const db = getConnection();

  const row = db
    .query(
      "SELECT value FROM secrets WHERE key = ? AND (environment = ? OR environment = 'all') LIMIT 1"
    )
    .get(name, environment) as { value: Buffer } | null;

  if (!row) return null;

  const unpacked = unpack(new Uint8Array(row.value));
  return decrypt(unpacked, key);
}

/**
 * List all secret keys (without values).
 */
export function listSecrets(environment?: string): SecretRow[] {
  const db = getConnection();
  if (environment) {
    return db
      .query(
        "SELECT id, key, environment, created_at, updated_at FROM secrets WHERE environment = ? OR environment = 'all' ORDER BY key"
      )
      .all(environment) as SecretRow[];
  }
  return db
    .query(
      "SELECT id, key, environment, created_at, updated_at FROM secrets ORDER BY key"
    )
    .all() as SecretRow[];
}

/**
 * Remove a secret.
 */
export function removeSecret(
  name: string,
  environment: string = "all"
): boolean {
  const db = getConnection();
  const result = db.run(
    "DELETE FROM secrets WHERE key = ? AND environment = ?",
    name,
    environment
  );
  return result.changes > 0;
}

/**
 * Extract all secrets for an environment, returning a key-value map.
 */
export async function extractSecrets(
  environment: string
): Promise<Record<string, string>> {
  const rows = listSecrets(environment);
  const result: Record<string, string> = {};

  for (const row of rows) {
    const value = await getSecret(row.key, row.environment);
    if (value !== null) {
      result[row.key] = value;
    }
  }

  return result;
}
