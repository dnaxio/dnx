/**
 * Heartbeat mechanism for the dnxd agent.
 * Sends periodic heartbeats to the CLI to report agent status.
 * The CLI can poll this endpoint or the agent can push.
 */

import { getAllProcesses } from "./supervisor.ts";
import { AGENT_VERSION, type AgentStatus } from "./protocol.ts";

let startTime = Date.now();
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

export function getStatus(): AgentStatus {
  return {
    agentVersion: AGENT_VERSION,
    uptime: Date.now() - startTime,
    managedProcesses: getAllProcesses(),
  };
}

export function startHeartbeat(
  callback?: (status: AgentStatus) => void,
  intervalMs = 30_000
): void {
  if (heartbeatInterval) return;

  startTime = Date.now();

  heartbeatInterval = setInterval(() => {
    const status = getStatus();
    callback?.(status);
  }, intervalMs);
}

export function stopHeartbeat(): void {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}
