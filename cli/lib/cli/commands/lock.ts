import { BaseCommand, type CommandContext } from "../command.ts";
import { logger } from "../output.ts";
import { listLocks, forceRelease, cleanupExpired } from "../../lock/manager.ts";
import { runMigrations } from "../../db/connection.ts";

export class LockListCommand extends BaseCommand {
  name = "list";
  description = "List active locks";
  options = [];
  async run(ctx: CommandContext) {
    runMigrations();
    const locks = listLocks();
    if (ctx.json) {
      console.log(JSON.stringify(locks, null, 2));
      return;
    }
    if (locks.length === 0) {
      logger.info("No active locks.");
      return;
    }
    logger.section("Active locks:");
    for (const l of locks) {
      const exp = l.expiresAt ? ` (expire: ${l.expiresAt})` : "";
      logger.keyValue(l.resource, `${l.holder}${exp}`);
    }
  }
}

export class LockReleaseCommand extends BaseCommand {
  name = "release";
  description = "Release a lock (force)";
  args = [{ name: "resource", required: true }];
  async run(ctx: CommandContext, resource?: string) {
    runMigrations();
    if (!resource) {
      logger.error("Usage : dnx lock release <resource>");
      process.exit(1);
    }
    const released = forceRelease(resource);
    if (released) logger.success(`Lock "${resource}" released.`);
    else logger.warn(`Lock "${resource}" not found.`);
  }
}

export class LockCommand extends BaseCommand {
  name = "lock";
  description = "Manage deployment locks";
  options = [];
  subcommands = [new LockListCommand(), new LockReleaseCommand()];
  async run(_ctx: CommandContext) {}
}
