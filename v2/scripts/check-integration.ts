import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { testDatabaseUrl, testRedisUrl } from "../tests/support/environment.js";

process.env.REQUIRE_INTEGRATION = "true";
testDatabaseUrl();
testDatabaseUrl("TEST_ADMIN_DATABASE_URL");
testRedisUrl();
const result = spawnSync(process.execPath, [resolve("node_modules/vitest/vitest.mjs"), "run"], {
  stdio: "inherit", env: process.env, windowsHide: true
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
