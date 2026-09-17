import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type pg from "pg";

function checksum(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function normalizeMigrationSql(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function migrationChecksumCandidates(value: string): Set<string> {
  const lf = normalizeMigrationSql(value);
  const crlf = lf.replace(/\n/g, "\r\n");
  return new Set([checksum(value), checksum(lf), checksum(crlf)]);
}

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
      const source = await readFile(resolve(directory, file), "utf8");
      const sql = normalizeMigrationSql(source);
      const canonicalChecksum = checksum(sql);
      const existing = await client.query<{ checksum: string }>(
        "select checksum from schema_migrations where version = $1", [file]
      );
      if (existing.rows[0]) {
        if (!migrationChecksumCandidates(source).has(existing.rows[0].checksum)) {
          throw new Error(`Applied migration was modified: ${file}`);
        }
        continue;
      }
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations(version, checksum) values ($1, $2)", [file, canonicalChecksum]);
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
