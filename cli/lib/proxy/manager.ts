import type { SSHConnection } from "../ssh/connection.ts";
import type { SSHPool, ExecutionResult } from "../ssh/pool.ts";
import { logger, spinner } from "../cli/output.ts";
import {
  generateCaddyfile,
  generateSimpleCaddyfile,
  type CaddyRoute,
} from "./caddyfile.ts";

const CADDY_CONFIG_PATH = "/etc/caddy/Caddyfile";
const CADDY_RELOAD_CMD = "caddy reload --config /etc/caddy/Caddyfile";
const CADDY_START_CMD = "caddy start --config /etc/caddy/Caddyfile";
const CADDY_STOP_CMD = "caddy stop";
const CADDY_STATUS_CMD =
  "caddy version && pgrep caddy && echo RUNNING || echo NOT_RUNNING";

/**
 * Check if Caddy is installed on a remote server.
 */
export async function isCaddyInstalled(conn: SSHConnection): Promise<boolean> {
  const result = await conn.exec("which caddy || echo NOT_FOUND");
  return !result.stdout.includes("NOT_FOUND");
}

/**
 * Install Caddy on a remote server via the official script.
 */
export async function installCaddyRemote(conn: SSHConnection): Promise<void> {
  if (await isCaddyInstalled(conn)) {
    logger.debug("Caddy already installed.");
    return;
  }

  logger.info("Installation de Caddy...");
  const cmd =
    "curl -fsSL https://caddyserver.com/api/download?os=linux&arch=amd64 -o /tmp/caddy && " +
    "chmod +x /tmp/caddy && " +
    "mv /tmp/caddy /usr/local/bin/caddy && " +
    "mkdir -p /etc/caddy";

  const result = await conn.exec(cmd);
  if (result.exitCode !== 0) {
    throw new Error(`Caddy install failed: ${result.stderr}`);
  }
  logger.success("Caddy installed.");
}

/**
 * Upload a Caddyfile to a remote server.
 */
export async function uploadCaddyfile(
  conn: SSHConnection,
  config: string,
): Promise<void> {
  await conn.mkdir("/etc/caddy", true);
  await conn.upload(Buffer.from(config), CADDY_CONFIG_PATH);
  logger.debug("Caddyfile uploaded.");
}

/**
 * Read existing Caddyfile from remote, merge with new routes, upload.
 */
export async function uploadMergedCaddyfile(
  conn: SSHConnection,
  newRoutes: Array<{
    domain: string;
    target: string;
    port: number;
    ssl?: boolean;
  }>,
  opts: { email?: string; autoSSL?: boolean },
): Promise<void> {
  const { mergeCaddyfile } = await import("./caddyfile.ts");

  // Read existing Caddyfile
  let existingContent = "";
  try {
    const result = await conn.exec(`cat ${CADDY_CONFIG_PATH} 2>/dev/null`);
    if (result.exitCode === 0 && result.stdout) {
      existingContent = result.stdout;
    }
  } catch {
    // No existing Caddyfile — will create a new one
  }

  const merged = mergeCaddyfile(existingContent, newRoutes, opts);
  await conn.mkdir("/etc/caddy", true);
  await conn.upload(Buffer.from(merged), CADDY_CONFIG_PATH);
  logger.debug("Caddyfile merged and uploaded.");
}

/**
 * Reload Caddy configuration on a remote server (graceful, zero-downtime).
 */
export async function reloadCaddy(conn: SSHConnection): Promise<void> {
  const result = await conn.exec(CADDY_RELOAD_CMD);
  if (result.exitCode !== 0 && !result.stderr.includes("not running")) {
    throw new Error(`Caddy reload failed: ${result.stderr}`);
  }
  logger.debug("Caddy reloaded.");
}

/**
 * Start Caddy on a remote server.
 */
export async function startCaddy(conn: SSHConnection): Promise<void> {
  // Check if already running
  const status = await conn.exec("pgrep caddy && echo RUNNING || echo NOT");
  if (status.stdout.includes("RUNNING")) {
    logger.info("Caddy already running.");
    return;
  }

  const result = await conn.exec(CADDY_START_CMD);
  if (result.exitCode !== 0) {
    throw new Error(`Caddy start failed: ${result.stderr}`);
  }
  logger.success("Caddy started.");
}

/**
 * Stop Caddy on a remote server.
 */
export async function stopCaddy(conn: SSHConnection): Promise<void> {
  const result = await conn.exec(CADDY_STOP_CMD);
  if (result.exitCode !== 0 && !result.stderr.includes("not running")) {
    throw new Error(`Caddy stop failed: ${result.stderr}`);
  }
  logger.success("Caddy stopped.");
}

/**
 * Restart Caddy on a remote server.
 */
export async function restartCaddy(conn: SSHConnection): Promise<void> {
  await conn.exec(CADDY_STOP_CMD);
  await conn.exec(CADDY_START_CMD);
  logger.success("Caddy restarted.");
}

/**
 * Get Caddy status on a remote server.
 */
export async function getCaddyStatus(
  conn: SSHConnection,
): Promise<{ installed: boolean; running: boolean; version: string }> {
  const installed = await isCaddyInstalled(conn);
  if (!installed) return { installed: false, running: false, version: "" };

  const result = await conn.exec(CADDY_STATUS_CMD);
  const running = result.stdout.includes("RUNNING");
  const versionLine = result.stdout.split("\n")[0] ?? "";
  return { installed: true, running, version: versionLine };
}

/**
 * Get Caddy logs from a remote server.
 */
export async function getCaddyLogs(
  conn: SSHConnection,
  lines = 50,
  follow = false,
): Promise<void> {
  const cmd = follow
    ? `journalctl -u caddy -f -n ${lines}`
    : `journalctl -u caddy -n ${lines} --no-pager`;

  await conn.execStream(cmd, (data, stderr) => {
    if (stderr) logger.error(data);
    else process.stdout.write(data);
  });
}

/**
 * Deploy Caddy configuration to multiple servers.
 */
export async function deployCaddyConfig(
  pool: SSHPool,
  routes: CaddyRoute[],
  email?: string,
): Promise<ExecutionResult[]> {
  const config = generateCaddyfile({ email, routes });

  return pool.executeAll(
    `cat > ${CADDY_CONFIG_PATH} << 'DNX_EOF'\n${config}\nDNX_EOF\n${CADDY_RELOAD_CMD}`,
  );
}

/**
 * Generate a load-balanced Caddy configuration for an app deployed on multiple servers.
 */
export function generateLBConfig(
  domain: string,
  servers: { host: string; port: number }[],
  lbPolicy: CaddyRoute["lbPolicy"] = "round_robin",
  email?: string,
): string {
  const upstreams = servers.map((s) => `${s.host}:${s.port}`);
  return generateCaddyfile({
    email,
    routes: [
      {
        domain,
        target: "",
        port: 0,
        upstreams,
        lbPolicy,
        ssl: true,
      },
    ],
  });
}
