import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type pg from "pg";

export async function runMigrations(pool: pg.Pool, directory = resolve("migrations")): Promise<string[]> {
  const files = (await readdir(directory)).filter((name) => /^\d+_[a-z0-9_-]+\.sql$/.test(name)).sort();
  const client = await pool.connect();
  const applied: string[] = [];
  let locked = false;
  try {
    await client.query("select pg_advisory_lock(hashtext('answertravel-v2-migrations'))");
    locked = true;
    await client.query(`create table if not exists schema_migrations (
      version text primary key, checksum char(64) not null,
      applied_at timestamptz not null default now()
    )`);
    for (const file of files) {
      const sql = await readFile(resolve(directory, file), "utf8");
      const checksum = createHash("sha256").update(sql, "utf8").digest("hex");
      const existing = await client.query<{ checksum: string }>(
        "select checksum from schema_migrations where version = $1", [file]
      );
      if (existing.rows[0]) {
        if (existing.rows[0].checksum !== checksum) throw new Error(`Applied migration was modified: ${file}`);
        continue;
      }
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations(version, checksum) values ($1, $2)", [file, checksum]);
        await client.query("commit");
        applied.push(file);
      } catch (error) {
        await client.query("rollback");
        throw error;
      }
    }
    return applied;
  } finally {
    try {
      if (locked) await client.query("select pg_advisory_unlock(hashtext('answertravel-v2-migrations'))");
    } finally {
      client.release();
    }
  }
}
