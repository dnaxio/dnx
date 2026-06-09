export { DnxProgram } from "./lib/cli/program.ts";
export { BaseCommand } from "./lib/cli/command.ts";
export type { CommandContext, CommandOption } from "./lib/cli/command.ts";
export { logger, icons, spinner, setLogLevel } from "./lib/cli/output.ts";
export { loadConfig, loadResolvedConfig } from "./lib/config/loader.ts";
export { deepMerge } from "./lib/config/merger.ts";
export {
  resolve,
  resolveConfig,
  resolveString,
  resolveTemplate,
  findUnresolved,
} from "./lib/config/resolver.ts";
export type { ResolverContext } from "./lib/config/resolver.ts";
export { DnxConfigSchema } from "./lib/config/schema.ts";
export type {
  DnxConfig,
  Workload,
  Server,
  Environment,
  ProxyRoute,
  Driver,
} from "./lib/config/schema.ts";
export {
  getConnection,
  runMigrations,
  closeConnection,
  getDbPath,
} from "./lib/db/connection.ts";
export { Repository } from "./lib/db/repository.ts";
export type { Row } from "./lib/db/repository.ts";
export {
  generateKey,
  encrypt,
  decrypt,
  pack,
  unpack,
  importKey,
  exportKey,
} from "./lib/utils/crypto.ts";
export type { EncryptedData } from "./lib/utils/crypto.ts";
export {
  initKeyring,
  forceInitKeyring,
  loadKey,
  hasKey,
  getKeyPath,
} from "./lib/secrets/keyring.ts";
export {
  setSecret,
  getSecret,
  listSecrets,
  removeSecret,
  extractSecrets,
  initStore,
} from "./lib/secrets/manager.ts";
export {
  createSecretResolver,
  preloadSecrets,
  buildResolverContext,
} from "./lib/secrets/extractor.ts";
export { SSHConnection } from "./lib/ssh/connection.ts";
export type { SSHConnectionOptions } from "./lib/ssh/connection.ts";
export { SSHPool } from "./lib/ssh/pool.ts";
export type { PoolOptions, ExecutionResult } from "./lib/ssh/pool.ts";
export { withRetry } from "./lib/ssh/retry.ts";
export type { RetryOptions } from "./lib/ssh/retry.ts";
