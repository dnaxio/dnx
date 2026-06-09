import { BaseCommand, type CommandContext } from "../command.ts";
import { logger, spinner } from "../output.ts";
import { activateAndRun, isFloxInstalled } from "../../flox/environment.ts";
import { loadConfig } from "../../config/loader.ts";

export class BuildCommand extends BaseCommand {
  name = "build";
  description = "Build an application (flox)";
  args = [{ name: "app", description: "Application name", required: true }];
  options = [
    {
      flags: "--env <env>",
      description: "Target environment",
      defaultValue: "staging",
    },
    { flags: "--no-cache", description: "Ignore cache" },
    { flags: "--skip-tests", description: "Skip tests" },
  ];

  async run(
    ctx: CommandContext,
    appName?: string,
    opts?: Record<string, unknown>,
  ) {
    if (!appName) {
      logger.error("Usage : dnx build <app>");
      process.exit(1);
    }

    if (!isFloxInstalled()) {
      logger.error("flox is not installed. https://flox.dev");
      process.exit(1);
    }

    const env = (opts?.env as string) ?? "staging";
    const { config } = loadConfig(ctx.cwd, env);
    const app = config.workloads.find((a) => a.name === appName);

    if (!app) {
      logger.error(`Application "${appName}" not found.`);
      process.exit(1);
    }

    logger.title(`Build : ${appName}`);

    // Execute build steps
    const steps = app.build?.local?.steps ?? [];
    if (steps.length === 0) {
      logger.info("No build steps configured.");
      return;
    }

    for (const step of steps) {
      const spin = spinner(`Running: ${step.run}`);
      try {
        const result = await activateAndRun(ctx.cwd, step.run, step.env);
        if (result.exitCode === 0) {
          spin.succeed(step.run);
        } else {
          spin.fail(`${step.run} — exit code ${result.exitCode}`);
          if (result.stderr) logger.error(result.stderr);
          process.exit(1);
        }
      } catch (err) {
        spin.fail(step.run);
        throw err;
      }
    }

    logger.success(`Build completed: ${appName}`);
  }
}
