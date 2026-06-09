import { getConnection } from "../db/connection.ts";
import { Repository } from "../db/repository.ts";
import { logger } from "../cli/output.ts";

interface ReleaseRecord {
  id: string;
  app_id: string;
  service_id?: string;
  server_id: string;
  version: string;
  release_path: string;
  active: number;
  artifact_hash?: string;
  created_at: string;
}

const releasesRepo = new Repository<ReleaseRecord>("releases");

/**
 * Get the list of releases for an app, ordered by most recent first.
 */
export function listReleases(appName: string): {
  version: string;
  releasePath: string;
  active: boolean;
  createdAt: string;
}[] {
  const db = getConnection();
  const rows = db
    .query(
      `SELECT r.version, r.release_path as releasePath, r.active, r.created_at as createdAt
     FROM releases r
     JOIN apps a ON r.app_id = a.id
     WHERE a.name = ?
     ORDER BY r.created_at DESC
     LIMIT 20`,
    )
    .all(appName) as any[];

  return rows.map((r: any) => ({
    version: r.version,
    releasePath: r.releasePath,
    active: r.active === 1,
    createdAt: r.createdAt,
  }));
}

/**
 * Get the previous active release for an app (for rollback).
 */
export function getPreviousRelease(
  appName: string,
): { version: string; releasePath: string } | null {
  const db = getConnection();
  const row = db
    .query(
      `SELECT r.version, r.release_path as releasePath
     FROM releases r
     JOIN apps a ON r.app_id = a.id
     WHERE a.name = ? AND r.active = 1
     ORDER BY r.created_at DESC
     LIMIT 1 OFFSET 0`,
    )
    .get(appName) as any;

  // Get the one before the active
  const prev = db
    .query(
      `SELECT r.version, r.release_path as releasePath
     FROM releases r
     JOIN apps a ON r.app_id = a.id
     WHERE a.name = ? AND r.active = 0
     ORDER BY r.created_at DESC
     LIMIT 1`,
    )
    .get(appName) as any;

  return prev ?? row;
}

/**
 * Mark a specific release as the active one.
 */
export function activateRelease(appName: string, version: string): boolean {
  const db = getConnection();

  const app = db.query("SELECT id FROM apps WHERE name = ?").get(appName) as {
    id: string;
  } | null;
  if (!app) return false;

  // Deactivate all
  db.run("UPDATE releases SET active = 0 WHERE app_id = ?", app.id);

  // Activate the target version
  const result = db.run(
    "UPDATE releases SET active = 1 WHERE app_id = ? AND version = ?",
    app.id,
    version,
  );

  return result.changes > 0;
}

/**
 * Generate the rollback shell commands for a remote server.
 */
export function generateRollbackCommands(
  appName: string,
  targetReleasePath: string,
  baseDir = "$HOME/.dnx",
): string {
  return `
# Rollback ${appName} to ${targetReleasePath}
CURRENT="${baseDir}/workloads/${appName}/current"
TARGET="${targetReleasePath}"

# Stop current
if [ -f "$CURRENT/app.pid" ]; then
  PID=$(cat "$CURRENT/app.pid")
  kill -TERM "$PID" 2>/dev/null
  sleep 3
  kill -KILL "$PID" 2>/dev/null || true
fi

# Switch symlink
ln -sfn "$TARGET" "$CURRENT"

# Start from rollback target
nohup bash "$CURRENT/dnx-start.sh" > ${baseDir}/workloads/${appName}/app.log 2>&1 &
sleep 2

# Verify
if [ -f "${baseDir}/workloads/${appName}/app.pid" ]; then
  NEW_PID=$(cat ${baseDir}/workloads/${appName}/app.pid)
  if kill -0 "$NEW_PID" 2>/dev/null; then
    echo "ROLLBACK_OK PID=$NEW_PID"
  else
    echo "ROLLBACK_FAILED"
  fi
else
  echo "ROLLBACK_FAILED"
fi
`;
}

export function getReleaseCount(appName: string): number {
  const db = getConnection();
  const row = db
    .query(
      `SELECT COUNT(*) as count FROM releases r JOIN apps a ON r.app_id = a.id WHERE a.name = ?`,
    )
    .get(appName) as { count: number };
  return row?.count ?? 0;
}
