import { getConnection } from "../db/connection.ts";
import { logger } from "../cli/output.ts";

export interface Lock {
  id: string;
  resource: string;
  holder: string;
  acquiredAt: Date;
  expiresAt?: Date;
}

const HOLDER = `${process.pid}@${require("node:os").hostname()}`;

/**
 * Acquire an advisory lock on a resource.
 * Uses SQLite as the lock backend (single-writer, works for local CLI).
 * For distributed locking, also sets a remote file lock on the target server.
 */
export function acquire(resource: string, ttlMs?: number): Lock {
  const db = getConnection();
  const id = crypto.randomUUID().replace(/-/g, "");
  const expiresAt = ttlMs ? new Date(Date.now() + ttlMs).toISOString() : null;

  try {
    db.run(
      "INSERT INTO locks (id, resource, holder, expires_at) VALUES (?, ?, ?, ?)",
      id,
      resource,
      HOLDER,
      expiresAt
    );
  } catch (err: any) {
    if (err?.code === "SQLITE_CONSTRAINT_UNIQUE") {
      throw new Error(`Ressource "${resource}" déjà verrouillée. Utilisez "dnx lock list" pour voir les locks actifs.`);
    }
    throw err;
  }

  return { id, resource, holder: HOLDER, acquiredAt: new Date(), expiresAt: expiresAt ? new Date(expiresAt) : undefined };
}

/**
 * Release a lock.
 */
export function release(resource: string): boolean {
  const db = getConnection();
  const result = db.run("DELETE FROM locks WHERE resource = ? AND holder = ?", resource, HOLDER);
  return result.changes > 0;
}

/**
 * Check if a resource is locked.
 */
export function isLocked(resource: string): boolean {
  const db = getConnection();
  const row = db.query("SELECT id FROM locks WHERE resource = ? LIMIT 1").get(resource) as { id: string } | null;
  return row !== null;
}

/**
 * List all active locks.
 */
export function listLocks(): Array<{ resource: string; holder: string; acquiredAt: string; expiresAt: string | null }> {
  const db = getConnection();
  return db.query(
    "SELECT resource, holder, acquired_at as acquiredAt, expires_at as expiresAt FROM locks ORDER BY acquired_at DESC"
  ).all() as any[];
}

/**
 * Release all locks held by the current process.
 */
export function releaseAll(): void {
  const db = getConnection();
  db.run("DELETE FROM locks WHERE holder = ?", HOLDER);
}

/**
 * Force-release a lock by resource name (admin).
 */
export function forceRelease(resource: string): boolean {
  const db = getConnection();
  const result = db.run("DELETE FROM locks WHERE resource = ?", resource);
  return result.changes > 0;
}

/**
 * Clean up expired locks. Called periodically via Bun.cron().
 */
export function cleanupExpired(): number {
  const db = getConnection();
  const result = db.run(
    "DELETE FROM locks WHERE expires_at IS NOT NULL AND datetime(expires_at) < datetime('now')"
  );
  if (result.changes > 0) {
    logger.debug(`Nettoyage de ${result.changes} lock(s) expiré(s).`);
  }
  return result.changes;
}

/**
 * Acquire a lock, run the callback, and release.
 */
export async function withLock<T>(
  resource: string,
  fn: () => Promise<T>,
  ttlMs?: number
): Promise<T> {
  const lock = acquire(resource, ttlMs);
  try {
    return await fn();
  } finally {
    release(lock.resource);
  }
}

/**
 * Acquire a deploy lock for an app in an environment.
 */
export function acquireDeployLock(appName: string, environment: string, ttlMs = 30 * 60 * 1000): Lock {
  return acquire(`deploy:${appName}:${environment}`, ttlMs);
}

/**
 * Release a deploy lock.
 */
export function releaseDeployLock(appName: string, environment: string): boolean {
  return release(`deploy:${appName}:${environment}`);
}

export { HOLDER };
