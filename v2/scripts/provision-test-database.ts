import { pathToFileURL } from "node:url";
import pg from "pg";
import { runMigrations } from "../src/platform/migrations.js";
import { testDatabaseUrl } from "../tests/support/environment.js";

// Only for an isolated disposable test cluster; production role provisioning is separate.
export async function provisionTestDatabase(adminUrl: string, password: string): Promise<string> {
  const url = new URL(adminUrl);
  if (!url.pathname.endsWith("_test") || process.env.NODE_ENV === "production") throw new Error("Dedicated test database required.");
  const role = "answertravel_v2_app_test";
  const pool = new pg.Pool({ connectionString: adminUrl });
  try {
    await runMigrations(pool);
    const existing = await pool.query("select 1 from pg_roles where rolname = $1", [role]);
    if (existing.rowCount) throw new Error("Test role already exists; use a fresh isolated test cluster.");
    await pool.query(`create role ${pg.escapeIdentifier(role)} login nosuperuser nobypassrls nocreatedb nocreaterole password ${pg.escapeLiteral(password)}`);
    await pool.query(`grant usage on schema public to ${pg.escapeIdentifier(role)}`);
    await pool.query(`grant select on tenants to ${pg.escapeIdentifier(role)}`);
    // Extra mutation grants exercise append-only guards; production needs SELECT/INSERT only.
    await pool.query(`grant select, insert, update, delete, truncate on brand_truth_cards to ${pg.escapeIdentifier(role)}`);
    await pool.query(`grant select, insert, update, delete, truncate on brand_truth_quality_reports to ${pg.escapeIdentifier(role)}`);
    await pool.query(`grant select, insert, update, delete, truncate on question_generation_runs, question_panels to ${pg.escapeIdentifier(role)}`);
    // Extra mutation grants exercise database triggers; production needs SELECT/INSERT only.
    await pool.query(`grant select, insert, update, delete, truncate on evidence_artifacts, audit_events to ${pg.escapeIdentifier(role)}`);
  } finally {
    await pool.end();
  }
  url.username = role;
  url.password = password;
  return url.toString();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const adminUrl = testDatabaseUrl("TEST_ADMIN_DATABASE_URL");
  const password = process.env.TEST_APP_PASSWORD;
  if (!adminUrl || !password) throw new Error("TEST_ADMIN_DATABASE_URL and TEST_APP_PASSWORD are required.");
  await provisionTestDatabase(adminUrl, password);
  console.log("Isolated test database migrated; non-superuser test role provisioned.");
}
