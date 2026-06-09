import { BaseCommand, type CommandContext } from "../command.ts";
import { logger, spinner } from "../output.ts";
import { loadConfig } from "../../config/loader.ts";
import type { Server } from "../../config/schema.ts";
import { SSHConnection } from "../../ssh/connection.ts";
import { SSHPool } from "../../ssh/pool.ts";

const PACKAGES = [
  {
    name: "unzip",
    check: "which unzip && echo OK || echo MISSING",
    install:
      "apt-get update -qq && apt-get install -y -qq unzip 2>/dev/null || yum install -y unzip 2>/dev/null || apk add unzip 2>/dev/null || echo 'install unzip manually'",
  },
  {
    name: "bun",
    check: "which bun && echo OK || echo MISSING",
    install:
      "curl -fsSL https://bun.sh/install | bash && " +
      'export BUN_INSTALL="$HOME/.bun" && export PATH="$BUN_INSTALL/bin:$PATH" && ' +
      "echo 'export BUN_INSTALL=\"$HOME/.bun\"' >> ~/.bashrc && " +
      "echo 'export PATH=\"$BUN_INSTALL/bin:$PATH\"' >> ~/.bashrc",
  },
  {
    name: "docker",
    check: "which docker && echo OK || echo MISSING",
    install: "curl -fsSL https://get.docker.com | sh",
  },
  {
    name: "devbox",
    check: "which devbox && echo OK || echo MISSING",
    install: "curl -fsSL https://get.jetify.com/devbox | bash -s -- -f",
  },
  {
    name: "flox",
    check: "which flox && echo OK || echo MISSING",
    install:
      "ARCH=$(uname -m | sed 's/x86_64/x86_64-linux/;s/aarch64/aarch64-linux/') && " +
      "if command -v apt-get >/dev/null; then " +
      "  curl -fsSL -o /tmp/flox.deb https://downloads.flox.dev/by-env/stable/deb/flox-1.12.2.$ARCH.deb && " +
      "  dpkg -i /tmp/flox.deb && rm /tmp/flox.deb; " +
      "elif command -v yum >/dev/null; then " +
      "  curl -fsSL -o /tmp/flox.rpm https://downloads.flox.dev/by-env/stable/rpm/flox-1.12.2.$ARCH.rpm && " +
      "  rpm -ivh /tmp/flox.rpm && rm /tmp/flox.rpm; " +
      "else " +
      "  curl -fsSL https://install.flox.dev | sh; " +
      "fi",
  },
  {
    name: "rsync",
    check: "which rsync && echo OK || echo MISSING",
    install:
      "apt-get install -y -qq rsync 2>/dev/null || echo 'rsync present or install manually'",
  },
  {
    name: "jq",
    check: "which jq && echo OK || echo MISSING",
    install:
      "apt-get install -y -qq jq 2>/dev/null || echo 'install jq manually'",
  },
  {
    name: "caddy",
    check: "which caddy && echo OK || echo MISSING",
    install:
      "curl -fsSL https://caddyserver.com/api/download?os=linux&arch=amd64 -o /usr/local/bin/caddy && " +
      "chmod +x /usr/local/bin/caddy && mkdir -p /etc/caddy",
  },
  {
    name: "git",
    check: "which git && echo OK || echo MISSING",
    install:
      "apt-get update -qq && apt-get install -y -qq git 2>/dev/null || yum install -y git 2>/dev/null || echo 'install git manually'",
  },
  {
    name: "tar",
    check: "which tar && echo OK || echo MISSING",
    install:
      "apt-get install -y -qq tar 2>/dev/null || echo 'tar already present or install manually'",
  },
  {
    name: "curl",
    check: "which curl && echo OK || echo MISSING",
    install:
      "apt-get install -y -qq curl 2>/dev/null || echo 'curl already present or install manually'",
  },
];

export class SetupCommand extends BaseCommand {
  name = "setup";
  description = "Installe les dépendances sur les serveurs distants";
  args = [
    {
      name: "target",
      description:
        "Nom du serveur, 'all' pour tous les environnements, ou rien pour l'environnement courant",
    },
  ];
  options = [
    {
      flags: "--env <env>",
      description: "Environnement cible",
      defaultValue: "staging",
    },
    { flags: "--check-only", description: "Vérifie sans installer" },
  ];

  async run(
    ctx: CommandContext,
    target?: string,
    opts?: Record<string, unknown>,
  ) {
    const env = (opts?.env as string) ?? "staging";
    const checkOnly = !!opts?.["check-only"];
    const { config } = loadConfig(ctx.cwd, env);

    let allServers: Server[];

    if (target === "all") {
      // All servers across all environments
      allServers = Object.values(config.environments).flatMap((e) => e.servers);
    } else if (target) {
      // Specific server by name
      allServers = Object.values(config.environments)
        .flatMap((e) => e.servers)
        .filter((s) => s.name === target);
    } else {
      // Current environment only
      allServers = config.environments[env]?.servers ?? [];
    }

    if (allServers.length === 0) {
      logger.error(
        target ? `Server "${target}" not found.` : "No servers configured.",
      );
      process.exit(1);
    }

    logger.title(`Setup : ${allServers.length} server(s) [${env}]`);

    for (const srv of allServers) {
      logger.section(`${srv.name} (${srv.host})`);

      const conn = new SSHConnection({
        host: srv.host,
        port: srv.port ?? 22,
        username: srv.user ?? "root",
        password: srv.password,
      });

      try {
        await conn.connect();

        for (const pkg of PACKAGES) {
          const spin = spinner(`${pkg.name}...`);
          const result = await conn.exec(pkg.check);

          if (result.stdout.includes("OK")) {
            spin.succeed(`${pkg.name} : installed`);
            continue;
          }

          if (checkOnly) {
            spin.warn(`${pkg.name} : NOT INSTALLED`);
            continue;
          }

          spin.text = `Installing ${pkg.name}...`;
          const installResult = await conn.exec(pkg.install);

          // Re-check after install
          const recheck = await conn.exec(pkg.check);
          if (recheck.stdout.includes("OK")) {
            spin.succeed(`${pkg.name} : installed ✓`);
          } else {
            spin.fail(`${pkg.name} : install failed`);
            if (installResult.stderr) {
              logger.error(
                `  ${installResult.stderr.split("\n").slice(0, 2).join(" | ")}`,
              );
            }
          }
        }
      } catch (err) {
        logger.error(`Connection failed : ${(err as Error).message}`);
      } finally {
        await conn.close();
      }
    }

    logger.success("\nSetup complete.");
  }
}
