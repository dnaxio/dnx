/**
 * .env file loader for DNX CLI.
 *
 * Loads environment variables from `.env` files in priority order.
 * Shell environment variables always take precedence (never overridden).
 *
 * Priority (lowest to highest):
 *   1. .env
 *   2. .env.<environment>
 *   3. .dnax/.env
 *   4. .dnax/.env.<environment>
 *   5. .env.local
 *   6. Shell environment (always wins)
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse as dotenvParse } from "dotenv";

/** Snapshot of the shell environment before any .env loading. */
let shellEnv: Record<string, string | undefined> | null = null;

/**
 * Reset process.env back to the original shell environment.
 * Only restores keys that existed in the original shell — does not
 * delete keys loaded from .env files.
 */
function restoreShellEnv(): void {
  if (!shellEnv) return;

  // Shell env always wins: restore any key that was in the original shell
  for (const [key, value] of Object.entries(shellEnv)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
}

/**
 * Load a single .env file and apply its variables to process.env.
 */
function loadFile(filePath: string): void {
  if (!existsSync(filePath)) return;

  const content = readFileSync(filePath, "utf-8");
  let vars: Record<string, string>;
  try {
    vars = dotenvParse(content);
  } catch {
    // Silently skip malformed .env files
    return;
  }

  for (const [key, value] of Object.entries(vars)) {
    process.env[key] = value;
  }
}

/**
 * Load all applicable .env files for the given working directory and environment.
 *
 * Can be called multiple times (e.g., once at startup without env, then again
 * when the environment is known). Shell env always wins.
 *
 * @param cwd - Working directory
 * @param environment - Optional environment name (e.g., "production", "staging")
 */
export function loadEnvFiles(cwd: string, environment?: string): void {
  // Save snapshot of shell env on first call only
  if (shellEnv === null) {
    shellEnv = { ...process.env };
  }

  // Reset to clean slate for .env loading (shell vars are the base,
  // but we don't delete non-shell keys — previous .env loads are additive)
  restoreShellEnv();

  // Build the list of files in priority order (lowest to highest)
  const files: string[] = [
    resolve(cwd, ".env"),
    ...(environment ? [resolve(cwd, `.env.${environment}`)] : []),
    resolve(cwd, ".dnax/.env"),
    ...(environment ? [resolve(cwd, `.dnax/.env.${environment}`)] : []),
    resolve(cwd, ".env.local"),
  ];

  // Load all files in order (later files override earlier ones)
  for (const file of files) {
    loadFile(file);
  }

  // Shell env always wins — restore original values
  // (this overwrites any .env values for keys that the shell already set)
  restoreShellEnv();
}
