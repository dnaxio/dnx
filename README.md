# DNX Deploy

Multi-server deployment tool via SSH with reproducible environments. One CLI, zero server dependencies.

## Install

```bash
bun install -g @dnax/dnx
```

## Quickstart

```bash
dnx init --name my-app
# edit dnx.yaml with your servers
dnx deploy web --env staging --tag v1
```

## dnx.yaml

```yaml
version: "1"
name: "my-app"

environments:
  staging:
    servers:
      - host: $STAGING_HOST
        user: root

workloads:
  - name: web
    type: web
    driver: flox          # flox | devbox | docker | podman
    ports: [3000]
    env:
      NODE_ENV: "production"

  - name: redis
    type: cache
    image: redis:7-alpine
    ports: [6379]

proxy:
  routes:
    - domain: app.example.com
      target: 127.0.0.1
      port: 3000
```

## Commands

| Command | Description |
|---------|-------------|
| `dnx init` | Create a new dnx.yaml |
| `dnx deploy <wl> --tag <v>` | Deploy a workload |
| `dnx status` | Show all workloads |
| `dnx logs <wl> --follow` | Stream workload logs |
| `dnx workload start/stop/restart <wl>` | Lifecycle management |
| `dnx rollback <wl> --tag <v>` | Rollback to a previous release |
| `dnx config validate/show` | Config management |
| `dnx secrets set KEY=VALUE` | Encrypted secrets (AES-256) |

## Key Features

- **Multi-server** — SSH pool with concurrency, retry, keep-alive
- **Reproducible** — flox.dev (Nix) or devbox + Docker/OCI
- **Built-in proxy** — Caddy with auto SSL, load balancing
- **Secrets** — AES-256-GCM encrypted at rest, injected at deploy
- **Atomic releases** — symlink-based, keep last 5, instant rollback
- **Shared network** — containers communicate via `workload-name:port`
- **Health checks** — HTTP/TCP/command probes with state machine
- **Preview envs** — ephemeral environments per branch

## Workload Types

| Type | Use case |
|------|----------|
| `web` | Web server, frontend |
| `api` | REST/GraphQL API |
| `database` | Postgres, MySQL, Mongo |
| `cache` | Redis, Memcached |
| `worker` | Background job processor |
| `cron` | Scheduled tasks |
| `other` | Anything else |

## Architecture

```
Local CLI (Bun + TS)          Remote Server ($HOME/.dnx/)
┌──────────────────┐          ┌────────────────────────────┐
│ dnx.yaml          │   SSH    │ workloads/<name>/           │
│ .dnx/hash/        │ ──────▶ │   ├── current → releases/v1 │
│ .dnx/state.db     │          │   └── releases/             │
│ .dnx/master.key   │          │       ├── v3/ (active)      │
└──────────────────┘          │       ├── v2/               │
                              │       └── v1/               │
                              │ Caddy (reverse proxy)       │
                              │ Docker + dnx network        │
                              └────────────────────────────┘
```

## License

MIT
