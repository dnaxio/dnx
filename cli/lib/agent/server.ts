/**
 * HTTP server for the dnxd agent.
 * Listens on localhost:AGENT_PORT for JSON-RPC requests from the CLI.
 */

import {
  AGENT_PORT,
  AGENT_HOST,
  type AgentRequest,
  type AgentResponse,
} from "./protocol.ts";
import {
  registerProcess,
  startProcess,
  stopProcess,
  restartProcess,
  getProcessInfo,
  getAllProcesses,
} from "./supervisor.ts";
import { getLogs, clearLogs } from "./logbuffer.ts";
import { getStatus, startHeartbeat } from "./heartbeat.ts";

function jsonResponse(body: AgentResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleRequest(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return jsonResponse(
      { jsonrpc: "2.0", id: 0, error: { code: -32600, message: "Only POST" } },
      405
    );
  }

  let body: AgentRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse(
      { jsonrpc: "2.0", id: 0, error: { code: -32700, message: "Parse error" } },
      400
    );
  }

  try {
    const result = await handleMethod(body.method, body.params);
    return jsonResponse({ jsonrpc: "2.0", id: body.id, result });
  } catch (err) {
    return jsonResponse({
      jsonrpc: "2.0",
      id: body.id,
      error: { code: -32000, message: (err as Error).message },
    });
  }
}

async function handleMethod(
  method: string,
  params: Record<string, unknown>
): Promise<unknown> {
  switch (method) {
    case "ping":
      return { pong: true, version: "0.1.0" };

    case "status":
      return getStatus();

    case "register": {
      registerProcess(params as Parameters<typeof registerProcess>[0]);
      return { ok: true };
    }

    case "start": {
      const name = params.name as string;
      if (!name) throw new Error("Missing param: name");
      return startProcess(name);
    }

    case "stop": {
      const name = params.name as string;
      if (!name) throw new Error("Missing param: name");
      stopProcess(name, params.graceful !== false);
      return { ok: true };
    }

    case "restart": {
      const name = params.name as string;
      if (!name) throw new Error("Missing param: name");
      return restartProcess(name);
    }

    case "processInfo": {
      const name = params.name as string;
      if (!name) throw new Error("Missing param: name");
      return getProcessInfo(name) ?? { error: "not found" };
    }

    case "processes":
      return getAllProcesses();

    case "logs": {
      const name = params.name as string;
      const tail = (params.tail as number) ?? 100;
      if (!name) throw new Error("Missing param: name");
      return getLogs(name, tail);
    }

    case "clearLogs": {
      const name = params.name as string;
      if (!name) throw new Error("Missing param: name");
      clearLogs(name);
      return { ok: true };
    }

    case "deploy": {
      const { appName, version, releasePath, startCmd, envVars, ports } =
        params as Record<string, unknown>;
      if (!appName || !startCmd) throw new Error("Missing required params");

      const name = `app-${appName}`;
      registerProcess({
        name,
        startCmd: startCmd as string,
        envVars: envVars as Record<string, string>,
        cwd: releasePath as string,
      });
      return startProcess(name);
    }

    default:
      throw new Error(`Unknown method: ${method}`);
  }
}

/**
 * Start the agent HTTP server.
 */
export function startAgentServer(port = AGENT_PORT): void {
  const server = Bun.serve({
    port,
    hostname: AGENT_HOST,
    fetch: handleRequest,
  });

  startHeartbeat();

  console.log(`dnxd agent v0.1.0 listening on ${AGENT_HOST}:${port}`);
}

// If run directly, start the server
if (import.meta.main) {
  startAgentServer();
}
