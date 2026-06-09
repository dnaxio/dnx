import { BaseCommand, type CommandContext } from "../command.ts";
import { logger } from "../output.ts";
import { loadConfig } from "../../config/loader.ts";
import { SSHConnection } from "../../ssh/connection.ts";
import type { Server } from "../../config/schema.ts";

function getConn(srv: Server): SSHConnection {
  return new SSHConnection({
    host: srv.host,
    port: srv.port ?? 22,
    username: srv.user ?? "root",
    password: srv.password,
    privateKey: srv.key_path
      ? require("node:fs").readFileSync(srv.key_path, "utf-8")
      : undefined,
  });
}

export class LogsCommand extends BaseCommand {
  override name = "logs";
  override description = "Show workload logs";
  override args = [{ name: "workload", description: "Workload name", required: true }];
  override options = [
    { flags: "--env <env>", description: "Environment", defaultValue: "staging" },
    { flags: "--server <name>", description: "Specific server" },
    { flags: "-f, --follow", description: "Follow output" },
    { flags: "-n, --tail <n>", description: "Last N lines", defaultValue: "100" },
    { flags: "--grep <pattern>", description: "Filter pattern" },
  ];

  override async run(
    ctx: CommandContext,
    workloadName?: string,
    opts?: Record<string, unknown>,
  ) {
    if (!workloadName) {
      logger.error("Usage: dnx logs <workload>");
      process.exit(1);
    }

    const env = (opts?.env as string) ?? "staging";
    const { config } = loadConfig(ctx.cwd, env);
    const servers =
      config.environments[env as "staging" | "test" | "production"]?.servers ?? [];

    const targetSrv = opts?.server
      ? servers.find((s) => s.name === opts.server)
      : servers[0];

    if (!targetSrv) {
      logger.error("No server found.");
      process.exit(1);
    }

    const conn = getConn(targetSrv);
    try {
      await conn.connect();
      const n = parseInt((opts?.tail as string) ?? "100");
      const follow = opts?.follow ? "-f" : "";
      const cmd =
        `(docker logs ${follow} --tail ${n} ${workloadName} 2>/dev/null || ` +
        `tail ${follow} -n ${n} $HOME/.dnx/workloads/${workloadName}/app.log 2>/dev/null) ` +
        (opts?.grep ? `| grep "${opts.grep}"` : "");
      await conn.execStream(cmd, (data, stderr) => {
        if (stderr) process.stderr.write(data);
        else process.stdout.write(data);
      });
    } finally {
      await conn.close();
    }
  }
}
