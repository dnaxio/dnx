import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { generateKey, exportKey, importKey } from "../utils/crypto.ts";
import { logger } from "../cli/output.ts";

const DNX_DIR = join(homedir(), ".dnx");
const KEY_PATH = join(DNX_DIR, "master.key");

let cachedKey: CryptoKey | null = null;

/**
 * Initialize a new master key if one doesn't exist.
 * The key is stored in ~/.dnx/master.key with chmod 600.
 */
export async function initKeyring(): Promise<CryptoKey> {
  if (!existsSync(DNX_DIR)) {
    mkdirSync(DNX_DIR, { recursive: true, mode: 0o700 });
  }

  if (existsSync(KEY_PATH)) {
    logger.warn("Une clé maîtresse existe déjà. Utilisez --force pour la régénérer.");
    return loadKey();
  }

  const key = await generateKey();
  const exported = await exportKey(key);

  writeFileSync(KEY_PATH, exported, { mode: 0o600 });
  logger.success("Clé maîtresse générée dans ~/.dnx/master.key");

  cachedKey = key;
  return key;
}

/**
 * Force regeneration of the master key.
 */
export async function forceInitKeyring(): Promise<CryptoKey> {
  const key = await generateKey();
  const exported = await exportKey(key);

  writeFileSync(KEY_PATH, exported, { mode: 0o600 });
  logger.success("Clé maîtresse régénérée.");

  cachedKey = key;
  return key;
}

/**
 * Load the master key from disk.
 * Also checks DNX_MASTER_KEY environment variable.
 */
export async function loadKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;

  // Check environment variable first
  const envKey = process.env.DNX_MASTER_KEY;
  if (envKey) {
    cachedKey = await importKey(envKey);
    return cachedKey;
  }

  // Load from file
  if (!existsSync(KEY_PATH)) {
    throw new Error(
      "Clé maîtresse introuvable. Exécutez 'dnx secrets init' pour la générer."
    );
  }

  const raw = readFileSync(KEY_PATH, "utf-8").trim();
  if (!raw) {
    throw new Error("Fichier de clé maîtresse vide.");
  }

  cachedKey = await importKey(raw);
  return cachedKey;
}

/**
 * Check if a master key exists.
 */
export function hasKey(): boolean {
  return existsSync(KEY_PATH) || !!process.env.DNX_MASTER_KEY;
}

export function getKeyPath(): string {
  return KEY_PATH;
}
