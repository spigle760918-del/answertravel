export function testDatabaseUrl(name = "TEST_DATABASE_URL"): string | undefined {
  const value = process.env[name];
  if (process.env.NODE_ENV === "production") throw new Error("Integration tests cannot run in production.");
  if (!value) {
    if (process.env.REQUIRE_INTEGRATION === "true") throw new Error(`${name} is required; integration tests may not be skipped.`);
    return undefined;
  }
  const url = new URL(value);
  if (!url.pathname.endsWith("_test")) throw new Error(`${name} must identify a dedicated _test database.`);
  return value;
}

export function testRedisUrl(): string | undefined {
  const value = process.env.TEST_REDIS_URL;
  if (!value && process.env.REQUIRE_INTEGRATION === "true") throw new Error("TEST_REDIS_URL is required.");
  return value;
}
