#!/usr/bin/env bun

import "@colors/colors";

import { loadEnvFiles } from "./utils/env.ts";
import { DnxProgram } from "./cli/program.ts";
import { InitCommand } from "./cli/commands/init.ts";
import { VersionCommand } from "./cli/commands/version.ts";
import { ConfigCommand } from "./cli/commands/config.ts";
import { SecretsCommand } from "./cli/commands/secrets.ts";
import { BuildCommand } from "./cli/commands/build.ts";
import { DeployCommand } from "./cli/commands/deploy.ts";
import { ProxyCommand } from "./cli/commands/proxy.ts";
import { AgentCommand } from "./cli/commands/agent.ts";
import { OciCommand } from "./cli/commands/oci.ts";
import { WorkloadCommand } from "./cli/commands/workload.ts";
import { ServiceCommand } from "./cli/commands/service.ts";
import { LockCommand } from "./cli/commands/lock.ts";
import { HealthCommand } from "./cli/commands/health.ts";
import { RollbackCommand } from "./cli/commands/rollback.ts";
import { SetupCommand } from "./cli/commands/setup.ts";
import { StatusCommand } from "./cli/commands/status.ts";
import { LogsCommand } from "./cli/commands/logs.ts";

const program = new DnxProgram();

program.register([
  new InitCommand(),
  new ConfigCommand(),
  new SecretsCommand(),
  new BuildCommand(),
  new DeployCommand(),
  new ProxyCommand(),
  new AgentCommand(),
  new OciCommand(),
  new WorkloadCommand(),
  new ServiceCommand(),
  new LockCommand(),
  new HealthCommand(),
  new RollbackCommand(),
  new SetupCommand(),
  new StatusCommand(),
  new LogsCommand(),
  new VersionCommand(),
]);

// Load .env and .env.local at startup (env-specific files loaded when env is known)
loadEnvFiles(process.cwd());

program.run();
