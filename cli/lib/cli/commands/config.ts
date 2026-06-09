import { BaseCommand, type CommandContext } from "../command.ts";
import { logger } from "../output.ts";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { parse as parseYaml } from "yaml";
import type { DnxConfig } from "../../config/schema.ts";

export class ConfigValidateCommand extends BaseCommand {
  name = "validate";
  description = "Valide le fichier .dnax/dnx.yaml";
  options = [
    {
      flags: "-f, --file <path>",
      description: "Chemin vers le dnx.yaml",
      defaultValue: ".dnax/dnx.yaml",
    },
  ];

  async run(ctx: CommandContext, opts?: Record<string, unknown>) {
    const fileName = (opts?.file as string) ?? "dnx.yaml";
    const filePath = resolve(ctx.cwd, fileName);

    if (!existsSync(filePath)) {
      logger.error(`Fichier introuvable : ${filePath}`);
      process.exit(1);
    }

    try {
      const raw = readFileSync(filePath, "utf-8");
      const parsed = parseYaml(raw);

      if (!parsed || typeof parsed !== "object") {
        logger.error("Le fichier YAML est vide ou invalide.");
        process.exit(1);
      }

      if ((parsed as Record<string, unknown>).version !== "1") {
        logger.warn(
          `Version "${(parsed as Record<string, unknown>).version}" — "1" attendue.`,
        );
      }

      // Basic structure validation
      const cfg = parsed as Record<string, unknown>;
      const checks: { field: string; valid: boolean }[] = [
        { field: "version", valid: cfg.version === "1" },
        {
          field: "name",
          valid: typeof cfg.name === "string" && cfg.name.length > 0,
        },
        {
          field: "environments",
          valid:
            typeof cfg.environments === "object" && cfg.environments !== null,
        },
        { field: "workloads", valid: Array.isArray(cfg.workloads) },
      ];

      logger.section(`Validation de ${fileName}`);
      let allValid = true;
      for (const check of checks) {
        const icon = check.valid ? "✔" : "✖";
        logger[check.valid ? "success" : "error"](`${icon} ${check.field}`);
        if (!check.valid) allValid = false;
      }

      if (!allValid) {
        logger.error("\nDes champs obligatoires sont manquants ou invalides.");
        process.exit(1);
      }

      logger.success(`\n${fileName} est valide !`);
      logger.info(`Projet : ${cfg.name}`);
      const envs = Object.keys(cfg.environments as Record<string, unknown>);
      logger.info(`Environnements : ${envs.join(", ")}`);
      const apps = cfg.workloads as Array<Record<string, unknown>>;
      logger.info(
        `Applications : ${apps.length} (${apps.map((a) => a.name).join(", ")})`,
      );
    } catch (err) {
      logger.error(`Erreur de parsing YAML : ${(err as Error).message}`);
      process.exit(1);
    }
  }
}

export class ConfigShowCommand extends BaseCommand {
  name = "show";
  description = "Affiche la configuration résolue";
  options = [
    {
      flags: "-f, --file <path>",
      description: "Chemin vers le dnx.yaml",
      defaultValue: ".dnax/dnx.yaml",
    },
    { flags: "--env <env>", description: "Environnement à afficher" },
  ];

  async run(ctx: CommandContext, opts?: Record<string, unknown>) {
    const fileName = (opts?.file as string) ?? ".dnax/dnx.yaml";
    const filePath = resolve(ctx.cwd, fileName);

    if (!existsSync(filePath)) {
      logger.error(`Fichier introuvable : ${filePath}`);
      process.exit(1);
    }

    const raw = readFileSync(filePath, "utf-8");
    const parsed = parseYaml(raw);

    if (ctx.json) {
      console.log(JSON.stringify(parsed, null, 2));
      return;
    }

    const cfg = parsed as Record<string, unknown>;
    logger.title(cfg.name as string);
    logger.section("Environnements :");
    const envs = cfg.environments as Record<string, Record<string, unknown>>;
    const targetEnv = (opts?.env as string) ?? null;

    for (const [envName, envCfg] of Object.entries(envs)) {
      if (targetEnv && envName !== targetEnv) continue;
      logger.keyValue(envName, "");
      const servers = envCfg.servers as Array<Record<string, unknown>>;
      if (Array.isArray(servers)) {
        for (const srv of servers) {
          console.log(`    • ${srv.name} (${srv.host}:${srv.port ?? 22})`);
        }
      }
      if (envCfg.deploy_strategy) {
        console.log(`    Stratégie : ${envCfg.deploy_strategy}`);
      }
    }

    logger.section("Applications :");
    const apps = cfg.workloads as Array<Record<string, unknown>>;
    for (const app of apps) {
      const driver = app.driver as string;
      logger.keyValue(
        app.name as string,
        `${driver ?? "flox"} | ${(app.ports as number[])?.join(", ") ?? "?"}`,
      );
    }
  }
}

export class ConfigDiffCommand extends BaseCommand {
  name = "diff";
  description = "Affiche les différences entre deux environnements";
  args = [
    { name: "env1", description: "Premier environnement", required: true },
    { name: "env2", description: "Second environnement", required: true },
  ];
  options = [
    {
      flags: "-f, --file <path>",
      description: "Chemin vers le dnx.yaml",
      defaultValue: ".dnax/dnx.yaml",
    },
  ];

  async run(
    ctx: CommandContext,
    env1?: string,
    env2?: string,
    opts?: Record<string, unknown>,
  ) {
    const fileName = (opts?.file as string) ?? ".dnax/dnx.yaml";
    const filePath = resolve(ctx.cwd, fileName);

    if (!existsSync(filePath)) {
      logger.error(`Fichier introuvable : ${filePath}`);
      process.exit(1);
    }

    if (!env1 || !env2) {
      logger.error("Usage : dnx config diff <env1> <env2>");
      logger.info("Exemple : dnx config diff staging production");
      process.exit(1);
    }

    const raw = readFileSync(filePath, "utf-8");
    const parsed = parseYaml(raw) as Record<string, unknown>;
    const envs = parsed.environments as Record<string, Record<string, unknown>>;

    if (!envs[env1]) {
      logger.error(`Environnement "${env1}" introuvable.`);
      process.exit(1);
    }
    if (!envs[env2]) {
      logger.error(`Environnement "${env2}" introuvable.`);
      process.exit(1);
    }

    const diff = computeDiff(envs[env1]!, envs[env2]!);

    logger.title(`Diff : ${env1} ⟷ ${env2}`);

    if (ctx.json) {
      console.log(JSON.stringify(diff, null, 2));
      return;
    }

    if (diff.length === 0) {
      logger.success("Les deux environnements sont identiques.");
      return;
    }

    for (const entry of diff) {
      const prefix =
        entry.type === "added" ? "+" : entry.type === "removed" ? "-" : "~";
      const msg = `  ${prefix} ${entry.path}: ${entry.value1 ?? "—"} → ${entry.value2 ?? "—"}`;
      if (entry.type === "added") logger.success(msg);
      else if (entry.type === "removed") logger.error(msg);
      else logger.warn(msg);
    }
  }
}

interface DiffEntry {
  path: string;
  type: "added" | "removed" | "changed";
  value1: unknown;
  value2: unknown;
}

function computeDiff(
  env1: Record<string, unknown>,
  env2: Record<string, unknown>,
  prefix = "",
): DiffEntry[] {
  const allKeys = new Set([...Object.keys(env1), ...Object.keys(env2)]);
  const diffs: DiffEntry[] = [];

  for (const key of allKeys) {
    const path = prefix ? `${prefix}.${key}` : key;
    const v1 = env1[key];
    const v2 = env2[key];

    if (v1 === undefined && v2 !== undefined) {
      diffs.push({ path, type: "added", value1: undefined, value2: v2 });
    } else if (v1 !== undefined && v2 === undefined) {
      diffs.push({ path, type: "removed", value1: v1, value2: undefined });
    } else if (
      typeof v1 === "object" &&
      typeof v2 === "object" &&
      v1 !== null &&
      v2 !== null &&
      !Array.isArray(v1) &&
      !Array.isArray(v2)
    ) {
      diffs.push(
        ...computeDiff(
          v1 as Record<string, unknown>,
          v2 as Record<string, unknown>,
          path,
        ),
      );
    } else if (JSON.stringify(v1) !== JSON.stringify(v2)) {
      diffs.push({ path, type: "changed", value1: v1, value2: v2 });
    }
  }

  return diffs;
}

export class ConfigCommand extends BaseCommand {
  name = "config";
  description = "Gère la configuration DNX";
  options = [];
  subcommands = [
    new ConfigValidateCommand(),
    new ConfigShowCommand(),
    new ConfigDiffCommand(),
  ];

  async run(_ctx: CommandContext) {
    // Delegates to subcommands
  }
}
