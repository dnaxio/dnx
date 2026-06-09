/**
 * Variable resolver for DNX configuration files.
 *
 * Supported patterns:
 *   ${ENV_VAR}         → Resolves from process.env
 *   ${ENV_VAR:-default} → Resolves with fallback default value
 *   ${secret:KEY}      → Resolves from decrypted secrets store (requires Phase 3)
 *   {{ .Field }}       → Contextual template variables (Environment, Branch, etc.)
 */

export interface ResolverContext {
  /** Current environment name (staging, test, production) */
  environment?: string;
  /** Current branch name */
  branch?: string;
  /** Current app name */
  appName?: string;
  /** Current commit hash */
  commitHash?: string;
  /** Custom variables */
  vars?: Record<string, string>;
  /** Secret resolver function (provided by Phase 3) */
  resolveSecret?: (key: string) => string | undefined;
}

const ENV_VAR_RE = /\$\{(\w+)(?::-([^}]*))?\}/g;
const ENV_VAR_SHORT_RE = /\$(\w+)/g;
const SECRET_RE = /\$\{secret:(\w+)\}/g;
const TEMPLATE_RE = /\{\{\s*\.(\w+)\s*\}\}/g;

/**
 * Resolve all variable patterns in a string value.
 */
export function resolveString(value: string, ctx: ResolverContext): string {
  let resolved = value;

  // 1. Resolve ${secret:KEY} — depends on Phase 3
  resolved = resolved.replace(SECRET_RE, (_match, key: string) => {
    if (ctx.resolveSecret) {
      const secret = ctx.resolveSecret(key);
      if (secret !== undefined) return secret;
    }
    // If secrets module is not available, leave unresolved
    // (will be resolved at deploy time or flagged as error depending on strict mode)
    return `\${secret:${key}}`;
  });

  // 2. Resolve ${ENV_VAR} and ${ENV_VAR:-default}
  resolved = resolved.replace(
    ENV_VAR_RE,
    (_match, name: string, fallback: string | undefined) => {
      const envValue = process.env[name];
      if (envValue !== undefined) return envValue;
      if (fallback !== undefined) return fallback;
      // Leave unresolved — will be flagged by strict validation
      return `\${${name}}`;
    },
  );

  // 3. Resolve $VAR (shorthand without braces)
  resolved = resolved.replace(ENV_VAR_SHORT_RE, (_match, name: string) => {
    const envValue = process.env[name];
    if (envValue !== undefined) return envValue;
    return `$${name}`;
  });

  return resolved;
}

/**
 * Resolve contextual template variables {{ .Field }} in a string.
 */
export function resolveTemplate(value: string, ctx: ResolverContext): string {
  return value.replace(TEMPLATE_RE, (_match, field: string) => {
    switch (field) {
      case "Environment":
        return ctx.environment ?? "unknown";
      case "Branch":
        return ctx.branch ?? "unknown";
      case "AppName":
        return ctx.appName ?? "unknown";
      case "CommitHash":
        return ctx.commitHash ?? "unknown";
      default:
        return ctx.vars?.[field] ?? `{{ .${field} }}`;
    }
  });
}

/**
 * Resolve all patterns in a single string (both env vars, secrets, and templates).
 */
export function resolve(value: string, ctx: ResolverContext): string {
  let result = resolveString(value, ctx);
  result = resolveTemplate(result, ctx);
  return result;
}

/**
 * Recursively resolve all variables in a config object.
 * Walks through the entire object tree and resolves strings.
 */
export function resolveConfig<T>(config: T, ctx: ResolverContext): T {
  if (typeof config === "string") {
    return resolve(config, ctx) as unknown as T;
  }

  if (Array.isArray(config)) {
    return config.map((item) => resolveConfig(item, ctx)) as unknown as T;
  }

  if (typeof config === "object" && config !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      config as Record<string, unknown>,
    )) {
      result[key] = resolveConfig(value, ctx);
    }
    return result as T;
  }

  return config;
}

/**
 * Find all unresolved variables in a config object.
 * Used for strict validation — if any ${VAR} or ${secret:KEY} remain after resolution, error.
 */
export function findUnresolved(value: unknown, path = ""): string[] {
  const unresolved: string[] = [];

  if (typeof value === "string") {
    const envMatches = value.matchAll(ENV_VAR_RE);
    for (const match of envMatches) {
      unresolved.push(`${path}: \${${match[1]}} could not be resolved`);
    }
    const secretMatches = value.matchAll(SECRET_RE);
    for (const match of secretMatches) {
      unresolved.push(
        `${path}: \${secret:${match[1]}} — secrets module not available`,
      );
    }
  } else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      unresolved.push(...findUnresolved(value[i], `${path}[${i}]`));
    }
  } else if (typeof value === "object" && value !== null) {
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      unresolved.push(...findUnresolved(val, path ? `${path}.${key}` : key));
    }
  }

  return unresolved;
}
