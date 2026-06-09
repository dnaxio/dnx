import { z } from "zod";

export const ServerSchema = z.object({
  host: z.string().min(1),
  name: z.string().optional(),
  port: z.number().int().min(1).max(65535).default(22),
  user: z.string().default("root"),
  password: z.string().optional(),
  key_path: z.string().optional(),
  fingerprint: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

export const BuildStepSchema = z.object({
  run: z.string(),
  env: z.record(z.string()).optional(),
});

export const BuildSchema = z.object({
  steps: z.array(BuildStepSchema).default([]),
  cache: z
    .object({
      key: z.string().optional(),
      paths: z.array(z.string()).default([]),
    })
    .optional(),
});

export const OciSchema = z.object({
  build_args: z.record(z.string()).optional(),
  secrets: z.array(z.string()).default([]),
  volumes: z.array(z.string()).default([]),
});

export const DriverSchema = z
  .enum(["flox", "docker", "devbox", "podman"])
  .default("flox");

export const WorkloadTypeSchema = z
  .enum(["web", "api", "database", "cache", "worker", "cron", "other"])
  .default("web");

export const ResourcesSchema = z.object({
  cpu: z.string().optional(),
  memory: z.string().optional(),
});

export const HealthCheckSchema = z.object({
  type: z.enum(["http", "tcp", "command"]).default("http"),
  endpoint: z.string().optional(),
  command: z.string().optional(),
  interval: z.string().default("30s"),
  timeout: z.string().default("5s"),
  retries: z.number().int().min(1).max(10).default(3),
});

export const ScalingSchema = z.object({
  min_instances: z.number().int().min(1).default(1),
  max_instances: z.number().int().min(1).default(10),
  target_cpu: z.number().min(1).max(100).optional(),
  target_memory: z.number().min(1).max(100).optional(),
  cooldown: z.string().default("300s"),
  strategy: z.enum(["horizontal", "vertical"]).default("horizontal"),
});

export const WorkloadSchema = z.object({
  name: z.string().min(1),
  type: WorkloadTypeSchema,
  image: z.string().optional(),
  repo_url: z.string().optional(),
  branch: z.string().default("main"),
  driver: DriverSchema,
  start_cmd: z.string().optional(),
  ports: z.array(z.number().int().min(1).max(65535)).default([]),
  workdir: z.string().default("/app"),
  volumes: z.array(z.string()).default([]),
  restart: z
    .enum(["no", "always", "on-failure", "unless-stopped"])
    .default("no"),
  resources: ResourcesSchema.optional(),
  env: z.record(z.string()).default({}),
  flox_env: z.string().optional(),
  dockerfile: z.string().optional(),
  registry: z.string().optional(),
  oci: OciSchema.optional(),
  build: BuildSchema.default({ steps: [] }),
  health: HealthCheckSchema.optional(),
  scaling: ScalingSchema.optional(),
  sync: z
    .object({
      source: z.string().default("."),
      exclude: z
        .array(z.string())
        .default([
          ".dnax",
          ".devbox",
          "node_modules",
          ".git",
          ".flox",
          ".cursor",
        ]),
      force: z.boolean().default(false),
    })
    .default({}),
});

export const ProxyRouteSchema = z.object({
  domain: z.string().min(1),
  target: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  lb_policy: z
    .enum(["round_robin", "least_conn", "first", "ip_hash"])
    .default("round_robin"),
  ssl: z.boolean().default(true),
  headers: z.record(z.string()).default({}),
});

export const ProxySchema = z.object({
  auto_ssl: z.boolean().default(true),
  email: z.string().email().optional(),
  routes: z.array(ProxyRouteSchema).default([]),
  global_options: z.record(z.unknown()).default({}),
});

export const AlertSchema = z.object({
  type: z.enum(["webhook", "email"]),
  url: z.string().optional(),
  to: z.string().optional(),
  on: z
    .array(z.enum(["degraded", "unhealthy", "recovered"]))
    .default(["unhealthy"]),
});

export const HealthGlobalSchema = z.object({
  enabled: z.boolean().default(true),
  interval: z.string().default("30s"),
  alerts: z.array(AlertSchema).default([]),
});

export const NotificationSchema = z.object({
  type: z.enum(["webhook", "email"]),
  url: z.string().optional(),
  to: z.string().optional(),
});

export const NotificationsSchema = z.object({
  deploy_start: z.array(NotificationSchema).default([]),
  deploy_success: z.array(NotificationSchema).default([]),
  deploy_failure: z.array(NotificationSchema).default([]),
});

export const PreviewSchema = z.object({
  enabled: z.boolean().default(false),
  domain_template: z.string().default("preview-{{ .BranchSlug }}.example.com"),
  ttl_hours: z.number().int().min(1).default(48),
  cleanup_interval: z.number().int().default(3600),
  max_concurrent: z.number().int().min(1).default(5),
  servers: z.array(z.string()).default([]),
  auto_deploy: z
    .object({
      on_push: z.boolean().default(false),
      branches: z.array(z.string()).default(["feat/*", "fix/*"]),
    })
    .default({}),
  notifications: z
    .object({
      github: z
        .object({
          comment_pr: z.boolean().default(true),
          status_check: z.boolean().default(true),
        })
        .default({}),
      gitlab: z.object({ comment_mr: z.boolean().default(true) }).default({}),
    })
    .default({}),
});

export const EnvironmentSchema = z.object({
  servers: z.array(ServerSchema).min(1),
  deploy_strategy: z
    .enum(["rolling", "blue-green", "canary"])
    .default("rolling"),
  auto_rollback: z.boolean().default(false),
  health_check_grace: z.string().default("30s"),
  min_healthy_percent: z.number().int().min(1).max(100).default(100),
});

export const DnxConfigSchema = z.object({
  version: z.literal("1"),
  name: z.string().min(1),
  environments: z
    .record(z.string(), EnvironmentSchema)
    .refine(
      (envs) => Object.keys(envs).length > 0,
      "At least one environment required",
    ),
  workloads: z.array(WorkloadSchema).min(1),
  proxy: ProxySchema.optional(),
  health: HealthGlobalSchema.default({}),
  scaling: z
    .object({
      cooldown: z.string().default("300s"),
      provision_script: z.string().optional(),
    })
    .optional(),
  notifications: NotificationsSchema.default({}),
  preview: PreviewSchema.default({}),
});

export type DnxConfig = z.infer<typeof DnxConfigSchema>;
export type Workload = z.infer<typeof WorkloadSchema>;
export type Server = z.infer<typeof ServerSchema>;
export type Environment = z.infer<typeof EnvironmentSchema>;
export type ProxyRoute = z.infer<typeof ProxyRouteSchema>;
export type Driver = z.infer<typeof DriverSchema>;
