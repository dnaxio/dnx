import { BaseCommand, type CommandContext } from "../command.ts";
import { logger, spinner } from "../output.ts";
import { loadConfig } from "../../config/loader.ts";
import { loadKey } from "../../secrets/keyring.ts";
import {
  generateCaddyfile,
  generateSimpleCaddyfile,
  generateLBConfig,
  parseCaddyfile,
  type CaddyRoute,
} from "../../proxy/caddyfile.ts";
import {
  startCaddy,
  stopCaddy,
  restartCaddy,
  reloadCaddy,
  getCaddyStatus,
  getCaddyLogs,
  installCaddyRemote,
  uploadCaddyfile,
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
  description = "Démarre Caddy sur les serveurs";
  options = [
    {
      flags: "--env <env>",
      description: "Environnement",
      defaultValue: "staging",
    },
  ];

  async run(ctx: CommandContext, opts?: Record<string, unknown>) {
    const env = (opts?.env as string) ?? "staging";
    const { config } = loadConfig(ctx.cwd, env);
    const servers =
      config.environments[env as "staging" | "test" | "production"]?.servers ??
      [];

    const caddyRoutes: CaddyRoute[] = (config.proxy?.routes ?? []).map((r) => ({
      domain: r.domain,
      target: r.target,
      port: r.port,
      lbPolicy: r.lb_policy as CaddyRoute["lbPolicy"],
      ssl: r.ssl,
      headers: r.headers,
    }));

    const caddyConfig = generateCaddyfile({
      email: config.proxy?.email,
      routes: caddyRoutes,
    });

    for (const srv of servers) {
      logger.info(`Déploiement Caddy sur ${srv.name} (${srv.host})...`);
      const conn = getConnectionFromServer(srv);
      try {
        await conn.connect();
        if (!(await isCaddyInstalled(conn))) {
          await installCaddyRemote(conn);
        }
        await uploadCaddyfile(conn, caddyConfig);
        await startCaddy(conn);
        logger.success(`${srv.name} : Caddy démarré`);
      } catch (err) {
        logger.error(`${srv.name} : ${(err as Error).message}`);
      } finally {
        await conn.close();
      }
    }
  }
}

export class ProxyStopCommand extends BaseCommand {
  name = "stop";
  description = "Arrête Caddy sur les serveurs";
  options = [
    {
      flags: "--env <env>",
      description: "Environnement",
      defaultValue: "staging",
    },
  ];
  async run(ctx: CommandContext, opts?: Record<string, unknown>) {
    const env = (opts?.env as string) ?? "staging";
    const { config } = loadConfig(ctx.cwd, env);
    const servers =
      config.environments[env as "staging" | "test" | "production"]?.servers ??
      [];
    for (const srv of servers) {
      const conn = getConnectionFromServer(srv);
      try {
        await conn.connect();
        await stopCaddy(conn);
        logger.success(`${srv.name} : arrêté`);
      } catch (err) {
        logger.error(`${srv.name} : ${(err as Error).message}`);
      } finally {
        await conn.close();
      }
    }
  }
}

export class ProxyRestartCommand extends BaseCommand {
  name = "restart";
  description = "Redémarre Caddy sur les serveurs";
  options = [
    {
      flags: "--env <env>",
      description: "Environnement",
      defaultValue: "staging",
    },
  ];
  async run(ctx: CommandContext, opts?: Record<string, unknown>) {
    const env = (opts?.env as string) ?? "staging";
    const { config } = loadConfig(ctx.cwd, env);
    const servers =
      config.environments[env as "staging" | "test" | "production"]?.servers ??
      [];
    for (const srv of servers) {
      const conn = getConnectionFromServer(srv);
      try {
        await conn.connect();
        await restartCaddy(conn);
        logger.success(`${srv.name} : redémarré`);
      } catch (err) {
        logger.error(`${srv.name} : ${(err as Error).message}`);
      } finally {
        await conn.close();
      }
    }
  }
}

export class ProxyStatusCommand extends BaseCommand {
  name = "status";
  description = "Affiche le statut de Caddy";
  options = [
    {
      flags: "--env <env>",
      description: "Environnement",
      defaultValue: "staging",
    },
  ];
  async run(ctx: CommandContext, opts?: Record<string, unknown>) {
    const env = (opts?.env as string) ?? "staging";
    const { config } = loadConfig(ctx.cwd, env);
    const servers =
      config.environments[env as "staging" | "test" | "production"]?.servers ??
      [];
    for (const srv of servers) {
      const conn = getConnectionFromServer(srv);
      try {
        await conn.connect();
        const status = await getCaddyStatus(conn);
        logger.keyValue(
          srv.name,
          status.installed
            ? `${status.version} — ${status.running ? "RUNNING" : "STOPPED"}`
            : "Non installé",
        );
      } catch (err) {
        logger.keyValue(srv.name, `ERREUR: ${(err as Error).message}`);
      } finally {
        await conn.close();
      }
    }
  }
}

export class ProxyLogsCommand extends BaseCommand {
  name = "logs";
  description = "Affiche les logs de Caddy";
  args = [{ name: "server", description: "Nom du serveur", required: true }];
  options = [
    { flags: "-f, --follow", description: "Suivre en continu" },
    {
      flags: "-n, --lines <n>",
      description: "Nombre de lignes",
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
      logger.error(`Serveur "${serverName}" introuvable.`);
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
  description = "Liste les routes proxy configurées";
  options = [];
  async run(ctx: CommandContext) {
    const { config } = loadConfig(ctx.cwd);
    const routes = config.proxy?.routes ?? [];
    if (ctx.json) {
      console.log(JSON.stringify(routes, null, 2));
      return;
    }
    if (routes.length === 0) {
      logger.info("Aucune route configurée.");
      return;
    }
    logger.section("Routes proxy :");
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
  description = "Ajoute une route proxy";
  args = [
    { name: "domain", required: true },
    { name: "target", required: true },
  ];
  options = [
    {
      flags: "-p, --port <port>",
      description: "Port cible",
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
    logger.info(`Route ajoutée : ${domain} → ${target}:${opts?.port ?? 3000}`);
    logger.warn(
      "Pour persister, ajoutez la route dans votre dnx.yaml → proxy.routes",
    );
  }
}

export class ProxyRouteRemoveCommand extends BaseCommand {
  name = "remove";
  description = "Supprime une route proxy";
  args = [{ name: "domain", required: true }];
  options = [];
  async run(ctx: CommandContext, domain?: string) {
    if (!domain) {
      logger.error("Usage : dnx proxy route remove <domain>");
      process.exit(1);
    }
    logger.info(`Route "${domain}" marquée pour suppression.`);
    logger.warn("Retirez-la de votre dnx.yaml → proxy.routes");
  }
}

export class ProxySSLStatusCommand extends BaseCommand {
  name = "ssl";
  description = "Affiche le statut des certificats SSL";
  options = [{ flags: "--env <env>", description: "Environnement" }];
  async run(ctx: CommandContext) {
    const { config } = loadConfig(ctx.cwd);
    const routes = config.proxy?.routes ?? [];
    logger.section("Statut SSL :");
    for (const r of routes) {
      const managed = r.ssl !== false ? "Auto (Let's Encrypt)" : "Désactivé";
      logger.keyValue(r.domain, managed);
    }
  }
}

export class ProxyCommand extends BaseCommand {
  name = "proxy";
  description = "Gère le proxy Caddy (reverse proxy + load balancing + SSL)";
  options = [];
  subcommands = [
    new ProxyStartCommand(),
    new ProxyStopCommand(),
    new ProxyRestartCommand(),
    new ProxyStatusCommand(),
    new ProxyLogsCommand(),
    new ProxyRouteListCommand(),
    new ProxyRouteAddCommand(),
    new ProxyRouteRemoveCommand(),
    new ProxySSLStatusCommand(),
  ];
  async run(_ctx: CommandContext) {}
}
