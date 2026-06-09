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
  description = "Build an OCI image (Docker/Podman)";
  args = [{ name: "app", description: "Application name", required: true }];
  options = [
    {
      flags: "--tag <tag>",
      description: "Image tag",
      defaultValue: "latest",
    },
    { flags: "--no-cache", description: "Ignore cache" },
    {
      flags: "--platform <platform>",
      description: "Platform (linux/amd64, linux/arm64)",
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
      logger.error(`Application "${appName}" not found.`);
      process.exit(1);
    }

    const dockerfile = app.dockerfile ?? findDockerfile(ctx.cwd);
    if (!dockerfile && !hasDockerfile(ctx.cwd)) {
      logger.info("No Dockerfile found. Auto-generating...");
      const gen = generateDockerfileIfMissing(ctx.cwd);
      logger.success(`Dockerfile generated (${gen.type})`);
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
  description = "Push an image to a registry";
  args = [{ name: "app", description: "Application name", required: true }];
  options = [
    { flags: "--tag <tag>", description: "Tag", defaultValue: "latest" },
    { flags: "--registry <url>", description: "Registry URL" },
    { flags: "-u, --username <user>", description: "Registry username" },
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
      logger.error(`Application "${appName}" not found.`);
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
  description = "Pull an image from a registry to a server";
  args = [
    { name: "app", description: "Application name", required: true },
    { name: "server", description: "Target server", required: true },
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
      logger.error(`Server "${serverName}" not found.`);
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
  description = "List OCI containers on a server";
  args = [{ name: "server", description: "Target server", required: true }];
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
      logger.error(`Server "${serverName}" not found.`);
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
  description = "Clean up old images and containers";
  args = [{ name: "server", description: "Target server", required: true }];
  options = [{ flags: "--keep <n>", description: "Keep the last N images" }];
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
      logger.error(`Server "${serverName}" not found.`);
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
  description = "Manage OCI images and containers (Docker/Podman)";
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
