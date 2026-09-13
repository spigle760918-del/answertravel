import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    sequence: { concurrent: false },
    fileParallelism: false,
    testTimeout: 20000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"]
    }
  }
});
