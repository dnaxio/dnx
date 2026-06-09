import { existsSync } from "node:fs";
import { join } from "node:path";
import { logger, spinner } from "../cli/output.ts";
import type { SSHConnection } from "../ssh/connection.ts";
import { hasFloxEnv } from "./lockfile.ts";

/**
 * Initialize a flox environment in the given directory.
 * Runs: flox init
 */
export async function initFloxEnv(cwd: string): Promise<void> {
  const proc = Bun.spawn(["flox", "init"], { cwd, stdout: "pipe", stderr: "pipe" });
  const output = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();

  if (proc.exitCode !== 0) {
    throw new Error(`flox init échoué : ${err || output}`);
  }
}

/**
 * Install packages into a flox environment.
 * Runs: flox install <packages...>
 */
export async function installPackages(cwd: string, packages: string[]): Promise<void> {
  const spin = spinner(`Installation de ${packages.length} package(s) flox...`);
  const proc = Bun.spawn(["flox", "install", ...packages], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();

  if (proc.exitCode !== 0) {
    spin.fail(`flox install échoué`);
    throw new Error(err || output);
  }
  spin.succeed(`${packages.length} package(s) installé(s)`);
}

/**
 * Activate a flox environment and run a command.
 * Runs: flox activate -- <command>
 */
export async function activateAndRun(
  cwd: string,
  command: string,
  env?: Record<string, string>
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const args = ["flox", "activate", "--", ...command.split(" ")];
  const proc = Bun.spawn(args, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  await proc.exited;

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: proc.exitCode };
}

/**
 * Check if flox is installed locally.
 */
export function isFloxInstalled(): boolean {
  try {
    const proc = Bun.spawnSync(["flox", "--version"]);
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Install flox on a remote server via SSH.
 */
export async function installFloxRemote(conn: SSHConnection): Promise<void> {
  const result = await conn.exec("which flox || echo NOT_FOUND");
  if (!result.stdout.includes("NOT_FOUND")) {
    logger.debug("flox déjà installé sur le serveur distant.");
    return;
  }

  logger.info("Installation de flox sur le serveur distant...");
  // Official flox install script
  const installCmd = 'curl -fsSL https://install.flox.dev | sh';
  const installResult = await conn.exec(installCmd);

  if (installResult.exitCode !== 0) {
    throw new Error(`Échec de l'installation de flox : ${installResult.stderr}`);
  }
  logger.success("flox installé sur le serveur distant.");
}

/**
 * Ensure flox environment exists on a remote server.
 * Syncs the .flox/ directory to the remote server.
 */
export async function syncFloxEnv(
  conn: SSHConnection,
  localProjectPath: string,
  remoteProjectPath: string
): Promise<void> {
  const floxDir = join(localProjectPath, ".flox");
  if (!existsSync(floxDir)) {
    throw new Error("Environnement flox local introuvable. Exécutez 'flox init'.");
  }

  const remoteFloxDir = `${remoteProjectPath}/.flox`;
  await conn.mkdir(remoteFloxDir, true);

  // Upload the manifest.lock (the critical reproducible file)
  const lockfile = join(floxDir, "env", "manifest.lock");
  const manifest = join(floxDir, "env", "manifest.json");

  if (existsSync(lockfile)) {
    await conn.upload(lockfile, `${remoteFloxDir}/env/manifest.lock`);
  }
  if (existsSync(manifest)) {
    await conn.upload(manifest, `${remoteFloxDir}/env/manifest.json`);
  }

  logger.debug("Environnement flox synchronisé vers le serveur.");
}
