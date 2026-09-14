import { loadConfig } from "./platform/config.js";
import { createDatabasePool, assertRuntimeDatabaseRole } from "./platform/database.js";
import { createFoundationWorker } from "./platform/foundation-queue.js";
import { createObservationWorker } from "./modules/observation/observation-queue.js";

const config = loadConfig();
const pool = createDatabasePool(config.DATABASE_URL);
await assertRuntimeDatabaseRole(pool).catch(async (error: unknown) => { await pool.end(); throw error; });
const runtime = createFoundationWorker(config.REDIS_URL, pool);
const observations = config.DEEPSEEK_API_KEY ? createObservationWorker(config.REDIS_URL, pool, config.DEEPSEEK_API_KEY) : undefined;

async function shutdown(): Promise<void> {
  await runtime.close();
  await observations?.close();
  await pool.end();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
