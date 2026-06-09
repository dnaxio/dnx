import {
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { getConnection } from "../db/connection.ts";
import { Repository } from "../db/repository.ts";

export interface ReleaseRecord {
  id: string;
  deployment_id?: string;
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
 * Determine the next release path for an app on a server.
 * Format: $HOME/.dnx/workloads/<app_name>/releases/<version>_<timestamp>
 */
export function getReleasePath(
  appName: string,
  version: string,
  baseDir = "$HOME/.dnx",
): string {
  const ts = Date.now();
  return `${baseDir}/workloads/${appName}/releases/${version}_${ts}`;
}

/**
 * Create a new release directory structure on the remote server via SSH.
 */
export function generateReleaseSetupCommands(
  appName: string,
  version: string,
  startCmd: string,
  ports: number[],
  envVars: Record<string, string>,
  baseDir = "$HOME/.dnx",
): string {
  const releasePath = getReleasePath(appName, version, baseDir);
  const envLines = Object.entries(envVars)
    .map(([k, v]) => `export ${k}="${v}"`)
    .join("\n");

  const portStr = ports.join(" ");

  return `
# Créer la structure de release
mkdir -p ${releasePath}
mkdir -p ${baseDir}/workloads/${appName}/data

# Écrire les variables d'environnement
cat > ${releasePath}/.env << 'DNXEOF'
${envLines}
DNXEOF

# Créer le script de démarrage
cat > ${releasePath}/dnx-start.sh << 'DNXEOF'
#!/bin/bash
set -e
# Add common runtime paths
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$HOME/bin:/usr/local/bin:$PATH"
cd ${releasePath}
source .env
echo "PID: $$" > ${releasePath}/app.pid
exec ${startCmd}
DNXEOF
chmod +x ${releasePath}/dnx-start.sh

# Créer le lien "current" (atomique)
ln -sfn ${releasePath} ${baseDir}/workloads/${appName}/current

echo "RELEASE_PATH=${releasePath}"
echo "RELEASE_OK"
`;
}

/**
 * Generate the command to stop a running app on a remote server.
 */
export function generateStopCommand(
  appName: string,
  baseDir = "$HOME/.dnx",
): string {
  return `
CURRENT="${baseDir}/workloads/${appName}/current"
if [ -f "$CURRENT/app.pid" ]; then
  PID=$(cat "$CURRENT/app.pid")
  if kill -0 "$PID" 2>/dev/null; then
    kill -TERM "$PID"
    for i in $(seq 1 30); do
      kill -0 "$PID" 2>/dev/null || break
      sleep 1
    done
    kill -0 "$PID" 2>/dev/null && kill -KILL "$PID"
    echo "STOPPED"
  else
    echo "NOT_RUNNING"
  fi
else
  echo "NO_PID_FILE"
fi
`;
}

/**
 * Generate the command to start an app.
 */
export function generateStartCommand(
  appName: string,
  baseDir = "$HOME/.dnx",
): string {
  return `
CURRENT="${baseDir}/workloads/${appName}/current"
if [ -f "$CURRENT/dnx-start.sh" ]; then
  nohup bash "$CURRENT/dnx-start.sh" > "$CURRENT/app.log" 2>&1 &
  sleep 2
  if [ -f "$CURRENT/app.pid" ]; then
    PID=$(cat "$CURRENT/app.pid")
    if kill -0 "$PID" 2>/dev/null; then
      echo "STARTED PID=$PID"
    else
      echo "FAILED_TO_START"
    fi
  else
    echo "FAILED_NO_PID"
  fi
else
  echo "NO_START_SCRIPT"
fi
`;
}

/**
 * Record a release in the local database.
 */
export function recordRelease(
  appName: string,
  serverName: string,
  version: string,
  releasePath: string,
  deploymentId?: string,
  artifactHash?: string,
): ReleaseRecord {
  const db = getConnection();

  // Ensure app record exists
  let appRow = db.query("SELECT id FROM apps WHERE name = ?").get(appName) as {
    id: string;
  } | null;
  if (!appRow) {
    db.run("INSERT INTO apps (id, name, runtime_type) VALUES (?, ?, ?)", [
      crypto.randomUUID().replace(/-/g, ""),
      appName,
      "flox",
    ]);
    appRow = db.query("SELECT id FROM apps WHERE name = ?").get(appName) as {
      id: string;
    };
  }

  // Ensure server record exists
  let srvRow = db
    .query("SELECT id FROM servers WHERE name = ?")
    .get(serverName) as { id: string } | null;
  if (!srvRow) {
    db.run("INSERT INTO servers (id, name, host) VALUES (?, ?, ?)", [
      crypto.randomUUID().replace(/-/g, ""),
      serverName,
      serverName,
    ]);
    srvRow = db
      .query("SELECT id FROM servers WHERE name = ?")
      .get(serverName) as { id: string };
  }

  // Deactivate old releases for this app+server
  db.run(
    "UPDATE releases SET active = 0 WHERE app_id = ? AND server_id = ? AND active = 1",
    appRow.id,
    srvRow.id,
  );

  return releasesRepo.create({
    app_id: appRow!.id,
    server_id: srvRow!.id,
    version,
    release_path: releasePath,
    active: 1,
    deployment_id: deploymentId,
    artifact_hash: artifactHash,
  });
}

/**
 * Get the active release for an app on a server.
 */
export function getActiveRelease(
  appName: string,
  serverName: string,
): ReleaseRecord | null {
  return (
    releasesRepo.query(
      `SELECT r.* FROM releases r JOIN apps a ON r.app_id = a.id JOIN servers s ON r.server_id = s.id WHERE a.name = ? AND s.name = ? AND r.active = 1 ORDER BY r.created_at DESC LIMIT 1`,
      appName,
      serverName,
    )[0] ?? null
  );
}

/**
 * List all releases for an app, ordered by most recent.
 */
export function listReleases(appName: string): ReleaseRecord[] {
  return releasesRepo.query(
    `SELECT r.* FROM releases r JOIN apps a ON r.app_id = a.id WHERE a.name = ? ORDER BY r.created_at DESC`,
    appName,
  );
}
