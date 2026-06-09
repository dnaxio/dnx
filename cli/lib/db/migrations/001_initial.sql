-- 001_initial.sql
-- DNX Deploy — Schéma complet

-- Serveurs cibles
CREATE TABLE IF NOT EXISTS servers (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name        TEXT NOT NULL UNIQUE,
    host        TEXT NOT NULL,
    port        INTEGER DEFAULT 22,
    username    TEXT NOT NULL DEFAULT 'root',
    auth_method TEXT NOT NULL DEFAULT 'key',
    key_path    TEXT,
    fingerprint TEXT,
    tags        TEXT DEFAULT '[]',
    flox_installed INTEGER DEFAULT 0,
    caddy_installed INTEGER DEFAULT 0,
    agent_installed INTEGER DEFAULT 0,
    status      TEXT DEFAULT 'unknown',
    last_seen   TEXT,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);

-- Applications
CREATE TABLE IF NOT EXISTS apps (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name        TEXT NOT NULL UNIQUE,
    repo_url    TEXT,
    branch      TEXT DEFAULT 'main',
    runtime_type TEXT DEFAULT 'flox',
    build_cmd   TEXT,
    start_cmd   TEXT,
    env         TEXT DEFAULT '{}',
    ports       TEXT DEFAULT '[]',
    health_check TEXT,
    flox_env    TEXT,
    dockerfile  TEXT,
    registry    TEXT,
    oci_image   TEXT,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);

-- Services (bases de données, redis, etc.)
CREATE TABLE IF NOT EXISTS services (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name        TEXT NOT NULL UNIQUE,
    type        TEXT NOT NULL,
    runtime_type TEXT DEFAULT 'flox',
    version     TEXT,
    config      TEXT DEFAULT '{}',
    flox_env    TEXT,
    oci_image   TEXT,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);

-- Déploiements
CREATE TABLE IF NOT EXISTS deployments (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    app_id          TEXT REFERENCES apps(id),
    service_id      TEXT REFERENCES services(id),
    environment     TEXT NOT NULL,
    version         TEXT NOT NULL,
    release_path    TEXT,
    status          TEXT DEFAULT 'pending',
    servers         TEXT DEFAULT '[]',
    strategy        TEXT DEFAULT 'rolling',
    artifact_hash   TEXT,
    config_snapshot TEXT,
    deployed_at     TEXT,
    finished_at     TEXT,
    error           TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);

-- Locks
CREATE TABLE IF NOT EXISTS locks (
    id          TEXT PRIMARY KEY,
    resource    TEXT NOT NULL,
    holder      TEXT NOT NULL,
    acquired_at TEXT DEFAULT (datetime('now')),
    expires_at  TEXT,
    metadata    TEXT DEFAULT '{}'
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_locks_resource ON locks(resource);

-- Health check logs
CREATE TABLE IF NOT EXISTS health_logs (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    target_type TEXT NOT NULL,
    target_id   TEXT NOT NULL,
    server_id   TEXT REFERENCES servers(id),
    status      TEXT NOT NULL,
    response_time_ms INTEGER,
    error       TEXT,
    checked_at  TEXT DEFAULT (datetime('now'))
);

-- Logs centralisés
CREATE TABLE IF NOT EXISTS logs (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    source      TEXT NOT NULL,
    level       TEXT DEFAULT 'info',
    message     TEXT NOT NULL,
    metadata    TEXT DEFAULT '{}',
    recorded_at TEXT DEFAULT (datetime('now'))
);

-- Secrets (encrypted at rest)
CREATE TABLE IF NOT EXISTS secrets (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    key         TEXT NOT NULL UNIQUE,
    value       BLOB NOT NULL,
    environment TEXT DEFAULT 'all',
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);

-- Releases (pour rollback)
CREATE TABLE IF NOT EXISTS releases (
    id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    deployment_id   TEXT REFERENCES deployments(id),
    app_id          TEXT REFERENCES apps(id),
    service_id      TEXT REFERENCES services(id),
    server_id       TEXT REFERENCES servers(id),
    version         TEXT NOT NULL,
    release_path    TEXT NOT NULL,
    active          INTEGER DEFAULT 1,
    artifact_hash   TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);

-- Caddy proxy routes
CREATE TABLE IF NOT EXISTS proxy_routes (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    domain      TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id   TEXT NOT NULL,
    port        INTEGER NOT NULL,
    server_ids  TEXT DEFAULT '[]',
    lb_policy   TEXT DEFAULT 'round_robin',
    ssl         INTEGER DEFAULT 1,
    enabled     INTEGER DEFAULT 1,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);

-- Images OCI
CREATE TABLE IF NOT EXISTS oci_images (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    app_id      TEXT REFERENCES apps(id),
    service_id  TEXT REFERENCES services(id),
    registry    TEXT NOT NULL,
    tag         TEXT NOT NULL,
    digest      TEXT NOT NULL,
    size_bytes  INTEGER,
    built_at    TEXT,
    build_log   TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
);

-- Preview Environments
CREATE TABLE IF NOT EXISTS preview_environments (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name        TEXT NOT NULL,
    branch      TEXT NOT NULL,
    pr_number   INTEGER,
    pr_url      TEXT,
    app_id      TEXT REFERENCES apps(id),
    domain      TEXT NOT NULL,
    server_id   TEXT REFERENCES servers(id),
    status      TEXT DEFAULT 'creating',
    ttl_hours   INTEGER DEFAULT 48,
    expires_at  TEXT,
    deployed_at TEXT,
    destroyed_at TEXT,
    config_snapshot TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_deployments_app ON deployments(app_id);
CREATE INDEX IF NOT EXISTS idx_deployments_env ON deployments(environment);
CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status);
CREATE INDEX IF NOT EXISTS idx_health_logs_target ON health_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_health_logs_time ON health_logs(checked_at);
CREATE INDEX IF NOT EXISTS idx_logs_source ON logs(source);
CREATE INDEX IF NOT EXISTS idx_logs_time ON logs(recorded_at);
CREATE INDEX IF NOT EXISTS idx_releases_deployment ON releases(deployment_id);
CREATE INDEX IF NOT EXISTS idx_proxy_routes_domain ON proxy_routes(domain);
CREATE INDEX IF NOT EXISTS idx_oci_images_app ON oci_images(app_id);
CREATE INDEX IF NOT EXISTS idx_oci_images_digest ON oci_images(digest);
CREATE INDEX IF NOT EXISTS idx_preview_envs_branch ON preview_environments(branch);
CREATE INDEX IF NOT EXISTS idx_preview_envs_status ON preview_environments(status);
CREATE INDEX IF NOT EXISTS idx_preview_envs_expires ON preview_environments(expires_at);

-- Migration tracking
CREATE TABLE IF NOT EXISTS _migrations (
    version     INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    applied_at  TEXT DEFAULT (datetime('now'))
);
