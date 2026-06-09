import { BaseCommand, type CommandContext } from "../command.ts";
import { logger, spinner } from "../output.ts";
import { loadConfig } from "../../config/loader.ts";
import {
  runProbe,
  runProbeWithRetries,
  type ProbeConfig,
} from "../../health/probes.ts";
import { recordCheck, getAllStates, getState } from "../../health/alert.ts";
import { runMigrations } from "../../db/connection.ts";

export class HealthCheckCommand extends BaseCommand {
  name = "check";
  description = "Check health of a workload";
  args = [{ name: "target", description: "workload name" }];
  options = [{ flags: "--env <env>", defaultValue: "staging" }];

  async run(
    ctx: CommandContext,
    target?: string,
    opts?: Record<string, unknown>,
  ) {
    runMigrations();
    const env = (opts?.env as string) ?? "staging";
    const { config } = loadConfig(ctx.cwd, env);

    if (target) {
      const wl = config.workloads.find((w) => w.name === target);
      if (wl) {
        await checkWorkload(
          wl.name,
          wl.health,
          config.environments[env as any]?.servers ?? [],
        );
      } else {
        logger.error(`Workload "${target}" not found.`);
      }
    } else {
      logger.title(`Health Check — ${env}`);
      for (const wl of config.workloads) {
        await checkWorkload(
          wl.name,
          wl.health,
          config.environments[env as any]?.servers ?? [],
        );
      }
    }
  }
}

async function checkWorkload(
  name: string,
  health: any,
  servers: Array<{ name: string; host: string }>,
) {
  const cfg: ProbeConfig = {
    type: health?.type ?? "http",
    endpoint: health?.endpoint ?? `http://localhost:${3000}/health`,
    timeout: health?.timeout ? parseDuration(health.timeout) : 5000,
    retries: health?.retries ?? 3,
  };

  for (const srv of servers) {
    const result = await runProbeWithRetries(cfg);
    const status = recordCheck(
      "workload",
      name,
      srv.name,
      result.success,
      result.responseTimeMs,
      result.error,
    );
    const icon =
      status === "healthy" ? "🟢" : status === "degraded" ? "🟡" : "🔴";
    logger.keyValue(
      `${name}@${srv.name}`,
      `${icon} ${result.responseTimeMs}ms${result.error ? ` — ${result.error}` : ""}`,
    );
  }
}

export class HealthWatchCommand extends BaseCommand {
  name = "watch";
  description = "Continuous health monitoring";
  args = [{ name: "target", description: "workload name" }];
  options = [
    { flags: "--env <env>", defaultValue: "staging" },
    {
      flags: "-i, --interval <s>",
      description: "Interval in seconds",
      defaultValue: "30",
    },
  ];

  async run(
    ctx: CommandContext,
    target?: string,
    opts?: Record<string, unknown>,
  ) {
    runMigrations();
    const interval = parseInt((opts?.interval as string) ?? "30") * 1000;
    logger.info(`Watching every ${interval / 1000}s — Ctrl+C to stop`);

    const check = async () => {
      const checkCmd = new HealthCheckCommand();
      await checkCmd.run(ctx, target, opts);
    };

    await check();
    setInterval(check, interval);

    await new Promise(() => {});
  }
}

export class HealthHistoryCommand extends BaseCommand {
  name = "history";
  description = "Health check history";
  options = [
    { flags: "--workload <name>" },
    { flags: "--since <duration>", defaultValue: "1h" },
  ];
  async run(ctx: CommandContext, opts?: Record<string, unknown>) {
    runMigrations();
    const db = (await import("../../db/connection.ts")).getConnection();
    let query = "SELECT * FROM health_logs WHERE 1=1";
    const params: unknown[] = [];

    if (opts?.workload) {
      query += " AND target_type='workload' AND target_id=?";
      params.push(opts.workload);
    }

    query += " ORDER BY checked_at DESC LIMIT 50";
    const rows = db.query(query).all(...params) as any[];

    if (ctx.json) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    if (rows.length === 0) {
      logger.info("No history.");
      return;
    }
    logger.section("Health check history:");
    for (const r of rows) {
      const icon =
        r.status === "healthy" ? "🟢" : r.status === "degraded" ? "🟡" : "🔴";
      logger.keyValue(
        `${r.target_type}/${r.target_id}@${r.server_id}`,
        `${icon} ${r.status} (${r.response_time_ms}ms) — ${r.checked_at}`,
      );
    }
  }
}

export class HealthCommand extends BaseCommand {
  name = "health";
  description = "Health checks for workloads";
  options = [];
  subcommands = [
    new HealthCheckCommand(),
    new HealthWatchCommand(),
    new HealthHistoryCommand(),
  ];
  async run(_ctx: CommandContext) {}
}

function parseDuration(s: string): number {
  if (s.endsWith("ms")) return parseInt(s);
  if (s.endsWith("s")) return parseInt(s) * 1000;
  if (s.endsWith("m")) return parseInt(s) * 60000;
  return parseInt(s) || 5000;
}
