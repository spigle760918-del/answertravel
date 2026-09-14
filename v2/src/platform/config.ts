import { z } from "zod";

const ConfigSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4274),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  DEEPSEEK_API_KEY: z.string().min(1).optional(),
  ACCEPTANCE_TENANT_ID: z.string().uuid().optional(),
  WEB_ROOT: z.string().min(1).optional(),
  SOURCE_FETCH_ALLOWED_DOMAINS: z.string().optional(),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  return ConfigSchema.parse(environment);
}
