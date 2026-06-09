import { logger, spinner } from "../cli/output.ts";
import type { SSHConnection } from "../ssh/connection.ts";
import type { SSHPool, ExecutionResult } from "../ssh/pool.ts";

export interface ProcessInfo {
  name: string;
  pid: number | null;
  status: "running" | "stopped" | "unknown";
  uptime: number;
  startCmd: string;
  pidFile: string;
  logFile: string;
}

/**
 * Generate a shell script for process supervision (agentless fallback).
 */
export function generateSupervisorScript(
  appName: string,
  startCmd: string,
  envVars: Record<string, string>,
  baseDir = "$HOME/.dnx",
): string {
  const envLines = Object.entries(envVars)
    .map(([k, v]) => `export ${k}="${v.replace(/"/g, '\\"')}"`)
    .join("\n");

  return `#!/bin/bash
# DNX Supervisor for ${appName}
set -e
# Add common runtime paths
export PATH="$HOME/.bun/bin:$HOME/.local/bin:$HOME/bin:/usr/local/bin:$PATH"
${envLines}
cd ${baseDir}/workloads/${appName}/current
echo "PID: $$" > ${baseDir}/workloads/${appName}/app.pid
exec ${startCmd}
`;
}

/**
 * Start a process on a remote server via SSH.
 */
export async function remoteStart(
  conn: SSHConnection,
  appName: string,
  startCmd: string,
  envVars: Record<string, string>,
  baseDir = "$HOME/.dnx",
): Promise<{ pid: number }> {
  const currentDir = `${baseDir}/workloads/${appName}/current`;
  const exists = await conn.exists(currentDir);
  if (!exists) {
    throw new Error(
      `Application "${appName}" non déployée. Répertoire ${currentDir} introuvable.`,
    );
  }

  // Check if already running
  const status = await getRemoteStatus(conn, appName, baseDir);
  if (status.status === "running") {
    logger.info(`${appName} déjà en cours d'exécution (PID ${status.pid}).`);
    return { pid: status.pid! };
  }

  // Write supervisor script
  const script = generateSupervisorScript(appName, startCmd, envVars, baseDir);
  await conn.upload(Buffer.from(script), `${currentDir}/dnx-start.sh`);
  await conn.exec(`chmod +x ${currentDir}/dnx-start.sh`);

  // Start via nohup
  const result = await conn.exec(
    `mkdir -p ${baseDir}/workloads/${appName}/data && ` +
      `nohup bash ${currentDir}/dnx-start.sh > ${baseDir}/workloads/${appName}/app.log 2>&1 & ` +
      `sleep 1 && cat ${baseDir}/workloads/${appName}/app.pid`,
  );

  const pid = parseInt(result.stdout.trim());
  if (!pid) throw new Error(`Échec du démarrage de ${appName}`);

  return { pid };
}

/**
 * Stop a process on a remote server.
 */
export async function remoteStop(
  conn: SSHConnection,
  appName: string,
  baseDir = "$HOME/.dnx",
): Promise<{ wasRunning: boolean }> {
  const pidFile = `${baseDir}/workloads/${appName}/app.pid`;
  const exists = await conn.exists(pidFile);

  if (!exists) return { wasRunning: false };

  const result = await conn.exec(
    `PID=$(cat ${pidFile} 2>/dev/null); ` +
      `if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then ` +
      `  kill -TERM "$PID"; ` +
      `  for i in $(seq 1 30); do kill -0 "$PID" 2>/dev/null || break; sleep 1; done; ` +
      `  kill -0 "$PID" 2>/dev/null && kill -KILL "$PID"; ` +
      `  echo "STOPPED"; ` +
      `else echo "NOT_RUNNING"; fi`,
  );

  const wasRunning = result.stdout.includes("STOPPED");
  await conn.exec(`rm -f ${pidFile}`);
  return { wasRunning };
}

/**
 * Restart a process on a remote server.
 */
export async function remoteRestart(
  conn: SSHConnection,
  appName: string,
  startCmd: string,
  envVars: Record<string, string>,
  baseDir = "$HOME/.dnx",
): Promise<{ pid: number }> {
  await remoteStop(conn, appName, baseDir);
  return remoteStart(conn, appName, startCmd, envVars, baseDir);
}

/**
 * Get process status on a remote server.
 */
export async function getRemoteStatus(
  conn: SSHConnection,
  appName: string,
  baseDir = "$HOME/.dnx",
): Promise<ProcessInfo> {
  const pidFile = `${baseDir}/workloads/${appName}/app.pid`;
  const result = await conn.exec(
    `if [ -f ${pidFile} ]; then ` +
      `  PID=$(cat ${pidFile}); ` +
      `  if kill -0 "$PID" 2>/dev/null; then ` +
      `    UPTIME=$(ps -o etimes= -p "$PID" 2>/dev/null | tr -d ' '); ` +
      `    echo "RUNNING PID=$PID UPTIME=$UPTIME"; ` +
      `  else echo "DEAD PID=$PID"; fi; ` +
      `else echo "NOT_RUNNING"; fi`,
  );

  const output = result.stdout.trim();

  if (output.startsWith("RUNNING")) {
    const pidMatch = output.match(/PID=(\d+)/);
    const uptimeMatch = output.match(/UPTIME=(\d+)/);
    return {
      name: appName,
      pid: pidMatch ? parseInt(pidMatch[1]!) : null,
      status: "running",
      uptime: uptimeMatch ? parseInt(uptimeMatch[1]!) : 0,
      startCmd: "",
      pidFile,
      logFile: `${baseDir}/workloads/${appName}/app.log`,
    };
  }

  return {
    name: appName,
    pid: null,
    status: "stopped",
    uptime: 0,
    startCmd: "",
    pidFile,
    logFile: `${baseDir}/workloads/${appName}/app.log`,
  };
}

/**
 * Stream logs from a remote server.
 */
export async function streamLogs(
  conn: SSHConnection,
  appName: string,
  options: { tail?: number; follow?: boolean; grep?: string } = {},
  baseDir = "$HOME/.dnx",
): Promise<void> {
  const logFile = `${baseDir}/workloads/${appName}/app.log`;
  const exists = await conn.exists(logFile);
  if (!exists) {
    logger.warn(`Aucun fichier de log trouvé pour ${appName}.`);
    return;
  }

  let cmd = `tail`;
  if (options.follow) cmd += ` -f`;
  if (options.tail) cmd += ` -n ${options.tail}`;
  else cmd += ` -n 100`;
  cmd += ` ${logFile}`;
  if (options.grep) cmd += ` | grep "${options.grep}"`;

  await conn.execStream(cmd, (data, isStderr) => {
    if (isStderr) process.stderr.write(data);
    else process.stdout.write(data);
  });
}

/**
 * Graceful stop signal constants.
 */
export const STOP_TIMEOUT = 30; // seconds to wait before SIGKILL
export const RESTART_DELAY = 2; // seconds delay before restart
