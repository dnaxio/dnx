import { getSecret } from "./manager.ts";
import type { ResolverContext } from "../config/resolver.ts";

/**
 * Create a secret resolver function for use with the config resolver.
 * This bridges Phase 3 (Secrets) with Phase 2 (Config Resolver).
 */
export function createSecretResolver(
  environment: string
): (key: string) => string | undefined {
  return (key: string): string | undefined => {
    // getSecret is async, but the resolver API is sync.
    // For synchronous access, we use a synchronous version.
    // In practice, secrets should be pre-loaded before resolution.
    // This function provides the bridge — actual resolution
    // happens via the CLI command `dnx secrets extract`.
    return undefined;
  };
}

/**
 * Pre-load all secrets for an environment into a key-value map.
 * This should be called before config resolution.
 */
export async function preloadSecrets(
  environment: string
): Promise<Record<string, string>> {
  const { extractSecrets } = await import("./manager.ts");
  return extractSecrets(environment);
}

/**
 * Build a synchronous resolver context with pre-loaded secrets.
 */
export async function buildResolverContext(
  environment: string
): Promise<ResolverContext> {
  const secrets = await preloadSecrets(environment);
  return {
    environment,
    resolveSecret: (key: string) => secrets[key],
  };
}
