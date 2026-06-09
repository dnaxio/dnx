import { BaseCommand, type CommandContext } from "../command.ts";
import { logger } from "../output.ts";

export class VersionCommand extends BaseCommand {
  name = "version";
  description = "Affiche la version de DNX";
  options = [];

  async run(ctx: CommandContext, _opts?: Record<string, unknown>) {
    const version = "0.1.0";
    if (ctx.json) {
      console.log(JSON.stringify({ version, runtime: "bun", node: process.versions.bun }));
    } else {
      logger.info(`dnx v${version} — Bun ${process.versions.bun}`);
    }
  }
}
