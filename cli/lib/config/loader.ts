import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { DnxConfigSchema, type DnxConfig } from "./schema.ts";
import { deepMerge } from "./merger.ts";
import {
  resolveConfig,
  findUnresolved,
  type ResolverContext,
} from "./resolver.ts";
import { logger } from "../cli/output.ts";

export interface LoadResult {
  config: DnxConfig;
  filePath: string;
}

/**
 * Load and validate dnx.yaml from the current directory.
 * Checks dnx.yaml first, then .dnax/dnx.yaml as fallback.
 */
export function loadConfig(cwd: string, env?: string): LoadResult {
  const candidates = ["dnx.yaml", "dnx.yml", ".dnax/dnx.yaml", ".dnax/dnx.yml"];
  let basePath: string | null = null;

  for (const candidate of candidates) {
    const p = resolve(cwd, candidate);
    if (existsSync(p)) {
      basePath = p;
      break;
    }
  }

  if (!basePath) {
    throw new Error("dnx.yaml not found. Run 'dnx init' to create a project.");
  }

  let raw = readFileSync(basePath, "utf-8");
  let parsed: unknown;

  try {
    parsed = parseYaml(raw);
  } catch (err) {
    throw new Error(
      `YAML parse error in ${basePath}: ${(err as Error).message}`,
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Empty or invalid config in ${basePath}`);
  }

  // If an environment-specific override exists, merge it
  if (env) {
    const envPaths = [`dnx.${env}.yaml`, `.dnax/dnx.${env}.yaml`];
    for (const envRelPath of envPaths) {
      const envPath = resolve(cwd, envRelPath);
      if (existsSync(envPath)) {
        try {
          const envRaw = readFileSync(envPath, "utf-8");
          const envParsed = parseYaml(envRaw) as Record<string, unknown>;
          parsed = deepMerge(parsed as Record<string, unknown>, envParsed);
          logger.debug(`Merged config with ${envRelPath}`);
          break;
        } catch (err) {
          logger.warn(`Error merging ${envRelPath}: ${(err as Error).message}`);
        }
      }
    }
  }

  // Validate with Zod
  const result = DnxConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }

  return { config: result.data, filePath: basePath };
}

/**
 * Load config with variable resolution applied.
 */
export function loadResolvedConfig(
  cwd: string,
  env?: string,
  ctx?: Partial<ResolverContext>,
): DnxConfig {
  const { config } = loadConfig(cwd, env);

  const resolverCtx: ResolverContext = {
    environment: env,
    ...ctx,
  };

  const resolved = resolveConfig(config, resolverCtx);

  const unresolved = findUnresolved(resolved);
  if (unresolved.length > 0) {
    logger.warn("Unresolved variables:");
    for (const msg of unresolved) {
      logger.warn(`  • ${msg}`);
    }
  }

  return resolved;
}

export { deepMerge };
