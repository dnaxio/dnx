import type { SSHConnection } from "../ssh/connection.ts";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { logger, spinner } from "../cli/output.ts";
import { AGENT_PORT } from "./protocol.ts";

const AGENT_REMOTE_DIR = "$HOME/.dnx/agent";
const AGENT_BINARY = "dnxd-agent";
const AGENT_SERVICE = "dnxd-agent";

/**
 * Install the dnxd agent on a remote server via SSH.
 * Steps:
 * 1. Compile the agent TypeScript to a standalone binary (if needed)
 * 2. Upload the binary to the remote server
 * 3. Create a systemd service (or init script)
 * 4. Start the agent
 */
export async function installAgent(
  conn: SSHConnection,
  localCliDir: string,
): Promise<void> {
  logger.info("Vérification de l'agent existant...");
  const check = await conn.exec(
    `test -f ${AGENT_REMOTE_DIR}/${AGENT_BINARY} && echo EXISTS || echo NOT_FOUND`,
  );

  if (check.stdout.includes("EXISTS")) {
    logger.info("Agent déjà installé. Utilisez --force pour réinstaller.");
    return;
  }

  // Check if Bun is available on the remote server
  const bunCheck = await conn.exec("which bun || echo NOT");
  const hasBun = !bunCheck.stdout.includes("NOT");

  if (!hasBun) {
    // Install Bun on the remote server
    logger.info("Installation de Bun sur le serveur distant...");
    await conn.exec("curl -fsSL https://bun.sh/install | bash");
    await conn.exec('export PATH="$HOME/.bun/bin:$PATH"');
  }

  // Upload agent files
  const spin = spinner("Upload de l'agent...");
  await conn.mkdir(AGENT_REMOTE_DIR, true);

  const agentFiles = [
    "lib/agent/server.ts",
    "lib/agent/protocol.ts",
    "lib/agent/supervisor.ts",
    "lib/agent/logbuffer.ts",
    "lib/agent/heartbeat.ts",
  ];

  for (const file of agentFiles) {
    const localPath = join(localCliDir, file);
    if (existsSync(localPath)) {
      const remotePath = `${AGENT_REMOTE_DIR}/${file.replace("lib/agent/", "")}`;
      await conn.upload(localPath, remotePath);
    }
  }

  // Create entry point
  const entryTs = `
import { startAgentServer } from "./server.ts";
startAgentServer();
`;
  await conn.upload(Buffer.from(entryTs), `${AGENT_REMOTE_DIR}/entry.ts`);

  // Create start script
  const startScript = `#!/bin/bash
export PATH="$HOME/.bun/bin:$PATH"
cd ${AGENT_REMOTE_DIR}
nohup bun run entry.ts > /var/log/dnxd.log 2>&1 &
echo $! > /tmp/dnxd.pid
echo "Agent started"
`;
  await conn.upload(Buffer.from(startScript), `${AGENT_REMOTE_DIR}/start.sh`);
  await conn.exec(`chmod +x ${AGENT_REMOTE_DIR}/start.sh`);

  // Start the agent
  spin.text = "Démarrage de l'agent...";
  await conn.exec(`bash ${AGENT_REMOTE_DIR}/start.sh`);

  spin.succeed("Agent installé et démarré.");
}

/**
 * Uninstall the agent from a remote server.
 */
export async function uninstallAgent(conn: SSHConnection): Promise<void> {
  logger.info("Arrêt de l'agent...");
  await conn.exec("pkill -f dnxd || true");
  await conn.exec(`rm -rf ${AGENT_REMOTE_DIR}`);
  await conn.exec("rm -f /tmp/dnxd.pid");
  logger.success("Agent désinstallé.");
}

/**
 * Check agent status on a remote server.
 */
export async function checkAgentStatus(
  conn: SSHConnection,
): Promise<{ installed: boolean; running: boolean; port: number }> {
  const checkDir = await conn.exec(
    `test -d ${AGENT_REMOTE_DIR} && echo EXISTS || echo NOT`,
  );
  const installed = checkDir.stdout.includes("EXISTS");

  if (!installed) return { installed: false, running: false, port: 0 };

  const checkProc = await conn.exec(
    `curl -s -X POST http://127.0.0.1:${AGENT_PORT} -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"ping","params":{}}' 2>/dev/null || echo NOT_RUNNING`,
  );
  const running = !checkProc.stdout.includes("NOT_RUNNING");

  return { installed: true, running, port: AGENT_PORT };
}
