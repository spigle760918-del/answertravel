const path = require('path');
const fs = require('fs');

function loadLocalEnv() {
  if ((process.env.NODE_ENV || 'development') === 'production') return;
  const file = path.join(__dirname, '.env.local');
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadLocalEnv();
const postgresAvailable = (() => { try { require.resolve('pg'); return true; } catch { return false; } })();

function integer(name, fallback, minimum = 0) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) throw new Error(`${name} 必须是大于等于 ${minimum} 的整数。`);
  return value;
}

function flag(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw.toLowerCase())) return true;
  if (['0', 'false', 'no', 'off'].includes(raw.toLowerCase())) return false;
  throw new Error(`${name} 必须是 true 或 false。`);
}

function list(name, fallback) {
  const raw = process.env[name];
  return (raw == null || raw === '' ? fallback : raw.split(','))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const environment = process.env.NODE_ENV || 'development';
const production = environment === 'production';
const root = __dirname;
const configuredIndexDelay = Number(process.env.ANSWERTRAVEL_AUTO_INDEX_DELAY_MS || 2200);
const localAdminLoginEnabled = flag('ANSWERTRAVEL_LOCAL_ADMIN_LOGIN', false);

const config = Object.freeze({
  environment,
  production,
  host: process.env.ANSWERTRAVEL_API_HOST || '127.0.0.1',
  port: integer('ANSWERTRAVEL_API_PORT', 4174, 1),
  dataFile: process.env.ANSWERTRAVEL_API_DATA_FILE || path.join(root, 'data.json'),
  storageDriver: process.env.ANSWERTRAVEL_STORAGE || 'json',
  databaseUrl: process.env.DATABASE_URL || '',
  maxBodyBytes: integer('ANSWERTRAVEL_MAX_BODY_BYTES', 2 * 1024 * 1024, 1024),
  autoIndexDelayMs: Number.isFinite(configuredIndexDelay) ? Math.max(0, configuredIndexDelay) : 2200,
  accessTokenTtlMs: integer('ANSWERTRAVEL_ACCESS_TOKEN_TTL_MS', 15 * 60 * 1000, 60 * 1000),
  refreshTokenTtlMs: integer('ANSWERTRAVEL_REFRESH_TOKEN_TTL_MS', 30 * 24 * 60 * 60 * 1000, 60 * 1000),
  invitationTtlMs: integer('ANSWERTRAVEL_INVITATION_TTL_MS', 7 * 24 * 60 * 60 * 1000, 60 * 1000),
  demoAuthEnabled: flag('ANSWERTRAVEL_DEMO_AUTH', !production),
  localAdminLoginEnabled,
  allowedOrigins: list('ANSWERTRAVEL_ALLOWED_ORIGINS', [
    'http://127.0.0.1:4173',
    'http://localhost:4173',
    'null'
  ]),
  trustProxy: flag('ANSWERTRAVEL_TRUST_PROXY', false),
  bootstrapAdminEmail: (process.env.ANSWERTRAVEL_BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase(),
  bootstrapAdminPassword: process.env.ANSWERTRAVEL_BOOTSTRAP_ADMIN_PASSWORD || '',
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
  deepseekEndpoint: process.env.DEEPSEEK_API_ENDPOINT || 'https://api.deepseek.com/chat/completions',
  deepseekModel: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  braveSearchApiKey: process.env.BRAVE_SEARCH_API_KEY || '',
  braveSearchEndpoint: process.env.BRAVE_SEARCH_API_ENDPOINT || 'https://api.search.brave.com/res/v1/web/search',
  sourceSearchMaxResults: integer('ANSWERTRAVEL_SOURCE_SEARCH_MAX_RESULTS', 5, 1),
  sourceFetchTimeoutMs: integer('ANSWERTRAVEL_SOURCE_FETCH_TIMEOUT_MS', 12_000, 1_000),
  sourceFetchMaxBytes: integer('ANSWERTRAVEL_SOURCE_FETCH_MAX_BYTES', 1_500_000, 16_384),
  sourceAutoDiscover: flag('ANSWERTRAVEL_SOURCE_AUTO_DISCOVER', true),
  providerTimeoutMs: integer('ANSWERTRAVEL_PROVIDER_TIMEOUT_MS', 45_000, 1_000),
  collectionMaxAttempts: integer('ANSWERTRAVEL_COLLECTION_MAX_ATTEMPTS', 3, 1),
  collectionRetryBaseMs: integer('ANSWERTRAVEL_COLLECTION_RETRY_BASE_MS', 5_000, 100),
  collectionRetryMaxMs: integer('ANSWERTRAVEL_COLLECTION_RETRY_MAX_MS', 5 * 60_000, 100),
  collectionSchedulerIntervalMs: integer('ANSWERTRAVEL_COLLECTION_SCHEDULER_INTERVAL_MS', 60_000, 250),
  collectionTeamMonthlyQuota: integer('ANSWERTRAVEL_COLLECTION_TEAM_MONTHLY_QUOTA', 5000, 0),
  collectionBrandMonthlyQuota: integer('ANSWERTRAVEL_COLLECTION_BRAND_MONTHLY_QUOTA', 1000, 0),
  simulateProviderResponses: flag('ANSWERTRAVEL_SIMULATE_PROVIDER_RESPONSES', !production),
  postgresAvailable
});

function productionBlockers() {
  const blockers = [];
  if (config.storageDriver !== 'postgres') blockers.push('生产环境必须设置 ANSWERTRAVEL_STORAGE=postgres');
  else if (!config.postgresAvailable) blockers.push('缺少 pg 依赖，PostgreSQL 存储适配器无法加载');
  if (!config.databaseUrl) blockers.push('缺少 DATABASE_URL');
  if (config.demoAuthEnabled) blockers.push('生产环境必须关闭 ANSWERTRAVEL_DEMO_AUTH');
  if (config.localAdminLoginEnabled) blockers.push('生产环境必须关闭 ANSWERTRAVEL_LOCAL_ADMIN_LOGIN');
  if (!config.allowedOrigins.length || config.allowedOrigins.includes('*') || config.allowedOrigins.includes('null')) blockers.push('生产环境必须配置明确的 ANSWERTRAVEL_ALLOWED_ORIGINS');
  if (!config.bootstrapAdminEmail || !config.bootstrapAdminPassword) blockers.push('缺少生产环境初始管理员账号配置');
  return blockers;
}

if (!['json', 'postgres'].includes(config.storageDriver)) throw new Error('ANSWERTRAVEL_STORAGE 仅支持 json 或 postgres。');
if (production && config.bootstrapAdminPassword && config.bootstrapAdminPassword.length < 12) throw new Error('生产环境初始管理员密码至少需要 12 个字符。');

module.exports = { config, productionBlockers };
