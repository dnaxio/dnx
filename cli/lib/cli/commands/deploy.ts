import { BaseCommand, type CommandContext } from "../command.ts";
import { logger, spinner, icons } from "../output.ts";
import { loadConfig } from "../../config/loader.ts";
import { deploy, type DeployStrategy } from "../../deploy/engine.ts";

export class DeployCommand extends BaseCommand {
  name = "deploy";
  description = "Déploie un workload sur les serveurs d'un environnement";
  args = [
    {
      name: "workload",
      description: "Nom du workload à déployer",
      required: true,
    },
  ];
  options = [
    {
      flags: "--env <env>",
      description: "Environnement cible",
      defaultValue: "staging",
    },
    {
      flags: "--strategy <strategy>",
      description: "Stratégie: rolling, blue-green, canary",
    },
    { flags: "--dry-run", description: "Simule le déploiement sans exécuter" },
    { flags: "--no-health-check", description: "Désactive le health check" },
    { flags: "--timeout <seconds>", description: "Timeout SSH en secondes" },
    {
      flags: "--tag <tag>",
      description: "Tag de l'image Docker (obligatoire)",
      required: true,
    },
  ];

  async run(
    ctx: CommandContext,
    workloadName?: string,
    opts?: Record<string, unknown>,
  ) {
    if (!workloadName) {
      logger.error("Usage : dnx deploy <workload> [--env staging|production]");
      process.exit(1);
    }

    const env = (opts?.env as string) ?? "staging";
    const strategy = opts?.strategy as DeployStrategy | undefined;
    const dryRun = !!(opts["dryRun"] ?? opts["dry-run"]);
    const skipHealth = !!(opts["noHealthCheck"] ?? opts["no-health-check"]);
    const timeout = opts?.timeout
      ? parseInt(opts.timeout as string)
      : undefined;

    const tag = opts?.tag as string;
    if (!tag) {
      logger.error("--tag required");
      process.exit(1);
    }

    const { config } = loadConfig(ctx.cwd, env);

    // Reject duplicate tags
    for (const srv of config.environments[env]?.servers ?? []) {
      const { SSHConnection } = await import("../../ssh/connection.ts");
      const conn = new SSHConnection({
        host: srv.host,
        port: srv.port ?? 22,
        username: srv.user ?? "root",
        password: srv.password,
      });
      try {
        await conn.connect();
        const check = await conn.exec(
          `docker images --format '{{.Tag}}' ${workloadName} | grep -wx '${tag}' && echo EXISTS || echo OK`,
        );
        await conn.close();
        if (check.stdout.includes("EXISTS")) {
          logger.error(`Tag "${tag}" already exists on ${srv.host}`);
          process.exit(1);
        }
      } catch {}
    }

    const result = await deploy(config, workloadName, {
      environment: env,
      strategy,
      dryRun,
      skipHealthCheck: skipHealth,
      timeout,
      tag,
    });

    if (ctx.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (result.success) {
      logger.success(
        `\n✔ Deployed ${workloadName} ${opts?.tag ? opts.tag : result.version} in ${Math.round(result.durationMs / 1000)}s`,
      );
      logger.info(`${icons.check} ${result.servers.join(", ")}`);
    } else {
      logger.error(`\nDeploy failed : ${result.error ?? "Unknown error"}`);
      process.exit(1);
    }
  }
}
