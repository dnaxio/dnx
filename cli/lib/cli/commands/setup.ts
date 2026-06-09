import { BaseCommand, type CommandContext } from "../command.ts";
import { logger, spinner } from "../output.ts";
import { loadConfig, loadResolvedConfig } from "../../config/loader.ts";
import type { Server } from "../../config/schema.ts";
import { SSHConnection } from "../../ssh/connection.ts";

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
  description = "Install dependencies on remote servers";
  args = [
    {
      name: "target",
      description: "Server name, 'all' for all servers (default: all)",
    },
  ];
  options = [
    {
      flags: "--env <env>",
      description: "Target environment(s), comma-separated (default: all)",
    },
    { flags: "--check-only", description: "Check without installing" },
  ];

  async run(
    ctx: CommandContext,
    target?: string,
    opts?: Record<string, unknown>,
  ) {
    const targetEnv = opts?.env as string | undefined;
    const checkOnly = !!opts?.["check-only"];
    const { config } = loadConfig(ctx.cwd);

    // Determine environments
    const environments = targetEnv
      ? targetEnv
          .split(",")
          .map((e) => e.trim())
          .filter(Boolean)
      : Object.keys(config.environments);

    if (environments.length === 0) {
      logger.error("No environments defined in config.");
      process.exit(1);
    }

    // Validate environments exist
    if (targetEnv) {
      const unknown = environments.filter((e) => !(e in config.environments));
      if (unknown.length > 0) {
        logger.error(
          `Unknown environment(s): ${unknown.join(", ")}. Available: ${Object.keys(config.environments).join(", ")}`,
        );
        process.exit(1);
      }
    }

    // Collect servers per environment with resolved variables
    interface ServerWithEnv extends Server {
      _env: string;
    }
    let allServers: ServerWithEnv[] = [];

    for (const env of environments) {
      const resolved = loadResolvedConfig(ctx.cwd, env);
      const envServers = resolved.environments[env]?.servers ?? [];

      if (target === "all") {
        allServers.push(...envServers.map((s) => ({ ...s, _env: env })));
      } else if (target) {
        const match = envServers.find((s) => s.name === target);
        if (match) allServers.push({ ...match, _env: env });
      } else {
        allServers.push(...envServers.map((s) => ({ ...s, _env: env })));
      }
    }

    if (allServers.length === 0) {
      logger.error(
        target ? `Server "${target}" not found.` : "No servers configured.",
      );
      process.exit(1);
    }

    const envLabel = targetEnv ?? environments.join(", ");
    logger.title(`Setup : ${allServers.length} server(s) [${envLabel}]`);

    let failures = 0;

    for (const srv of allServers) {
      logger.section(`${srv.name} (${srv.host})`);

      const conn = new SSHConnection({
        host: srv.host,
        port: srv.port ?? 22,
        username: srv.user ?? "root",
        password: srv.password,
      });

      let serverFailed = false;

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
            serverFailed = true;
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
            serverFailed = true;
            if (installResult.stderr) {
              logger.error(
                `  ${installResult.stderr.split("\n").slice(0, 2).join(" | ")}`,
              );
            }
          }
        }
      } catch (err) {
        logger.error(`Connection failed : ${(err as Error).message}`);
        serverFailed = true;
      } finally {
        await conn.close();
      }

      if (serverFailed) failures++;
    }

    if (failures > 0) {
      logger.error(
        `\nSetup failed on ${failures}/${allServers.length} server(s).`,
      );
      process.exit(1);
    }

    logger.success("\nSetup complete.");
  }
}
