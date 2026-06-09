/**
 * Process supervisor for the dnxd agent.
 * Manages application processes on the server: start, stop, restart, status.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import type { AgentProcessInfo } from "./protocol.ts";

interface ManagedProcess {
  name: string;
  pid: number | null;
  startCmd: string;
  envVars: Record<string, string>;
  cwd: string;
  restartPolicy: "always" | "on-failure" | "no";
  maxRestarts: number;
  restartCount: number;
  startedAt: number | null;
}

const processes = new Map<string, ManagedProcess>();

export function registerProcess(config: {
  name: string;
  startCmd: string;
  envVars?: Record<string, string>;
  cwd?: string;
  restartPolicy?: "always" | "on-failure" | "no";
  maxRestarts?: number;
}): void {
  processes.set(config.name, {
    name: config.name,
    pid: null,
    startCmd: config.startCmd,
    envVars: config.envVars ?? {},
    cwd: config.cwd ?? "$HOME/.dnx",
    restartPolicy: config.restartPolicy ?? "always",
    maxRestarts: config.maxRestarts ?? 10,
    restartCount: 0,
    startedAt: null,
  });
}

export function startProcess(name: string): { pid: number } {
  const proc = processes.get(name);
  if (!proc) throw new Error(`Process not registered: ${name}`);

  if (proc.pid && isProcessAlive(proc.pid)) {
    return { pid: proc.pid };
  }

  const pidFile = `/tmp/dnxd-${name}.pid`;

  // Spawn the process
  const env = { ...process.env, ...proc.envVars };
  const spawned = Bun.spawn(["sh", "-c", proc.startCmd], {
    cwd: proc.cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
    onExit: (_proc, exitCode, _signal, _error) => {
      proc.pid = null;
      proc.restartCount++;
      if (exitCode !== 0 && proc.restartPolicy === "on-failure") {
        if (proc.restartCount < proc.maxRestarts) {
          setTimeout(() => startProcess(name), 2000);
        }
      } else if (proc.restartPolicy === "always") {
        if (proc.restartCount < proc.maxRestarts) {
          setTimeout(() => startProcess(name), 2000);
        }
      }
    },
  });

  proc.pid = spawned.pid;
  proc.startedAt = Date.now();
  proc.restartCount = 0;

  writeFileSync(pidFile, String(spawned.pid));

  return { pid: spawned.pid };
}

export function stopProcess(name: string, graceful = true): void {
  const proc = processes.get(name);
  if (!proc || !proc.pid) return;

  const signal = graceful ? "SIGTERM" : "SIGKILL";
  try {
    process.kill(proc.pid, signal);
  } catch {
    // already dead
  }

  const pidFile = `/tmp/dnxd-${name}.pid`;
  if (existsSync(pidFile)) unlinkSync(pidFile);

  proc.pid = null;
}

export function restartProcess(name: string): { pid: number } {
  stopProcess(name);
  return startProcess(name);
}

export function getProcessInfo(name: string): AgentProcessInfo | null {
  const proc = processes.get(name);
  if (!proc) return null;

  return {
    name,
    pid: proc.pid ?? 0,
    status: proc.pid && isProcessAlive(proc.pid) ? "running" : "stopped",
    uptime: proc.startedAt ? Date.now() - proc.startedAt : 0,
    restartCount: proc.restartCount,
  };
}

export function getAllProcesses(): AgentProcessInfo[] {
  return [...processes.keys()].map((n) => getProcessInfo(n)!).filter(Boolean);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
