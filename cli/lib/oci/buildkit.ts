import { logger, spinner } from "../cli/output.ts";

/**
 * BuildKit interface for building OCI images without a Docker daemon.
 * Uses `docker buildx` if available, falls back to `buildctl`.
 */
export async function buildImage(
  contextPath: string,
  options: {
    dockerfile?: string;
    tag?: string;
    buildArgs?: Record<string, string>;
    secrets?: string[];
    platform?: string;
    noCache?: boolean;
    registry?: string;
  } = {}
): Promise<{ tag: string; digest?: string }> {
  const tag = options.tag ?? "latest";
  const dockerfile = options.dockerfile ?? "Dockerfile";
  const registry = options.registry ?? "localhost";
  const fullTag = `${registry}:${tag}`;

  // Prefer docker buildx, fall back to buildctl
  const useDocker = await hasCommand("docker");

  if (useDocker) {
    return buildWithDocker(contextPath, { ...options, tag: fullTag, dockerfile });
  }
  return buildWithBuildKit(contextPath, { ...options, tag: fullTag, dockerfile });
}

async function hasCommand(cmd: string): Promise<boolean> {
  try {
    const proc = Bun.spawnSync(["which", cmd]);
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

async function buildWithDocker(
  contextPath: string,
  opts: Required<Pick<typeof buildImage extends (a: any, b: infer O) => any ? O : never, "dockerfile" | "tag">> & { buildArgs?: Record<string, string>; platform?: string; noCache?: boolean }
): Promise<{ tag: string }> {
  const args = ["docker", "buildx", "build", "-f", opts.dockerfile, "-t", opts.tag, contextPath];

  if (opts.platform) args.push("--platform", opts.platform);
  if (opts.noCache) args.push("--no-cache");
  if (opts.buildArgs) {
    for (const [k, v] of Object.entries(opts.buildArgs)) {
      args.push("--build-arg", `${k}=${v}`);
    }
  }

  const spin = spinner(`BuildKit (docker) : ${opts.tag}`);
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  await proc.exited;

  if (proc.exitCode !== 0) {
    spin.fail(`Build échoué`);
    throw new Error(err || out);
  }
  spin.succeed(`Image buildée : ${opts.tag}`);
  return { tag: opts.tag };
}

async function buildWithBuildKit(
  contextPath: string,
  opts: { dockerfile: string; tag: string; noCache?: boolean }
): Promise<{ tag: string }> {
  const args = [
    "buildctl", "build",
    "--frontend=dockerfile.v0",
    "--local", `context=${contextPath}`,
    "--local", `dockerfile=${contextPath}`,
    "--opt", `filename=${opts.dockerfile}`,
    "--output", `type=docker,name=${opts.tag}`,
  ];

  if (opts.noCache) args.push("--no-cache");

  const spin = spinner(`BuildKit (buildctl) : ${opts.tag}`);
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  await proc.exited;

  if (proc.exitCode !== 0) {
    spin.fail(`Build échoué`);
    throw new Error(err || out);
  }
  spin.succeed(`Image buildée : ${opts.tag}`);
  return { tag: opts.tag };
}

/**
 * Detect if a project has a Dockerfile.
 */
export function hasDockerfile(cwd: string): boolean {
  const candidates = ["Dockerfile", "Dockerfile.prod", "Containerfile"];
  const { existsSync } = require("node:fs");
  const { join } = require("node:path");
  return candidates.some((f) => existsSync(join(cwd, f)));
}

/**
 * Get the Dockerfile path for a project.
 */
export function findDockerfile(cwd: string): string | null {
  const candidates = ["Dockerfile", "Dockerfile.prod", "Containerfile"];
  const { existsSync } = require("node:fs");
  const { join } = require("node:path");
  for (const f of candidates) {
    if (existsSync(join(cwd, f))) return f;
  }
  return null;
}
