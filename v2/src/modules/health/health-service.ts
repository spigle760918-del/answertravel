import type pg from "pg";
import type { Redis } from "ioredis";
import { assertRuntimeDatabaseRole } from "../../platform/database.js";

export type DependencyHealth = { status: "up" | "down"; latencyMs: number; error?: string };

async function probe(operation: () => Promise<unknown>): Promise<DependencyHealth> {
  const startedAt = performance.now();
  try {
    await operation();
    return { status: "up", latencyMs: Math.round(performance.now() - startedAt) };
  } catch (error) {
    return {
      status: "down",
      latencyMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : "Unknown dependency failure"
    };
  }
}

export async function readiness(pool: pg.Pool, redis: Redis): Promise<{
  status: "ready" | "not_ready";
  dependencies: { postgres: DependencyHealth; redis: DependencyHealth };
}> {
  const [postgres, redisHealth] = await Promise.all([
    probe(() => assertRuntimeDatabaseRole(pool)),
    probe(() => redis.ping())
  ]);
  return {
    status: postgres.status === "up" && redisHealth.status === "up" ? "ready" : "not_ready",
    dependencies: { postgres, redis: redisHealth }
  };
}
