import { existsSync } from "node:fs";
import { join } from "node:path";
import { logger, spinner } from "../cli/output.ts";
import type { SSHConnection } from "../ssh/connection.ts";

export interface OciRegistry {
  url: string;       // ghcr.io/org/app
  username?: string;
  password?: string;
}

/**
 * Check if Docker is installed on a remote server.
 */
export async function isDockerInstalled(conn: SSHConnection): Promise<boolean> {
  const result = await conn.exec("which docker || echo NOT");
  return !result.stdout.includes("NOT");
}

/**
 * Check if Podman is installed on a remote server.
 */
export async function isPodmanInstalled(conn: SSHConnection): Promise<boolean> {
  const result = await conn.exec("which podman || echo NOT");
  return !result.stdout.includes("NOT");
}

/**
 * Install Docker on a remote server.
 */
export async function installDockerRemote(conn: SSHConnection): Promise<void> {
  if (await isDockerInstalled(conn)) {
    logger.debug("Docker déjà installé.");
    return;
  }
  logger.info("Installation de Docker...");
  await conn.exec("curl -fsSL https://get.docker.com | sh");
  logger.success("Docker installé.");
}

/**
 * Pull an OCI image on a remote server.
 */
export async function pullImage(
  conn: SSHConnection,
  image: string,
  runtime: "docker" | "podman" = "docker"
): Promise<void> {
  const result = await conn.exec(`${runtime} pull ${image}`);
  if (result.exitCode !== 0) {
    throw new Error(`Pull échoué : ${result.stderr}`);
  }
  logger.success(`Image pullée : ${image}`);
}

/**
 * Push an image to a registry (local operation).
 */
export async function pushImage(
  image: string,
  registry: OciRegistry
): Promise<void> {
  const spin = spinner(`Push : ${image}`);

  if (registry.username) {
    const loginProc = Bun.spawn(
      ["docker", "login", registry.url, "-u", registry.username, "--password-stdin"],
      { stdin: "pipe" }
    );
    loginProc.stdin.write(registry.password ?? "");
    loginProc.stdin.end();
    await loginProc.exited;
  }

  const pushProc = Bun.spawn(["docker", "push", image]);
  const out = await new Response(pushProc.stdout).text();
  const err = await new Response(pushProc.stderr).text();
  await pushProc.exited;

  if (pushProc.exitCode !== 0) {
    spin.fail(`Push échoué`);
    throw new Error(err);
  }
  spin.succeed(`Image pushée : ${image}`);
}

/**
 * Run a container on a remote server.
 */
export async function runContainer(
  conn: SSHConnection,
  image: string,
  options: {
    name: string;
    ports?: string[];
    envVars?: Record<string, string>;
    volumes?: string[];
    restart?: string;
    network?: string;
    runtime?: "docker" | "podman";
  }
): Promise<void> {
  const runtime = options.runtime ?? "docker";
  const args: string[] = [runtime, "run", "-d"];

  args.push("--name", options.name);

  if (options.restart) {
    args.push("--restart", options.restart);
  }

  for (const port of options.ports ?? []) {
    args.push("-p", port);
  }

  for (const vol of options.volumes ?? []) {
    args.push("-v", vol);
  }

  if (options.envVars) {
    for (const [k, v] of Object.entries(options.envVars)) {
      args.push("-e", `${k}=${v}`);
    }
  }

  if (options.network) {
    args.push("--network", options.network);
  }

  args.push(image);

  const cmd = args.join(" ");
  const result = await conn.exec(cmd);
  if (result.exitCode !== 0) {
    throw new Error(`Container start échoué : ${result.stderr}`);
  }
  logger.success(`Conteneur démarré : ${options.name}`);
}

/**
 * Stop and remove a container on a remote server.
 */
export async function removeContainer(
  conn: SSHConnection,
  name: string,
  runtime: "docker" | "podman" = "docker"
): Promise<void> {
  await conn.exec(`${runtime} stop ${name} 2>/dev/null || true`);
  await conn.exec(`${runtime} rm ${name} 2>/dev/null || true`);
  logger.success(`Conteneur supprimé : ${name}`);
}

/**
 * Get container logs from a remote server.
 */
export async function getContainerLogs(
  conn: SSHConnection,
  name: string,
  options: { tail?: number; follow?: boolean; runtime?: "docker" | "podman" } = {}
): Promise<void> {
  const runtime = options.runtime ?? "docker";
  const follow = options.follow ? "-f" : "";
  const tail = options.tail ? `--tail ${options.tail}` : "--tail 100";

  await conn.execStream(`${runtime} logs ${follow} ${tail} ${name}`, (data, isStderr) => {
    if (isStderr) process.stderr.write(data);
    else process.stdout.write(data);
  });
}

/**
 * List running containers on a remote server.
 */
export async function listContainers(
  conn: SSHConnection,
  runtime: "docker" | "podman" = "docker"
): Promise<string> {
  const result = await conn.exec(`${runtime} ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"`);
  return result.stdout;
}

/**
 * Cleanup old images and containers on a remote server.
 */
export async function cleanupRemote(
  conn: SSHConnection,
  runtime: "docker" | "podman" = "docker"
): Promise<void> {
  await conn.exec(`${runtime} container prune -f 2>/dev/null || true`);
  await conn.exec(`${runtime} image prune -f 2>/dev/null || true`);
  logger.success("Nettoyage OCI terminé.");
}
