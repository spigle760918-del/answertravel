import Fastify, { type FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { readiness } from "./modules/health/health-service.js";
import { createDatabasePool } from "./platform/database.js";
import type { AppConfig } from "./platform/config.js";

export function buildApp(config: AppConfig): FastifyInstance {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });
  const pool = createDatabasePool(config.DATABASE_URL);
  const redis = new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 2000, commandTimeout: 3000 });
  redis.on("error", () => app.log.warn({ event: "dependency.unavailable", dependency: "redis" }));
  pool.on("error", () => app.log.warn({ event: "dependency.unavailable", dependency: "postgres" }));

  app.get("/health/live", async () => ({ status: "alive", service: "answertravel-v2-api" }));
  app.get("/health/ready", async (_request, reply) => {
    const result = await readiness(pool, redis);
    if (result.status !== "ready") reply.code(503);
    return result;
  });

  app.addHook("onClose", async () => {
    redis.disconnect();
    await pool.end();
  });

  return app;
}
