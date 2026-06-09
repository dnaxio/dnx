import { BaseCommand, type CommandContext } from "../command.ts";
import { logger, spinner } from "../output.ts";
import { loadConfig } from "../../config/loader.ts";
import { SSHConnection } from "../../ssh/connection.ts";
import { SSHPool } from "../../ssh/pool.ts";
import {
  remoteStart,
  remoteStop,
  remoteRestart,
  getRemoteStatus,
  streamLogs,
} from "../../app/process.ts";
import type { Server } from "../../config/schema.ts";
import { formatPorts } from "../../utils/docker.ts";

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

export class WorkloadStartCommand extends BaseCommand {
  name = "start";
  description = "Start a workload";
  args = [{ name: "workload", description: "Workload name", required: true }];
  options = [
    {
      flags: "--env <env>",
      description: "Environment",
      defaultValue: "staging",
    },
  ];
  async run(
    ctx: CommandContext,
    workloadName?: string,
    opts?: Record<string, unknown>,
  ) {
    if (!workloadName) {
      logger.error("Usage: dnx workload start <name>");
      process.exit(1);
    }
    const env = (opts?.env as string) ?? "staging";
    const { config } = loadConfig(ctx.cwd, env);
    const workload = config.workloads.find((w) => w.name === workloadName);
    if (!workload) {
      logger.error(`Workload "${workloadName}" not found.`);
      process.exit(1);
    }
    const servers =
      config.environments[env as "staging" | "test" | "production"]?.servers ??
      [];

    const pool = new SSHPool(
      servers.map((s) => ({ host: s.host, port: s.port, username: s.user })),
    );
    await pool.executeAll(
      `docker start ${workloadName} 2>/dev/null || ` +
        `nohup bash $HOME/.dnx/workloads/${workloadName}/current/dnx-start.sh > $HOME/.dnx/workloads/${workloadName}/app.log 2>&1 & sleep 1; ` +
        `cat $HOME/.dnx/workloads/${workloadName}/app.pid 2>/dev/null && echo " STARTED" || echo " FAILED"`,
    );
  }
}

export class WorkloadStopCommand extends BaseCommand {
  name = "stop";
  description = "Stop a workload";
  args = [{ name: "workload", required: true }];
  options = [{ flags: "--env <env>", defaultValue: "staging" }];
  async run(
    ctx: CommandContext,
    workloadName?: string,
    opts?: Record<string, unknown>,
  ) {
    if (!workloadName) {
      logger.error("Usage: dnx workload stop <name>");
      process.exit(1);
    }
    const env = (opts?.env as string) ?? "staging";
    const { config } = loadConfig(ctx.cwd, env);
    const servers =
      config.environments[env as "staging" | "test" | "production"]?.servers ??
      [];
    const pool = new SSHPool(
      servers.map((s) => ({ host: s.host, port: s.port, username: s.user })),
    );
    const results = await pool.executeAll(
      `docker stop ${workloadName} 2>/dev/null; PID=$(cat $HOME/.dnx/workloads/${workloadName}/app.pid 2>/dev/null); [ -n "$PID" ] && kill -TERM "$PID" 2>/dev/null && echo "STOPPED" || echo "NOT_RUNNING"; rm -f $HOME/.dnx/workloads/${workloadName}/app.pid`,
    );
    for (const r of results) logger.keyValue(r.host, r.stdout.trim());
  }
}

export class WorkloadRestartCommand extends BaseCommand {
  name = "restart";
  description = "Restart a workload";
  args = [{ name: "workload", required: true }];
  options = [{ flags: "--env <env>", defaultValue: "staging" }];
  async run(
    ctx: CommandContext,
    workloadName?: string,
    opts?: Record<string, unknown>,
  ) {
    if (!workloadName) {
      logger.error("Usage: dnx workload restart <name>");
      process.exit(1);
    }
    const env = (opts?.env as string) ?? "staging";
    const { config } = loadConfig(ctx.cwd, env);
    const servers =
      config.environments[env as "staging" | "test" | "production"]?.servers ??
      [];
    const pool = new SSHPool(
      servers.map((s) => ({ host: s.host, port: s.port, username: s.user })),
    );
    await pool.executeAll(
      `docker restart ${workloadName} 2>/dev/null || (PID=$(cat $HOME/.dnx/workloads/${workloadName}/app.pid 2>/dev/null); [ -n "$PID" ] && kill -TERM "$PID" 2>/dev/null; sleep 2; nohup bash $HOME/.dnx/workloads/${workloadName}/current/dnx-start.sh > $HOME/.dnx/workloads/${workloadName}/app.log 2>&1 & echo "RESTARTED")`,
    );
    logger.success(`${workloadName} restarted on ${servers.length} server(s)`);
  }
}

export class WorkloadStatusCommand extends BaseCommand {
  name = "status";
  description = "Show workload status";
  args = [{ name: "workload", required: true }];
  options = [{ flags: "--env <env>", defaultValue: "staging" }];
  async run(
    ctx: CommandContext,
    workloadName?: string,
    opts?: Record<string, unknown>,
  ) {
    if (!workloadName) {
      logger.error("Usage: dnx workload status <name>");
      process.exit(1);
    }
    const env = (opts?.env as string) ?? "staging";
    const { config } = loadConfig(ctx.cwd, env);
    const wl = config.workloads.find((w) => w.name === workloadName);
    const wlType = wl?.type ?? "-";
    const servers =
      config.environments[env as "staging" | "test" | "production"]?.servers ??
      [];
    const pool = new SSHPool(
      servers.map((s) => ({
        host: s.host,
        port: s.port,
        username: s.user,
        password: s.password,
      })),
    );
    const results = await pool.executeAll(
      `docker ps --filter name=${workloadName} --format '{{.Names}}|{{.Status}}|{{.Image}}|{{.Ports}}' 2>/dev/null || echo "-|STOPPED|-|-"`,
    );
    const statsResults = await pool.executeAll(
      `docker stats --no-stream ${workloadName} 2>/dev/null | tail -1 | awk '{print $3, $4}' || echo "- -"`,
    );

    if (ctx.json) {
      console.log(JSON.stringify(results));
      return;
    }

    const rows: string[][] = [
      ["Server", "Env", "Type", "Status", "CPU", "RAM", "Tag", "Name", "Ports"],
    ];
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      const s = statsResults[i]!;
      const parts = r.stdout.trim().split("|");
      const statsParts = s.stdout.trim().split(/\s+/);
      const name = parts[0] !== "-" ? parts[0]! : "-";
      const status = parts[1] || "STOPPED";
      const image = parts[2] || "-";
      const tag = image.includes(":") ? image.split(":").pop()! : image;
      const ports = formatPorts(parts[3] || "-");
      const cpu = statsParts[0] || "-";
      const ram = statsParts[1] || "-";
      const icon = status.startsWith("Up") ? "🟢" : "🔴";
      rows.push([
        r.host,
        env,
        wlType,
        `${icon} ${status}`,
        cpu,
        ram,
        tag,
        name,
        ports,
      ]);
    }
    logger.table(rows);
  }
}

export class WorkloadLogsCommand extends BaseCommand {
  name = "logs";
  description = "Show workload logs";
  args = [{ name: "workload", required: true }];
  options = [
    { flags: "--env <env>", defaultValue: "staging" },
    { flags: "--server <name>", description: "Specific server" },
    { flags: "-f, --follow", description: "Follow output" },
    {
      flags: "-n, --tail <n>",
      description: "Last N lines",
      defaultValue: "100",
    },
    { flags: "--grep <pattern>", description: "Filter" },
  ];
  async run(
    ctx: CommandContext,
    workloadName?: string,
    opts?: Record<string, unknown>,
  ) {
    if (!workloadName) {
      logger.error("Usage: dnx workload logs <name>");
      process.exit(1);
    }
    const env = (opts?.env as string) ?? "staging";
    const { config } = loadConfig(ctx.cwd, env);
    const servers =
      config.environments[env as "staging" | "test" | "production"]?.servers ??
      [];
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
      // Try docker logs first, fall back to file
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

export class WorkloadRemoveCommand extends BaseCommand {
  name = "remove";
  description = "Remove a workload";
  args = [{ name: "workload", required: true }];
  options = [
    { flags: "--env <env>", defaultValue: "staging" },
    { flags: "--force", description: "Skip confirmation" },
  ];
  async run(
    ctx: CommandContext,
    workloadName?: string,
    opts?: Record<string, unknown>,
  ) {
    if (!workloadName) {
      logger.error("Usage: dnx workload remove <name>");
      process.exit(1);
    }
    if (!opts?.force) {
      logger.warn(`⚠  This will remove "${workloadName}" from all servers.`);
      logger.info("Use --force to confirm.");
      process.exit(1);
    }
    const env = (opts?.env as string) ?? "staging";
    const { config } = loadConfig(ctx.cwd, env);
    const servers =
      config.environments[env as "staging" | "test" | "production"]?.servers ??
      [];
    const pool = new SSHPool(
      servers.map((s) => ({ host: s.host, port: s.port, username: s.user })),
    );
    await pool.executeAll(
      `docker stop ${workloadName} 2>/dev/null; docker rm ${workloadName} 2>/dev/null; ` +
        `pkill -f "dnx-start.sh" 2>/dev/null || true; ` +
        `rm -rf $HOME/.dnx/workloads/${workloadName}`,
    );
    logger.success(`${workloadName} removed from ${servers.length} server(s)`);
  }
}

export class WorkloadCommand extends BaseCommand {
  name = "workload";
  description = "Manage workload lifecycle";
  options = [];
  subcommands = [
    new WorkloadStartCommand(),
    new WorkloadStopCommand(),
    new WorkloadRestartCommand(),
    new WorkloadStatusCommand(),
    new WorkloadLogsCommand(),
    new WorkloadRemoveCommand(),
  ];
  async run(_ctx: CommandContext) {}
}
