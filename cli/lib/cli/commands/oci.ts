import { BaseCommand, type CommandContext } from "../command.ts";
import { logger, spinner } from "../output.ts";
import { loadConfig } from "../../config/loader.ts";
import {
  buildImage,
  hasDockerfile,
  findDockerfile,
} from "../../oci/buildkit.ts";
import { generateDockerfileIfMissing } from "../../oci/dockerfile.ts";
import {
  pushImage,
  isDockerInstalled,
  installDockerRemote,
  runContainer,
  removeContainer,
  getContainerLogs,
  listContainers,
  cleanupRemote,
  pullImage,
} from "../../oci/registry.ts";
import { SSHConnection } from "../../ssh/connection.ts";

function getConn(host: string, port = 22, user = "root"): SSHConnection {
  return new SSHConnection({ host, port, username: user });
}

export class OciBuildCommand extends BaseCommand {
  name = "build";
  description = "Build une image OCI (Docker/Podman)";
  args = [{ name: "app", description: "Nom de l'application", required: true }];
  options = [
    {
      flags: "--tag <tag>",
      description: "Tag de l'image",
      defaultValue: "latest",
    },
    { flags: "--no-cache", description: "Ignore le cache" },
    {
      flags: "--platform <platform>",
      description: "Plateforme (linux/amd64, linux/arm64)",
    },
  ];

  async run(
    ctx: CommandContext,
    appName?: string,
    opts?: Record<string, unknown>,
  ) {
    if (!appName) {
      logger.error("Usage : dnx oci build <app>");
      process.exit(1);
    }

    const { config } = loadConfig(ctx.cwd);
    const app = config.workloads.find((a) => a.name === appName);
    if (!app) {
      logger.error(`Application "${appName}" introuvable.`);
      process.exit(1);
    }

    const dockerfile = app.dockerfile ?? findDockerfile(ctx.cwd);
    if (!dockerfile && !hasDockerfile(ctx.cwd)) {
      logger.info("Aucun Dockerfile trouvé. Génération automatique...");
      const gen = generateDockerfileIfMissing(ctx.cwd);
      logger.success(`Dockerfile généré (${gen.type})`);
    }

    const registry = app.registry ?? `${appName}`;
    const tag = (opts?.tag as string) ?? "latest";

    try {
      await buildImage(ctx.cwd, {
        dockerfile: dockerfile ?? "Dockerfile",
        tag,
        registry,
        noCache: !!opts?.["no-cache"],
        platform: opts?.platform as string | undefined,
      });
    } catch (err) {
      logger.error((err as Error).message);
      process.exit(1);
    }
  }
}

export class OciPushCommand extends BaseCommand {
  name = "push";
  description = "Push une image vers un registry";
  args = [{ name: "app", description: "Nom de l'application", required: true }];
  options = [
    { flags: "--tag <tag>", description: "Tag", defaultValue: "latest" },
    { flags: "--registry <url>", description: "URL du registry" },
    { flags: "-u, --username <user>", description: "Username registry" },
  ];

  async run(
    ctx: CommandContext,
    appName?: string,
    opts?: Record<string, unknown>,
  ) {
    if (!appName) {
      logger.error("Usage : dnx oci push <app>");
      process.exit(1);
    }
    const { config } = loadConfig(ctx.cwd);
    const app = config.workloads.find((a) => a.name === appName);
    if (!app) {
      logger.error(`Application "${appName}" introuvable.`);
      process.exit(1);
    }

    const registry =
      (opts?.registry as string) ?? app.registry ?? `ghcr.io/org/${appName}`;
    const tag = (opts?.tag as string) ?? "latest";
    const image = `${registry}:${tag}`;

    await pushImage(image, {
      url: registry,
      username: opts?.username as string,
    });
  }
}

export class OciPullCommand extends BaseCommand {
  name = "pull";
  description = "Pull une image depuis un registry sur un serveur";
  args = [
    { name: "app", description: "Nom de l'application", required: true },
    { name: "server", description: "Serveur cible", required: true },
  ];
  async run(ctx: CommandContext, appName?: string, serverName?: string) {
    if (!appName || !serverName) {
      logger.error("Usage : dnx oci pull <app> <server>");
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
    const app = config.workloads.find((a) => a.name === appName);
    const image =
      app?.oci_image ?? `${app?.registry ?? `ghcr.io/org/${appName}`}:latest`;

    const conn = getConn(srv.host, srv.port ?? 22, srv.user ?? "root");
    try {
      await conn.connect();
      await pullImage(conn, image!);
    } finally {
      await conn.close();
    }
  }
}

export class OciImagesCommand extends BaseCommand {
  name = "images";
  description = "Liste les conteneurs OCI sur un serveur";
  args = [{ name: "server", description: "Serveur cible", required: true }];
  async run(ctx: CommandContext, serverName?: string) {
    if (!serverName) {
      logger.error("Usage : dnx oci images <server>");
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
    const conn = getConn(srv.host, srv.port ?? 22, srv.user ?? "root");
    try {
      await conn.connect();
      const list = await listContainers(conn);
      console.log(list);
    } finally {
      await conn.close();
    }
  }
}

export class OciCleanupCommand extends BaseCommand {
  name = "cleanup";
  description = "Nettoie les anciennes images et conteneurs";
  args = [{ name: "server", description: "Serveur cible", required: true }];
  options = [
    { flags: "--keep <n>", description: "Garder les N dernières images" },
  ];
  async run(ctx: CommandContext, serverName?: string) {
    if (!serverName) {
      logger.error("Usage : dnx oci cleanup <server>");
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
    const conn = getConn(srv.host, srv.port ?? 22, srv.user ?? "root");
    try {
      await conn.connect();
      await cleanupRemote(conn);
    } finally {
      await conn.close();
    }
  }
}

export class OciCommand extends BaseCommand {
  name = "oci";
  description = "Gère les images et conteneurs OCI (Docker/Podman)";
  options = [];
  subcommands = [
    new OciBuildCommand(),
    new OciPushCommand(),
    new OciPullCommand(),
    new OciImagesCommand(),
    new OciCleanupCommand(),
  ];
  async run(_ctx: CommandContext) {}
}
