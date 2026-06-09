import { logger } from "../cli/output.ts";

/**
 * Generate a Caddyfile from DNX proxy routes configuration.
 */
export interface CaddyRoute {
  domain: string;
  target: string;
  port: number;
  upstreams?: string[]; // For load balancing: ["server1:3000", "server2:3000"]
  lbPolicy?: "round_robin" | "least_conn" | "first" | "ip_hash";
  ssl?: boolean;
  headers?: Record<string, string>;
  compression?: boolean;
  rateLimit?: { rate: number; burst: number; period: string };
}

interface CaddyfileOptions {
  email?: string;
  autoSSL?: boolean;
  routes: CaddyRoute[];
  globalOptions?: Record<string, unknown>;
}

/**
 * Generate a complete Caddyfile string from route definitions.
 */
export function generateCaddyfile(opts: CaddyfileOptions): string {
  const lines: string[] = [];

  // Global options
  if (opts.email) {
    lines.push(`# Global options`);
    lines.push(`{`);
    lines.push(`  email ${opts.email}`);
    if (opts.autoSSL === false) {
      lines.push(`  auto_https off`);
    }
    lines.push(`}`);
    lines.push("");
  }

  // Routes
  for (const route of opts.routes) {
    lines.push(`# ${route.domain}`);
    lines.push(`${route.domain} {`);

    // Determine upstream list
    const upstreams = route.upstreams?.length
      ? route.upstreams
      : [`${route.target}:${route.port}`];

    if (upstreams.length === 1) {
      lines.push(`  reverse_proxy ${upstreams[0]}`);
    } else {
      // Load balancing
      const upstreamStr = upstreams.join(" ");
      lines.push(`  reverse_proxy ${upstreamStr} {`);
      if (route.lbPolicy) {
        lines.push(`    lb_policy ${route.lbPolicy}`);
      }
      lines.push(`    health_uri /health`);
      lines.push(`    health_interval 10s`);
      lines.push(`    health_timeout 3s`);
      lines.push(`  }`);
    }

    // SSL
    if (route.ssl === false) {
      lines.push(`  tls internal`);
    }

    // Custom headers
    if (route.headers) {
      lines.push(`  header {`);
      for (const [key, value] of Object.entries(route.headers)) {
        lines.push(`    ${key} "${value}"`);
      }
      lines.push(`  }`);
    }

    // Compression
    if (route.compression !== false) {
      lines.push(`  encode gzip zstd`);
    }

    // Rate limiting
    if (route.rateLimit) {
      lines.push(
        `  rate_limit {`
      );
      lines.push(`    rate ${route.rateLimit.rate}`);
      lines.push(`    burst ${route.rateLimit.burst}`);
      lines.push(`    period ${route.rateLimit.period}`);
      lines.push(`  }`);
    }

    lines.push(`}`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Generate a minimal Caddyfile for a simple reverse proxy setup.
 */
export function generateSimpleCaddyfile(
  domain: string,
  upstream: string,
  email?: string
): string {
  return generateCaddyfile({
    email,
    routes: [
      {
        domain,
        target: "",
        port: 0,
        upstreams: [upstream],
      },
    ],
  });
}

/**
 * Parse a Caddyfile string back to a structured format (basic).
 */
export function parseCaddyfile(content: string): CaddyRoute[] {
  const routes: CaddyRoute[] = [];
  const blocks = content.split(/\n(?=\S)/); // Split on non-indented lines (new domain blocks)

  for (const block of blocks) {
    const lines = block.trim().split("\n");
    const domainLine = lines[0]?.trim();
    if (!domainLine || domainLine.startsWith("#") || domainLine === "{") continue;

    const domain = domainLine.replace(/\s*\{.*/, "").trim();
    const route: CaddyRoute = { domain, target: "", port: 0 };

    const body = lines.slice(1).join("\n");
    const proxyMatch = body.match(/reverse_proxy\s+([^\s{]+)/);
    if (proxyMatch) {
      const target = proxyMatch[1]!;
      const [host, port] = target.split(":");
      route.target = host ?? target;
      route.port = port ? parseInt(port) : 80;
    }

    if (body.includes("lb_policy")) {
      const lbMatch = body.match(/lb_policy\s+(\w+)/);
      if (lbMatch) route.lbPolicy = lbMatch[1] as CaddyRoute["lbPolicy"];
    }

    if (!body.includes("tls internal") && !body.includes("auto_https off")) {
      route.ssl = true;
    }

    routes.push(route);
  }

  return routes;
}
