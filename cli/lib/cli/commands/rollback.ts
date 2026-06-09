import { BaseCommand, type CommandContext } from "../command.ts";
import { logger } from "../output.ts";
import { loadConfig } from "../../config/loader.ts";
import { SSHPool } from "../../ssh/pool.ts";

export class RollbackCommand extends BaseCommand {
  name = "rollback";
  description = "List releases or rollback to a specific release version";
  args = [{ name: "workload", required: true }];
  options = [
    { flags: "--env <env>", defaultValue: "staging" },
    {
      flags: "--tag <tag>",
      description: "Release version tag (omit to list releases)",
    },
  ];

  async run(
    ctx: CommandContext,
    workloadName?: string,
    opts?: Record<string, unknown>,
  ) {
    if (!workloadName) {
      logger.error("Usage: dnx rollback <workload>");
      process.exit(1);
    }
    const env = (opts?.env as string) ?? "staging";
    const { config } = loadConfig(ctx.cwd, env);
    const servers = config.environments[env]?.servers ?? [];
    if (servers.length === 0) {
      logger.error("No servers.");
      process.exit(1);
    }

    if (!opts?.tag) {
      const srv = servers[0]!;
      const pool = new SSHPool([
        {
          host: srv.host,
          port: srv.port,
          username: srv.user,
          password: srv.password,
        },
      ]);
      const results = await pool.executeAll(
        `ls -1t $HOME/.dnx/workloads/${workloadName}/releases/ 2>/dev/null || echo "NO_RELEASES"`,
      );
      for (const r of results) {
        if (r.stdout.trim() && !r.stdout.includes("NO_RELEASES")) {
          console.log(`\n  Releases for ${workloadName} on ${r.host}:`);
          for (const line of r.stdout.trim().split("\n")) {
            console.log(`    ${line}`);
          }
        } else {
          logger.info(`No releases on ${r.host}`);
        }
      }
      return;
    }

    const tag = opts?.tag as string;
    logger.title(`Rollback: ${workloadName} → ${tag}`);

    const pool = new SSHPool(
      servers.map((s) => ({
        host: s.host,
        port: s.port,
        username: s.user,
        password: s.password,
      })),
    );
    const results = await pool.executeAll(
      `docker stop ${workloadName} 2>/dev/null; ` +
        `docker rm ${workloadName} 2>/dev/null; ` +
        `if [ -d "$HOME/.dnx/workloads/${workloadName}/releases/${tag}" ]; then ` +
        `ln -sfn releases/${tag} $HOME/.dnx/workloads/${workloadName}/current && ` +
        `docker network create dnx 2>/dev/null; ` +
        `docker run -dit --name ${workloadName} --network dnx -v $HOME/.dnx/workloads/${workloadName}/current:/app -w /app ${workloadName}:latest && ` +
        `echo ROLLBACK_OK; ` +
        `else echo "RELEASE_NOT_FOUND"; fi`,
    );
    for (const r of results) {
      if (r.stdout.includes("ROLLBACK_OK"))
        logger.success(`${r.host}: rolled back to ${tag}`);
      else if (r.stdout.includes("RELEASE_NOT_FOUND"))
        logger.error(`${r.host}: release "${tag}" not found`);
      else logger.error(`${r.host}: ${r.stdout || r.stderr || "failed"}`);
    }
  }
}
