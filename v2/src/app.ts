import Fastify, { type FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { readiness } from "./modules/health/health-service.js";
import { createDatabasePool } from "./platform/database.js";
import type { AppConfig } from "./platform/config.js";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { AcceptanceConsoleRepository } from "./modules/acceptance-console/acceptance-console.js";
import { registerProductReadRoutes } from "./modules/product-read/product-read-routes.js";
import { registerIdentityRoutes, resolvedAuthMode } from "./modules/identity/auth-routes.js";

export function buildApp(config: AppConfig): FastifyInstance {
  if(config.NODE_ENV==="production"&&resolvedAuthMode(config)!=="session")throw new Error("Production product routes require session authentication.");
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
        ...(config.CLOUD_BACKUP_RESTORE_EVIDENCE
          ? { cloudBackupRestore: config.CLOUD_BACKUP_RESTORE_EVIDENCE }
          : {}),
      }).overview(config.ACCEPTANCE_TENANT_ID);
    }
    catch (error) {
      app.log.error({ err: error, event: "acceptance_console.read_failed" }, "Acceptance console data could not be read");
      return reply.code(503).send({ code: "acceptance_data_unavailable", message: "验收数据暂时不可用，请稍后重试。" });
    }
  });
  app.addHook("onSend",async(request,reply,payload)=>{if(request.url.startsWith("/api/v1/")){reply.header("cache-control","no-store, private");reply.header("pragma","no-cache");reply.header("vary","Cookie");reply.header("x-content-type-options","nosniff");reply.header("referrer-policy","same-origin");}return payload;});
  const identity=registerIdentityRoutes(app,pool,config);
  registerProductReadRoutes(app, pool, identity.resolveTenant, config.NODE_ENV);
  const webRoot=resolve(config.WEB_ROOT??"web-dist");
  if(existsSync(webRoot)) app.register(fastifyStatic,{root:webRoot,prefix:"/"});

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/") || request.url.startsWith("/health/"))
      return reply.code(404).send({ code: "route_not_found", message: "未找到该接口。" });
    if (existsSync(webRoot) && request.headers.accept?.includes("text/html"))
      return reply.type("text/html").sendFile("index.html");
    return reply.code(404).send({ code: "route_not_found", message: "未找到该页面。" });
  });

  app.addHook("onClose", async () => {
    redis.disconnect();
    await pool.end();
  });

  return app;
}
