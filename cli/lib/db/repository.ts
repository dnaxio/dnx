import type { Database } from "bun:sqlite";
import { getConnection } from "./connection.ts";

export type Row = Record<string, unknown>;

export class Repository<T extends Row> {
  protected db: Database;
  protected tableName: string;

  constructor(tableName: string) {
    this.db = getConnection();
    this.tableName = tableName;
  }

  findById(id: string): T | null {
    return this.db
      .query(`SELECT * FROM ${this.tableName} WHERE id = ?`)
      .get(id) as T | null;
  }

  findAll(where: Partial<T> = {}): T[] {
    const keys = Object.keys(where);
    if (keys.length === 0) {
      return this.db
        .query(`SELECT * FROM ${this.tableName} ORDER BY created_at DESC`)
        .all() as T[];
    }

    const clauses = keys.map((k) => `${k} = ?`).join(" AND ");
    const values = keys.map((k) => where[k]);
    return this.db
      .query(
        `SELECT * FROM ${this.tableName} WHERE ${clauses} ORDER BY created_at DESC`,
      )
      .all(...values) as T[];
  }

  create(data: Partial<T>): T {
    // Generate ID client-side if not provided (TEXT primary keys)
    if (!data.id) {
      data.id = crypto.randomUUID().replace(/-/g, "");
    }

    const keys = Object.keys(data);
    const placeholders = keys.map(() => "?").join(", ");
    const values = keys.map((k) => data[k]);

    this.db.run(
      `INSERT INTO ${this.tableName} (${keys.join(", ")}) VALUES (${placeholders})`,
      ...values,
    );

    return this.findById(data.id as string)!;
  }

  update(id: string, data: Partial<T>): T | null {
    const keys = Object.keys(data).filter((k) => k !== "id");
    if (keys.length === 0) return this.findById(id);

    const setClause = keys.map((k) => `${k} = ?`).join(", ");
    const values = keys.map((k) => data[k]);

    this.db.run(
      `UPDATE ${this.tableName} SET ${setClause}, updated_at = datetime('now') WHERE id = ?`,
      ...values,
      id,
    );

    return this.findById(id);
  }

  delete(id: string): void {
    this.db.run(`DELETE FROM ${this.tableName} WHERE id = ?`, id);
  }

  count(where: Partial<T> = {}): number {
    const keys = Object.keys(where);
    if (keys.length === 0) {
      const row = this.db
        .query(`SELECT COUNT(*) as count FROM ${this.tableName}`)
        .get() as { count: number };
      return row.count;
    }

    const clauses = keys.map((k) => `${k} = ?`).join(" AND ");
    const values = keys.map((k) => where[k]);
    const row = this.db
      .query(`SELECT COUNT(*) as count FROM ${this.tableName} WHERE ${clauses}`)
      .get(...values) as { count: number };
    return row.count;
  }

  /** Execute a raw SQL query and return rows */
  query(sql: string, ...params: unknown[]): T[] {
    return this.db.query(sql).all(...params) as T[];
  }
}
