import { buildApp } from "./app.js";
import { loadConfig } from "./platform/config.js";

const config = loadConfig();
const app = buildApp(config);
process.once("SIGINT", () => void app.close());
process.once("SIGTERM", () => void app.close());

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
