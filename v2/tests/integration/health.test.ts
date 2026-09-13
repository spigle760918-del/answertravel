import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { testDatabaseUrl, testRedisUrl } from "../support/environment.js";

const databaseUrl = testDatabaseUrl();
const adminUrl = testDatabaseUrl("TEST_ADMIN_DATABASE_URL");
const redisUrl = testRedisUrl();
describe.runIf(Boolean(databaseUrl && adminUrl && redisUrl))("API health with real services", () => {
  const config = () => ({ NODE_ENV: "test" as const, HOST: "127.0.0.1", PORT: 4274,
    DATABASE_URL: databaseUrl!, REDIS_URL: redisUrl!, LOG_LEVEL: "silent" as const });
  it("returns ready only with a safe database role and live Redis", async () => {
    const app = buildApp(config());
    try {
      expect((await app.inject({ url: "/health/live" })).statusCode).toBe(200);
      const response = await app.inject({ url: "/health/ready" });
      expect(response.statusCode).toBe(200);
      expect(response.json().dependencies.postgres.status).toBe("up");
      expect(response.json().dependencies.redis.status).toBe("up");
    } finally { await app.close(); }
  });
  it("rejects unsafe database roles even when the database responds", async () => {
    const app = buildApp({ ...config(), DATABASE_URL: adminUrl! });
    try {
      const response = await app.inject({ url: "/health/ready" });
      expect(response.statusCode).toBe(503);
      expect(response.json().dependencies.postgres.status).toBe("down");
      expect(response.json().dependencies.redis.status).toBe("up");
    } finally { await app.close(); }
  });
  it("keeps liveness separate from unavailable dependencies", async () => {
    const app = buildApp({ ...config(), DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused_test", REDIS_URL: "redis://127.0.0.1:1" });
    try {
      expect((await app.inject({ url: "/health/live" })).statusCode).toBe(200);
      const response = await app.inject({ url: "/health/ready" });
      expect(response.statusCode).toBe(503);
      expect(response.json().dependencies.postgres.status).toBe("down");
      expect(response.json().dependencies.redis.status).toBe("down");
    } finally { await app.close(); }
  });
});
