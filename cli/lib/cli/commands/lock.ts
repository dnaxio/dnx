import { BaseCommand, type CommandContext } from "../command.ts";
import { logger } from "../output.ts";
import { listLocks, forceRelease, cleanupExpired } from "../../lock/manager.ts";
import { runMigrations } from "../../db/connection.ts";

export class LockListCommand extends BaseCommand {
  name = "list";
  description = "Liste les locks actifs";
  options = [];
  async run(ctx: CommandContext) {
    runMigrations();
    const locks = listLocks();
    if (ctx.json) { console.log(JSON.stringify(locks, null, 2)); return; }
    if (locks.length === 0) { logger.info("Aucun lock actif."); return; }
    logger.section("Locks actifs :");
    for (const l of locks) {
      const exp = l.expiresAt ? ` (expire: ${l.expiresAt})` : "";
      logger.keyValue(l.resource, `${l.holder}${exp}`);
    }
  }
}

export class LockReleaseCommand extends BaseCommand {
  name = "release";
  description = "Libère un lock (force)";
  args = [{ name: "resource", required: true }];
  async run(ctx: CommandContext, resource?: string) {
    runMigrations();
    if (!resource) { logger.error("Usage : dnx lock release <resource>"); process.exit(1); }
    const released = forceRelease(resource);
    if (released) logger.success(`Lock "${resource}" libéré.`);
    else logger.warn(`Lock "${resource}" introuvable.`);
  }
}

export class LockCommand extends BaseCommand {
  name = "lock";
  description = "Gère les verrous de déploiement";
  options = [];
  subcommands = [new LockListCommand(), new LockReleaseCommand()];
  async run(_ctx: CommandContext) {}
}
