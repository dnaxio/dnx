import { BaseCommand, type CommandContext } from "../command.ts";
import { logger, spinner } from "../output.ts";
import { activateAndRun, isFloxInstalled } from "../../flox/environment.ts";
import { loadConfig } from "../../config/loader.ts";

export class BuildCommand extends BaseCommand {
  name = "build";
  description = "Build une application (flox)";
  args = [{ name: "app", description: "Nom de l'application", required: true }];
  options = [
    {
      flags: "--env <env>",
      description: "Environnement cible",
      defaultValue: "staging",
    },
    { flags: "--no-cache", description: "Ignore le cache" },
    { flags: "--skip-tests", description: "Sauter les tests" },
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
      logger.error("flox n'est pas installé. https://flox.dev");
      process.exit(1);
    }

    const env = (opts?.env as string) ?? "staging";
    const { config } = loadConfig(ctx.cwd, env);
    const app = config.workloads.find((a) => a.name === appName);

    if (!app) {
      logger.error(`Application "${appName}" introuvable.`);
      process.exit(1);
    }

    logger.title(`Build : ${appName}`);

    // Execute build steps
    const steps = app.build?.steps ?? [];
    if (steps.length === 0) {
      logger.info("Aucune étape de build configurée.");
      return;
    }

    for (const step of steps) {
      const spin = spinner(`Exécution : ${step.run}`);
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

    logger.success(`Build terminé : ${appName}`);
  }
}
