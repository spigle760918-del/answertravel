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
  PRODUCT_TENANT_ID: z.string().uuid().optional(),
  PRODUCT_AUTH_MODE: z.enum(["disabled", "fixed_test", "session"]).optional(),
  PRODUCT_SESSION_COOKIE_NAME: z.string().regex(/^[A-Za-z0-9_-]{3,64}$/).optional(),
  PRODUCT_SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).optional(),
  PRODUCT_PUBLIC_ORIGIN: z.string().url().optional(),
  WEB_ROOT: z.string().min(1).optional(),
  SOURCE_FETCH_ALLOWED_DOMAINS: z.string().optional(),
  ALIYUN_RUNTIME_EVIDENCE: z.string().min(1).optional(),
  PUBLIC_HTTPS_EVIDENCE: z.string().min(1).optional(),
  CLOUD_BACKUP_RESTORE_EVIDENCE: z.string().min(1).optional(),
});

export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const config=ConfigSchema.parse(environment);
  if(config.NODE_ENV==="production"&&config.PRODUCT_AUTH_MODE!=="session") throw new Error("Production product routes require PRODUCT_AUTH_MODE=session.");
  if(config.NODE_ENV==="production"&&config.PRODUCT_TENANT_ID) throw new Error("PRODUCT_TENANT_ID is forbidden in production.");
  if(config.NODE_ENV==="production"&&!config.PRODUCT_PUBLIC_ORIGIN) throw new Error("PRODUCT_PUBLIC_ORIGIN is required in production.");
  return config;
}
