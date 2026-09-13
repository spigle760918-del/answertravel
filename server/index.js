const http = require('http');
const crypto = require('crypto');
const net = require('net');
const { config, productionBlockers } = require('./config');
const { applySecurityHeaders, clientAddress, createRateLimiter } = require('./security');
const { createStore } = require('./db');
const { createCollectionRunner } = require('./collection-runner');
const { createCollectionScheduler } = require('./collection-scheduler');
const { createSourceEvidenceService } = require('./source-evidence-service');
const { nextCollectionAt, ensureUsageLedger, quotaStatus, assertCollectionQuota, consumeCollectionQuota } = require('./collection-policy');
const { analyzeWorkspace } = require('../brand-intelligence');

const PORT = config.port;
const HOST = config.host;
const MAX_BODY_BYTES = config.maxBodyBytes;
const AUTO_INDEX_DELAY_MS = config.autoIndexDelayMs;
const ROLE_LEVEL = {
  '团队管理员': 4,
  '品牌管理员': 3,
  '品牌编辑者': 2,
  '品牌成员（只读）': 1,
  '无权限': 0
};
const PLATFORMS = ['DeepSeek', '豆包', 'Kimi', '元宝'];
const DEFAULT_CHANNELS = [
  { id: 'website', name: '官网', status: '已连接', enabled: true, endpoint: 'answertravel.example.com', defaultAuthor: 'AnswerTravel 内容团队' },
  { id: 'wechat', name: '微信公众号', status: '演示可用', enabled: true, endpoint: 'AnswerTravel 服务号', defaultAuthor: 'AnswerTravel 内容团队' },
  { id: 'wordpress', name: 'WordPress', status: '演示可用', enabled: true, endpoint: 'https://travel.example.com/wp-json', defaultAuthor: 'AnswerTravel 内容团队' }
];
const DEFAULT_BRANDS = [{
  id: 'brand-1', name: 'AnswerTravel', aliases: ['Answer Travel'], competitors: [], tracking: true,
  language: 'zh-CN', website: 'https://answertravel.example.com',
  description: '面向游客出发前决策的目的地问答与文旅品牌监控服务。', note: ''
}];
const sessions = new Map();
// 本地开发/验收需要允许重复尝试账号；正式生产仍保持严格的 15 分钟 20 次限制。
const authRateLimit = createRateLimiter({ windowMs: 15 * 60 * 1000, limit: config.production ? 20 : 100 });
let db;
let store;
let collectionRunner;
let collectionScheduler;
let sourceEvidenceService;

function relationalContext() {
  const repositories = store?.getRepositories?.();
  const workspaceId = store?.getWorkspaceId?.();
  return repositories && workspaceId ? { repositories, workspaceId } : null;
}

function id(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function clientResourceId(value, prefix) {
  const candidate = text(value);
  return new RegExp(`^${prefix}-[A-Za-z0-9-]{3,120}$`).test(candidate) ? candidate : id(prefix);
}

function generatedPromptGroupId(brandId, name) {
  return `group-${crypto.createHash('sha1').update(`${brandId}:${name}`).digest('hex').slice(0, 20)}`;
}

function now() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function text(value, fallback = '') {
  return String(value == null ? fallback : value).trim();
}

function pick(input, allowed) {
  const output = {};
  if (!input || typeof input !== 'object') return output;
  for (const key of allowed) if (Object.prototype.hasOwnProperty.call(input, key)) output[key] = input[key];
  return output;
}

function normalizeEmail(value) {
  return text(value).normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').toLowerCase();
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verifyPassword(password, stored) {
  const [, salt, expectedHex] = text(stored).split('$');
  if (!salt || !expectedHex) return false;
  const actual = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function publicMember(member) {
  const output = clone(member);
  delete output.inviteToken;
  delete output.inviteTokenHash;
  delete output.inviteUrl;
  const user = member?.userId && db?.users?.find((entry) => entry.id === member.userId);
  output.lastActiveAt = user?.lastLoginAt || member?.acceptedAt || member?.invitedAt || '';
  return output;
}

function scopeEntries(scope) {
  if (Array.isArray(scope)) return scope.map(text).filter(Boolean);
  if (scope && typeof scope === 'object') return [...(scope.brandIds || []), ...(scope.brands || [])].map(text).filter(Boolean);
  const value = text(scope);
  return value ? [value] : [];
}

function canAccessBrand(session, brandId) {
  if (!session || !brandId) return false;
  if (session.demo || session.role === '团队管理员') return true;
  const brand = db.brands.find((entry) => entry.id === brandId);
  if (!brand) return false;
  const scope = scopeEntries(session.scope);
  return scope.includes('全部品牌') || scope.includes('*') || scope.includes(brand.id) || scope.includes(brand.name);
}

function accessibleBrandIds(session) {
  return db.brands.filter((brand) => canAccessBrand(session, brand.id)).map((brand) => brand.id);
}

function selectedBrandId(session, requestedBrandId = '') {
  const requested = text(requestedBrandId);
  if (requested && !canAccessBrand(session, requested)) return '';
  const candidates = [requested, text(session?.selectedBrandId), text(db.workspace?.brandId)].filter(Boolean);
  const selected = candidates.find((brandId) => canAccessBrand(session, brandId)) || accessibleBrandIds(session)[0];
  if (selected && session) session.selectedBrandId = selected;
  return selected || '';
}

function resourceBrandId(resource) {
  if (resource?.brandId) return resource.brandId;
  if (resource?.promptId) return db.prompts.find((prompt) => prompt.id === resource.promptId)?.brandId || '';
  if (resource?.articleId) return db.articles.find((article) => article.id === resource.articleId)?.brandId || '';
  return '';
}

function visibleTo(session, resource) {
  const brandId = resourceBrandId(resource);
  return !brandId || canAccessBrand(session, brandId);
}

function scopesOverlap(session, member) {
  if (session?.demo || session?.role === '团队管理员') return true;
  if (member.userId && member.userId === session?.userId) return true;
  if (member.role === '团队管理员') return true;
  return db.brands.some((brand) => canAccessBrand(session, brand.id) && (
    scopeEntries(member.scope).includes('全部品牌') ||
    scopeEntries(member.scope).includes('*') ||
    scopeEntries(member.scope).includes(brand.id) ||
    scopeEntries(member.scope).includes(brand.name)
  ));
}

function workspaceFor(session) {
  return Object.assign(clone(db.workspace), {
    brandId: selectedBrandId(session),
    setupCompleted: Boolean(db.setupCompleted),
    wizardDraft: clone(db.wizardDraft || {})
  });
}

function publicSnapshot(session) {
  const snapshot = clone(db);
  delete snapshot.users;
  delete snapshot.refreshTokens;
  if (session.role !== '团队管理员') snapshot.auditLogs = [];
  snapshot.brands = snapshot.brands.filter((brand) => canAccessBrand(session, brand.id));
  snapshot.promptGroups = (snapshot.promptGroups || []).filter((group) => canAccessBrand(session, group.brandId));
  for (const key of ['prompts', 'records', 'assets', 'articles', 'tasks']) snapshot[key] = snapshot[key].filter((item) => visibleTo(session, item));
  snapshot.members = snapshot.members.filter((member) => scopesOverlap(session, member)).map(publicMember);
  if (!snapshot.brands.some((brand) => brand.id === snapshot.workspace.brandId)) snapshot.workspace.brandId = snapshot.brands[0]?.id || '';
  return snapshot;
}

function stageAudit(req, session, action, resourceType, resourceId, before, after) {
  let ip = clientAddress(req, config.trustProxy);
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (!net.isIP(ip)) ip = '';
  const entry = {
    id: id('audit'),
    actorId: session.userId || '',
    actor: session.user || '系统',
    action,
    resourceType,
    resourceId: text(resourceId),
    before: before == null ? null : clone(before),
    after: after == null ? null : clone(after),
    ip,
    createdAt: now()
  };
  db.auditLogs.unshift(entry);
  db.auditLogs = db.auditLogs.slice(0, 1000);
  return entry;
}

function expireAuthState() {
  const current = Date.now();
  for (const [token, session] of sessions) {
    if (Date.parse(session.expiresAt || '') <= current) sessions.delete(token);
  }
  db.refreshTokens = db.refreshTokens.filter((entry) => !entry.revokedAt && Date.parse(entry.expiresAt || '') > current);
}

function issueSession(user) {
  const accessToken = crypto.randomBytes(32).toString('hex');
  const refreshToken = crypto.randomBytes(48).toString('hex');
  const createdAt = now();
  const expiresAt = new Date(Date.now() + config.accessTokenTtlMs).toISOString();
  const refreshExpiresAt = new Date(Date.now() + config.refreshTokenTtlMs).toISOString();
  const member = db.members.find((entry) => entry.userId === user.id && entry.status === '正常');
  const session = {
    token: accessToken,
    accessToken,
    user: user.name,
    userId: user.id,
    email: user.email,
    role: member?.role || user.role,
    scope: member?.scope || '全部品牌',
    memberId: member?.id || '',
    createdAt,
    expiresAt
  };
  sessions.set(accessToken, session);
  db.refreshTokens.push({ id: id('refresh'), userId: user.id, tokenHash: tokenHash(refreshToken), createdAt, expiresAt: refreshExpiresAt, revokedAt: '' });
  return Object.assign(clone(session), { refreshToken, refreshExpiresAt });
}

function revokeUserSessions(userId) {
  for (const [token, session] of sessions) if (session.userId === userId) sessions.delete(token);
  const revoked = [];
  db.refreshTokens.forEach((entry) => {
    if (entry.userId !== userId || entry.revokedAt) return;
    entry.revokedAt = now();
    revoked.push(entry);
  });
  return revoked;
}

function factsPassed(article) {
  return ['factSources', 'factUpdated', 'factAuthor', 'factContact', 'factPricing']
    .every((key) => article && article[key] === true);
}

function seoPassed(article) {
  return Boolean(article && article.seoTitle && article.seoDescription && article.seoKeywords && article.slug);
}

function articleUrl(channel, article) {
  const endpoint = text(channel && channel.endpoint).replace(/\/wp-json\/?$/i, '').replace(/\/$/, '');
  if (!endpoint || channel.name === '微信公众号') return '';
  const base = /^https?:\/\//i.test(endpoint) ? endpoint : `https://${endpoint}`;
  return `${base}/guides/${article.slug || 'guide'}`;
}

function normalize() {
  db.workspace = db.workspace || { team: {}, channels: [] };
  db.workspace.team = Object.assign({ name: '体验团队', description: '' }, db.workspace.team || {});
  db.workspace.channels = Array.isArray(db.workspace.channels) ? db.workspace.channels : [];
  for (const key of ['brands', 'promptGroups', 'prompts', 'records', 'assets', 'articles', 'tasks', 'members', 'users', 'refreshTokens', 'auditLogs']) {
    if (!Array.isArray(db[key])) db[key] = [];
  }
  db.articles = db.articles.map((article) => Object.assign({ indexDueAt: '' }, article || {}));
  db.members = db.members.map((member) => {
    const normalized = Object.assign({}, member || {});
    if (normalized.inviteToken && !normalized.inviteTokenHash) normalized.inviteTokenHash = tokenHash(normalized.inviteToken);
    delete normalized.inviteToken;
    delete normalized.inviteUrl;
    return normalized;
  });
  db.workspace.brandId = db.workspace.brandId || db.brands[0]?.id || '';
  const defaultBrandId = db.workspace.brandId;
  db.prompts = db.prompts.map((prompt) => {
    const normalized = Object.assign({ brandId: defaultBrandId, frequency: 'daily' }, prompt || {});
    if (!normalized.nextCollectionAt && ['daily', 'weekly'].includes(normalized.frequency)) normalized.nextCollectionAt = nextCollectionAt(normalized.frequency);
    return normalized;
  });
  const knownGroups = new Map();
  db.promptGroups = db.promptGroups.map((group) => Object.assign({ brandId: defaultBrandId, name: '默认分组', sortOrder: 0 }, group || {}))
    .filter((group) => text(group.name))
    .map((group) => {
      const normalized = Object.assign({}, group, { name: text(group.name), brandId: group.brandId || defaultBrandId });
      normalized.id = clientResourceId(normalized.id, 'group') || generatedPromptGroupId(normalized.brandId, normalized.name);
      const key = `${normalized.brandId}:${normalized.name}`;
      if (knownGroups.has(key)) return null;
      knownGroups.set(key, normalized);
      return normalized;
    }).filter(Boolean);
  db.prompts.forEach((prompt) => {
    const name = text(prompt.group, '默认分组');
    const key = `${prompt.brandId}:${name}`;
    if (knownGroups.has(key)) return;
    const group = { id: generatedPromptGroupId(prompt.brandId, name), brandId: prompt.brandId, name, sortOrder: db.promptGroups.length, createdAt: now(), updatedAt: now() };
    knownGroups.set(key, group);
    db.promptGroups.push(group);
  });
  db.records = db.records.map((record) => Object.assign({ brandId: db.prompts.find((prompt) => prompt.id === record?.promptId)?.brandId || defaultBrandId }, record || {}));
  db.assets = db.assets.map((asset) => Object.assign({ brandId: defaultBrandId }, asset || {}));
  db.articles = db.articles.map((article) => Object.assign({ brandId: defaultBrandId, indexDueAt: '' }, article || {}));
  db.tasks = db.tasks.map((task) => Object.assign({ brandId: resourceBrandId(task) || defaultBrandId }, task || {}));
  ensureUsageLedger(db);
  db.meta = Object.assign({}, db.meta || {});
}

async function load() {
  db = await store.load();
  if (!db) {
    db = {
      version: 1,
      workspace: { team: { name: '体验团队', description: '' }, brandId: 'brand-1', channels: clone(DEFAULT_CHANNELS) },
      brands: clone(DEFAULT_BRANDS), promptGroups: [], prompts: [], records: [], assets: [], articles: [], tasks: [], members: [], users: [], refreshTokens: [], auditLogs: [], meta: {}
    };
    await persist();
  }
  normalize();
  const hasActivePasswordUser = db.users.some((entry) => entry.status === 'active' && text(entry.passwordHash).startsWith('scrypt$'));
  if (!hasActivePasswordUser && config.bootstrapAdminEmail && config.bootstrapAdminPassword) {
    const user = {
      id: id('user'), email: config.bootstrapAdminEmail, name: 'AnswerTravel 管理员', role: '团队管理员',
      passwordHash: hashPassword(config.bootstrapAdminPassword), status: 'active', createdAt: now(), updatedAt: now(), lastLoginAt: ''
    };
    db.users.push(user);
    const member = db.members.find((entry) => normalizeEmail(entry.email) === user.email);
    if (member) Object.assign(member, { name: user.name, role: user.role, status: '正常', userId: user.id });
    else db.members.unshift({ id: id('member'), userId: user.id, name: user.name, email: user.email, role: user.role, scope: '全部品牌', status: '正常' });
    await persist();
  }
  expireAuthState();
  advanceTasks();
}

function persist() {
  db.meta.updatedAt = now();
  return store.save(db).catch((error) => {
    console.error('[answertravel-api] persist failed', error);
    throw error;
  });
}

async function persistIncremental(mutator) {
  if (typeof store.mutate !== 'function') return persist();
  db.meta.updatedAt = now();
  try {
    const mutation = await store.mutate(mutator);
    db.meta.revision = mutation.revision;
    return mutation.result;
  } catch (error) {
    const restored = await store.load().catch(() => null);
    if (restored) {
      db = restored;
      normalize();
    }
    throw error;
  }
}

async function persistRuntimeState({ task = null, record = null, article = null, prompt = null, tasks = [], records = [], articles = [], prompts = [] } = {}) {
  if (typeof store.mutate !== 'function') return persist();
  const unique = (items) => [...new Map(items.filter(Boolean).map((item) => [item.id, item])).values()];
  return persistIncremental(async ({ repositories, workspaceId }) => {
    for (const item of unique([task, ...tasks])) await repositories.tasks.upsert(workspaceId, item);
    for (const item of unique([record, ...records])) await repositories.records.upsert(workspaceId, item);
    for (const item of unique([article, ...articles])) await repositories.articles.upsert(workspaceId, item);
    for (const item of unique([prompt, ...prompts])) await repositories.prompts.upsert(workspaceId, item);
    if (task || tasks.length) await repositories.workspace.updateSettings(workspaceId, { collectionUsage: db.workspace.collectionUsage });
  });
}

function sessionRefreshRecord(session) {
  const hash = tokenHash(session?.refreshToken || '');
  return db.refreshTokens.find((entry) => entry.tokenHash === hash) || null;
}

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body)
  });
  res.end(body);
}

function fail(res, status, message, details) {
  send(res, status, { error: { message, ...(details ? { details } : {}) } });
}

function routeError(res, error) {
  if (error && error.code === 'ANSWERTRAVEL_WRITE_CONFLICT') return fail(res, 409, error.message);
  if (error && error.code === '23505') return fail(res, 409, '相同名称或内容的数据已存在。');
  return fail(res, error?.statusCode || 500, error?.message || '服务器内部错误。', error?.code ? { code: error.code, quota: error.quota } : undefined);
}

function sessionFrom(req) {
  const auth = text(req.headers.authorization);
  if (auth.startsWith('Bearer ')) {
    const token = auth.slice(7);
    const session = sessions.get(token);
    if (session && Date.parse(session.expiresAt || '') > Date.now()) {
      if (session.userId) {
        const user = db.users.find((entry) => entry.id === session.userId && entry.status === 'active');
        if (!user) { sessions.delete(token); return null; }
        const member = db.members.find((entry) => entry.userId === user.id && entry.status === '正常');
        if (!member) { sessions.delete(token); return null; }
        session.user = user.name;
        session.role = member.role;
        session.scope = member.scope;
        session.memberId = member.id;
      }
      return session;
    }
    if (session) sessions.delete(token);
  }
  const encodedDemoRole = text(req.headers['x-demo-role']);
  let demoRole = encodedDemoRole;
  try { demoRole = decodeURIComponent(encodedDemoRole); } catch { return null; }
  if (config.demoAuthEnabled && demoRole && Object.prototype.hasOwnProperty.call(ROLE_LEVEL, demoRole)) {
    return { user: 'Demo', role: demoRole, scope: '全部品牌', token: '', demo: true };
  }
  return null;
}

function requireRole(req, res, level) {
  const session = sessionFrom(req);
  if (!session) {
    fail(res, 401, '请先登录。');
    return null;
  }
  if ((ROLE_LEVEL[session.role] || 0) < level) {
    fail(res, 403, '当前账号没有执行此操作的权限。');
    return null;
  }
  return session;
}

function localAdminLoginAvailable(req) {
  if (config.production || !config.localAdminLoginEnabled || HOST !== '127.0.0.1') return false;
  const address = clientAddress(req, config.trustProxy).replace(/^::ffff:/, '');
  return address === '127.0.0.1' || address === '::1';
}

function requireBrandRole(req, res, level, brandId) {
  const session = requireRole(req, res, level);
  if (!session) return null;
  if (!canAccessBrand(session, brandId)) {
    fail(res, 403, '当前账号没有访问该品牌的权限。');
    return null;
  }
  return session;
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let raw = '';
    let tooLarge = false;
    let settled = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        raw = '';
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      if (tooLarge) return reject(Object.assign(new Error(`请求体过大，不能超过 ${MAX_BODY_BYTES} 字节。`), { statusCode: 413 }));
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('请求体必须是合法 JSON。'), { statusCode: 400 }));
      }
    });
    req.on('aborted', () => {
      if (settled) return;
      settled = true;
      reject(Object.assign(new Error('请求在上传完成前中断。'), { statusCode: 400 }));
    });
    req.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}

function findOrFail(collection, resourceId, label) {
  const entries = Array.isArray(collection) ? collection : db[collection];
  const item = entries.find((entry) => entry.id === resourceId);
  if (!item) throw Object.assign(new Error(`${label}不存在。`), { statusCode: 404 });
  return item;
}

function updatePromptRecords(prompt) {
  db.records.filter((record) => record.promptId === prompt.id && record.status === 'queued').forEach((record) => {
    record.question = prompt.text;
    record.group = prompt.group;
  });
}

function collectionTaskRecords(task) {
  const linked = db.records.filter((record) => record.taskId === task.id);
  if (linked.length) return linked;
  // Legacy tasks predate taskId. Only unlinked records may be claimed by them.
  return db.records.filter((record) => record.promptId === task.promptId && !record.taskId &&
    (!task.platform || task.platform === '全平台' || record.platform === task.platform));
}

function createPrompt(input, brandId) {
  const cleanText = text(input.text);
  if (!cleanText) throw Object.assign(new Error('提问内容不能为空。'), { statusCode: 400 });
  const group = text(input.group, '默认分组');
  const frequency = ['manual', 'daily', 'weekly'].includes(text(input.frequency)) ? text(input.frequency) : 'daily';
  const platforms = Array.isArray(input.platforms) && input.platforms.length ? input.platforms : PLATFORMS;
  assertCollectionQuota(db, config, brandId, platforms.length);
  const prompt = {
    id: clientResourceId(input.id, 'prompt'),
    brandId,
    group,
    text: cleanText,
    platforms,
    rank: 0,
    exposure: 0,
    delta: 0,
    status: 'active',
    language: text(input.language, 'zh-CN'),
    region: text(input.region, '中国'),
    frequency,
    lastScheduledAt: '',
    nextCollectionAt: nextCollectionAt(frequency),
    createdAt: now().slice(0, 10)
  };
  db.prompts.unshift(prompt);
  const result = createCollectionTask(prompt, { reason: 'prompt_created' });
  return { prompt, task: result.task, records: result.records };
}

function createCollectionTask(prompt, options = {}) {
  const requestedPlatform = text(options.platform, '全平台');
  const platforms = requestedPlatform === '全平台'
    ? (Array.isArray(prompt.platforms) ? prompt.platforms : PLATFORMS)
    : [requestedPlatform];
  const active = db.tasks.find((entry) => entry.type === '回答采集' && entry.promptId === prompt.id && entry.platform === requestedPlatform && ['queued', 'running'].includes(entry.status));
  if (active) return { task: active, records: db.records.filter((record) => record.taskId === active.id), reused: true };
  consumeCollectionQuota(db, config, prompt.brandId, platforms.length);
  const task = {
    id: id('task'),
    brandId: prompt.brandId,
    type: '回答采集',
    promptId: prompt.id,
    label: `${prompt.group} · ${prompt.text}`,
    platform: requestedPlatform,
    status: 'queued',
    progress: 0,
    createdAt: now(),
    reason: text(options.reason, 'manual'),
    requestedBy: text(options.requestedBy),
    attempt: 0,
    maxAttempts: config.collectionMaxAttempts,
    error: ''
  };
  db.tasks.unshift(task);
  const createdAt = now();
  const records = platforms.map((platform) => ({
    id: id('record'), brandId: prompt.brandId, promptId: prompt.id, taskId: task.id,
    question: prompt.text, group: prompt.group, platform, mentioned: false, score: 0,
    date: createdAt.slice(0, 10), time: '待评估', createdAt,
    status: 'queued', answer: '任务已创建，等待大模型返回原始回答。', sources: []
  }));
  db.records.push(...records);
  return { task, records, reused: false };
}

function createArticle(input, brandId) {
  const title = text(input.title);
  if (!title) throw Object.assign(new Error('文章标题不能为空。'), { statusCode: 400 });
  const article = Object.assign({
    id: id('article'), status: '草稿', check: '需补资料', channel: '未发布',
    seoTitle: '', seoDescription: '', seoKeywords: '', slug: '',
    factSources: false, factUpdated: false, factAuthor: false,
    factContact: false, factPricing: false, seoCheck: '未检查',
    indexStatus: '未提交', indexDueAt: '', publishedAt: '', publishedUrl: '',
    reviewer: '', reviewedAt: '', indexCheckedAt: '', publishError: '', time: '刚刚'
  }, pick(input, ['status', 'topic', 'body', 'channel', 'seoTitle', 'seoDescription', 'seoKeywords', 'slug', 'factSources', 'factUpdated', 'factAuthor', 'factContact', 'factPricing', 'analysisSnapshot', 'contentBrief', 'sourceRecordIds']), { title });
  article.id = clientResourceId(input.id, 'article');
  article.brandId = brandId;
  article.title = title;
  article.status = ['草稿', '待审核', '待发布'].includes(article.status) ? article.status : '草稿';
  article.channel = text(article.channel, '未发布');
  article.seoCheck = seoPassed(article) ? '已通过' : '未检查';
  if (article.status === '待发布' && !factsPassed(article)) article.status = '待审核';
  db.articles.unshift(article);
  return article;
}

function channelFor(name) {
  return db.workspace.channels.find((channel) => channel.name === name);
}

function publishArticle(article, requestedChannel) {
  if (!factsPassed(article)) throw Object.assign(new Error('请先完成事实与可信度检查。'), { statusCode: 400 });
  if (!seoPassed(article)) throw Object.assign(new Error('请先补充 SEO 标题、描述、关键词和 URL slug。'), { statusCode: 400 });
  const channel = channelFor(text(requestedChannel, article.channel));
  if (!channel || channel.enabled === false || ['未连接', '暂停'].includes(channel.status)) {
    throw Object.assign(new Error('发布渠道未连接或已暂停。'), { statusCode: 409 });
  }
  article.channel = channel.name;
  article.status = '发布中';
  article.indexStatus = '未提交';
  article.indexDueAt = '';
  article.publishedAt = '';
  article.publishedUrl = '';
  article.publishError = '';
  article.time = '刚刚';
  const task = {
    id: id('task'), brandId: article.brandId, type: '文章发布', articleId: article.id, label: article.title,
    platform: channel.name, status: 'running', progress: 25, createdAt: now(), error: ''
  };
  db.tasks.unshift(task);
  return { article, task };
}

function advanceTasks() {
  const current = Date.now();
  const changedTasks = [];
  const changedRecords = [];
  const changedArticles = [];
  for (const task of db.tasks) {
    if (task.type === '文章发布' && task.status === 'completed' && task.articleId) {
      const publishedArticle = db.articles.find((entry) => entry.id === task.articleId);
      const dueAt = Date.parse(publishedArticle?.indexDueAt || '');
      const publishedAt = Date.parse(publishedArticle?.publishedAt || '');
      const fallbackDueAt = Number.isFinite(publishedAt) ? publishedAt + AUTO_INDEX_DELAY_MS : NaN;
      const shouldIndex = Boolean(
        publishedArticle &&
        publishedArticle.indexStatus === '待收录' &&
        ((Number.isFinite(dueAt) && current >= dueAt) ||
          (!Number.isFinite(dueAt) && Number.isFinite(fallbackDueAt) && current >= fallbackDueAt))
      );
      if (shouldIndex) {
        publishedArticle.indexStatus = '已收录';
        publishedArticle.indexCheckedAt = now();
        publishedArticle.time = '刚刚';
        changedArticles.push(publishedArticle);
      }
      continue;
    }
    if (collectionRunner?.owns(task)) continue;
    if (!['running', 'queued'].includes(task.status)) continue;
    const started = Date.parse(task.startedAt || task.createdAt || '') || current;
    const age = current - started;
    if (age < 900) continue;
    const article = task.articleId ? db.articles.find((entry) => entry.id === task.articleId) : null;
    if (task.type === '文章发布' && article) {
      const channel = channelFor(article.channel);
      if (!channel || channel.enabled === false || ['未连接', '暂停'].includes(channel.status)) {
        task.status = 'error'; task.progress = 25; task.error = '发布渠道未连接或已暂停。';
        article.status = factsPassed(article) ? '待发布' : '待审核'; article.publishError = task.error;
      } else {
        task.status = 'completed'; task.progress = 100; task.completedAt = now();
        article.status = '已发布';
        article.publishedAt = article.publishedAt || now();
        const publishedAt = Date.parse(article.publishedAt);
        article.indexDueAt = Number.isFinite(publishedAt) ? new Date(publishedAt + AUTO_INDEX_DELAY_MS).toISOString() : '';
        article.indexStatus = age >= AUTO_INDEX_DELAY_MS ? '已收录' : '待收录';
        article.publishedUrl = articleUrl(channel, article); article.time = '刚刚';
        if (article.indexStatus === '已收录') article.indexCheckedAt = now();
      }
    } else if (task.type === '回答采集') {
      const records = collectionTaskRecords(task);
      if (!config.simulateProviderResponses) {
        task.status = 'error'; task.progress = 100; task.completedAt = now(); task.error = '尚未配置可用的大模型平台。'; task.errorCode = 'PROVIDER_NOT_CONFIGURED'; task.retryable = false;
        records.forEach((record) => {
          record.status = 'error'; record.answer = '采集失败：尚未配置可用的大模型平台。'; record.collectionMode = 'unavailable'; record.time = now();
          changedRecords.push(record);
        });
      } else {
        task.status = 'completed'; task.progress = 100; task.completedAt = now(); task.provider = 'AnswerTravel 模拟器'; task.collectionMode = 'simulated';
        records.forEach((record, index) => {
          record.status = 'completed'; record.mentioned = index % 3 !== 2; record.score = record.mentioned ? 62 - index * 4 : 34;
          record.answer = record.mentioned ? '模拟采集已完成：返回了新的目的地推荐结果。' : '模拟采集已完成：当前回答未提及目标目的地。';
          record.time = now(); record.collectionMode = 'simulated'; record.modelVersion = 'answertravel-simulator-v1';
          changedRecords.push(record);
        });
      }
    } else if (task.type === '文章生成' && article) {
      task.status = 'completed'; task.progress = 100; task.completedAt = now(); article.check = '资料齐全'; article.time = '刚刚';
    } else {
      task.status = 'completed'; task.progress = 100; task.completedAt = now();
    }
    changedTasks.push(task);
    if (article) changedArticles.push(article);
  }
  return changedTasks.length || changedRecords.length || changedArticles.length
    ? { tasks: changedTasks, records: changedRecords, articles: changedArticles }
    : null;
}

async function route(req, res) {
  if (req.method === 'OPTIONS') {
    if (req.answerTravelCors && !req.answerTravelCors.originAllowed) return fail(res, 403, '该来源不在 CORS 白名单中。');
    return send(res, 204, {});
  }
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const rawPathname = url.pathname.replace(/\/$/, '') || '/';
  const pathname = rawPathname === '/api/v1' ? '/api' : rawPathname.replace(/^\/api\/v1(?=\/)/, '/api');
  if (!pathname.startsWith('/api')) return fail(res, 404, 'API 路径不存在。');
  const publicRoute = pathname === '/api/health' || pathname === '/api/ready' ||
    pathname === '/api/auth/login' || pathname === '/api/auth/local-admin' || pathname === '/api/auth/register' || pathname === '/api/auth/refresh' || pathname === '/api/auth/logout' ||
    /^\/api\/invitations\/[^/]+(?:\/accept)?$/.test(pathname);
  if (config.production && !publicRoute && !sessionFrom(req)) return fail(res, 401, '请先登录。');
  const advanced = advanceTasks();
  if (advanced) await persistRuntimeState(advanced);
  let body = {};
  if (!['GET', 'HEAD'].includes(req.method)) {
    try { body = await parseBody(req); } catch (error) { return fail(res, error.statusCode || 400, error.message); }
  }
  try {
    if (pathname === '/api/health' && req.method === 'GET') return send(res, 200, { ok: true, service: 'answertravel-api', version: 'v1', environment: config.environment, time: now() });
    if (pathname === '/api/ready' && req.method === 'GET') {
      const blockers = productionBlockers();
      let storageReady = false;
      try { storageReady = await store.health(); } catch (error) { blockers.push(`存储不可用：${error.message}`); }
      const ready = storageReady && (!config.production || blockers.length === 0);
      return send(res, ready ? 200 : 503, { ready, productionReady: blockers.length === 0 && storageReady, storage: config.storageDriver, blockers });
    }
    if (pathname === '/api/auth/local-admin' && req.method === 'GET') {
      return send(res, 200, { data: { available: localAdminLoginAvailable(req) } });
    }
    if (pathname === '/api/auth/local-admin' && req.method === 'POST') {
      if (!localAdminLoginAvailable(req)) return fail(res, 404, 'API 路径不存在。');
      const user = db.users.find((entry) => entry.email === config.bootstrapAdminEmail && entry.status === 'active' && text(entry.passwordHash).startsWith('scrypt$'));
      if (!user) return fail(res, 503, '本地管理员账号尚未初始化。');
      user.lastLoginAt = now();
      const session = issueSession(user);
      const refreshToken = sessionRefreshRecord(session);
      const audit = stageAudit(req, session, 'auth.local-admin', 'user', user.id, null, { email: user.email, role: session.role });
      await persistIncremental(async ({ repositories, workspaceId }) => {
        await repositories.identity.upsertUser(user);
        await repositories.identity.upsertRefreshToken(refreshToken);
        await repositories.auditLogs.append(workspaceId, audit);
      });
      return send(res, 200, { data: session });
    }
    if (pathname === '/api/auth/register' && req.method === 'POST') {
      const email = normalizeEmail(body.email);
      const password = String(body.password || '');
      if (!validEmail(email)) return fail(res, 400, '请输入有效的邮箱地址。');
      if (password.length < 10) return fail(res, 400, '密码至少需要 10 个字符。');
      if (db.users.some((entry) => entry.email === email)) return fail(res, 409, '该邮箱已经注册。');
      let member = null;
      let role = '团队管理员';
      if (db.users.length || config.production) {
        const inviteToken = text(body.inviteToken);
        member = db.members.find((entry) => entry.inviteTokenHash === tokenHash(inviteToken) && normalizeEmail(entry.email) === email && entry.status === '待接受' && Date.parse(entry.inviteExpiresAt || '') > Date.now());
        if (!member) return fail(res, 403, '需要有效的团队邀请才能注册。');
        role = member.role;
      }
      const user = { id: id('user'), email, name: text(body.name, email.split('@')[0]), role, passwordHash: hashPassword(password), status: 'active', createdAt: now(), updatedAt: now(), lastLoginAt: now() };
      db.users.push(user);
      const invitationBefore = member ? publicMember(member) : null;
      if (member) Object.assign(member, { userId: user.id, name: user.name, status: '正常', acceptedAt: now(), inviteTokenHash: '' });
      else {
        const existingMember = db.members.find((entry) => normalizeEmail(entry.email) === email);
        if (existingMember) {
          Object.assign(existingMember, { userId: user.id, name: user.name, role, status: '正常' });
          member = existingMember;
        } else {
          member = { id: id('member'), userId: user.id, name: user.name, email, role, scope: '全部品牌', status: '正常', acceptedAt: now() };
          db.members.unshift(member);
        }
      }
      const session = issueSession(user);
      const refreshToken = sessionRefreshRecord(session);
      const audit = stageAudit(req, session, invitationBefore ? 'member.accept' : 'member.register', 'member', member.id, invitationBefore, publicMember(member));
      await persistIncremental(async ({ repositories, workspaceId }) => {
        if (invitationBefore) await repositories.identity.acceptInvitation(workspaceId, member, user);
        else await repositories.identity.upsertMember(workspaceId, member, user);
        await repositories.identity.upsertRefreshToken(refreshToken);
        await repositories.auditLogs.append(workspaceId, audit);
      });
      return send(res, 201, { data: session });
    }
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const rate = authRateLimit(clientAddress(req, config.trustProxy));
      res.setHeader('X-RateLimit-Remaining', String(rate.remaining));
      if (!rate.allowed) { res.setHeader('Retry-After', String(rate.retryAfterSeconds)); return fail(res, 429, '登录尝试过于频繁，请稍后再试。'); }
      const email = normalizeEmail(body.email);
      const submittedPassword = String(body.password || '');
      // 本地验收时兼容复制粘贴带入的空格、零宽字符与全角标点；生产环境保持密码原样校验。
      const password = config.production
        ? submittedPassword
        : submittedPassword.normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/\p{Pd}/gu, '-').trim();
      if (email || body.password !== undefined) {
        const user = db.users.find((entry) => entry.email === email && entry.status === 'active');
        if (!user || !verifyPassword(password, user.passwordHash)) return fail(res, 401, '邮箱或密码错误。');
        user.lastLoginAt = now();
        const session = issueSession(user);
        const refreshToken = sessionRefreshRecord(session);
        await persistIncremental(async ({ repositories }) => {
          await repositories.identity.upsertUser(user);
          await repositories.identity.upsertRefreshToken(refreshToken);
        });
        return send(res, 200, { data: session });
      }
      if (!config.demoAuthEnabled) return fail(res, 400, '生产环境必须使用邮箱和密码登录。');
      const role = text(body.role, '团队管理员');
      if (!Object.prototype.hasOwnProperty.call(ROLE_LEVEL, role)) return fail(res, 400, '角色无效。');
      const token = crypto.randomBytes(32).toString('hex');
      const session = { token, accessToken: token, user: text(body.user, 'Admin'), role, createdAt: now(), expiresAt: new Date(Date.now() + config.accessTokenTtlMs).toISOString(), demo: true };
      sessions.set(token, session);
      return send(res, 200, { data: clone(session) });
    }
    if (pathname === '/api/auth/refresh' && req.method === 'POST') {
      expireAuthState();
      const hash = tokenHash(body.refreshToken || '');
      const stored = db.refreshTokens.find((entry) => entry.tokenHash === hash && !entry.revokedAt && Date.parse(entry.expiresAt || '') > Date.now());
      if (!stored) return fail(res, 401, '刷新凭证无效或已过期，请重新登录。');
      const user = db.users.find((entry) => entry.id === stored.userId && entry.status === 'active');
      if (!user) return fail(res, 401, '账号已停用。');
      stored.revokedAt = now();
      const session = issueSession(user);
      const refreshToken = sessionRefreshRecord(session);
      await persistIncremental(async ({ repositories }) => {
        await repositories.identity.revokeRefreshToken(stored.tokenHash, stored.revokedAt);
        await repositories.identity.upsertRefreshToken(refreshToken);
      });
      return send(res, 200, { data: session });
    }
    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      const auth = text(req.headers.authorization); if (auth.startsWith('Bearer ')) sessions.delete(auth.slice(7));
      const refreshHash = tokenHash(body.refreshToken || '');
      const stored = db.refreshTokens.find((entry) => entry.tokenHash === refreshHash && !entry.revokedAt);
      if (stored) {
        stored.revokedAt = now();
        await persistIncremental(({ repositories }) => repositories.identity.revokeRefreshToken(stored.tokenHash, stored.revokedAt));
      }
      return send(res, 200, { data: { loggedIn: false } });
    }
    if (pathname === '/api/auth/me' && req.method === 'GET') {
      const session = requireRole(req, res, 1); if (!session) return;
      return send(res, 200, { data: { loggedIn: true, user: session.user, userId: session.userId || '', email: session.email || '', role: session.role, scope: clone(session.scope || []), brandIds: accessibleBrandIds(session), expiresAt: session.expiresAt || '', demo: Boolean(session.demo) } });
    }
    if (pathname === '/api/providers' && req.method === 'GET') {
      if (!requireRole(req, res, 1)) return;
      return send(res, 200, { data: collectionRunner?.status?.() || [] });
    }
    if (pathname === '/api/collection/status' && req.method === 'GET') {
      const session = requireRole(req, res, 1); if (!session) return;
      const brandIds = accessibleBrandIds(session);
      const quotas = brandIds.map((brandId) => ({ brandId, ...quotaStatus(db, config, brandId) }));
      const scheduled = db.prompts.filter((prompt) => canAccessBrand(session, prompt.brandId) && prompt.status === 'active' && ['daily', 'weekly'].includes(prompt.frequency));
      return send(res, 200, { data: {
        providers: collectionRunner?.status?.() || [], quotas,
        schedule: { enabled: true, activePrompts: scheduled.length, nextRunAt: scheduled.map((prompt) => prompt.nextCollectionAt).filter(Boolean).sort()[0] || '' }
      } });
    }
    if (pathname === '/api/audit-logs' && req.method === 'GET') {
      if (!requireRole(req, res, 4)) return;
      const filters = {
        resourceType: text(url.searchParams.get('resourceType')),
        action: text(url.searchParams.get('action')),
        limit: text(url.searchParams.get('limit'))
      };
      const relational = relationalContext();
      if (relational) {
        const auditLogs = await relational.repositories.auditLogs.list(relational.workspaceId, filters);
        return send(res, 200, { data: auditLogs, filters });
      }
      const limit = Math.min(200, Math.max(1, Number(filters.limit) || 50));
      const auditLogs = db.auditLogs.filter((entry) =>
        (!filters.resourceType || filters.resourceType === 'all' || entry.resourceType === filters.resourceType) &&
        (!filters.action || filters.action === 'all' || entry.action === filters.action)
      ).slice(0, limit);
      return send(res, 200, { data: clone(auditLogs), filters });
    }
    if (pathname === '/api/brand-intelligence' && req.method === 'GET') {
      const session = requireRole(req, res, 1); if (!session) return;
      const brandId = text(url.searchParams.get('brandId'), db.workspace.brandId || db.brands[0]?.id);
      if (!brandId || !canAccessBrand(session, brandId)) return fail(res, 403, '当前账号没有该品牌的分析权限。');
      try {
        return send(res, 200, { data: analyzeWorkspace(db, brandId) });
      } catch (error) {
        return fail(res, error.statusCode || 400, error.message || '品牌优化分析失败。');
      }
    }
    if (pathname === '/api/snapshot' && req.method === 'GET') { const session = requireRole(req, res, 1); if (!session) return; return send(res, 200, { data: publicSnapshot(session), auth: { loggedIn: true, user: session.user, role: session.role, scope: clone(session.scope || []) } }); }
    if (pathname === '/api/snapshot' && req.method === 'PUT') {
      if (config.production) return fail(res, 404, '生产环境不支持整份快照写入。');
      const session = requireRole(req, res, 4); if (!session) return;
      const incoming = body && body.data && typeof body.data === 'object' ? body.data : body;
      if (!incoming || typeof incoming !== 'object') return fail(res, 400, '快照格式无效。');
      const keys = ['workspace', 'brands', 'promptGroups', 'prompts', 'records', 'assets', 'articles', 'tasks', 'members', 'wizardDraft', 'setupCompleted'];
      for (const key of keys) if (incoming[key] !== undefined) db[key] = clone(incoming[key]);
      normalize(); await persist();
      return send(res, 200, { data: publicSnapshot(session) });
    }
    if (pathname === '/api/workspace' && req.method === 'GET') { const session = requireRole(req, res, 1); if (!session) return; return send(res, 200, { data: workspaceFor(session) }); }
    if (pathname === '/api/workspace' && req.method === 'PATCH') {
      const session = requireRole(req, res, 1); if (!session) return;
      const before = { brandId: db.workspace.brandId, setupCompleted: Boolean(db.setupCompleted), wizardDraft: clone(db.wizardDraft || {}) };
      let persistentChange = false;
      if (Object.prototype.hasOwnProperty.call(body, 'brandId')) {
        if (body.brandId && !db.brands.some((brand) => brand.id === body.brandId)) return fail(res, 400, '所选品牌不存在。');
        if (!canAccessBrand(session, body.brandId)) return fail(res, 403, '当前账号没有访问该品牌的权限。');
        session.selectedBrandId = text(body.brandId, session.selectedBrandId);
        if (session.role === '团队管理员' || session.demo) {
          persistentChange = persistentChange || db.workspace.brandId !== session.selectedBrandId;
          db.workspace.brandId = session.selectedBrandId;
        }
      }
      const editsSetup = Object.prototype.hasOwnProperty.call(body, 'setupCompleted') || (body.wizardDraft && typeof body.wizardDraft === 'object');
      if (editsSetup && (ROLE_LEVEL[session.role] || 0) < 4) return fail(res, 403, '只有团队管理员可以修改设置向导。');
      if (Object.prototype.hasOwnProperty.call(body, 'setupCompleted')) {
        persistentChange = persistentChange || db.setupCompleted !== Boolean(body.setupCompleted);
        db.setupCompleted = Boolean(body.setupCompleted);
      }
      if (body.wizardDraft && typeof body.wizardDraft === 'object') {
        persistentChange = persistentChange || JSON.stringify(db.wizardDraft || {}) !== JSON.stringify(body.wizardDraft);
        db.wizardDraft = clone(body.wizardDraft);
      }
      if (persistentChange) {
        const after = { brandId: db.workspace.brandId, setupCompleted: Boolean(db.setupCompleted), wizardDraft: clone(db.wizardDraft || {}) };
        const audit = stageAudit(req, session, 'workspace.settings.update', 'workspace', db.workspace.id, before, after);
        await persistIncremental(async ({ repositories, workspaceId }) => {
          await repositories.workspace.updateSettings(workspaceId, after);
          await repositories.auditLogs.append(workspaceId, audit);
        });
      }
      return send(res, 200, { data: workspaceFor(session) });
    }
    if (pathname === '/api/workspace/team' && req.method === 'PATCH') {
      const session = requireRole(req, res, 4); if (!session) return;
      const before = clone(db.workspace.team);
      db.workspace.team.name = text(body.name, db.workspace.team.name);
      db.workspace.team.description = text(body.description, db.workspace.team.description);
      const audit = stageAudit(req, session, 'workspace.team.update', 'workspace', db.workspace.id, before, db.workspace.team);
      await persistIncremental(async ({ repositories, workspaceId }) => {
        await repositories.workspace.updateTeam(workspaceId, db.workspace.team);
        await repositories.auditLogs.append(workspaceId, audit);
      });
      return send(res, 200, { data: clone(db.workspace.team) });
    }
    const channelMatch = pathname.match(/^\/api\/workspace\/channels\/([^/]+)$/);
    if (channelMatch && req.method === 'PATCH') {
      const session = requireRole(req, res, 4); if (!session) return;
      const channel = findOrFail(db.workspace.channels, channelMatch[1], '发布渠道');
      const before = clone(channel);
      Object.assign(channel, { status: text(body.status, channel.status), endpoint: text(body.endpoint, channel.endpoint), defaultAuthor: text(body.defaultAuthor, channel.defaultAuthor) });
      channel.enabled = channel.status !== '未连接';
      const audit = stageAudit(req, session, 'channel.update', 'channel', channel.id, before, channel);
      await persistIncremental(async ({ repositories, workspaceId }) => {
        await repositories.workspace.updateChannel(workspaceId, channel.id, channel);
        await repositories.auditLogs.append(workspaceId, audit);
      });
      return send(res, 200, { data: clone(channel) });
    }
    const brandMatch = pathname.match(/^\/api\/brands(?:\/([^/]+))?$/);
    if (brandMatch) {
      const brandId = brandMatch[1];
      if (req.method === 'GET') {
        const session = requireRole(req, res, 1); if (!session) return;
        if (brandId && !canAccessBrand(session, brandId)) return fail(res, 403, '当前账号没有访问该品牌的权限。');
        const relational = relationalContext();
        if (relational) {
          const queried = brandId
            ? await relational.repositories.brands.get(relational.workspaceId, brandId)
            : await relational.repositories.brands.list(relational.workspaceId);
          if (brandId && !queried) return fail(res, 404, '品牌不存在。');
          const data = brandId ? queried : queried.filter((brand) => canAccessBrand(session, brand.id));
          return send(res, 200, { data });
        }
        return send(res, 200, { data: brandId ? clone(findOrFail(db.brands, brandId, '品牌')) : clone(db.brands.filter((brand) => canAccessBrand(session, brand.id))) });
      }
      if (req.method === 'POST') {
        const session = requireRole(req, res, 4); if (!session) return;
        const brand = Object.assign({ aliases: [], competitors: [], tracking: true, language: 'zh-CN' }, pick(body, ['name', 'aliases', 'website', 'language', 'region', 'description', 'note', 'tracking']), { id: clientResourceId(body.id, 'brand') });
        if (!text(brand.name)) return fail(res, 400, '品牌名称不能为空。');
        if (db.brands.some((entry) => entry.id === brand.id)) return fail(res, 409, '品牌已存在。');
        db.brands.push(brand);
        const audit = stageAudit(req, session, 'brand.create', 'brand', brand.id, null, brand);
        await persistIncremental(async ({ repositories, workspaceId }) => {
          await repositories.brands.upsert(workspaceId, brand);
          await repositories.auditLogs.append(workspaceId, audit);
        });
        return send(res, 201, { data: clone(brand) });
      }
      const session = requireBrandRole(req, res, 2, brandId); if (!session) return;
      const brand = findOrFail(db.brands, brandId, '品牌');
      if (req.method === 'PATCH') {
        const before = clone(brand);
        Object.assign(brand, pick(body, ['name', 'aliases', 'website', 'language', 'region', 'description', 'note', 'tracking']));
        if (!text(brand.name)) return fail(res, 400, '品牌名称不能为空。');
        const audit = stageAudit(req, session, 'brand.update', 'brand', brand.id, before, brand);
        await persistIncremental(async ({ repositories, workspaceId }) => {
          await repositories.brands.upsert(workspaceId, brand);
          await repositories.auditLogs.append(workspaceId, audit);
        });
        return send(res, 200, { data: clone(brand) });
      }
      if (req.method === 'DELETE') {
        if ((ROLE_LEVEL[session.role] || 0) < 4) return fail(res, 403, '只有团队管理员可以删除品牌。');
        if (db.brands.length <= 1) return fail(res, 409, '至少保留一个品牌。');
        const before = clone(brand);
        db.brands = db.brands.filter((entry) => entry.id !== brandId);
        db.prompts = db.prompts.filter((entry) => entry.brandId !== brandId);
        db.records = db.records.filter((entry) => entry.brandId !== brandId);
        db.assets = db.assets.filter((entry) => entry.brandId !== brandId);
        db.articles = db.articles.filter((entry) => entry.brandId !== brandId);
        db.tasks = db.tasks.filter((entry) => entry.brandId !== brandId);
        if (db.workspace.brandId === brandId) db.workspace.brandId = db.brands[0].id;
        const selectedBrandId = db.workspace.brandId;
        const audit = stageAudit(req, session, 'brand.delete', 'brand', brandId, before, null);
        await persistIncremental(async ({ repositories, workspaceId }) => {
          await repositories.brands.delete(workspaceId, brandId, selectedBrandId);
          await repositories.auditLogs.append(workspaceId, audit);
        });
        return send(res, 200, { data: { deleted: true } });
      }
    }
    const competitorMatch = pathname.match(/^\/api\/brands\/([^/]+)\/competitors$/);
    if (competitorMatch && req.method === 'PUT') {
      const session = requireBrandRole(req, res, 2, competitorMatch[1]); if (!session) return;
      const brand = findOrFail(db.brands, competitorMatch[1], '品牌');
      const before = clone(brand.competitors);
      brand.competitors = [...new Set((body.competitors || []).map((item) => text(item)).filter(Boolean))].slice(0, 5);
      const audit = stageAudit(req, session, 'competitor.replace', 'brand', brand.id, before, brand.competitors);
      await persistIncremental(async ({ repositories, workspaceId }) => {
        await repositories.brands.replaceCompetitors(workspaceId, brand.id, brand.competitors);
        await repositories.auditLogs.append(workspaceId, audit);
      });
      return send(res, 200, { data: clone(brand.competitors) });
    }
    const promptGroupMatch = pathname.match(/^\/api\/prompt-groups(?:\/([^/]+))?$/);
    if (promptGroupMatch) {
      const groupId = promptGroupMatch[1];
      if (req.method === 'GET') {
        const session = requireRole(req, res, 1); if (!session) return;
        const requestedBrandId = text(url.searchParams.get('brandId'));
        const relational = relationalContext();
        if (relational) {
          const groups = await relational.repositories.promptGroups.list(relational.workspaceId, groupId || '', requestedBrandId);
          const visible = groups.filter((group) => canAccessBrand(session, group.brandId));
          if (groupId && !visible[0]) return fail(res, 404, '主题分组不存在。');
          return send(res, 200, { data: groupId ? visible[0] : visible });
        }
        const groups = db.promptGroups.filter((group) => visibleTo(session, group) &&
          (!requestedBrandId || requestedBrandId === 'all' || group.brandId === requestedBrandId));
        if (groupId && !groups[0]) return fail(res, 404, '主题分组不存在。');
        return send(res, 200, { data: groupId ? clone(groups[0]) : clone(groups) });
      }
      const session = requireRole(req, res, 2); if (!session) return;
      if (req.method === 'POST') {
        const brandId = selectedBrandId(session, body.brandId);
        if (!brandId) return fail(res, 403, '当前账号没有可编辑的品牌。');
        const name = text(body.name);
        if (!name) return fail(res, 400, '主题分组名称不能为空。');
        if (name.length > 120) return fail(res, 400, '主题分组名称不能超过 120 个字符。');
        if (db.promptGroups.some((group) => group.brandId === brandId && group.name.toLowerCase() === name.toLowerCase())) return fail(res, 409, '该主题分组已存在。');
        const group = { id: clientResourceId(body.id, 'group'), brandId, name, sortOrder: Number(body.sortOrder) || db.promptGroups.length, createdAt: now(), updatedAt: now() };
        db.promptGroups.push(group);
        const audit = stageAudit(req, session, 'prompt_group.create', 'prompt_group', group.id, null, group);
        await persistIncremental(async ({ repositories, workspaceId }) => {
          await repositories.promptGroups.upsert(workspaceId, group);
          await repositories.auditLogs.append(workspaceId, audit);
        });
        return send(res, 201, { data: clone(group) });
      }
      const group = db.promptGroups.find((entry) => entry.id === groupId);
      if (!group) return fail(res, 404, '主题分组不存在。');
      if (!canAccessBrand(session, group.brandId)) return fail(res, 403, '当前账号没有访问该品牌的权限。');
      if (req.method === 'PATCH') {
        const name = text(body.name);
        if (!name) return fail(res, 400, '主题分组名称不能为空。');
        if (name.length > 120) return fail(res, 400, '主题分组名称不能超过 120 个字符。');
        if (db.promptGroups.some((entry) => entry.id !== group.id && entry.brandId === group.brandId && entry.name.toLowerCase() === name.toLowerCase())) return fail(res, 409, '该主题分组已存在。');
        const before = clone(group);
        const oldName = group.name;
        Object.assign(group, { name, sortOrder: Number(body.sortOrder) || group.sortOrder || 0, updatedAt: now() });
        db.prompts.filter((prompt) => prompt.brandId === group.brandId && prompt.group === oldName).forEach((prompt) => { prompt.group = name; updatePromptRecords(prompt); });
        const audit = stageAudit(req, session, 'prompt_group.update', 'prompt_group', group.id, before, group);
        await persistIncremental(async ({ repositories, workspaceId }) => {
          await repositories.promptGroups.upsert(workspaceId, group);
          for (const prompt of db.prompts.filter((item) => item.brandId === group.brandId && item.group === name)) {
            await repositories.prompts.upsert(workspaceId, prompt);
            for (const record of db.records.filter((item) => item.promptId === prompt.id)) await repositories.records.upsert(workspaceId, record);
          }
          await repositories.auditLogs.append(workspaceId, audit);
        });
        return send(res, 200, { data: clone(group) });
      }
      if (req.method === 'DELETE') {
        const promptCount = db.prompts.filter((prompt) => prompt.brandId === group.brandId && prompt.group === group.name).length;
        if (promptCount) return fail(res, 409, '该主题下还有用户提问，请先移动或删除提问。');
        const before = clone(group);
        db.promptGroups = db.promptGroups.filter((entry) => entry.id !== group.id);
        const audit = stageAudit(req, session, 'prompt_group.delete', 'prompt_group', group.id, before, null);
        await persistIncremental(async ({ repositories, workspaceId }) => {
          await repositories.promptGroups.delete(workspaceId, group.id);
          await repositories.auditLogs.append(workspaceId, audit);
        });
        return send(res, 200, { data: { deleted: true } });
      }
    }
    const promptMatch = pathname.match(/^\/api\/prompts(?:\/([^/]+))?$/);
    if (promptMatch) {
      const promptId = promptMatch[1];
      if (req.method === 'GET') {
        const session = requireRole(req, res, 1); if (!session) return;
        const existing = promptId ? db.prompts.find((prompt) => prompt.id === promptId) : null;
        if (existing && !canAccessBrand(session, existing.brandId)) return fail(res, 403, '当前账号没有访问该品牌的权限。');
        const promptFilters = {
          brandId: text(url.searchParams.get('brandId')),
          group: text(url.searchParams.get('group')),
          status: text(url.searchParams.get('status')),
          search: text(url.searchParams.get('search') || url.searchParams.get('q'))
        };
        const relational = relationalContext();
        if (relational) {
          const prompts = (await relational.repositories.prompts.list(relational.workspaceId, promptId || '', promptFilters)).filter((prompt) => visibleTo(session, prompt));
          if (promptId && !prompts[0]) return fail(res, 404, '提问不存在。');
          return send(res, 200, { data: promptId ? prompts[0] : prompts, filters: promptFilters });
        }
        const prompts = db.prompts.filter((prompt) => visibleTo(session, prompt) &&
          (!promptFilters.brandId || promptFilters.brandId === 'all' || prompt.brandId === promptFilters.brandId) &&
          (!promptFilters.group || promptFilters.group === 'all' || promptFilters.group === '全部分组' || prompt.group === promptFilters.group) &&
          (!promptFilters.status || promptFilters.status === 'all' || promptFilters.status === '全部状态' || prompt.status === promptFilters.status) &&
          (!promptFilters.search || `${prompt.text} ${prompt.group}`.toLowerCase().includes(promptFilters.search.toLowerCase())));
        if (promptId && !prompts[0]) return fail(res, 404, '提问不存在。');
        return send(res, 200, { data: promptId ? clone(prompts[0]) : clone(prompts), filters: promptFilters });
      }
      const session = requireRole(req, res, 2); if (!session) return;
      if (req.method === 'POST') {
        const brandId = selectedBrandId(session, body.brandId);
        if (!brandId) return fail(res, 403, '当前账号没有可编辑的品牌。');
        const result = createPrompt(body, brandId);
        const records = result.records;
        const audit = stageAudit(req, session, 'prompt.create', 'prompt', result.prompt.id, null, result.prompt);
        await persistIncremental(async ({ repositories, workspaceId }) => {
          await repositories.prompts.upsert(workspaceId, result.prompt);
          await repositories.tasks.upsert(workspaceId, result.task);
          for (const record of records) await repositories.records.upsert(workspaceId, record);
          await repositories.workspace.updateSettings(workspaceId, { collectionUsage: db.workspace.collectionUsage });
          await repositories.auditLogs.append(workspaceId, audit);
        });
        return send(res, 201, { data: clone(result) });
      }
      const prompt = findOrFail(db.prompts, promptId, '提问');
      if (!canAccessBrand(session, prompt.brandId)) return fail(res, 403, '当前账号没有访问该品牌的权限。');
      if (req.method === 'PATCH') {
        const before = clone(prompt);
        const previousFrequency = prompt.frequency;
        Object.assign(prompt, pick(body, ['text', 'group', 'platforms', 'status', 'language', 'region', 'frequency']));
        prompt.text = text(prompt.text);
        if (!prompt.text) return fail(res, 400, '提问内容不能为空。');
        prompt.group = text(prompt.group, '默认分组');
        if (!['manual', 'daily', 'weekly'].includes(prompt.frequency)) prompt.frequency = 'daily';
        if (prompt.frequency !== previousFrequency || !prompt.nextCollectionAt) prompt.nextCollectionAt = nextCollectionAt(prompt.frequency);
        updatePromptRecords(prompt);
        const records = db.records.filter((record) => record.promptId === prompt.id);
        const audit = stageAudit(req, session, 'prompt.update', 'prompt', prompt.id, before, prompt);
        await persistIncremental(async ({ repositories, workspaceId }) => {
          await repositories.prompts.upsert(workspaceId, prompt);
          for (const record of records) await repositories.records.upsert(workspaceId, record);
          await repositories.auditLogs.append(workspaceId, audit);
        });
        return send(res, 200, { data: clone(prompt) });
      }
      if (req.method === 'DELETE') {
        const before = clone(prompt);
        db.prompts = db.prompts.filter((entry) => entry.id !== promptId);
        db.records = db.records.filter((entry) => entry.promptId !== promptId);
        db.tasks = db.tasks.filter((entry) => entry.promptId !== promptId);
        const audit = stageAudit(req, session, 'prompt.delete', 'prompt', promptId, before, null);
        await persistIncremental(async ({ repositories, workspaceId }) => {
          await repositories.prompts.delete(workspaceId, promptId);
          await repositories.auditLogs.append(workspaceId, audit);
        });
        return send(res, 200, { data: { deleted: true } });
      }
    }
    if (pathname === '/api/assets' && req.method === 'GET') { const session = requireRole(req, res, 1); if (!session) return; return send(res, 200, { data: clone(db.assets.filter((asset) => visibleTo(session, asset))) }); }
    if (pathname === '/api/assets' && req.method === 'POST') {
      const session = requireRole(req, res, 2); if (!session) return;
      const brandId = selectedBrandId(session, body.brandId);
      if (!brandId) return fail(res, 403, '当前账号没有可编辑的品牌。');
      const asset = Object.assign({ brandId, status: '待审核', citations: 0, updated: '刚刚' }, pick(body, ['title', 'type', 'source', 'sourceUrl', 'content', 'status', 'validFrom', 'validUntil']), { id: clientResourceId(body.id, 'asset') });
      if (!text(asset.title)) return fail(res, 400, '素材名称不能为空。');
      if (db.assets.some((entry) => entry.id === asset.id)) return fail(res, 409, '素材已存在。');
      db.assets.unshift(asset);
      const audit = stageAudit(req, session, 'asset.create', 'asset', asset.id, null, asset);
      await persistIncremental(async ({ repositories, workspaceId }) => {
        await repositories.assets.upsert(workspaceId, asset);
        await repositories.auditLogs.append(workspaceId, audit);
      });
      return send(res, 201, { data: clone(asset) });
    }
    const assetMatch = pathname.match(/^\/api\/assets\/([^/]+)$/);
    if (assetMatch) {
      const asset = findOrFail(db.assets, assetMatch[1], '素材');
      if (req.method === 'PATCH') {
        const session = requireBrandRole(req, res, 2, asset.brandId); if (!session) return;
        const before = clone(asset);
        Object.assign(asset, pick(body, ['title', 'type', 'source', 'sourceUrl', 'content', 'status', 'validFrom', 'validUntil']), { updated: '刚刚' });
        if (!text(asset.title)) return fail(res, 400, '素材名称不能为空。');
        const audit = stageAudit(req, session, 'asset.update', 'asset', asset.id, before, asset);
        await persistIncremental(async ({ repositories, workspaceId }) => {
          await repositories.assets.upsert(workspaceId, asset);
          await repositories.auditLogs.append(workspaceId, audit);
        });
        return send(res, 200, { data: clone(asset) });
      }
      if (req.method === 'DELETE') {
        const session = requireBrandRole(req, res, 2, asset.brandId); if (!session) return;
        const before = clone(asset);
        db.assets = db.assets.filter((entry) => entry.id !== asset.id);
        const audit = stageAudit(req, session, 'asset.delete', 'asset', asset.id, before, null);
        await persistIncremental(async ({ repositories, workspaceId }) => {
          await repositories.assets.delete(workspaceId, asset.id);
          await repositories.auditLogs.append(workspaceId, audit);
        });
        return send(res, 200, { data: { deleted: true } });
      }
    }
    if (pathname === '/api/members' && req.method === 'GET') { const session = requireRole(req, res, 1); if (!session) return; return send(res, 200, { data: db.members.filter((member) => scopesOverlap(session, member)).map(publicMember) }); }
    if (pathname === '/api/members' && req.method === 'POST') {
      const session = requireRole(req, res, 4); if (!session) return;
      const email = normalizeEmail(body.email);
      if (!validEmail(email)) return fail(res, 400, '请输入有效的成员邮箱。');
      if (db.members.some((member) => normalizeEmail(member.email) === email)) return fail(res, 409, '该邮箱已在团队中。');
      const role = text(body.role, '品牌成员（只读）');
      if (!Object.prototype.hasOwnProperty.call(ROLE_LEVEL, role) || role === '无权限') return fail(res, 400, '成员角色无效。');
      const scopeOmitted = body.scope == null || (typeof body.scope === 'string' && text(body.scope) === '');
      const requestedScope = scopeOmitted ? db.workspace.brandId : body.scope;
      const scope = role === '团队管理员' ? '全部品牌' : requestedScope;
      if (role !== '团队管理员' && !scopeEntries(scope).length) return fail(res, 400, '请至少选择一个可访问品牌。');
      const unknownScope = scopeEntries(scope).filter((entry) => entry !== '全部品牌' && entry !== '*' && !db.brands.some((brand) => brand.id === entry || brand.name === entry));
      if (unknownScope.length) return fail(res, 400, '成员的品牌范围包含不存在的品牌。');
      const inviteToken = crypto.randomBytes(18).toString('hex');
      const invitedAt = now();
      const member = Object.assign({ name: email.split('@')[0], email, role, scope, status: '待接受', invitedAt, inviteExpiresAt: new Date(Date.now() + config.invitationTtlMs).toISOString(), acceptedAt: '', inviteTokenHash: tokenHash(inviteToken) }, pick(body, ['name']), { id: clientResourceId(body.id, 'member') });
      member.role = role;
      member.status = '待接受';
      member.invitedAt = invitedAt;
      member.inviteExpiresAt = new Date(Date.now() + config.invitationTtlMs).toISOString();
      member.acceptedAt = '';
      member.inviteTokenHash = tokenHash(inviteToken);
      db.members.push(member);
      const audit = stageAudit(req, session, 'member.invite', 'member', member.id, null, publicMember(member));
      await persistIncremental(async ({ repositories, workspaceId }) => {
        await repositories.identity.upsertInvitation(workspaceId, member);
        await repositories.auditLogs.append(workspaceId, audit);
      });
      return send(res, 201, { data: Object.assign(publicMember(member), { inviteUrl: `/api/v1/invitations/${inviteToken}` }) });
    }
    const resendInvitationMatch = pathname.match(/^\/api\/members\/([^/]+)\/resend-invitation$/);
    if (resendInvitationMatch && req.method === 'POST') {
      const session = requireRole(req, res, 4); if (!session) return;
      const member = findOrFail(db.members, resendInvitationMatch[1], '成员');
      if (member.userId || member.status === '正常') return fail(res, 409, '该成员已经加入团队，无需重新邀请。');
      const before = publicMember(member);
      const inviteToken = crypto.randomBytes(18).toString('hex');
      Object.assign(member, {
        status: '待接受',
        invitedAt: now(),
        inviteExpiresAt: new Date(Date.now() + config.invitationTtlMs).toISOString(),
        inviteTokenHash: tokenHash(inviteToken)
      });
      const audit = stageAudit(req, session, 'member.invite.resend', 'member', member.id, before, publicMember(member));
      await persistIncremental(async ({ repositories, workspaceId }) => {
        await repositories.identity.upsertInvitation(workspaceId, member);
        await repositories.auditLogs.append(workspaceId, audit);
      });
      return send(res, 200, { data: Object.assign(publicMember(member), { inviteUrl: `/api/v1/invitations/${inviteToken}` }) });
    }
    const memberMatch = pathname.match(/^\/api\/members\/([^/]+)$/);
    if (memberMatch) {
      const member = findOrFail(db.members, memberMatch[1], '成员');
      if (req.method === 'PATCH') {
        const session = requireRole(req, res, 4); if (!session) return;
        const before = publicMember(member);
        const patch = pick(body, ['name', 'role', 'scope', 'status']);
        if (patch.role && (!Object.prototype.hasOwnProperty.call(ROLE_LEVEL, patch.role) || patch.role === '无权限')) return fail(res, 400, '成员角色无效。');
        if (patch.status && !['正常', '待接受', '暂停'].includes(patch.status)) return fail(res, 400, '成员状态无效。');
        if (member.userId && patch.status === '待接受') return fail(res, 409, '已注册成员不能改回待接受；如需停止访问，请将状态设为暂停。');
        const removesAdmin = member.role === '团队管理员' && (patch.role && patch.role !== '团队管理员' || patch.status && patch.status !== '正常');
        if (removesAdmin && db.members.filter((entry) => entry.role === '团队管理员' && entry.status === '正常').length <= 1) return fail(res, 409, '工作空间必须至少保留一位正常状态的团队管理员。');
        const nextRole = patch.role || member.role;
        if (nextRole === '团队管理员') patch.scope = '全部品牌';
        const nextScope = patch.scope === undefined ? member.scope : patch.scope;
        if (nextRole !== '团队管理员' && !scopeEntries(nextScope).length) return fail(res, 400, '请至少选择一个可访问品牌。');
        if (patch.scope !== undefined) {
          const unknownScope = scopeEntries(patch.scope).filter((entry) => entry !== '全部品牌' && entry !== '*' && !db.brands.some((brand) => brand.id === entry || brand.name === entry));
          if (unknownScope.length) return fail(res, 400, '成员的品牌范围包含不存在的品牌。');
        }
        Object.assign(member, patch);
        const user = member.userId ? db.users.find((entry) => entry.id === member.userId) : null;
        if (user) { user.name = member.name; user.role = member.role; user.status = member.status === '正常' ? 'active' : 'disabled'; user.updatedAt = now(); }
        const revokedTokens = user && member.status !== '正常' ? revokeUserSessions(user.id) : [];
        const audit = stageAudit(req, session, 'member.permission.update', 'member', member.id, before, publicMember(member));
        await persistIncremental(async ({ repositories, workspaceId }) => {
          await repositories.identity.updateMember(workspaceId, member, user);
          for (const token of revokedTokens) await repositories.identity.revokeRefreshToken(token.tokenHash, token.revokedAt);
          await repositories.auditLogs.append(workspaceId, audit);
        });
        return send(res, 200, { data: publicMember(member) });
      }
      if (req.method === 'DELETE') {
        const session = requireRole(req, res, 4); if (!session) return;
        if (member.role === '团队管理员' && member.status === '正常' && db.members.filter((entry) => entry.role === '团队管理员' && entry.status === '正常').length <= 1) return fail(res, 409, '工作空间必须至少保留一位正常状态的团队管理员。');
        const before = publicMember(member);
        const user = member.userId ? db.users.find((entry) => entry.id === member.userId) : null;
        let revokedTokens = [];
        if (user) { user.status = 'disabled'; user.updatedAt = now(); revokedTokens = revokeUserSessions(user.id); }
        db.members = db.members.filter((entry) => entry.id !== member.id);
        const audit = stageAudit(req, session, 'member.remove', 'member', member.id, before, null);
        await persistIncremental(async ({ repositories, workspaceId }) => {
          await repositories.identity.deleteMember(workspaceId, member);
          for (const token of revokedTokens) await repositories.identity.revokeRefreshToken(token.tokenHash, token.revokedAt);
          await repositories.auditLogs.append(workspaceId, audit);
        });
        return send(res, 200, { data: { deleted: true } });
      }
    }
    const invitationMatch = pathname.match(/^\/api\/invitations\/([^/]+)(?:\/(accept))?$/);
    if (invitationMatch) {
      const token = invitationMatch[1];
      const member = db.members.find((entry) => entry.inviteTokenHash === tokenHash(token));
      if (!member) return fail(res, 404, '邀请不存在或已失效。');
      if (Date.parse(member.inviteExpiresAt || '') <= Date.now()) return fail(res, 410, '邀请已过期，请联系团队管理员重新发送。');
      if (!invitationMatch[2] && req.method === 'GET') {
        return send(res, 200, { data: { id: member.id, name: member.name, email: member.email, role: member.role, scope: member.scope, status: member.status, invitedAt: member.invitedAt, inviteExpiresAt: member.inviteExpiresAt } });
      }
      if (invitationMatch[2] === 'accept' && req.method === 'POST') {
        return fail(res, 400, '请通过邀请注册表单设置密码并加入团队。');
      }
    }
    if (pathname === '/api/articles' && req.method === 'GET') { const session = requireRole(req, res, 1); if (!session) return; return send(res, 200, { data: clone(db.articles.filter((article) => visibleTo(session, article))) }); }
    if (pathname === '/api/articles' && req.method === 'POST') {
      const session = requireRole(req, res, 2); if (!session) return;
      const brandId = selectedBrandId(session, body.brandId);
      if (!brandId) return fail(res, 403, '当前账号没有可编辑的品牌。');
      const article = createArticle(body, brandId);
      const audit = stageAudit(req, session, 'article.create', 'article', article.id, null, article);
      await persistIncremental(async ({ repositories, workspaceId }) => {
        await repositories.articles.upsert(workspaceId, article);
        await repositories.auditLogs.append(workspaceId, audit);
      });
      return send(res, 201, { data: clone(article) });
    }
    const articleMatch = pathname.match(/^\/api\/articles\/([^/]+)(?:\/([^/]+))?$/);
    if (articleMatch) {
      const article = findOrFail(db.articles, articleMatch[1], '文章');
      const action = articleMatch[2];
      if (!action && req.method === 'GET') { if (!requireBrandRole(req, res, 1, article.brandId)) return; return send(res, 200, { data: clone(article) }); }
      if (!action && req.method === 'PATCH') {
        const session = requireBrandRole(req, res, 2, article.brandId); if (!session) return;
        const before = clone(article);
        Object.assign(article, pick(body, ['title', 'topic', 'body', 'channel', 'seoTitle', 'seoDescription', 'seoKeywords', 'slug', 'status', 'analysisSnapshot', 'contentBrief', 'sourceRecordIds']), { time: '刚刚' });
        if (!text(article.title)) return fail(res, 400, '文章标题不能为空。');
        article.seoCheck = seoPassed(article) ? '已通过' : '未检查';
        if (article.status === '待发布' && !factsPassed(article)) article.status = '待审核';
        const audit = stageAudit(req, session, 'article.update', 'article', article.id, before, article);
        await persistIncremental(async ({ repositories, workspaceId }) => {
          await repositories.articles.upsert(workspaceId, article);
          await repositories.auditLogs.append(workspaceId, audit);
        });
        return send(res, 200, { data: clone(article) });
      }
      if (!action && req.method === 'DELETE') {
        const session = requireBrandRole(req, res, 2, article.brandId); if (!session) return;
        const before = clone(article);
        db.articles = db.articles.filter((entry) => entry.id !== article.id);
        db.tasks = db.tasks.filter((entry) => entry.articleId !== article.id);
        const audit = stageAudit(req, session, 'article.delete', 'article', article.id, before, null);
        await persistIncremental(async ({ repositories, workspaceId }) => {
          await repositories.articles.delete(workspaceId, article.id);
          await repositories.auditLogs.append(workspaceId, audit);
        });
        return send(res, 200, { data: { deleted: true } });
      }
      if (action === 'duplicate' && req.method === 'POST') {
        const session = requireBrandRole(req, res, 2, article.brandId); if (!session) return;
        const copy = clone(article);
        copy.id = id('article'); copy.title = `${copy.title}（副本）`; copy.status = '草稿'; copy.check = '需补资料';
        copy.factSources = copy.factUpdated = copy.factAuthor = copy.factContact = copy.factPricing = false;
        copy.channel = '未发布'; copy.indexStatus = '未提交'; copy.indexDueAt = ''; copy.publishedAt = '';
        copy.publishedUrl = ''; copy.publishError = ''; copy.reviewer = ''; copy.reviewedAt = ''; copy.time = '刚刚';
        db.articles.unshift(copy);
        const audit = stageAudit(req, session, 'article.duplicate', 'article', copy.id, article, copy);
        await persistIncremental(async ({ repositories, workspaceId }) => {
          await repositories.articles.upsert(workspaceId, copy);
          await repositories.auditLogs.append(workspaceId, audit);
        });
        return send(res, 201, { data: clone(copy) });
      }
      if (action === 'review' && req.method === 'POST') {
        const session = requireBrandRole(req, res, 2, article.brandId); if (!session) return;
        const before = clone(article);
        Object.assign(article, pick(body, ['factSources', 'factUpdated', 'factAuthor', 'factContact', 'factPricing']));
        article.check = factsPassed(article) ? '已通过' : '需补资料';
        article.status = factsPassed(article) ? '待发布' : '待审核';
        article.seoCheck = seoPassed(article) ? '已通过' : '未检查';
        article.reviewer = session.user; article.reviewedAt = now(); article.time = '刚刚';
        const audit = stageAudit(req, session, 'article.review', 'article', article.id, before, article);
        await persistIncremental(async ({ repositories, workspaceId }) => {
          await repositories.articles.upsert(workspaceId, article);
          await repositories.articles.addReview(workspaceId, article, session.userId);
          await repositories.auditLogs.append(workspaceId, audit);
        });
        return send(res, 200, { data: clone(article) });
      }
      if (action === 'publish' && req.method === 'POST') {
        const session = requireBrandRole(req, res, 2, article.brandId); if (!session) return;
        if (article.status === '发布中') {
          const activeTask = db.tasks.find((task) => task.type === '文章发布' && task.articleId === article.id && ['queued', 'running'].includes(task.status));
          if (!activeTask) return fail(res, 409, '文章发布状态异常，请刷新后重试。');
          return send(res, 202, { data: { article: clone(article), task: clone(activeTask), reused: true } });
        }
        if (article.status === '已发布' || article.status === '已收录') return fail(res, 409, '文章已经发布，不能重复创建发布任务。');
        const before = clone(article);
        const result = publishArticle(article, body.channel);
        const audit = stageAudit(req, session, 'article.publish', 'article', article.id, before, article);
        await persistIncremental(async ({ repositories, workspaceId }) => {
          await repositories.articles.upsert(workspaceId, article);
          await repositories.tasks.upsert(workspaceId, result.task);
          await repositories.auditLogs.append(workspaceId, audit);
        });
        return send(res, 202, { data: Object.assign(clone(result), { reused: false }) });
      }
      if (action === 'index' && req.method === 'POST') {
        const session = requireBrandRole(req, res, 2, article.brandId); if (!session) return;
        if (!['已发布', '已收录'].includes(article.status)) return fail(res, 409, '文章尚未发布。');
        const before = clone(article);
        article.indexStatus = '已收录'; article.indexCheckedAt = now(); article.time = '刚刚';
        const audit = stageAudit(req, session, 'article.index.confirm', 'article', article.id, before, article);
        await persistIncremental(async ({ repositories, workspaceId }) => {
          await repositories.articles.upsert(workspaceId, article);
          await repositories.auditLogs.append(workspaceId, audit);
        });
        return send(res, 200, { data: clone(article) });
      }
    }
    if (pathname === '/api/records' && req.method === 'GET') {
      const session = requireRole(req, res, 1); if (!session) return;
      const platform = text(url.searchParams.get('platform'));
      const brandId = text(url.searchParams.get('brandId'));
      const group = text(url.searchParams.get('group'));
      const status = text(url.searchParams.get('status'));
      const mentioned = url.searchParams.get('mentioned');
      const search = text(url.searchParams.get('search') || url.searchParams.get('q')).toLowerCase();
      const sourceType = text(url.searchParams.get('sourceType'));
      const verificationStatus = text(url.searchParams.get('verificationStatus'));
      const from = Date.parse(text(url.searchParams.get('from')));
      const to = Date.parse(text(url.searchParams.get('to')));
      const relational = relationalContext();
      if (relational) {
        const filters = {
          brandId: text(url.searchParams.get('brandId')),
          platform,
          group,
          status,
          mentioned,
          sourceType,
          verificationStatus,
          search,
          from: text(url.searchParams.get('from')),
          to: text(url.searchParams.get('to'))
        };
        const records = (await relational.repositories.records.list(relational.workspaceId, filters)).filter((record) => visibleTo(session, record));
        return send(res, 200, { data: records, filters });
      }
      const records = db.records.filter((record) => {
        const recordDate = Date.parse(record.date || record.createdAt || '');
        const haystack = `${record.question || ''} ${record.group || ''} ${record.platform || ''} ${record.answer || ''}`.toLowerCase();
        const recordSources = Array.isArray(record.sources) ? record.sources : [];
        const hasSourceType = !sourceType || sourceType === 'all' || recordSources.some((source) => (Array.isArray(source) ? 'model_citation' : source?.sourceType) === sourceType);
        const hasVerificationStatus = !verificationStatus || verificationStatus === 'all' || recordSources.some((source) => (Array.isArray(source) ? 'unverified' : source?.verificationStatus) === verificationStatus);
        return visibleTo(session, record) &&
          (!brandId || brandId === 'all' || record.brandId === brandId) &&
          (!platform || platform === '全部' || record.platform === platform) &&
          (!group || group === 'all' || record.group === group) &&
          (!status || status === 'all' || record.status === status) &&
          (mentioned === null || mentioned === 'all' || Boolean(record.mentioned) === (mentioned === 'true')) &&
          hasSourceType && hasVerificationStatus &&
          (!search || haystack.includes(search)) &&
          (!Number.isFinite(from) || (Number.isFinite(recordDate) && recordDate >= from)) &&
          (!Number.isFinite(to) || (Number.isFinite(recordDate) && recordDate <= to + 86400000 - 1));
      });
      return send(res, 200, { data: clone(records), filters: { platform, group, status, mentioned, search, from: Number.isFinite(from) ? new Date(from).toISOString().slice(0, 10) : '', to: Number.isFinite(to) ? new Date(to).toISOString().slice(0, 10) : '' } });
    }
    if (pathname === '/api/sources/refresh' && req.method === 'POST') {
      const record = findOrFail(db.records, text(body.recordId), '回答记录');
      const brandId = resourceBrandId(record);
      const session = requireBrandRole(req, res, 2, brandId); if (!session) return;
      if (!sourceEvidenceService) return fail(res, 503, '信源服务尚未就绪。');
      const prompt = findOrFail(db.prompts, record.promptId, '提问');
      const brand = findOrFail(db.brands, brandId, '品牌');
      const before = clone(record);
      const result = await sourceEvidenceService.enrichRecord(record, brand, prompt, {
        discover: body.discover !== false,
        fetchLimit: Math.min(12, Math.max(1, Number(body.fetchLimit) || config.sourceSearchMaxResults))
      });
      const audit = stageAudit(req, session, 'source.refresh', 'record', record.id, before, record);
      await persistIncremental(async ({ repositories, workspaceId }) => {
        await repositories.records.upsert(workspaceId, record);
        await repositories.auditLogs.append(workspaceId, audit);
      });
      return send(res, 200, { data: { record: clone(record), summary: clone(result.summary), provider: sourceEvidenceService.status() } });
    }
    if (pathname === '/api/sources' && req.method === 'GET') {
      const session = requireRole(req, res, 1); if (!session) return;
      const filters = {
        brandId: text(url.searchParams.get('brandId')),
        sourceType: text(url.searchParams.get('sourceType')),
        verificationStatus: text(url.searchParams.get('verificationStatus')),
        domain: text(url.searchParams.get('domain')),
        limit: Number(url.searchParams.get('limit')) || 100
      };
      const relational = relationalContext();
      if (relational) {
        const sources = (await relational.repositories.records.listSources(relational.workspaceId, filters)).filter((source) => visibleTo(session, source));
        return send(res, 200, { data: sources, filters });
      }
      const sources = db.records.flatMap((record) => (Array.isArray(record.sources) ? record.sources : []).map((raw, index) => {
        const source = Array.isArray(raw) ? { title: raw[0], url: raw[1], sourceType: 'model_citation', verificationStatus: 'unverified' } : raw || {};
        return Object.assign({}, source, { id: `${record.id}:${index + 1}`, recordId: record.id, promptId: record.promptId, brandId: record.brandId, question: record.question || '', platform: record.platform || '', position: source.position || index + 1 });
      })).filter((source) => visibleTo(session, source) && (!filters.brandId || filters.brandId === 'all' || source.brandId === filters.brandId) && (!filters.sourceType || filters.sourceType === 'all' || source.sourceType === filters.sourceType) && (!filters.verificationStatus || filters.verificationStatus === 'all' || source.verificationStatus === filters.verificationStatus)).slice(0, Math.min(500, Math.max(1, filters.limit)));
      return send(res, 200, { data: clone(sources), filters });
    }
    if (pathname === '/api/tasks' && req.method === 'GET') { const session = requireRole(req, res, 1); if (!session) return; return send(res, 200, { data: clone(db.tasks.filter((task) => visibleTo(session, task))) }); }
    const taskDetailMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
    if (taskDetailMatch && req.method === 'GET') { const task = findOrFail(db.tasks, taskDetailMatch[1], '任务'); if (!requireBrandRole(req, res, 1, resourceBrandId(task))) return; return send(res, 200, { data: clone(task) }); }
    const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/(retry|cancel)$/);
    if (taskMatch && req.method === 'POST') {
      const task = findOrFail(db.tasks, taskMatch[1], '任务');
      const session = requireBrandRole(req, res, 2, resourceBrandId(task)); if (!session) return;
      const before = clone(task);
      const article = task.articleId ? db.articles.find((entry) => entry.id === task.articleId) : null;
      if (taskMatch[2] === 'cancel') {
        if (!['running', 'queued'].includes(task.status)) return fail(res, 409, '当前任务不能取消。');
        task.status = 'cancelled'; task.error = '已由当前账号取消'; task.nextAttemptAt = '';
        if (article && article.status === '发布中') article.status = factsPassed(article) ? '待发布' : '待审核';
      } else {
        if (!['error', 'cancelled'].includes(task.status)) return fail(res, 409, '当前任务不需要重试。');
        task.status = 'queued'; task.progress = 0; task.error = ''; task.createdAt = now(); task.startedAt = ''; task.nextAttemptAt = ''; task.attempt = 0;
      }
      const taskRecords = task.type === '回答采集' ? collectionTaskRecords(task) : [];
      if (taskMatch[2] === 'retry') {
        taskRecords.forEach((record) => Object.assign(record, {
          status: 'queued', mentioned: false, score: 0, answer: '任务已重新排队，等待大模型返回原始回答。',
          sources: [], error: '', collectionMode: '', modelVersion: '', latencyMs: null,
          rawPayload: null, usage: null, time: '待评估'
        }));
      } else {
        taskRecords.filter((record) => ['queued', 'running'].includes(record.status)).forEach((record) => {
          record.status = 'cancelled'; record.error = task.error; record.time = now();
        });
      }
      const audit = stageAudit(req, session, `task.${taskMatch[2]}`, 'task', task.id, before, task);
      await persistIncremental(async ({ repositories, workspaceId }) => {
        await repositories.tasks.upsert(workspaceId, task);
        for (const record of taskRecords) await repositories.records.upsert(workspaceId, record);
        if (article) await repositories.articles.upsert(workspaceId, article);
        await repositories.auditLogs.append(workspaceId, audit);
      });
      return send(res, 200, { data: clone(task) });
    }
    const recordRetryMatch = pathname.match(/^\/api\/records\/([^/]+)\/rerun$/);
    if (recordRetryMatch && req.method === 'POST') {
      const record = findOrFail(db.records, recordRetryMatch[1], '回答记录');
      const brandId = resourceBrandId(record);
      const session = requireBrandRole(req, res, 2, brandId); if (!session) return;
      const prompt = findOrFail(db.prompts, record.promptId, '提问');
      const result = createCollectionTask(prompt, { platform: record.platform, reason: 'record_rerun', requestedBy: session.userId });
      const audit = stageAudit(req, session, 'record.rerun', 'task', result.task.id, null, result.task);
      await persistIncremental(async ({ repositories, workspaceId }) => {
        await repositories.tasks.upsert(workspaceId, result.task);
        for (const createdRecord of result.records) await repositories.records.upsert(workspaceId, createdRecord);
        if (!result.reused) await repositories.workspace.updateSettings(workspaceId, { collectionUsage: db.workspace.collectionUsage });
        await repositories.auditLogs.append(workspaceId, audit);
      });
      return send(res, result.reused ? 200 : 202, { data: clone(result) });
    }
    return fail(res, 404, '接口不存在。');
  } catch (error) {
    return routeError(res, error);
  }
}

async function start() {
  if (config.production) {
    const blockers = productionBlockers();
    if (blockers.length) {
      console.error(`[answertravel-api] production readiness failed: ${blockers.join('; ')}`);
      process.exitCode = 78;
      return;
    }
  }
  store = createStore();
  await load();
  sourceEvidenceService = createSourceEvidenceService(config);
  collectionRunner = createCollectionRunner({ config, getDb: () => db, persist: persistRuntimeState, sourceEvidenceService });
  collectionRunner.start();
  collectionScheduler = createCollectionScheduler({ config, getDb: () => db, createTask: createCollectionTask, persist: persistRuntimeState, intervalMs: config.collectionSchedulerIntervalMs });
  collectionScheduler.start();
  const server = http.createServer((req, res) => {
    req.answerTravelCors = applySecurityHeaders(req, res, config);
    if (!req.answerTravelCors.originAllowed) return fail(res, 403, '该来源不在 CORS 白名单中。');
    route(req, res).catch((error) => routeError(res, error));
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  const shutdown = (signal) => {
    console.log(`[answertravel-api] ${signal} received, flushing data before shutdown`);
    collectionRunner?.stop();
    collectionScheduler?.stop();
    server.close(async () => {
      try {
        if (typeof store.mutate !== 'function') await persist();
        await store.close();
        process.exit(0);
      } catch { process.exit(1); }
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  server.on('error', (error) => {
    console.error(`[answertravel-api] server error: ${error.code || error.message}`);
    process.exitCode = error.code === 'EADDRINUSE' ? 98 : 1;
  });
  server.listen(PORT, HOST, () => console.log(`AnswerTravel API listening on http://${HOST}:${PORT} (${store.driver})`));
}

start().catch((error) => { console.error(error); process.exitCode = 1; });
