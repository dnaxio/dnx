import { Command } from "commander";
import type { BaseCommand } from "./command.ts";
import { logger } from "./output.ts";

const VERSION = "0.1.0";

export class DnxProgram {
  private program: Command;

  constructor() {
    this.program = new Command();

    this.program
      .name("dnx")
      .description(
        "🚀 DNX Deploy — Multi-server deployment tool with flox.dev & Docker/OCI",
      )
      .version(VERSION, "-v, --version", "Affiche la version")
      .option("--verbose", "Mode verbeux")
      .option("-q, --quiet", "Mode silencieux")
      .option("--json", "Sortie JSON (machine-readable)")
      .configureHelp({
        sortSubcommands: true,
        sortOptions: true,
      });
  }

  register(commands: BaseCommand[]) {
    for (const cmd of commands) {
      cmd.register(this.program, this.program);
    }
  }

  async run(argv: string[] = process.argv) {
    try {
      await this.program.parseAsync(argv);
    } catch (err) {
      logger.error((err as Error).message ?? String(err));
      process.exit(1);
    }
  }

  get commander(): Command {
    return this.program;
  }
}
