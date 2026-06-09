/**
 * Health check probes for apps and services.
 * Supports HTTP, TCP, and command-based checks.
 */

import { logger } from "../cli/output.ts";

export type ProbeType = "http" | "tcp" | "command";

export interface ProbeConfig {
  type: ProbeType;
  endpoint?: string;    // URL for HTTP, host:port for TCP
  command?: string;     // Shell command for command probe
  timeout?: number;     // ms
  interval?: number;    // ms
  retries?: number;     // consecutive failures before unhealthy
  successThreshold?: number; // consecutive successes before healthy
}

export interface ProbeResult {
  success: boolean;
  responseTimeMs: number;
  error?: string;
  statusCode?: number;
}

const DEFAULTS = {
  timeout: 5000,
  retries: 3,
  successThreshold: 2,
};

/**
 * Execute a single health check.
 */
export async function runProbe(config: ProbeConfig): Promise<ProbeResult> {
  const start = Date.now();

  try {
    switch (config.type) {
      case "http":
        return await httpProbe(config);
      case "tcp":
        return await tcpProbe(config);
      case "command":
        return await commandProbe(config);
      default:
        return { success: false, responseTimeMs: 0, error: `Unknown probe type: ${config.type}` };
    }
  } catch (err) {
    return {
      success: false,
      responseTimeMs: Date.now() - start,
      error: (err as Error).message,
    };
  }
}

async function httpProbe(config: ProbeConfig): Promise<ProbeResult> {
  const start = Date.now();
  const url = config.endpoint ?? "http://localhost/health";
  const timeout = config.timeout ?? DEFAULTS.timeout;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return {
      success: resp.status >= 200 && resp.status < 400,
      responseTimeMs: Date.now() - start,
      statusCode: resp.status,
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      success: false,
      responseTimeMs: Date.now() - start,
      error: (err as Error).message,
    };
  }
}

async function tcpProbe(config: ProbeConfig): Promise<ProbeResult> {
  const start = Date.now();
  const target = config.endpoint ?? "localhost:80";
  const [host, portStr] = target.split(":");
  const port = parseInt(portStr ?? "80");
  const timeout = config.timeout ?? DEFAULTS.timeout;

  try {
    const conn = await require("node:net").connect({ host, port, timeout });
    return new Promise((resolve) => {
      conn.on("connect", () => {
        conn.destroy();
        resolve({ success: true, responseTimeMs: Date.now() - start });
      });
      conn.on("error", (err: Error) => {
        resolve({ success: false, responseTimeMs: Date.now() - start, error: err.message });
      });
      conn.on("timeout", () => {
        conn.destroy();
        resolve({ success: false, responseTimeMs: Date.now() - start, error: "TCP timeout" });
      });
    });
  } catch (err) {
    return { success: false, responseTimeMs: Date.now() - start, error: (err as Error).message };
  }
}

async function commandProbe(config: ProbeConfig): Promise<ProbeResult> {
  const start = Date.now();
  const cmd = config.command ?? "exit 0";
  const timeout = config.timeout ?? DEFAULTS.timeout;

  try {
    const proc = Bun.spawn(["sh", "-c", cmd], { stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => proc.kill(), timeout);
    await proc.exited;
    clearTimeout(timer);

    return {
      success: proc.exitCode === 0,
      responseTimeMs: Date.now() - start,
      exitCode: proc.exitCode,
    };
  } catch (err) {
    return { success: false, responseTimeMs: Date.now() - start, error: (err as Error).message };
  }
}

/**
 * Run a health check with retries.
 */
export async function runProbeWithRetries(
  config: ProbeConfig
): Promise<ProbeResult> {
  const maxRetries = config.retries ?? DEFAULTS.retries;
  let lastResult: ProbeResult = { success: false, responseTimeMs: 0 };

  for (let i = 0; i < maxRetries; i++) {
    lastResult = await runProbe(config);
    if (lastResult.success) return lastResult;
    if (i < maxRetries - 1) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  return lastResult;
}
