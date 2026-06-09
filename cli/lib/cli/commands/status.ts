import { BaseCommand, type CommandContext } from "../command.ts";
import { logger } from "../output.ts";
import { loadConfig } from "../../config/loader.ts";
import { SSHPool } from "../../ssh/pool.ts";
import { formatPorts } from "../../utils/docker.ts";

export class StatusCommand extends BaseCommand {
  override name = "status";
  override description = "Show status of all deployed workloads";
  override args = [
    { name: "workload", description: "Workload name (optional)" },
  ];
  override options = [
    { flags: "--env <env>", description: "Filter by environment" },
    { flags: "--workload <name>", description: "Filter by workload" },
  ];

  override async run(
    ctx: CommandContext,
    workloadName?: string,
    opts?: Record<string, unknown>,
  ) {
    const { config } = loadConfig(ctx.cwd);
    const targetEnv = opts?.env as string | undefined;
    const targetWl = (opts?.workload as string) || workloadName;

    const rows: string[][] = [
      ["Name", "Type", "Env", "Server", "Status", "CPU", "RAM", "Tag", "Ports"],
    ];

    for (const [envName, envConfig] of Object.entries(config.environments)) {
      if (targetEnv && envName !== targetEnv) continue;
      for (const wl of config.workloads) {
        if (targetWl && wl.name !== targetWl) continue;
        for (const srv of envConfig.servers) {
          try {
            const pool = new SSHPool([
              {
                host: srv.host,
                port: srv.port,
                username: srv.user,
                password: srv.password,
              },
            ]);
            const results = await pool.executeAll(
              `docker ps --filter name=${wl.name} --format '{{.Status}}|{{.Image}}|{{.Ports}}' 2>/dev/null || echo "STOPPED|-|-"`,
            );
            const statsResults = await pool.executeAll(
              `docker stats --no-stream ${wl.name} 2>/dev/null | tail -1 | awk '{print $3, $4}' || echo "- -"`,
            );
            for (let i = 0; i < results.length; i++) {
              const r = results[i]!;
              const s = statsResults[i]!;
              const [status, image, rawPorts] = r.stdout.trim().split("|");
              const [cpu, ram] = s.stdout.trim().split(/\s+/);
              const icon = (status ?? "").startsWith("Up") ? "🟢" : "🔴";
              const tag = (image ?? "-").split(":").pop() || "-";
              const ports = formatPorts(rawPorts ?? "-");
              rows.push([
                wl.name,
                wl.type ?? "web",
                envName,
                srv.host,
                `${icon} ${status || "STOPPED"}`,
                cpu || "-",
                ram || "-",
                tag,
                ports,
              ]);
            }
          } catch {
            rows.push([
              wl.name,
              wl.type ?? "web",
              envName,
              srv.host,
              "🔴 unreachable",
              "-",
              "-",
              "-",
              "-",
            ]);
          }
        }
      }
    }

    if (ctx.json) {
      const headers = rows[0]!;
      const data = rows
        .slice(1)
        .map((r) =>
          Object.fromEntries(headers.map((h, i) => [h.toLowerCase(), r[i]])),
        );
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    if (rows.length === 1) {
      logger.info("No workloads deployed.");
      return;
    }
    logger.table(rows);
  }
}
