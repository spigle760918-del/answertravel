import { loadConfig } from "./platform/config.js";
import {
  createDatabasePool,
  assertRuntimeDatabaseRole,
} from "./platform/database.js";
import { createFoundationWorker } from "./platform/foundation-queue.js";
import { createObservationWorker } from "./modules/observation/observation-queue.js";
import { createCitationSourceWorker } from "./modules/citation-source/citation-source-queue.js";
import { createGeoIntelligenceWorker } from "./modules/geo-intelligence/geo-intelligence-queue.js";

const config = loadConfig();
const pool = createDatabasePool(config.DATABASE_URL);
await assertRuntimeDatabaseRole(pool).catch(async (error: unknown) => {
  await pool.end();
  throw error;
});
const runtime = createFoundationWorker(config.REDIS_URL, pool);
const observations = config.DEEPSEEK_API_KEY
  ? createObservationWorker(config.REDIS_URL, pool, config.DEEPSEEK_API_KEY)
  : undefined;
const citations = createCitationSourceWorker(config.REDIS_URL, pool, {
  allowedDomains: (config.SOURCE_FETCH_ALLOWED_DOMAINS ?? "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean),
});
const geoIntelligence = createGeoIntelligenceWorker(config.REDIS_URL, pool);

async function shutdown(): Promise<void> {
  await runtime.close();
  await observations?.close();
  await citations.close();
  await geoIntelligence.close();
  await pool.end();
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
