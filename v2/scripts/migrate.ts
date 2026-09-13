import { createDatabasePool } from "../src/platform/database.js";
import { runMigrations } from "../src/platform/migrations.js";

const databaseUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("MIGRATION_DATABASE_URL is required for migrations.");
const pool = createDatabasePool(databaseUrl);
try {
  console.log(JSON.stringify({ event: "migrations.complete", applied: await runMigrations(pool) }));
} finally {
  await pool.end();
}
