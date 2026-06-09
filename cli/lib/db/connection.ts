import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

let db: Database | null = null;

const DNX_DIR = join(homedir(), ".dnx");
const DB_PATH = join(DNX_DIR, "state.db");

export function getDbPath(): string {
  return DB_PATH;
}

export function getConnection(): Database {
  if (db) return db;

  if (!existsSync(DNX_DIR)) {
    mkdirSync(DNX_DIR, { recursive: true });
  }

  db = new Database(DB_PATH, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA busy_timeout = 5000");
  db.run("PRAGMA foreign_keys = ON");

  return db;
}

export function closeConnection(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function runMigrations(): void {
  const conn = getConnection();

  // Ensure _migrations table exists
  conn.run(`CREATE TABLE IF NOT EXISTS _migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT DEFAULT (datetime('now'))
  )`);

  const migrationsDir = join(dirname(import.meta.path), "migrations");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const version = parseInt(file.split("_")[0]!, 10);
    const name = file.replace(".sql", "");

    const existing = conn
      .query("SELECT version FROM _migrations WHERE version = ?")
      .get(version) as { version: number } | null;

    if (existing) continue;

    const sql = readFileSync(join(migrationsDir, file), "utf-8");
    conn.run(sql);
    conn.run("INSERT INTO _migrations (version, name) VALUES (?, ?)", [
      version,
      name,
    ]);
  }
}
