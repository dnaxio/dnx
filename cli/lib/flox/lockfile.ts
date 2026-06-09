import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { logger } from "../cli/output.ts";

export interface FloxPackage {
  name: string;
  version?: string;
  pkgPath: string;
  systems: string[];
}

export interface FloxManifestLock {
  version: number;
  packages: Record<string, FloxPackage>;
  manifest?: Record<string, unknown>;
}

/**
 * Parse a flox manifest.lock file.
 * Path is typically: .flox/env/manifest.lock
 */
export function parseLockfile(lockfilePath: string): FloxManifestLock {
  if (!existsSync(lockfilePath)) {
    throw new Error(`flox manifest.lock introuvable : ${lockfilePath}`);
  }

  const raw = readFileSync(lockfilePath, "utf-8");
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    // flox lockfiles can also be YAML in some versions
    try {
      parsed = parseYaml(raw);
    } catch (err) {
      throw new Error(`Impossible de parser manifest.lock : ${(err as Error).message}`);
    }
  }

  return parsed as FloxManifestLock;
}

/**
 * Get the hash of a lockfile for cache busting.
 */
export function getLockfileHash(lockfilePath: string): string {
  const { createHash } = require("node:crypto");
  const raw = readFileSync(lockfilePath, "utf-8");
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

/**
 * Detect if a directory has a flox environment.
 */
export function hasFloxEnv(cwd: string): boolean {
  return existsSync(join(cwd, ".flox", "env", "manifest.lock"));
}

/**
 * List installed packages from a lockfile.
 */
export function listPackages(lockfilePath: string): string[] {
  const lock = parseLockfile(lockfilePath);
  return Object.keys(lock.packages);
}

/**
 * Compare two lockfiles and return which packages changed.
 */
export function diffLockfiles(
  oldPath: string,
  newPath: string
): { added: string[]; removed: string[]; changed: string[] } {
  const oldLock = parseLockfile(oldPath);
  const newLock = parseLockfile(newPath);

  const oldPkgs = Object.keys(oldLock.packages);
  const newPkgs = Object.keys(newLock.packages);

  const added = newPkgs.filter((p) => !oldPkgs.includes(p));
  const removed = oldPkgs.filter((p) => !newPkgs.includes(p));
  const changed = newPkgs.filter((p) => {
    if (!oldPkgs.includes(p)) return false;
    const oldVer = oldLock.packages[p]?.version;
    const newVer = newLock.packages[p]?.version;
    return oldVer !== newVer;
  });

  return { added, removed, changed };
}
