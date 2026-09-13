import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../../src/platform/migrations.js";
import { testDatabaseUrl } from "../support/environment.js";

const adminUrl = testDatabaseUrl("TEST_ADMIN_DATABASE_URL");
describe.runIf(Boolean(adminUrl))("real PostgreSQL migrations", () => {
  it("is repeatable, detects modified history and rolls back failed DDL", async () => {
    const schema = `migration_test_${randomUUID().replaceAll("-", "")}`;
    const admin = new pg.Pool({ connectionString: adminUrl });
    const directory = await mkdtemp(join(tmpdir(), "answertravel-v2-migrations-"));
    const pool = new pg.Pool({ connectionString: adminUrl, options: `-c search_path=${schema}` });
    try {
      await admin.query(`create schema ${pg.escapeIdentifier(schema)}`);
      const first = join(directory, "0001_probe.sql");
      const sql = "create table migration_probe (id integer primary key);";
      await writeFile(first, sql);
      expect(await runMigrations(pool, directory)).toEqual(["0001_probe.sql"]);
      expect(await runMigrations(pool, directory)).toEqual([]);
      await writeFile(first, `${sql}\n-- changed fixture`);
      await expect(runMigrations(pool, directory)).rejects.toThrow("Applied migration was modified");
      await writeFile(first, sql);
      await writeFile(join(directory, "0002_failure.sql"), "create table rollback_probe(id integer); select missing_fixture_function();");
      await expect(runMigrations(pool, directory)).rejects.toThrow(/does not exist/);
      expect((await pool.query("select to_regclass('rollback_probe') as table_name")).rows[0].table_name).toBeNull();
      expect((await pool.query("select version from schema_migrations")).rows).toEqual([{ version: "0001_probe.sql" }]);
      await writeFile(join(directory, "0002_failure.sql"), "create table recovered_probe(id integer);");
      expect(await runMigrations(pool, directory)).toEqual(["0002_failure.sql"]);
    } finally {
      await pool.end();
      await admin.end();
    }
  });
});
