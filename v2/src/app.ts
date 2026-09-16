import Fastify, { type FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { readiness } from "./modules/health/health-service.js";
import { createDatabasePool } from "./platform/database.js";
import type { AppConfig } from "./platform/config.js";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { AcceptanceConsoleRepository } from "./modules/acceptance-console/acceptance-console.js";

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
  app.get("/api/acceptance/overview", async (_request, reply) => {
    if (!config.ACCEPTANCE_TENANT_ID) return reply.code(404).send({ code: "acceptance_console_disabled" });
    try {
      return await new AcceptanceConsoleRepository(pool, {
        ...(config.ALIYUN_RUNTIME_EVIDENCE
          ? { aliyunRuntime: config.ALIYUN_RUNTIME_EVIDENCE }
          : {}),
        ...(config.PUBLIC_HTTPS_EVIDENCE
          ? { publicHttps: config.PUBLIC_HTTPS_EVIDENCE }
          : {}),
      }).overview(config.ACCEPTANCE_TENANT_ID);
    }
    catch (error) {
      app.log.error({ err: error, event: "acceptance_console.read_failed" }, "Acceptance console data could not be read");
      return reply.code(503).send({ code: "acceptance_data_unavailable", message: "验收数据暂时不可用，请稍后重试。" });
    }
  });
  const webRoot=resolve(config.WEB_ROOT??"web-dist");
  if(existsSync(webRoot)) app.register(fastifyStatic,{root:webRoot,prefix:"/"});

  app.addHook("onClose", async () => {
    redis.disconnect();
    await pool.end();
  });

  return app;
}
