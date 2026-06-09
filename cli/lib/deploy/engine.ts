import type { DnxConfig, Server, Workload } from "../config/schema.ts";
import { SSHPool, type ExecutionResult } from "../ssh/pool.ts";
import { logger, spinner, type LogLevel } from "../cli/output.ts";
import { generateCaddyfile, type CaddyRoute } from "../proxy/caddyfile.ts";
import { recordRelease } from "./release.ts";
import { runMigrations } from "../db/connection.ts";
import chalk from "chalk";

export type DeployStrategy = "rolling" | "blue-green" | "canary";

export interface DeployOptions {
  environment: string;
  strategy?: DeployStrategy;
  timeout?: number;
  dryRun?: boolean;
  skipHealthCheck?: boolean;
  tag?: string;
}

export interface DeployResult {
  workloadName: string;
  environment: string;
  version: string;
  servers: string[];
  success: boolean;
  results: ExecutionResult[];
  durationMs: number;
  error?: string;
}

export async function deploy(
  config: DnxConfig,
  workloadName: string,
  opts: DeployOptions,
): Promise<DeployResult> {
  runMigrations();
  const startTime = Date.now();

  const workload = config.workloads.find((w) => w.name === workloadName);
  if (!workload) throw new Error(`Workload "${workloadName}" not found.`);

  const envConfig = config.environments[opts.environment];
  if (!envConfig)
    throw new Error(`Environment "${opts.environment}" not found.`);

  const servers = envConfig.servers;
  const version = opts.tag
    ? `${opts.environment}-${Date.now()}-${opts.tag}`
    : `${opts.environment}-${Date.now()}`;
  const strategy =
    opts.strategy ?? (envConfig.deploy_strategy as DeployStrategy) ?? "rolling";

  logger.section(`Deploy ${workloadName} → ${opts.environment}`);
  logger.info(
    `Driver : ${workload.driver} | Strategy : ${strategy} | Servers : ${servers.length}`,
  );
  for (const s of servers) {
    logger.info(`${s.name || s.host} (${s.host}:${s.port ?? 22})`);
  }

  if (opts.dryRun) {
    logger.warn("Dry-run mode — no changes will be made.");
    return {
      workloadName,
      environment: opts.environment,
      version,
      servers: servers.map((s) => s.name || s.host),
      success: true,
      results: [],
      durationMs: Date.now() - startTime,
    };
  }

  const pool = new SSHPool(
    servers.map((s) => ({
      host: s.host,
      port: s.port ?? 22,
      username: s.user ?? "root",
      password: s.password,
      timeout: opts.timeout ?? 30,
    })),
  );

  try {
    const prereqSpin = spinner("Checking prerequisites...");
    await ensurePrerequisites(pool);
    prereqSpin.succeed("Prerequisites checked");

    const wlPayload = {
      start_cmd: workload.start_cmd,
      ports: workload.ports as number[],
      env: workload.env as Record<string, string>,
      driver: workload.driver,
      restart: workload.restart,
      work_dir: workload.workdir,
      volumes: workload.volumes,
      resources: workload.resources,
      _tag: opts.tag,
      _buildSteps: workload.build?.server?.steps as
        | { run: string; env?: Record<string, string> }[]
        | undefined,
    };

    const results = await executeStrategy(
      pool,
      workloadName,
      wlPayload,
      servers,
      version,
      strategy,
      workload.sync,
    );

    if (config.proxy?.routes.length) {
      const proxySpin = spinner("Updating Caddy proxy...");
      await updateProxy(pool, config.proxy.routes, config.proxy.email);
      proxySpin.succeed("Caddy proxy updated");
    }

    for (const server of servers) {
      recordRelease(
        workloadName,
        server.name || server.host,
        version,
        `$HOME/.dnx/workloads/${workloadName}/releases/${version}`,
      );
    }

    return {
      workloadName,
      environment: opts.environment,
      version,
      servers: servers.map((s) => s.name || s.host),
      success: results.every((r) => r.exitCode === 0),
      durationMs: Date.now() - startTime,
      results,
    };
  } catch (err) {
    return {
      workloadName,
      environment: opts.environment,
      version,
      servers: servers.map((s) => s.name || s.host),
      success: false,
      durationMs: Date.now() - startTime,
      results: [],
      error: (err as Error).message,
    };
  }
}

async function ensurePrerequisites(pool: SSHPool): Promise<void> {
  const checks = ["which tar && which curl && which git"];
  const checkResults = await pool.executeAll(
    checks.join(" && ") + " && echo OK || echo MISSING",
  );
  const missing = checkResults.filter((r) => !r.stdout.includes("OK"));
  if (missing.length > 0) {
    const names = missing.map((r) => r.host).join(", ");
    logger.warn(`Missing dependencies on : ${names}`);
    logger.info(`Run 'dnx setup' to install them.`);
  }
}

async function executeStrategy(
  pool: SSHPool,
  workloadName: string,
  workload: {
    start_cmd?: string;
    ports?: number[];
    env?: Record<string, string>;
    driver?: string;
    restart?: string;
    work_dir?: string;
    volumes?: string[];
    resources?: { cpu?: string; memory?: string };
    _tag?: string;
    _buildSteps?: { run: string; env?: Record<string, string> }[];
  },
  servers: Server[],
  version: string,
  strategy: DeployStrategy,
  syncConfig?: {
    source: string;
    exclude: string[];
    include?: string[];
    force?: boolean;
  },
): Promise<ExecutionResult[]> {
  const allResults: ExecutionResult[] = [];
  if (strategy === "rolling") {
    for (const server of servers) {
      const deploySpin = spinner(
        `Deploying to ${server.name || server.host} (${server.host})...`,
      );
      const singlePool = new SSHPool([
        { host: server.host, username: server.user, port: server.port },
      ]);
      allResults.push(
        ...(await deployToServers(
          singlePool,
          workloadName,
          version,
          syncConfig,
          workload.driver,
          workload.start_cmd,
          workload.ports,
          workload.restart,
          workload.work_dir,
          workload.volumes,
          workload.resources,
          workload._tag,
          workload._buildSteps,
        )),
      );
      deploySpin.succeed(
        `Deployed to ${server.name || server.host} (${server.host})`,
      );
    }
  } else {
    allResults.push(
      ...(await deployToServers(
        pool,
        workloadName,
        version,
        syncConfig,
        workload.driver,
        workload.start_cmd,
        workload.ports,
        workload.restart,
        workload.work_dir,
        workload.volumes,
        workload.resources,
        workload._tag,
        workload._buildSteps,
      )),
    );
  }
  return allResults;
}

async function deployToServers(
  pool: SSHPool,
  workloadName: string,
  version: string,
  syncConfig?: {
    source: string;
    exclude: string[];
    include?: string[];
    force?: boolean;
  },
  driver?: string,
  startCmd?: string,
  ports?: number[],
  restart?: string,
  workDir?: string,
  volumes?: string[],
  resources?: { cpu?: string; memory?: string },
  tag?: string,
  buildSteps?: { run: string; env?: Record<string, string> }[],
): Promise<ExecutionResult[]> {
  logger.info(`Deploying with tag: ${tag || "latest"}`);
  const source = syncConfig?.source ?? ".";
  const portFlags = (ports ?? [])
    .map((p) => (typeof p === "number" ? `-p ${p}:${p}` : `-p ${p}`))
    .join(" ");
  const volumeFlags = (volumes ?? []).map((v) => `-v ${v}`).join(" ");
  const resourceFlags = [
    resources?.cpu ? `--cpus ${resources.cpu}` : null,
    resources?.memory ? `--memory ${resources.memory}` : null,
  ]
    .filter((f): f is string => f !== null)
    .join(" ");
  const wd = workDir ?? (driver === "devbox" ? "/code" : "/app");

  const { execSync } = require("node:child_process");
  const {
    existsSync,
    readFileSync,
    writeFileSync,
    mkdirSync,
  } = require("node:fs");
  const { join } = require("node:path");
  const cwd = process.cwd();
  const sourceDir = require("node:path").resolve(cwd, source);
  // Merge excludes: defaults + .gitignore + user config
  const defaultExcludes = [
    ".dnax",
    ".devbox",
    "node_modules",
    ".git",
    ".cursor",
  ];
  const gitignorePatterns: string[] = [];
  const sourcePath = require("node:path").resolve(cwd, source);
  const gitignoreCandidates = [
    join(sourcePath, ".gitignore"),
    join(cwd, ".gitignore"),
  ];
  for (const gitignorePath of gitignoreCandidates) {
    if (existsSync(gitignorePath)) {
      gitignorePatterns.push(
        ...readFileSync(gitignorePath, "utf-8")
          .split("\n")
          .map((l: string) => l.trim())
          .filter(
            (l: string) =>
              l && !l.startsWith("#") && l !== ".flox" && l !== ".flox/",
          ),
      );
    }
  }
  const userExcludes = syncConfig?.exclude ?? [];
  const userIncludes = syncConfig?.include ?? [];
  const excludeSet = new Set([
    ...defaultExcludes,
    ...gitignorePatterns,
    ...userExcludes,
  ]);

  // Filter out patterns that are explicitly included
  const isIncluded = (pattern: string): boolean => {
    return userIncludes.some((inc) => {
      if (pattern === inc) return true;
      if (pattern === `${inc}/`) return true;
      if (pattern.startsWith(`${inc}/`)) return true;
      return false;
    });
  };

  const excludeList = [...excludeSet].filter((e) => !isIncluded(e));
  const excludes = excludeList.map((e) => `--exclude='${e}'`).join(" ");
  const hashFile = join(cwd, ".dnx", "hash", `sync-${workloadName}`);
  let currentHash = "";
  try {
    currentHash = execSync(
      `find ${source} -type f ${excludeList.map((e) => `-not -path '*/${e}/*'`).join(" ")} -exec md5sum {} \\; | sort | md5sum`,
      { stdio: "pipe" },
    )
      .toString()
      .trim();
  } catch {
    currentHash = Date.now().toString();
  }

  const previousHash = existsSync(hashFile)
    ? readFileSync(hashFile, "utf-8").trim()
    : "";
  if (!syncConfig?.force && previousHash && currentHash === previousHash) {
    logger.info("No changes detected — skipping sync");
  } else {
    const syncSpin = spinner("Syncing via SFTP...");
    const tarFile = `/tmp/dnx-deploy-${workloadName}.tar.gz`;
    execSync(`tar -czf ${tarFile} ${excludes} -C ${sourceDir} .`, {
      stdio: "pipe",
    });
    await pool.uploadAll(tarFile, `/tmp/dnx-deploy-${workloadName}.tar.gz`);
    if (existsSync(tarFile)) require("node:fs").unlinkSync(tarFile);
    await pool.executeAll(
      `mkdir -p $HOME/.dnx/workloads/${workloadName}/releases/${version} && ` +
        `rm -rf $HOME/.dnx/workloads/${workloadName}/releases/${version}/* && ` +
        `tar -xzf /tmp/dnx-deploy-${workloadName}.tar.gz -C $HOME/.dnx/workloads/${workloadName}/releases/${version} && ` +
        `chmod -R a+w $HOME/.dnx/workloads/${workloadName}/releases/${version} && ` +
        `ln -sfn releases/${version} $HOME/.dnx/workloads/${workloadName}/current && ` +
        `rm /tmp/dnx-deploy-${workloadName}.tar.gz && echo "FILES_OK"`,
    );
    syncSpin.succeed("Files synced via SFTP");
  }

  try {
    mkdirSync(join(cwd, ".dnx", "hash"), { recursive: true });
    writeFileSync(hashFile, currentHash, "utf-8");
  } catch {}

  await pool.executeAll(
    `echo "Deployed by DNX at $(date)" > $HOME/.dnx/workloads/${workloadName}/releases/${version}/.dnx-release`,
  );

  // Run server build steps if defined
  if (buildSteps && buildSteps.length > 0) {
    logger.section("Running server build steps...");
    for (const step of buildSteps) {
      const stepSpin = spinner(`  ${step.run}`, { stream: process.stderr });
      const cmd = `cd $HOME/.dnx/workloads/${workloadName}/current && ${step.run}`;
      const results = await pool.executeAllStream(
        cmd,
        (server, data, isStderr) => {
          const lines = data.split("\n").filter((l) => l.trim() !== "");
          for (const line of lines) {
            const prefix = chalk.gray(`[${server}] `);
            const output = chalk.gray(line);
            if (isStderr) {
              process.stderr.write(`${prefix}${output}\n`);
            } else {
              process.stdout.write(`${prefix}${output}\n`);
            }
          }
        },
      );
      for (const r of results) {
        if (r.exitCode === 0) {
          stepSpin.succeed(`  ${r.host} : ${step.run}`);
        } else {
          stepSpin.fail(`  ${r.host} : ${step.run} failed`);
          if (r.stdout) logger.error(r.stdout.trim());
          if (r.stderr) logger.error(r.stderr.trim());
          throw new Error(`Build step "${step.run}" failed on ${r.host}`);
        }
      }
    }
  }

  if (driver === "flox" || driver === "devbox") {
    if (driver === "flox") {
      // Check if flox environment changed
      const floxHashFile = join(cwd, ".dnx", "hash", `flox-${workloadName}`);
      let floxHash = "";
      try {
        floxHash = execSync(`md5sum .flox/env/manifest.toml | cut -d' ' -f1`, {
          stdio: "pipe",
          cwd: sourceDir,
        })
          .toString()
          .trim();
      } catch {
        floxHash = Date.now().toString();
      }
      const previousFloxHash = existsSync(floxHashFile)
        ? readFileSync(floxHashFile, "utf-8").trim()
        : "";

      if (previousFloxHash && floxHash === previousFloxHash) {
        logger.info("flox environment unchanged — skipping sync & build");
      } else {
        // Build image (flox env is included in source sync)
        const floxSpin = spinner(`Building image ${workloadName}:latest...`);
        const buildCmd = `cd $HOME/.dnx/workloads/${workloadName}/current && flox containerize -f - > /tmp/dnx-flox-image.tar 2>/tmp/dnx-flox-err.log && docker load < /tmp/dnx-flox-image.tar 2>&1 | tee /tmp/dnx-load.log && IMG=$(grep -o 'Loaded image: [^ ]*' /tmp/dnx-load.log | cut -d' ' -f3) && [ -n "$IMG" ] && docker tag $IMG ${workloadName}:${tag || "latest"} && echo "BUILD_OK" || (cat /tmp/dnx-flox-err.log 2>/dev/null; echo "BUILD_FAILED"); rm -f /tmp/dnx-flox-image.tar /tmp/dnx-flox-err.log 2>/dev/null`;
        const buildResults = await pool.executeAll(buildCmd);
        for (const r of buildResults) {
          if (r.stdout.includes("BUILD_OK")) {
            floxSpin.succeed(`    ${r.host} : image built`);
          } else {
            floxSpin.fail(`  ${r.host} : build failed`);
            if (r.stdout) logger.error(`    ${r.stdout.trim()}`);
            if (r.stderr) logger.error(`    ${r.stderr.trim()}`);
            throw new Error(`Build failed on ${r.host}`);
          }
        }

        // Save hash
        try {
          mkdirSync(join(cwd, ".dnx", "hash"), { recursive: true });
          writeFileSync(floxHashFile, floxHash, "utf-8");
        } catch {}
      }
    }

    if (driver === "devbox") {
      // Check if devbox environment changed
      const devboxHashFile = join(
        cwd,
        ".dnx",
        "hash",
        `devbox-${workloadName}`,
      );
      let devboxHash = "";
      try {
        devboxHash = execSync(
          `cat devbox.json devbox.lock 2>/dev/null | md5sum | cut -d' ' -f1`,
          {
            stdio: "pipe",
            cwd: sourceDir,
          },
        )
          .toString()
          .trim();
      } catch {
        devboxHash = Date.now().toString();
      }
      const previousDevboxHash = existsSync(devboxHashFile)
        ? readFileSync(devboxHashFile, "utf-8").trim()
        : "";

      if (previousDevboxHash && devboxHash === previousDevboxHash) {
        logger.info("devbox unchanged — skipping build");
      } else {
        const devboxSpin = spinner(`Building image ${workloadName}:latest...`);
        const imgTag = tag || "latest";
        const buildCmd = `if docker image inspect ${workloadName}:${imgTag} >/dev/null 2>&1; then echo "BUILD_SKIPPED"; else cd $HOME/.dnx/workloads/${workloadName}/current && devbox generate dockerfile && DOCKER_BUILDKIT=1 docker build --cache-from ${workloadName}:latest -t ${workloadName}:${imgTag} . && echo "BUILD_OK" || echo "BUILD_FAILED"; fi`;
        const buildResults = await pool.executeAll(buildCmd);
        for (const r of buildResults) {
          if (r.stdout.includes("BUILD_OK")) {
            devboxSpin.succeed(`    ${r.host} : image built`);
          } else if (r.stdout.includes("BUILD_SKIPPED")) {
            devboxSpin.succeed(
              `    ${r.host} : image already exists — skipping build`,
            );
          } else {
            devboxSpin.fail(`  ${r.host} : build failed`);
            if (r.stdout) logger.error(`    ${r.stdout.trim()}`);
            if (r.stderr) logger.error(`    ${r.stderr.trim()}`);
            throw new Error(`Build failed on ${r.host}`);
          }
        }

        // Save hash
        try {
          mkdirSync(join(cwd, ".dnx", "hash"), { recursive: true });
          writeFileSync(devboxHashFile, devboxHash, "utf-8");
        } catch {}
      }
    }

    const runSpin = spinner(`Starting container ${workloadName}...`);
    const runResults = await pool.executeAll(
      `cd $HOME/.dnx/workloads/${workloadName}/current && ` +
        `IMAGE=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep -m1 ${workloadName} | head -1) && ` +
        `[ -n "$IMAGE" ] && docker tag $IMAGE ${workloadName}:${tag || "latest"} 2>/dev/null; ` +
        `docker network create dnx 2>/dev/null; ` +
        `docker stop ${workloadName} 2>/dev/null; docker rm ${workloadName} 2>/dev/null; ` +
        `(docker run -dit --name ${workloadName} --network dnx --restart ${restart ?? "no"} ${resourceFlags} ${portFlags} ${volumeFlags} -v $HOME/.dnx/workloads/${workloadName}/current:${wd} -w ${wd} ${workloadName}:${tag || "latest"}${startCmd ? " " + startCmd : ""} 2>&1 && echo "RUN_OK") || (echo "RUN_FAILED"; docker logs ${workloadName} 2>/dev/null | tail -20)`,
    );
    for (const r of runResults) {
      if (r.stdout.includes("RUN_OK")) {
        runSpin.succeed(`Container started on ${r.host}`);
      } else {
        runSpin.fail(`Container failed on ${r.host}`);
        if (r.stdout) {
          for (const line of r.stdout.trim().split("\n")) {
            logger.error(`    ${line}`);
          }
        }
        if (r.stderr) {
          for (const line of r.stderr.trim().split("\n")) {
            logger.error(`    ${line}`);
          }
        }
      }
    }

    const runFailed = runResults.some((r) => !r.stdout.includes("RUN_OK"));
    if (runFailed) {
      const failedHosts = runResults
        .filter((r) => !r.stdout.includes("RUN_OK"))
        .map((r) => r.host)
        .join(", ");
      throw new Error(`Container failed on: ${failedHosts}`);
    }
  }

  // Keep only the last 5 releases, delete older ones
  const cleanupSpin = spinner("Cleaning up old releases...");
  await pool.executeAll(
    `cd $HOME/.dnx/workloads/${workloadName}/releases && ls -t | tail -n +6 | xargs -r rm -rf`,
  );
  cleanupSpin.succeed("Old releases cleaned up");

  return pool.executeAll(`echo "DEPLOY_OK"`);
}

async function updateProxy(
  pool: SSHPool,
  routes: {
    domain: string;
    target: string;
    port: number;
    lb_policy?: string;
    ssl?: boolean;
  }[],
  email?: string,
): Promise<void> {
  const caddyRoutes: CaddyRoute[] = routes.map((r) => ({
    domain: r.domain,
    target: r.target,
    port: r.port,
    lbPolicy: r.lb_policy as CaddyRoute["lbPolicy"],
    ssl: r.ssl,
  }));
  const config = generateCaddyfile({ email, routes: caddyRoutes });
  await pool.executeAll(
    `mkdir -p /etc/caddy && cat > /etc/caddy/Caddyfile << 'CADDYEOF'\n${config}\nCADDYEOF\n` +
      `caddy reload --config /etc/caddy/Caddyfile 2>/dev/null || caddy start --config /etc/caddy/Caddyfile`,
  );
  logger.success("Caddy proxy updated.");
}
