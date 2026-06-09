import { BaseCommand, type CommandContext } from "../command.ts";
import { logger, spinner } from "../output.ts";
import { loadConfig } from "../../config/loader.ts";
import { SSHConnection } from "../../ssh/connection.ts";
import { installAgent, uninstallAgent, checkAgentStatus } from "../../agent/installer.ts";

function getConn(host: string, port = 22, user = "root"): SSHConnection {
  return new SSHConnection({ host, port, username: user });
}

export class AgentInstallCommand extends BaseCommand {
  name = "install";
  description = "Installe l'agent dnxd sur un serveur";
  args = [{ name: "server", description: "Nom du serveur", required: true }];
  options = [
    { flags: "-f, --force", description: "Réinstalle même si déjà présent" },
  ];

  async run(ctx: CommandContext, serverName?: string, opts?: Record<string, unknown>) {
    if (!serverName) { logger.error("Usage : dnx agent install <server>"); process.exit(1); }
    const { config } = loadConfig(ctx.cwd);
    const allServers = Object.values(config.environments).flatMap((e) => e.servers);
    const srv = allServers.find((s) => s.name === serverName);
    if (!srv) { logger.error(`Serveur "${serverName}" introuvable.`); process.exit(1); }

    const conn = getConn(srv.host, srv.port ?? 22, srv.user ?? "root");
    try {
      await conn.connect();
      if (opts?.force) {
        await uninstallAgent(conn);
      }
      await installAgent(conn, ctx.cwd);
    } catch (err) {
      logger.error((err as Error).message);
    } finally {
      await conn.close();
    }
  }
}

export class AgentUninstallCommand extends BaseCommand {
  name = "uninstall";
  description = "Désinstalle l'agent dnxd d'un serveur";
  args = [{ name: "server", description: "Nom du serveur", required: true }];
  async run(ctx: CommandContext, serverName?: string) {
    if (!serverName) { logger.error("Usage : dnx agent uninstall <server>"); process.exit(1); }
    const { config } = loadConfig(ctx.cwd);
    const allServers = Object.values(config.environments).flatMap((e) => e.servers);
    const srv = allServers.find((s) => s.name === serverName);
    if (!srv) { logger.error(`Serveur "${serverName}" introuvable.`); process.exit(1); }

    const conn = getConn(srv.host, srv.port ?? 22, srv.user ?? "root");
    try {
      await conn.connect();
      await uninstallAgent(conn);
    } catch (err) {
      logger.error((err as Error).message);
    } finally {
      await conn.close();
    }
  }
}

export class AgentStatusCommand extends BaseCommand {
  name = "status";
  description = "Vérifie le statut de l'agent dnxd";
  args = [{ name: "server", description: "Nom du serveur (optionnel)" }];
  async run(ctx: CommandContext, serverName?: string) {
    const { config } = loadConfig(ctx.cwd);
    const allServers = Object.values(config.environments).flatMap((e) => e.servers);
    const targets = serverName
      ? allServers.filter((s) => s.name === serverName)
      : allServers;

    if (targets.length === 0) {
      logger.error(serverName ? `Serveur "${serverName}" introuvable.` : "Aucun serveur.");
      process.exit(1);
    }

    for (const srv of targets) {
      const conn = getConn(srv.host, srv.port ?? 22, srv.user ?? "root");
      try {
        await conn.connect();
        const status = await checkAgentStatus(conn);
        if (ctx.json) {
          console.log(JSON.stringify({ server: srv.name, ...status }));
        } else {
          const state = status.installed
            ? status.running ? "RUNNING" : "STOPPED"
            : "NOT_INSTALLED";
          logger.keyValue(srv.name, state);
        }
      } catch (err) {
        logger.keyValue(srv.name, `ERREUR: ${(err as Error).message}`);
      } finally {
        await conn.close();
      }
    }
  }
}

export class AgentCommand extends BaseCommand {
  name = "agent";
  description = "Gère l'agent distant dnxd";
  options = [];
  subcommands = [
    new AgentInstallCommand(),
    new AgentUninstallCommand(),
    new AgentStatusCommand(),
  ];
  async run(_ctx: CommandContext) {}
}
