import type { Command as CommanderCommand } from "commander";

export interface CommandContext {
  /** Global --verbose flag */
  verbose: boolean;
  /** Global --quiet flag */
  quiet: boolean;
  /** Global --json flag */
  json: boolean;
  /** Working directory */
  cwd: string;
}

export interface CommandOption {
  flags: string;
  description: string;
  defaultValue?: unknown;
}

export interface CommandArgument {
  name: string;
  description?: string;
  required?: boolean;
  variadic?: boolean;
}

export abstract class BaseCommand {
  abstract name: string;
  abstract description: string;
  /** Command options (defaults to empty array) */
  options: CommandOption[] = [];
  /** Positional arguments */
  args: CommandArgument[] = [];

  /** Subcommands */
  subcommands: BaseCommand[] = [];

  abstract run(ctx: CommandContext, ...args: unknown[]): Promise<void>;

  /** Register this command on a commander program */
  register(program: CommanderCommand, globalProgram?: CommanderCommand): void {
    const cmd = program
      .command(this.name)
      .description(this.description)
      .action(async (...args: unknown[]) => {
        // Commander passes the command object as the last arg, strip it
        const cmdObj = args.pop() as Record<string, unknown> | undefined;
        // Global opts are on the top-level program, not subcommands
        const globalOpts = (globalProgram ?? program).opts<
          Record<string, unknown>
        >();
        const ctx: CommandContext = {
          verbose: !!(cmdObj?.verbose ?? globalOpts.verbose),
          quiet: !!(cmdObj?.quiet ?? globalOpts.quiet),
          json: !!(cmdObj?.json ?? globalOpts.json),
          cwd: process.cwd(),
        };
        try {
          await this.run(ctx, ...args);
        } catch (err) {
          if (ctx.json) {
            console.error(JSON.stringify({ error: String(err) }));
          } else {
            console.error(`\n  Error: ${(err as Error).message ?? err}`);
          }
          process.exit(1);
        }
      });

    for (const opt of this.options) {
      cmd.option(opt.flags, opt.description, opt.defaultValue);
    }

    // Add positional arguments
    for (const arg of this.args) {
      const argDef = arg.required
        ? `<${arg.name}>`
        : arg.variadic
          ? `[${arg.name}...]`
          : `[${arg.name}]`;
      cmd.argument(argDef, arg.description ?? "");
    }

    // Register subcommands, passing the global program down
    for (const sub of this.subcommands) {
      sub.register(cmd, globalProgram ?? program);
    }
  }
}
