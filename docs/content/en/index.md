---
seo:
  title: DNX Deploy — Documentation
  description: Deploy your workloads across multiple servers via SSH with reproducible environments. Bun + flox.dev + Caddy + Docker/OCI.
---

::u-page-hero
#title
DNX Deploy

#description
Deploy across **multiple servers** via SSH with **reproducible environments**.

One CLI. Zero server dependencies. flox.dev or Docker. Caddy built-in.

#links
  :::u-button
  ---
  color: primary
  size: xl
  to: /en/getting-started/installation
  trailing-icon: i-lucide-download
  ---
  Install DNX
  :::

  :::u-button
  ---
  color: neutral
  size: xl
  to: /en/getting-started/quickstart
  variant: outline
  trailing-icon: i-lucide-rocket
  ---
  Quickstart
  :::
::

::u-page-section
#title
Everything you need

#features
  :::u-page-feature
  ---
  icon: i-lucide-server
  ---
  #title
  Multi-server SSH
  #description
  Deploy to 1, 10, or 50 servers in parallel. SSH pool with concurrency limit, auto retry, keep-alive.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-box
  ---
  #title
  flox.dev + Docker/OCI
  #description
  100% reproducible environments via flox.dev (Nix) or OCI containers. BuildKit without Docker daemon.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-shield-check
  ---
  #title
  Built-in Caddy
  #description
  Reverse proxy, load balancing, auto SSL (Let's Encrypt). Config auto-generated from dnx.yaml.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-key
  ---
  #title
  AES-256 encrypted secrets
  #description
  AES-256-GCM encryption at rest. Local master key. Auto-injected at deploy time.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-git-branch
  ---
  #title
  Staging / Test / Production
  #description
  Per-environment isolation. Deploy strategies: rolling, blue-green, canary. One-command rollback.
  :::

  :::u-page-feature
  ---
  icon: i-lucide-activity
  ---
  #title
  Health checks & Alerts
  #description
  HTTP, TCP, command probes. State machine healthy → degraded → unhealthy. SQLite history.
  :::
::
