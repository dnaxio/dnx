import { BaseCommand, type CommandContext } from "../command.ts";
import { logger, spinner } from "../output.ts";
import { loadConfig } from "../../config/loader.ts";

export class BuildCommand extends BaseCommand {
  override name = "build";
  override description = "Build a workload locally (on the host machine)";
  override args = [
    { name: "workload", description: "Workload name", required: true },
  ];
  override options = [
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
    workloadName?: string,
    opts?: Record<string, unknown>,
  ) {
    if (!workloadName) {
      logger.error("Usage : dnx build <workload>");
      process.exit(1);
    }

    const env = (opts?.env as string) ?? "staging";
    const { config } = loadConfig(ctx.cwd, env);
    const wl = config.workloads.find((w) => w.name === workloadName);

    if (!wl) {
      logger.error(`Workload "${workloadName}" not found.`);
      process.exit(1);
    }

    logger.title(`Build : ${workloadName}`);

    // Execute local build steps
    const steps = wl.build?.local?.steps ?? [];
    if (steps.length === 0) {
      logger.info("No local build steps configured.");
      return;
    }

    const sourceDir = wl.sync?.source
      ? require("node:path").resolve(ctx.cwd, wl.sync.source)
      : ctx.cwd;

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

    logger.success(`Build completed: ${workloadName}`);
  }
}
