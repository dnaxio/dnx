import { BaseCommand, type CommandContext } from "../command.ts";
import { logger, spinner, icons } from "../output.ts";
import { loadConfig, loadResolvedConfig } from "../../config/loader.ts";
import { deploy, type DeployStrategy } from "../../deploy/engine.ts";
import type { Workload } from "../../config/schema.ts";

export class DeployCommand extends BaseCommand {
  override name = "deploy";
  override description =
    "Deploy one or all workloads to one or all environments";
  override args = [
    {
      name: "workload",
      description: "Workload name to deploy",
      required: false,
    },
  ];
  override options = [
    {
      flags: "--env <env>",
      description: "Target environment(s), comma-separated (default: all)",
    },
    {
      flags: "--strategy <strategy>",
      description: "Strategy: rolling, blue-green, canary",
    },
    {
      flags: "--dry-run",
      description: "Simulate deployment without executing",
    },
    { flags: "--no-health-check", description: "Disable health check" },
    { flags: "--timeout <seconds>", description: "SSH timeout in seconds" },
    {
      flags: "--tag <tag>",
      description:
        "Docker image tag (optional if deploy.tag is set in dnx.yaml)",
    },
    { flags: "--all", description: "Deploy all workloads" },
    { flags: "--force", description: "Overwrite existing tag" },
  ];

  async run(
    ctx: CommandContext,
    workloadName?: string,
    opts?: Record<string, unknown>,
  ) {
    const targetEnv = opts?.env as string | undefined;
    const strategy = opts?.strategy as DeployStrategy | undefined;
    const dryRun = !!(opts?.["dryRun"] ?? opts?.["dry-run"]);
    const skipHealth = !!(opts?.["noHealthCheck"] ?? opts?.["no-health-check"]);
    const timeout = opts?.timeout
      ? parseInt(opts.timeout as string)
      : undefined;
    const tag = opts?.tag as string;
    const deployAll = !!opts?.all;
    const force = !!opts?.force;

    // Require either a workload name or --all
    if (!workloadName && !deployAll) {
      logger.error("Usage: dnx deploy <workload> --tag <v> [--env <env>]");
      logger.info("  or:  dnx deploy --all --tag <v> [--env <env>]");
      process.exit(1);
    }

    // Load config to check for deploy.tag fallback
    const { config } = loadConfig(ctx.cwd);

    const resolvedTag = tag || config.deploy?.tag;
    if (!resolvedTag) {
      logger.error("--tag required (or set deploy.tag in dnx.yaml)");
      process.exit(1);
    }

    if (workloadName && deployAll) {
      logger.warn("--all is ignored when a workload name is provided");
    }

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

    // Validate requested environments exist
    if (targetEnv) {
      const unknown = environments.filter((e) => !(e in config.environments));
      if (unknown.length > 0) {
        logger.error(
          `Unknown environment(s): ${unknown.join(", ")}. Available: ${Object.keys(config.environments).join(", ")}`,
        );
        process.exit(1);
      }
    }

    // Determine workloads
    const workloads =
      deployAll && !workloadName
        ? config.workloads.map((w) => w.name)
        : [workloadName!];

    if (workloads.length === 0) {
      logger.error("No workloads defined in config.");
      process.exit(1);
    }

    if (!targetEnv) {
      logger.section(
        `Deploying to ${environments.length} environment(s): ${environments.join(", ")}`,
      );
    }
    if (deployAll && !workloadName) {
      logger.info(`Workloads: ${workloads.join(", ")}`);
    }

    // Run local build steps for each workload before deploying
    for (const wlName of workloads) {
      const wl = config.workloads.find((w) => w.name === wlName);
      if (wl?.build?.local?.steps && wl.build.local.steps.length > 0) {
        await this.runLocalBuild(ctx.cwd, wl, wlName);
      }
    }

    // Deploy each environment
    let overallSuccess = true;
    for (const env of environments) {
      if (environments.length > 1) {
        logger.title(`Environment: ${env}`);
      }

      // Reload config with env-specific overrides and variable resolution
      const envConfig = loadResolvedConfig(ctx.cwd, env);

      if (!force) {
        // Reject duplicate tags across all servers for this environment
        for (const srv of envConfig.environments[env]?.servers ?? []) {
          const { SSHConnection } = await import("../../ssh/connection.ts");
          const conn = new SSHConnection({
            host: srv.host,
            port: srv.port ?? 22,
            username: srv.user ?? "root",
            password: srv.password,
          });
          try {
            await conn.connect();
            for (const wl of workloads) {
              const check = await conn.exec(
                `docker images --format '{{.Tag}}' ${wl} | grep -wx '${resolvedTag}' && echo EXISTS || echo OK`,
              );
              if (check.stdout.includes("EXISTS")) {
                logger.error(
                  `Tag "${resolvedTag}" already exists for ${wl} on ${srv.host}. Use --force to overwrite`,
                );
                await conn.close();
                process.exit(1);
              }
            }
            await conn.close();
          } catch {}
        }
      }

      // Deploy each workload to this environment
      for (const wl of workloads) {
        if (workloads.length > 1 || environments.length > 1) {
          logger.section(`Deploying ${wl} to ${env}`);
        }

        const result = await deploy(envConfig, wl, {
          environment: env,
          strategy,
          dryRun,
          skipHealthCheck: skipHealth,
          timeout,
          tag: resolvedTag,
        });

        if (ctx.json) {
          console.log(JSON.stringify({ workload: wl, ...result }, null, 2));
          if (!result.success) overallSuccess = false;
          continue;
        }

        if (result.success) {
          logger.success(
            `✔ Deployed ${wl} to ${env} (${resolvedTag}) in ${Math.round(result.durationMs / 1000)}s`,
          );
          logger.info(`  ${icons.check} ${result.servers.join(", ")}`);
        } else {
          logger.error(
            `✖ ${wl} on ${env} failed: ${result.error ?? "Unknown error"}`,
          );
          overallSuccess = false;
        }
      }
    }

    if (!overallSuccess && !ctx.json) {
      process.exit(1);
    }
  }

  private async runLocalBuild(
    cwd: string,
    wl: Workload,
    wlName: string,
  ): Promise<void> {
    logger.section(`Local build: ${wlName}`);

    const steps = wl.build?.local?.steps ?? [];
    if (steps.length === 0) {
      logger.info("No local build steps configured.");
      return;
    }

    const sourceDir = wl.sync?.source
      ? require("node:path").resolve(cwd, wl.sync.source)
      : cwd;

    for (const step of steps) {
      const stepSpin = spinner(`Running: ${step.run}`, {
        stream: process.stderr,
      });
      try {
        const args = step.run.split(" ").filter(Boolean);
        if (args.length === 0) {
          stepSpin.fail("Empty command");
          process.exit(1);
        }
        const proc = Bun.spawn(args, {
          cwd: sourceDir,
          stdout: "pipe",
          stderr: "pipe",
          env: { ...process.env, ...(step.env as Record<string, string>) },
        });

        // Stream output in real-time
        const textDecoder = new TextDecoder();
        const streamOutput = async (reader: any, isStderr: boolean) => {
          if (!reader) return;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = textDecoder.decode(value);
            for (const line of text.split("\n")) {
              if (line.trim() === "") continue;
              const output = `${line}`.gray;
              if (isStderr) {
                process.stderr.write(`${output}\n`);
              } else {
                process.stdout.write(`${output}\n`);
              }
            }
          }
        };

        await Promise.all([
          streamOutput(proc.stdout?.getReader(), false),
          streamOutput(proc.stderr?.getReader(), true),
        ]);

        await proc.exited;

        if (proc.exitCode === 0) {
          stepSpin.succeed(step.run);
        } else {
          stepSpin.fail(`${step.run} — exit code ${proc.exitCode}`);
          process.exit(1);
        }
      } catch (err) {
        stepSpin.fail(step.run);
        throw err;
      }
    }

    logger.info(`Local build completed: ${wlName}`);
  }
}
