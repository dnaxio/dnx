/**
 * Circular log buffer for the dnxd agent.
 * Stores the last N log lines per process in memory.
 */

import type { AgentLogEntry } from "./protocol.ts";

const MAX_LINES = 500;

const buffers = new Map<string, AgentLogEntry[]>();

export function pushLog(processName: string, level: "stdout" | "stderr", message: string): void {
  if (!buffers.has(processName)) {
    buffers.set(processName, []);
  }

  const buf = buffers.get(processName)!;
  buf.push({
    timestamp: new Date().toISOString(),
    level,
    message,
  });

  // Trim to max size
  while (buf.length > MAX_LINES) {
    buf.shift();
  }
}

export function getLogs(processName: string, tail = 100): AgentLogEntry[] {
  const buf = buffers.get(processName);
  if (!buf) return [];
  return buf.slice(-tail);
}

export function clearLogs(processName: string): void {
  buffers.delete(processName);
}

export function getLogSize(processName: string): number {
  return buffers.get(processName)?.length ?? 0;
}
