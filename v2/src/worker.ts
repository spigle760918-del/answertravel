import { loadConfig } from "./platform/config.js";
import { createDatabasePool, assertRuntimeDatabaseRole } from "./platform/database.js";
import { createFoundationWorker } from "./platform/foundation-queue.js";

const config = loadConfig();
const pool = createDatabasePool(config.DATABASE_URL);
await assertRuntimeDatabaseRole(pool).catch(async (error: unknown) => { await pool.end(); throw error; });
const runtime = createFoundationWorker(config.REDIS_URL, pool);

async function shutdown(): Promise<void> {
  await runtime.close();
  await pool.end();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
