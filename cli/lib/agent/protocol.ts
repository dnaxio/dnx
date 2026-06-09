/**
 * Shared types for CLI ↔ Agent communication.
 * Protocol: JSON-RPC 2.0 over HTTP (localhost).
 */

export interface AgentRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params: Record<string, unknown>;
}

export interface AgentResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

export interface AgentDeployParams {
  appName: string;
  version: string;
  releasePath: string;
  startCmd: string;
  envVars: Record<string, string>;
  ports: number[];
}

export interface AgentProcessInfo {
  name: string;
  pid: number;
  status: "running" | "stopped" | "failed";
  uptime: number;
  cpu?: number;
  memory?: number;
  restartCount: number;
}

export interface AgentLogEntry {
  timestamp: string;
  level: "stdout" | "stderr";
  message: string;
}

export interface AgentStatus {
  agentVersion: string;
  uptime: number;
  managedProcesses: AgentProcessInfo[];
}

export const AGENT_PORT = 9876;
export const AGENT_HOST = "127.0.0.1";
export const AGENT_VERSION = "0.1.0";
