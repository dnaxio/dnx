import { Client, type ConnectConfig } from "ssh2";
import { logger } from "../cli/output.ts";

export interface SSHConnectionOptions {
  host: string;
  port?: number;
  username?: string;
  privateKey?: string;
  passphrase?: string;
  password?: string;
  fingerprint?: string;
  timeout?: number;
}

export class SSHConnection {
  private client: Client;
  private opts: SSHConnectionOptions;
  private _connected = false;

  constructor(opts: SSHConnectionOptions) {
    this.opts = opts;
    this.client = new Client();
  }

  get connected(): boolean {
    return this._connected;
  }

  async connect(): Promise<void> {
    if (this._connected) return;

    const config: ConnectConfig = {
      host: this.opts.host,
      port: this.opts.port ?? 22,
      username: this.opts.username ?? "root",
      readyTimeout: (this.opts.timeout ?? 30) * 1000,
    };

    if (this.opts.privateKey) {
      config.privateKey = this.opts.privateKey;
      if (this.opts.passphrase) config.passphrase = this.opts.passphrase;
    } else {
      // Try SSH agent first
      if (process.env.SSH_AUTH_SOCK) {
        config.agent = process.env.SSH_AUTH_SOCK;
      }
      // Fallback: try default keys
      const { existsSync, readFileSync } = require("node:fs");
      const { homedir } = require("node:os");
      const defaultKeys = [
        `${homedir()}/.ssh/id_ed25519`,
        `${homedir()}/.ssh/id_rsa`,
        `${homedir()}/.ssh/id_ecdsa`,
      ];
      for (const keyPath of defaultKeys) {
        if (existsSync(keyPath)) {
          config.privateKey = readFileSync(keyPath, "utf-8");
          break;
        }
      }
    }

    // Password auth as additional method
    if (this.opts.password) {
      config.password = this.opts.password;
    }

    return new Promise((resolve, reject) => {
      this.client.once("ready", () => {
        this._connected = true;
        resolve();
      });

      this.client.once("error", (err) => {
        this._connected = false;
        reject(err);
      });

      this.client.connect(config);
    });
  }

  async exec(
    command: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    await this.ensureConnected();

    return new Promise((resolve, reject) => {
      this.client.exec(command, (err, stream) => {
        if (err) return reject(err);

        let stdout = "";
        let stderr = "";

        stream.on("data", (data: Buffer) => {
          stdout += data.toString();
        });

        stream.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });

        stream.on("close", (code: number | null) => {
          resolve({
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode: code ?? -1,
          });
        });

        stream.on("error", reject);
      });
    });
  }

  async execStream(
    command: string,
    onData?: (data: string, stderr: boolean) => void,
  ): Promise<{ exitCode: number }> {
    await this.ensureConnected();

    return new Promise((resolve, reject) => {
      this.client.exec(command, (err, stream) => {
        if (err) return reject(err);

        stream.on("data", (data: Buffer) => {
          onData?.(data.toString(), false);
        });

        stream.stderr.on("data", (data: Buffer) => {
          onData?.(data.toString(), true);
        });

        stream.on("close", (code: number | null) => {
          resolve({ exitCode: code ?? -1 });
        });

        stream.on("error", reject);
      });
    });
  }

  async exists(remotePath: string): Promise<boolean> {
    const result = await this.exec(
      `test -e "${remotePath}" && echo "EXISTS" || echo "NOT_FOUND"`,
    );
    return result.stdout.includes("EXISTS");
  }

  async mkdir(remotePath: string, recursive = true): Promise<void> {
    const flag = recursive ? "-p" : "";
    const result = await this.exec(`mkdir ${flag} "${remotePath}"`);
    if (result.exitCode !== 0 && result.stderr) {
      throw new Error(`Impossible de créer le dossier : ${result.stderr}`);
    }
  }

  /**
   * Upload a local file or buffer to a remote path using SFTP.
   */
  async upload(localPath: string, remotePath: string): Promise<void>;
  async upload(content: Buffer, remotePath: string): Promise<void>;
  async upload(source: string | Buffer, remotePath: string): Promise<void> {
    await this.ensureConnected();

    return new Promise((resolve, reject) => {
      this.client.sftp((err, sftp) => {
        if (err) return reject(err);

        const writeStream = sftp.createWriteStream(remotePath);

        writeStream.on("close", () => {
          resolve();
        });

        writeStream.on("error", reject);

        if (typeof source === "string") {
          const fs = require("node:fs");
          fs.createReadStream(source).pipe(writeStream);
        } else {
          writeStream.end(source);
        }
      });
    });
  }

  /**
   * Download a remote file.
   */
  async download(remotePath: string, localPath: string): Promise<void> {
    await this.ensureConnected();

    return new Promise((resolve, reject) => {
      this.client.sftp((err, sftp) => {
        if (err) return reject(err);

        sftp.fastGet(remotePath, localPath, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    });
  }

  async close(): Promise<void> {
    if (this._connected) {
      this.client.end();
      this._connected = false;
    }
  }

  getRawClient(): Client {
    return this.client;
  }

  private async ensureConnected(): Promise<void> {
    if (!this._connected) {
      await this.connect();
    }
  }
}
