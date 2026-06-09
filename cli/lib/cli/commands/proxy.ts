import { BaseCommand, type CommandContext } from "../command.ts";
import { logger, spinner } from "../output.ts";
import { loadConfig, loadResolvedConfig } from "../../config/loader.ts";
import {
  startCaddy,
  stopCaddy,
  restartCaddy,
  reloadCaddy,
  getCaddyStatus,
  getCaddyLogs,
  installCaddyRemote,
  uploadMergedCaddyfile,
  isCaddyInstalled,
} from "../../proxy/manager.ts";
import { SSHConnection } from "../../ssh/connection.ts";
import type { Server } from "../../config/schema.ts";

function getConnectionFromServer(srv: Server): SSHConnection {
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

export class ProxyStartCommand extends BaseCommand {
  name = "start";
  description = "Start Caddy on servers";
  options = [
    {
      flags: "--env <env>",
      description: "Target environment(s), comma-separated (default: all)",
    },
  ];

  async run(ctx: CommandContext, opts?: Record<string, unknown>) {
    const targetEnv = opts?.env as string | undefined;
    const { config } = loadConfig(ctx.cwd);
    const environments = targetEnv
      ? targetEnv
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean)
      : Object.keys(config.environments);

    for (const env of environments) {
      const resolved = loadResolvedConfig(ctx.cwd, env);
      const servers = resolved.environments[env]?.servers ?? [];
      if (servers.length === 0) continue;

      const newRoutes = (resolved.proxy?.routes ?? []).map((r) => ({
        domain: r.domain,
        target: r.target,
        port: r.port,
        ssl: r.ssl,
      }));

      for (const srv of servers) {
        logger.info(`Deploying Caddy on ${srv.name} (${srv.host})...`);
        const conn = getConnectionFromServer(srv);
        try {
          await conn.connect();
          if (!(await isCaddyInstalled(conn))) {
            await installCaddyRemote(conn);
          }
          await uploadMergedCaddyfile(conn, newRoutes, {
            email: resolved.proxy?.email,
            autoSSL: resolved.proxy?.auto_ssl,
          });
          await startCaddy(conn);
          logger.success(`${srv.name} : Caddy started`);
        } catch (err) {
          logger.error(`${srv.name} : ${(err as Error).message}`);
        } finally {
          await conn.close();
        }
      }
    }
  }
}

export class ProxyStopCommand extends BaseCommand {
  name = "stop";
  description = "Stop Caddy on servers";
  options = [
    {
      flags: "--env <env>",
      description: "Target environment(s), comma-separated (default: all)",
    },
  ];
  async run(ctx: CommandContext, opts?: Record<string, unknown>) {
    const targetEnv = opts?.env as string | undefined;
    const { config } = loadConfig(ctx.cwd);
    const environments = targetEnv
      ? targetEnv
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean)
      : Object.keys(config.environments);
    for (const env of environments) {
      const resolved = loadResolvedConfig(ctx.cwd, env);
      const servers = resolved.environments[env]?.servers ?? [];
      for (const srv of servers) {
        const conn = getConnectionFromServer(srv);
        try {
          await conn.connect();
          await stopCaddy(conn);
          logger.success(`${srv.name} : stopped`);
        } catch (err) {
          logger.error(`${srv.name} : ${(err as Error).message}`);
        } finally {
          await conn.close();
        }
      }
    }
  }
}

export class ProxyRestartCommand extends BaseCommand {
  name = "restart";
  description = "Restart Caddy on servers";
  options = [
    {
      flags: "--env <env>",
      description: "Target environment(s), comma-separated (default: all)",
    },
  ];
  async run(ctx: CommandContext, opts?: Record<string, unknown>) {
    const targetEnv = opts?.env as string | undefined;
    const { config } = loadConfig(ctx.cwd);
    const environments = targetEnv
      ? targetEnv
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean)
      : Object.keys(config.environments);
    for (const env of environments) {
      const resolved = loadResolvedConfig(ctx.cwd, env);
      const servers = resolved.environments[env]?.servers ?? [];
      for (const srv of servers) {
        const conn = getConnectionFromServer(srv);
        try {
          await conn.connect();
          await restartCaddy(conn);
          logger.success(`${srv.name} : restarted`);
        } catch (err) {
          logger.error(`${srv.name} : ${(err as Error).message}`);
        } finally {
          await conn.close();
        }
      }
    }
  }
}

export class ProxyReloadCommand extends BaseCommand {
  name = "reload";
  description = "Regenerate and reload Caddy config (merge + zero-downtime)";
  options = [
    {
      flags: "--env <env>",
      description: "Target environment(s), comma-separated (default: all)",
    },
  ];
  async run(ctx: CommandContext, opts?: Record<string, unknown>) {
    const targetEnv = opts?.env as string | undefined;
    const { config } = loadConfig(ctx.cwd);
    const environments = targetEnv
      ? targetEnv
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean)
      : Object.keys(config.environments);
    for (const env of environments) {
      const resolved = loadResolvedConfig(ctx.cwd, env);
      const servers = resolved.environments[env]?.servers ?? [];
      if (servers.length === 0) continue;

      const newRoutes = (resolved.proxy?.routes ?? []).map((r) => ({
        domain: r.domain,
        target: r.target,
        port: r.port,
        ssl: r.ssl,
      }));

      for (const srv of servers) {
        const conn = getConnectionFromServer(srv);
        try {
          await conn.connect();
          if (!(await isCaddyInstalled(conn))) {
            await installCaddyRemote(conn);
          }
          await uploadMergedCaddyfile(conn, newRoutes, {
            email: resolved.proxy?.email,
            autoSSL: resolved.proxy?.auto_ssl,
          });
          await reloadCaddy(conn);
          logger.success(`${srv.name} : reloaded`);
        } catch (err) {
          logger.error(`${srv.name} : ${(err as Error).message}`);
        } finally {
          await conn.close();
        }
      }
    }
  }
}

export class ProxyStatusCommand extends BaseCommand {
  name = "status";
  description = "Show Caddy status";
  options = [
    {
      flags: "--env <env>",
      description: "Target environment(s), comma-separated (default: all)",
    },
  ];
  async run(ctx: CommandContext, opts?: Record<string, unknown>) {
    const targetEnv = opts?.env as string | undefined;
    const { config } = loadConfig(ctx.cwd);
    const environments = targetEnv
      ? targetEnv
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean)
      : Object.keys(config.environments);
    for (const env of environments) {
      const resolved = loadResolvedConfig(ctx.cwd, env);
      const servers = resolved.environments[env]?.servers ?? [];
      for (const srv of servers) {
        const conn = getConnectionFromServer(srv);
        try {
          await conn.connect();
          const status = await getCaddyStatus(conn);
          logger.keyValue(
            srv.name,
            status.installed
              ? `${status.version} — ${status.running ? "RUNNING" : "STOPPED"}`
              : "Not installed",
          );
        } catch (err) {
          logger.keyValue(srv.name, `ERROR: ${(err as Error).message}`);
        } finally {
          await conn.close();
        }
      }
    }
  }
}

export class ProxyLogsCommand extends BaseCommand {
  name = "logs";
  description = "Show Caddy logs";
  args = [{ name: "server", description: "Server name", required: true }];
  options = [
    { flags: "-f, --follow", description: "Follow output" },
    {
      flags: "-n, --lines <n>",
      description: "Number of lines",
      defaultValue: "50",
    },
  ];
  async run(
    ctx: CommandContext,
    serverName?: string,
    opts?: Record<string, unknown>,
  ) {
    if (!serverName) {
      logger.error("Usage : dnx proxy logs <server>");
      process.exit(1);
    }
    const { config } = loadConfig(ctx.cwd);
    const allServers = Object.values(config.environments).flatMap(
      (e) => e.servers,
    );
    const srv = allServers.find((s) => s.name === serverName);
    if (!srv) {
      logger.error(`Server "${serverName}" not found.`);
      process.exit(1);
    }
    const conn = getConnectionFromServer(srv);
    try {
      await conn.connect();
      await getCaddyLogs(
        conn,
        parseInt((opts?.lines as string) ?? "50"),
        !!opts?.follow,
      );
    } finally {
      await conn.close();
    }
  }
}

export class ProxyRouteListCommand extends BaseCommand {
  name = "list";
  description = "List configured proxy routes";
  options = [];
  async run(ctx: CommandContext) {
    const { config } = loadConfig(ctx.cwd);
    const routes = config.proxy?.routes ?? [];
    if (ctx.json) {
      console.log(JSON.stringify(routes, null, 2));
      return;
    }
    if (routes.length === 0) {
      logger.info("No routes configured.");
      return;
    }
    logger.section("Proxy routes:");
    for (const r of routes) {
      logger.keyValue(
        r.domain,
        `${r.target}:${r.port} (${r.lb_policy ?? "direct"}) ${r.ssl ? "🔒" : "🔓"}`,
      );
    }
  }
}

export class ProxyRouteAddCommand extends BaseCommand {
  name = "add";
  description = "Add a proxy route";
  args = [
    { name: "domain", required: true },
    { name: "target", required: true },
  ];
  options = [
    {
      flags: "-p, --port <port>",
      description: "Target port",
      defaultValue: "3000",
    },
  ];
  async run(
    ctx: CommandContext,
    domain?: string,
    target?: string,
    opts?: Record<string, unknown>,
  ) {
    if (!domain || !target) {
      logger.error("Usage : dnx proxy route add <domain> <target>");
      process.exit(1);
    }
    logger.info(`Route added: ${domain} → ${target}:${opts?.port ?? 3000}`);
    logger.warn("To persist, add the route in your dnx.yaml → proxy.routes");
  }
}

export class ProxyRouteRemoveCommand extends BaseCommand {
  name = "remove";
  description = "Remove a proxy route";
  args = [{ name: "domain", required: true }];
  options = [];
  async run(ctx: CommandContext, domain?: string) {
    if (!domain) {
      logger.error("Usage : dnx proxy route remove <domain>");
      process.exit(1);
    }
    logger.info(`Route "${domain}" marked for removal.`);
    logger.warn("Remove it from your dnx.yaml → proxy.routes");
  }
}

export class ProxySSLStatusCommand extends BaseCommand {
  name = "ssl";
  description = "Show SSL certificate status";
  options = [{ flags: "--env <env>", description: "Environment" }];
  async run(ctx: CommandContext) {
    const { config } = loadConfig(ctx.cwd);
    const routes = config.proxy?.routes ?? [];
    logger.section("SSL status:");
    for (const r of routes) {
      const managed = r.ssl !== false ? "Auto (Let's Encrypt)" : "Disabled";
      logger.keyValue(r.domain, managed);
    }
  }
}

export class ProxyCommand extends BaseCommand {
  name = "proxy";
  description = "Manage Caddy proxy (reverse proxy + load balancing + SSL)";
  options = [];
  subcommands = [
    new ProxyStartCommand(),
    new ProxyStopCommand(),
    new ProxyRestartCommand(),
    new ProxyReloadCommand(),
    new ProxyStatusCommand(),
    new ProxyLogsCommand(),
    new ProxyRouteListCommand(),
    new ProxyRouteAddCommand(),
    new ProxyRouteRemoveCommand(),
    new ProxySSLStatusCommand(),
  ];
  async run(_ctx: CommandContext) {}
}
