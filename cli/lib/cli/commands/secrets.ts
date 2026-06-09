import { BaseCommand, type CommandContext } from "../command.ts";
import { logger, spinner } from "../output.ts";
import {
  initKeyring,
  forceInitKeyring,
  hasKey,
  getKeyPath,
} from "../../secrets/keyring.ts";
import {
  setSecret,
  listSecrets,
  removeSecret,
  extractSecrets,
  initStore,
} from "../../secrets/manager.ts";

export class SecretsInitCommand extends BaseCommand {
  name = "init";
  description = "Generate master encryption key";
  options = [{ flags: "-f, --force", description: "Regenerate existing key" }];

  async run(ctx: CommandContext, opts?: Record<string, unknown>) {
    initStore();
    if (opts?.force) {
      await forceInitKeyring();
    } else {
      await initKeyring();
    }
    if (!ctx.json) {
      logger.info(`Key stored at: ${getKeyPath()}`);
    }
  }
}

export class SecretsSetCommand extends BaseCommand {
  name = "set";
  description = "Set an encrypted secret";
  args = [{ name: "entry", description: "KEY=VALUE", required: true }];
  options = [
    {
      flags: "--env <env>",
      description: "Target environment",
      defaultValue: "all",
    },
  ];

  async run(
    ctx: CommandContext,
    entry?: string,
    opts?: Record<string, unknown>,
  ) {
    initStore();
    if (!entry || !entry.includes("=")) {
      logger.error("Expected format: KEY=VALUE");
      process.exit(1);
    }

    const [key, ...rest] = entry.split("=");
    const value = rest.join("=");
    const env = (opts?.env as string) ?? "all";

    if (!key || !value) {
      logger.error("Key and value are required.");
      process.exit(1);
    }

    await setSecret(key, value, env);
  }
}

export class SecretsExtractCommand extends BaseCommand {
  name = "extract";
  description = "Extract decrypted secrets";
  options = [
    {
      flags: "--env <env>",
      description: "Target environment",
      defaultValue: "production",
    },
    {
      flags: "--format <format>",
      description: "Format: env or json",
      defaultValue: "env",
    },
  ];

  async run(ctx: CommandContext, opts?: Record<string, unknown>) {
    initStore();
    const env = (opts?.env as string) ?? "production";
    const format = (opts?.format as string) ?? "env";

    if (!hasKey()) {
      logger.error("Master key not found. Run 'dnx secrets init'.");
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
  description = "List secret keys (without values)";
  options = [{ flags: "--env <env>", description: "Filter by environment" }];

  async run(ctx: CommandContext, opts?: Record<string, unknown>) {
    initStore();
    const env = opts?.env as string | undefined;
    const secrets = listSecrets(env);

    if (ctx.json) {
      console.log(
        JSON.stringify(
          secrets.map((s) => ({
            key: s.key,
            environment: s.environment,
            created: s.created_at,
          })),
          null,
          2,
        ),
      );
      return;
    }

    if (secrets.length === 0) {
      logger.info("No secrets stored.");
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
  description = "Remove a secret";
  args = [{ name: "key", description: "Secret key", required: true }];
  options = [
    { flags: "--env <env>", description: "Environment", defaultValue: "all" },
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
      logger.success(`Secret "${key}" removed [${env}]`);
    } else {
      logger.warn(`Secret "${key}" not found [${env}]`);
    }
  }
}

export class SecretsCommand extends BaseCommand {
  name = "secrets";
  description = "Manage encrypted secrets (AES-256-GCM)";
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
