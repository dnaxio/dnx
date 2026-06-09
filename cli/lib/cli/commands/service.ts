import { BaseCommand, type CommandContext } from "../command.ts";
import { logger } from "../output.ts";
import { loadConfig } from "../../config/loader.ts";
import { SSHPool } from "../../ssh/pool.ts";

export class ServiceStartCommand extends BaseCommand {
  name = "start";
  description = "Start a service workload";
  args = [{ name: "name", required: true }];
  options = [{ flags: "--env <env>", defaultValue: "staging" }];
  async run(
    ctx: CommandContext,
    name?: string,
    opts?: Record<string, unknown>,
  ) {
    if (!name) {
      logger.error("Usage: dnx service start <name>");
      process.exit(1);
    }
    const env = (opts?.env as string) ?? "staging";
    const { config } = loadConfig(ctx.cwd, env);
    const wl = config.workloads.find((w) => w.name === name);
    if (!wl) {
      logger.error(`Workload "${name}" not found.`);
      process.exit(1);
    }
    const servers =
      config.environments[env as "staging" | "test" | "production"]?.servers ??
      [];
    const pool = new SSHPool(
      servers.map((s) => ({ host: s.host, port: s.port, username: s.user })),
    );
    if (wl.image) {
      const portFlags = (wl.ports ?? []).map((p) => `-p ${p}:${p}`).join(" ");
      const volumeFlags = (wl.volumes ?? []).map((v) => `-v ${v}`).join(" ");
      await pool.executeAll(
        `docker network create dnx 2>/dev/null; docker run -d --name ${name} --network dnx --restart ${wl.restart ?? "no"} ${portFlags} ${volumeFlags} ${wl.image} 2>/dev/null || docker start ${name}`,
      );
    } else {
      await pool.executeAll(
        `docker start ${name} 2>/dev/null || echo "No image configured for ${name}"`,
      );
    }
    logger.success(`${name} started on ${servers.length} server(s)`);
  }
}

export class ServiceStopCommand extends BaseCommand {
  name = "stop";
  description = "Stop a service workload";
  args = [{ name: "name", required: true }];
  options = [{ flags: "--env <env>", defaultValue: "staging" }];
  async run(
    ctx: CommandContext,
    name?: string,
    opts?: Record<string, unknown>,
  ) {
    if (!name) {
      logger.error("Usage: dnx service stop <name>");
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
    await pool.executeAll(`docker stop ${name} 2>/dev/null || true`);
    logger.success(`${name} stopped on ${servers.length} server(s)`);
  }
}

export class ServiceStatusCommand extends BaseCommand {
  name = "status";
  description = "Show service workload status";
  args = [{ name: "name", required: true }];
  options = [{ flags: "--env <env>", defaultValue: "staging" }];
  async run(
    ctx: CommandContext,
    name?: string,
    opts?: Record<string, unknown>,
  ) {
    if (!name) {
      logger.error("Usage: dnx service status <name>");
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
      `docker ps --filter name=${name} --format '{{.Status}}' 2>/dev/null || echo "stopped"`,
    );
    for (const r of results) logger.keyValue(r.host, r.stdout.trim());
  }
}

export class ServiceLogsCommand extends BaseCommand {
  name = "logs";
  description = "Show service workload logs";
  args = [{ name: "name", required: true }];
  options = [
    { flags: "--env <env>", defaultValue: "staging" },
    { flags: "-f, --follow" },
    { flags: "-n, --tail <n>", defaultValue: "100" },
    { flags: "--server <name>" },
  ];
  async run(
    ctx: CommandContext,
    name?: string,
    opts?: Record<string, unknown>,
  ) {
    if (!name) {
      logger.error("Usage: dnx service logs <name>");
      process.exit(1);
    }
    const env = (opts?.env as string) ?? "staging";
    const { config } = loadConfig(ctx.cwd, env);
    const servers =
      config.environments[env as "staging" | "test" | "production"]?.servers ??
      [];
    const srv = servers.find((s) => s.name === opts?.server) ?? servers[0];
    if (!srv) {
      logger.error("No server found.");
      process.exit(1);
    }
    const pool = new SSHPool([
      { host: srv.host, port: srv.port, username: srv.user },
    ]);
    const follow = opts?.follow ? "-f" : "";
    await pool.executeAllStream(
      `docker logs ${follow} --tail ${opts?.tail ?? 100} ${name} 2>/dev/null || echo "No logs for ${name}"`,
      (host, data, stderr) => {
        if (stderr) process.stderr.write(`[${host}] ${data}`);
        else process.stdout.write(`[${host}] ${data}`);
      },
    );
  }
}

export class ServiceRemoveCommand extends BaseCommand {
  name = "remove";
  description = "Remove a service workload";
  args = [{ name: "name", required: true }];
  options = [
    { flags: "--env <env>", defaultValue: "staging" },
    { flags: "--force" },
  ];
  async run(
    ctx: CommandContext,
    name?: string,
    opts?: Record<string, unknown>,
  ) {
    if (!name) {
      logger.error("Usage: dnx service remove <name>");
      process.exit(1);
    }
    if (!opts?.force) {
      logger.warn("Use --force to confirm.");
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
      `docker stop ${name} 2>/dev/null; docker rm ${name} 2>/dev/null || true`,
    );
    logger.success(`${name} removed from ${servers.length} server(s)`);
  }
}

export class ServiceCommand extends BaseCommand {
  name = "service";
  description = "Manage service workloads (DB, Redis, etc.)";
  options = [];
  subcommands = [
    new ServiceStartCommand(),
    new ServiceStopCommand(),
    new ServiceStatusCommand(),
    new ServiceLogsCommand(),
    new ServiceRemoveCommand(),
  ];
  async run(_ctx: CommandContext) {}
}
