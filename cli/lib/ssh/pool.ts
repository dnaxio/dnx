import { SSHConnection, type SSHConnectionOptions } from "./connection.ts";
import { withRetry } from "./retry.ts";
import { logger, spinner } from "../cli/output.ts";

export interface PoolOptions {
  /** Maximum concurrent connections */
  concurrency?: number;
  /** Connection timeout (seconds) */
  timeout?: number;
  /** Retry failed connections */
  retry?: boolean;
}

export interface ExecutionResult {
  server: string;
  host: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  error?: string;
}

const DEFAULTS: Required<PoolOptions> = {
  concurrency: 10,
  timeout: 30,
  retry: true,
};

export class SSHPool {
  private servers: SSHConnectionOptions[];
  private opts: Required<PoolOptions>;

  constructor(servers: SSHConnectionOptions[], opts: PoolOptions = {}) {
    this.servers = servers;
    this.opts = { ...DEFAULTS, ...opts };
  }

  /**
   * Execute a command on all servers in parallel (with concurrency limit).
   */
  async executeAll(command: string): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];
    const queue = [...this.servers];

    const worker = async (server: SSHConnectionOptions): Promise<void> => {
      const conn = new SSHConnection(server);
      try {
        const execFn = async () => {
          await conn.connect();
          return conn.exec(command);
        };

        const result = this.opts.retry
          ? await withRetry(execFn, { maxAttempts: 3 })
          : await execFn();

        results.push({
          server: server.host,
          host: server.host,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        });
      } catch (err) {
        results.push({
          server: server.host,
          host: server.host,
          stdout: "",
          stderr: "",
          exitCode: -1,
          error: (err as Error).message,
        });
      } finally {
        await conn.close();
      }
    };

    // Process in batches
    while (queue.length > 0) {
      const batch = queue.splice(0, this.opts.concurrency);
      await Promise.all(batch.map(worker));
    }

    return results;
  }

  /**
   * Execute a command on all servers and stream output.
   */
  async executeAllStream(
    command: string,
    onOutput?: (server: string, data: string, stderr: boolean) => void,
  ): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];
    const queue = [...this.servers];

    const worker = async (server: SSHConnectionOptions): Promise<void> => {
      const conn = new SSHConnection(server);
      try {
        await conn.connect();
        let stdout = "";
        let stderr = "";

        const result = await conn.execStream(command, (data, isStderr) => {
          if (isStderr) stderr += data;
          else stdout += data;
          onOutput?.(server.host, data, isStderr);
        });

        results.push({
          server: server.host,
          host: server.host,
          stdout,
          stderr,
          exitCode: result.exitCode,
        });
      } catch (err) {
        results.push({
          server: server.host,
          host: server.host,
          stdout: "",
          stderr: "",
          exitCode: -1,
          error: (err as Error).message,
        });
      } finally {
        await conn.close();
      }
    };

    while (queue.length > 0) {
      const batch = queue.splice(0, this.opts.concurrency);
      await Promise.all(batch.map(worker));
    }

    return results;
  }

  /**
   * Test connectivity to all servers.
   */
  async testAll(): Promise<ExecutionResult[]> {
    return this.executeAll("echo OK && hostname");
  }

  /**
   * Upload a file to all servers.
   */
  async uploadAll(
    localPath: string,
    remotePath: string,
  ): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];
    const queue = [...this.servers];

    const worker = async (server: SSHConnectionOptions): Promise<void> => {
      const conn = new SSHConnection(server);
      try {
        await conn.connect();
        await conn.upload(localPath, remotePath);
        results.push({
          server: server.host,
          host: server.host,
          stdout: `Uploadé vers ${remotePath}`,
          stderr: "",
          exitCode: 0,
        });
      } catch (err) {
        results.push({
          server: server.host,
          host: server.host,
          stdout: "",
          stderr: "",
          exitCode: -1,
          error: (err as Error).message,
        });
      } finally {
        await conn.close();
      }
    };

    while (queue.length > 0) {
      const batch = queue.splice(0, this.opts.concurrency);
      await Promise.all(batch.map(worker));
    }

    return results;
  }
}
