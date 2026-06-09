/**
 * HTTP client to communicate with a remote dnxd agent.
 * The CLI tunnels to the agent via SSH port-forward or direct HTTP.
 */

import type { SSHConnection } from "../ssh/connection.ts";
import { AGENT_PORT, AGENT_HOST, type AgentRequest, type AgentResponse, type AgentProcessInfo, type AgentLogEntry, type AgentStatus } from "./protocol.ts";

export class AgentClient {
  private conn: SSHConnection | null;
  private directBaseUrl: string | null;

  constructor(opts: { sshConnection?: SSHConnection; directUrl?: string }) {
    this.conn = opts.sshConnection ?? null;
    this.directBaseUrl = opts.directUrl ?? null;
  }

  /**
   * Send a JSON-RPC request to the agent.
   * If connected via SSH, tunnels through SSH exec.
   * If direct URL, uses HTTP fetch.
   */
  private async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const request: AgentRequest = {
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    };

    if (this.conn) {
      // Via SSH exec
      const curlCmd = `curl -s -X POST http://${AGENT_HOST}:${AGENT_PORT} -H 'Content-Type: application/json' -d '${JSON.stringify(request).replace(/'/g, "'\\''")}'`;
      const result = await this.conn.exec(curlCmd);
      const response = JSON.parse(result.stdout) as AgentResponse;
      if (response.error) throw new Error(response.error.message);
      return response.result;
    } else if (this.directBaseUrl) {
      const resp = await fetch(`${this.directBaseUrl}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
      const json = await resp.json() as AgentResponse;
      if (json.error) throw new Error(json.error.message);
      return json.result;
    }

    throw new Error("No agent connection available.");
  }

  async ping(): Promise<boolean> {
    const result = await this.send("ping") as { pong: boolean };
    return result.pong;
  }

  async status(): Promise<AgentStatus> {
    return this.send("status") as Promise<AgentStatus>;
  }

  async deploy(params: {
    appName: string;
    version: string;
    releasePath: string;
    startCmd: string;
    envVars: Record<string, string>;
    ports: number[];
  }): Promise<{ pid: number }> {
    return this.send("deploy", params as unknown as Record<string, unknown>) as Promise<{ pid: number }>;
  }

  async start(name: string): Promise<{ pid: number }> {
    return this.send("start", { name }) as Promise<{ pid: number }>;
  }

  async stop(name: string, graceful = true): Promise<void> {
    await this.send("stop", { name, graceful });
  }

  async restart(name: string): Promise<{ pid: number }> {
    return this.send("restart", { name }) as Promise<{ pid: number }>;
  }

  async processInfo(name: string): Promise<AgentProcessInfo | null> {
    return this.send("processInfo", { name }) as Promise<AgentProcessInfo | null>;
  }

  async processes(): Promise<AgentProcessInfo[]> {
    return this.send("processes") as Promise<AgentProcessInfo[]>;
  }

  async logs(name: string, tail = 100): Promise<AgentLogEntry[]> {
    return this.send("logs", { name, tail }) as Promise<AgentLogEntry[]>;
  }

  async clearLogs(name: string): Promise<void> {
    await this.send("clearLogs", { name });
  }
}
