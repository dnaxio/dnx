import { BaseCommand, type CommandContext } from "../command.ts";
import { logger, spinner } from "../output.ts";
import { initKeyring, forceInitKeyring, hasKey, getKeyPath } from "../../secrets/keyring.ts";
import { setSecret, listSecrets, removeSecret, extractSecrets, initStore } from "../../secrets/manager.ts";

export class SecretsInitCommand extends BaseCommand {
  name = "init";
  description = "Génère la clé maîtresse de chiffrement";
  options = [
    { flags: "-f, --force", description: "Régénère la clé existante" },
  ];

  async run(ctx: CommandContext, opts?: Record<string, unknown>) {
    initStore();
    if (opts?.force) {
      await forceInitKeyring();
    } else {
      await initKeyring();
    }
    if (!ctx.json) {
      logger.info(`Clé stockée : ${getKeyPath()}`);
    }
  }
}

export class SecretsSetCommand extends BaseCommand {
  name = "set";
  description = "Définit un secret chiffré";
  args = [
    { name: "entry", description: "KEY=VALUE", required: true },
  ];
  options = [
    { flags: "--env <env>", description: "Environnement cible", defaultValue: "all" },
  ];

  async run(ctx: CommandContext, entry?: string, opts?: Record<string, unknown>) {
    initStore();
    if (!entry || !entry.includes("=")) {
      logger.error("Format attendu : KEY=VALUE");
      process.exit(1);
    }

    const [key, ...rest] = entry.split("=");
    const value = rest.join("=");
    const env = (opts?.env as string) ?? "all";

    if (!key || !value) {
      logger.error("La clé et la valeur sont obligatoires.");
      process.exit(1);
    }

    await setSecret(key, value, env);
  }
}

export class SecretsExtractCommand extends BaseCommand {
  name = "extract";
  description = "Extrait les secrets déchiffrés";
  options = [
    { flags: "--env <env>", description: "Environnement cible", defaultValue: "production" },
    { flags: "--format <format>", description: "Format: env ou json", defaultValue: "env" },
  ];

  async run(ctx: CommandContext, opts?: Record<string, unknown>) {
    initStore();
    const env = (opts?.env as string) ?? "production";
    const format = (opts?.format as string) ?? "env";

    if (!hasKey()) {
      logger.error("Clé maîtresse introuvable. Exécutez 'dnx secrets init'.");
      process.exit(1);
    }

    const secrets = await extractSecrets(env);

    if (ctx.json || format === "json") {
      console.log(JSON.stringify(secrets, null, 2));
      return;
    }

    for (const [key, value] of Object.entries(secrets)) {
      console.log(`${key}=${value}`);
    }
  }
}

export class SecretsPrintCommand extends BaseCommand {
  name = "print";
  description = "Liste les clés des secrets (sans les valeurs)";
  options = [
    { flags: "--env <env>", description: "Filtrer par environnement" },
  ];

  async run(ctx: CommandContext, opts?: Record<string, unknown>) {
    initStore();
    const env = opts?.env as string | undefined;
    const secrets = listSecrets(env);

    if (ctx.json) {
      console.log(JSON.stringify(secrets.map(s => ({ key: s.key, environment: s.environment, created: s.created_at })), null, 2));
      return;
    }

    if (secrets.length === 0) {
      logger.info("Aucun secret stocké.");
      return;
    }

    logger.section("Secrets :");
    for (const s of secrets) {
      logger.keyValue(s.key, `[${s.environment}]  ${s.created_at}`);
    }
  }
}

export class SecretsRemoveCommand extends BaseCommand {
  name = "remove";
  description = "Supprime un secret";
  args = [
    { name: "key", description: "Clé du secret", required: true },
  ];
  options = [
    { flags: "--env <env>", description: "Environnement", defaultValue: "all" },
  ];

  async run(ctx: CommandContext, key?: string, opts?: Record<string, unknown>) {
    initStore();
    if (!key) {
      logger.error("Usage : dnx secrets remove <KEY>");
      process.exit(1);
    }

    const env = (opts?.env as string) ?? "all";
    const removed = removeSecret(key, env);

    if (removed) {
      logger.success(`Secret "${key}" supprimé [${env}]`);
    } else {
      logger.warn(`Secret "${key}" introuvable [${env}]`);
    }
  }
}

export class SecretsCommand extends BaseCommand {
  name = "secrets";
  description = "Gère les secrets chiffrés (AES-256-GCM)";
  options = [];
  subcommands = [
    new SecretsInitCommand(),
    new SecretsSetCommand(),
    new SecretsExtractCommand(),
    new SecretsPrintCommand(),
    new SecretsRemoveCommand(),
  ];

  async run(_ctx: CommandContext) {}
}
