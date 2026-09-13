const crypto = require('crypto');
const { Pool } = require('pg');
const { createRepositories } = require('./repositories');

const PLATFORMS = ['DeepSeek', '豆包', 'Kimi', '元宝'];
const roleToDb = { '团队管理员': 'team_admin', '品牌管理员': 'brand_admin', '品牌编辑者': 'brand_editor', '品牌成员（只读）': 'brand_member' };
const dbToRole = Object.fromEntries(Object.entries(roleToDb).map(([key, value]) => [value, key]));
const articleStatusToDb = { '草稿': 'draft', '待审核': 'pending_review', '待发布': 'pending_publish', '发布中': 'publishing', '已发布': 'published', '已收录': 'indexed', '发布失败': 'publish_error' };
const articleStatusFromDb = Object.fromEntries(Object.entries(articleStatusToDb).map(([key, value]) => [value, key]));

function stableUuid(kind, externalId) {
  const bytes = crypto.createHash('sha256').update(`answertravel:${kind}:${externalId}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function json(value, fallback = {}) {
  return value && typeof value === 'object' ? value : fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value, fallback = '') {
  return String(value == null ? fallback : value).trim();
}

// The prototype stores some display-only values such as "昨天 14:12".
// PostgreSQL parameters must receive either a valid Date or null, so only
// accept unambiguous ISO/date values during the snapshot transition.
function parseDateOrNull(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    const numericDate = new Date(value);
    return Number.isNaN(numericDate.getTime()) ? null : numericDate;
  }
  const raw = text(value);
  if (!raw || !/^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[T\s]\d{1,2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:\s?(?:Z|[+-]\d{2}:?\d{2}))?)?$/.test(raw)) return null;
  const parsed = new Date(raw.replace(/\//g, '-').replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function numberOrNull(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function uniqueExternalId(value, fallback, used) {
  const base = text(value, fallback);
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) candidate = `${base}-${suffix++}`;
  used.add(candidate);
  return candidate;
}

function articleDbStatus(value) {
  return articleStatusToDb[value] || 'draft';
}

function articleStatus(value) {
  return articleStatusFromDb[value] || value || '草稿';
}

function memberDbStatus(value) {
  return value === '待接受' ? 'invited' : value === '暂停' ? 'suspended' : 'active';
}

function memberStatus(value) {
  return value === 'invited' ? '待接受' : value === 'suspended' ? '暂停' : '正常';
}

class RelationalStore {
  constructor(connectionString) {
    if (!connectionString) throw new Error('PostgreSQL 存储需要 DATABASE_URL。');
    this.driver = 'postgres-relational';
    this.pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000, application_name: 'answertravel-api' });
    this.repositories = createRepositories(this.pool);
    this.workspaceId = null;
    this.ready = false;
    this.writeChain = Promise.resolve();
  }

  async load() {
    const client = await this.pool.connect();
    try {
      const workspaceResult = await client.query('select * from workspaces order by created_at asc limit 1');
      const workspaceRow = workspaceResult.rows[0];
      if (!workspaceRow) return null;
      const workspaceId = workspaceRow.id;
      this.workspaceId = workspaceId;
      const [brandResult, competitorResult, promptGroupResult, promptResult, taskResult, recordResult, assetResult, articleResult, channelResult, memberResult, invitationResult, userResult, refreshResult, auditResult] = await Promise.all([
        this.pool.query('select * from brands where workspace_id = $1 and deleted_at is null order by created_at asc', [workspaceId]),
        this.pool.query('select bc.* from brand_competitors bc join brands b on b.id = bc.brand_id where b.workspace_id = $1 order by bc.id', [workspaceId]),
        this.pool.query('select * from prompt_groups where workspace_id = $1 order by sort_order asc, created_at asc', [workspaceId]),
        this.pool.query('select * from prompts where workspace_id = $1 and deleted_at is null order by created_at asc', [workspaceId]),
        this.pool.query('select * from runtime_tasks where workspace_id = $1 order by created_at asc', [workspaceId]),
        this.pool.query(`select ar.*, p.workspace_id, mp.name as platform_name,
          coalesce(src.sources, '[]'::json) as sources
          from answer_records ar join prompts p on p.id = ar.prompt_id
          left join model_platforms mp on mp.id = ar.platform_id
          left join lateral (
            select json_agg(json_build_object(
              'url', s.url, 'title', s.title, 'position', s.position, 'domain', sd.domain,
              'sourceType', s.source_type, 'verificationStatus', s.verification_status,
              'content', s.content, 'author', s.author, 'publishedAt', s.published_at,
              'modality', s.modality, 'brandMatch', s.brand_match,
              'competitorMatches', s.competitor_matches
            ) order by s.position nulls last, s.created_at) as sources
            from answer_sources s left join source_domains sd on sd.id = s.domain_id
            where s.answer_record_id = ar.id
          ) src on true
          where p.workspace_id = $1 order by ar.created_at asc`, [workspaceId]),
        this.pool.query('select * from assets where workspace_id = $1 and deleted_at is null order by created_at asc', [workspaceId]),
        this.pool.query('select * from articles where workspace_id = $1 and deleted_at is null order by created_at asc', [workspaceId]),
        this.pool.query('select * from publish_channels where workspace_id = $1 order by created_at asc', [workspaceId]),
        this.pool.query('select wm.*, u.external_id as user_external_id, u.email, u.name as user_name, u.status as user_status from workspace_members wm join users u on u.id = wm.user_id where wm.workspace_id = $1 order by wm.created_at asc', [workspaceId]),
        this.pool.query('select * from workspace_invitations where workspace_id = $1 and accepted_at is null and expires_at > now() order by created_at asc', [workspaceId]),
        this.pool.query('select distinct u.* from users u join workspace_members wm on wm.user_id = u.id where wm.workspace_id = $1 order by u.created_at asc', [workspaceId]),
        this.pool.query('select distinct rt.*, u.external_id as user_external_id from refresh_tokens rt join users u on u.id = rt.user_id join workspace_members wm on wm.user_id = u.id where wm.workspace_id = $1 and rt.revoked_at is null and rt.expires_at > now() order by rt.created_at asc', [workspaceId]),
        this.pool.query('select al.*, u.external_id as actor_external_id, u.name as actor_name from audit_logs al left join users u on u.id = al.actor_id where al.workspace_id = $1 order by al.created_at desc limit 1000', [workspaceId])
      ]);

      const brands = brandResult.rows.map((row) => Object.assign({}, json(row.state), {
        id: row.external_id || row.id,
        name: row.name,
        aliases: asArray(row.aliases),
        website: row.website_url || '',
        language: row.language || 'zh-CN',
        description: row.description || '',
        note: row.note || '',
        tracking: row.tracking_enabled !== false,
        competitors: []
      }));
      const brandById = new Map(brands.map((brand, index) => [brandResult.rows[index].id, brand]));
      const brandExternalById = new Map(brands.map((brand, index) => [brandResult.rows[index].id, brand.id]));
      competitorResult.rows.forEach((row) => { const brand = brandById.get(row.brand_id); if (brand) brand.competitors.push(row.name); });

      const groupsById = new Map(promptGroupResult.rows.map((row) => [row.id, row.name]));
      const promptGroups = promptGroupResult.rows.map((row) => ({
        id: row.external_id || row.id,
        brandId: brandExternalById.get(row.brand_id) || row.brand_id,
        name: row.name,
        sortOrder: Number(row.sort_order || 0),
        promptCount: 0,
        createdAt: row.created_at?.toISOString?.().slice(0, 10) || row.created_at,
        updatedAt: row.updated_at?.toISOString?.() || row.updated_at
      }));
      const prompts = promptResult.rows.map((row) => Object.assign({}, json(row.state), {
        id: row.external_id || row.id,
        brandId: brandExternalById.get(row.brand_id) || row.brand_id,
        group: groupsById.get(row.group_id) || '默认分组',
        text: row.text,
        platforms: asArray(row.platforms).length ? row.platforms : PLATFORMS,
        status: row.status,
        createdAt: row.created_at?.toISOString?.().slice(0, 10) || row.created_at
      }));
      const promptCountByGroup = new Map();
      promptResult.rows.forEach((row) => promptCountByGroup.set(row.group_id, (promptCountByGroup.get(row.group_id) || 0) + 1));
      promptGroups.forEach((group, index) => { group.promptCount = promptCountByGroup.get(promptGroupResult.rows[index].id) || 0; });
      const promptById = new Map(promptResult.rows.map((row, index) => [row.id, prompts[index]]));
      const tasks = taskResult.rows.map((row) => Object.assign({}, json(row.state), {
        id: row.external_id || row.id,
        type: row.task_type,
        status: row.status,
        createdAt: row.created_at?.toISOString?.() || row.created_at
      }));
      const taskById = new Map(taskResult.rows.map((row, index) => [row.id, tasks[index]]));
      const records = recordResult.rows.map((row) => Object.assign({}, json(row.state), {
        id: row.external_id || row.id,
        brandId: promptById.get(row.prompt_id)?.brandId || json(row.state).brandId || '',
        promptId: promptById.get(row.prompt_id)?.id || row.prompt_id,
        platform: row.platform_name || json(row.state).platform || PLATFORMS[0],
        status: row.status,
        mentioned: row.mentioned,
        score: row.exposure_score,
        answer: row.raw_answer,
        sources: asArray(row.sources),
        date: row.evaluated_at?.toISOString?.().slice(0, 10) || row.created_at?.toISOString?.().slice(0, 10),
        time: row.evaluated_at?.toISOString?.() || '待评估',
        taskId: row.task_id ? taskById.get(row.task_id)?.id || row.task_id : ''
      }));
      const assets = assetResult.rows.map((row) => Object.assign({}, json(row.state), { id: row.external_id || row.id, brandId: brandExternalById.get(row.brand_id) || row.brand_id, title: row.title, type: row.asset_type, source: row.source_url || '', content: row.content_text || '', status: json(row.state).status || row.status, updated: row.updated_at?.toISOString?.() || row.updated_at }));
      const articles = articleResult.rows.map((row) => Object.assign({}, json(row.state), { id: row.external_id || row.id, brandId: brandExternalById.get(row.brand_id) || row.brand_id, title: row.title, topic: row.topic || '', body: row.body || '', status: articleStatus(row.status), seoTitle: row.seo_title || '', seoDescription: row.seo_description || '', seoKeywords: asArray(row.seo_keywords).join(','), slug: row.slug || '', publishedAt: row.published_at?.toISOString?.() || '', time: row.updated_at?.toISOString?.() || '刚刚' }));
      const channels = channelResult.rows.map((row) => Object.assign({}, json(row.state), { id: row.external_id || row.id, name: row.name, status: row.status, endpoint: row.endpoint || '', enabled: row.status !== '未连接' }));
      const users = userResult.rows.map((row) => Object.assign({}, json(row.profile), { id: row.external_id || row.id, email: row.email, name: row.name, status: row.status, passwordHash: row.password_hash }));
      const members = memberResult.rows.map((row) => ({ id: row.external_id || row.id, userId: row.user_external_id || '', name: row.user_name || row.email, email: row.email, role: dbToRole[row.role] || row.role, scope: row.scope == null ? '' : row.scope, status: memberStatus(row.status) }));
      invitationResult.rows.forEach((row) => members.push(Object.assign({}, json(row.state), { id: row.external_id || row.id, email: row.email, role: dbToRole[row.role] || row.role, status: text(json(row.state).status, '待接受'), scope: row.brand_scope == null ? [] : row.brand_scope, invitedAt: row.created_at?.toISOString?.(), inviteExpiresAt: row.expires_at?.toISOString?.(), inviteTokenHash: row.token_hash })));
      const refreshTokens = refreshResult.rows.map((row) => ({ id: row.id, userId: row.user_external_id || row.user_id, tokenHash: row.token_hash, expiresAt: row.expires_at?.toISOString?.(), createdAt: row.created_at?.toISOString?.(), revokedAt: '' }));
      const auditLogs = auditResult.rows.map((row) => ({ id: row.id, actorId: row.actor_external_id || '', actor: row.actor_name || '系统', action: row.action, resourceType: row.resource_type, resourceId: row.external_resource_id || '', before: row.before_data, after: row.after_data, ip: row.ip || '', createdAt: row.created_at?.toISOString?.() || row.created_at }));
      const settings = json(workspaceRow.settings);
      this.ready = true;
      return {
        version: 1,
        workspace: Object.assign({}, json(workspaceRow.settings?.workspace), { id: workspaceRow.external_id || workspaceRow.id, team: { name: workspaceRow.name, description: workspaceRow.description || '' }, brandId: settings.brandId || brands[0]?.id || '', channels, collectionUsage: json(settings.collectionUsage) }),
        brands, promptGroups, prompts, records, assets, articles, tasks, members, users, refreshTokens, auditLogs,
        setupCompleted: Boolean(settings.setupCompleted), wizardDraft: json(settings.wizardDraft), meta: Object.assign({}, json(settings.meta), { revision: Number(workspaceRow.revision || 0) })
      };
    } finally {
      client.release();
    }
  }

  async save(snapshot) {
    this.writeChain = this.writeChain.catch(() => {}).then(() => this.saveSnapshot(snapshot));
    return this.writeChain;
  }

  async mutate(mutator) {
    this.writeChain = this.writeChain.catch(() => {}).then(() => this.runMutation(mutator));
    return this.writeChain;
  }

  async runMutation(mutator) {
    if (!this.workspaceId) throw new Error('工作空间尚未加载，不能执行增量写入。');
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query("select pg_advisory_xact_lock(hashtext('answertravel_relational_store'))");
      const current = await client.query('select revision from workspaces where id = $1 for update', [this.workspaceId]);
      if (!current.rows[0]) throw Object.assign(new Error('工作空间不存在。'), { statusCode: 404 });
      const result = await mutator({
        repositories: createRepositories(client),
        workspaceId: this.workspaceId,
        client
      });
      const revision = Number(current.rows[0].revision || 0) + 1;
      await client.query('update workspaces set revision = $1, updated_at = now() where id = $2', [revision, this.workspaceId]);
      await client.query('commit');
      this.ready = true;
      return { result, revision };
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async saveSnapshot(snapshot) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query("select pg_advisory_xact_lock(hashtext('answertravel_relational_store'))");
      const workspaceExternalId = text(snapshot.workspace?.id, 'workspace-default');
      const workspaceId = stableUuid('workspace', workspaceExternalId);
      this.workspaceId = workspaceId;
      const currentWorkspace = await client.query('select revision from workspaces where id = $1 for update', [workspaceId]);
      const databaseRevision = currentWorkspace.rows[0] ? Number(currentWorkspace.rows[0].revision || 0) : 0;
      const expectedRevision = Number(snapshot.meta?.revision || 0);
      if (currentWorkspace.rows[0] && databaseRevision !== expectedRevision) {
        const conflict = new Error('数据库状态已被另一个服务实例更新，请重新载入后再提交。');
        conflict.code = 'ANSWERTRAVEL_WRITE_CONFLICT';
        throw conflict;
      }
      const nextRevision = databaseRevision + 1;
      await client.query(
        `insert into workspaces (id, external_id, name, description, settings, revision, updated_at)
         values ($1, $2, $3, $4, $5::jsonb, $6, now())
         on conflict (id) do update set external_id = excluded.external_id, name = excluded.name, description = excluded.description, settings = excluded.settings, revision = excluded.revision, updated_at = now()`,
        [workspaceId, workspaceExternalId, text(snapshot.workspace?.team?.name, 'AnswerTravel 工作空间'), text(snapshot.workspace?.team?.description), JSON.stringify({ brandId: snapshot.workspace?.brandId || '', setupCompleted: Boolean(snapshot.setupCompleted), wizardDraft: snapshot.wizardDraft || {}, collectionUsage: snapshot.workspace?.collectionUsage || {}, meta: Object.assign({}, snapshot.meta || {}, { revision: nextRevision }), workspace: { team: snapshot.workspace?.team || {} } }), nextRevision]
      );
      const oldWorkspace = workspaceId;
      await client.query('delete from audit_logs where workspace_id = $1', [oldWorkspace]);
      await client.query('delete from answer_sources where answer_record_id in (select id from answer_records where prompt_id in (select id from prompts where workspace_id = $1))', [oldWorkspace]);
      await client.query('delete from answer_records where prompt_id in (select id from prompts where workspace_id = $1)', [oldWorkspace]);
      await client.query('delete from runtime_tasks where workspace_id = $1', [oldWorkspace]);
      await client.query('delete from publish_jobs where article_id in (select id from articles where workspace_id = $1)', [oldWorkspace]);
      await client.query('delete from article_reviews where article_id in (select id from articles where workspace_id = $1)', [oldWorkspace]);
      await client.query('delete from prompts where workspace_id = $1', [oldWorkspace]);
      await client.query('delete from prompt_groups where workspace_id = $1', [oldWorkspace]);
      await client.query('delete from assets where workspace_id = $1', [oldWorkspace]);
      await client.query('delete from articles where workspace_id = $1', [oldWorkspace]);
      await client.query('delete from brand_competitors where brand_id in (select id from brands where workspace_id = $1)', [oldWorkspace]);
      await client.query('delete from brands where workspace_id = $1', [oldWorkspace]);
      await client.query('delete from publish_channels where workspace_id = $1', [oldWorkspace]);
      await client.query('delete from workspace_invitations where workspace_id = $1', [oldWorkspace]);
      await client.query('delete from workspace_members where workspace_id = $1', [oldWorkspace]);

      const brandSource = asArray(snapshot.brands);
      const brands = brandSource.length ? brandSource : [{
        id: 'brand-default', name: '未命名品牌', aliases: [], competitors: [], tracking: true,
        language: 'zh-CN', website: '', description: '', note: ''
      }];
      const brandIds = new Map();
      const brandExternalIds = new Set();
      for (const brand of brands) {
        const externalId = uniqueExternalId(brand.id, `brand-${crypto.randomUUID()}`, brandExternalIds);
        const brandId = stableUuid('brand', externalId); brandIds.set(externalId, brandId);
        await client.query(`insert into brands (id, workspace_id, external_id, name, aliases, website_url, language, description, note, tracking_enabled, state, updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,now())`, [brandId, workspaceId, externalId, text(brand.name, '未命名品牌'), asArray(brand.aliases), text(brand.website), text(brand.language, 'zh-CN'), text(brand.description), text(brand.note), brand.tracking !== false, JSON.stringify(brand)]);
        for (const competitorName of [...new Set(asArray(brand.competitors).map((value) => text(value)).filter(Boolean))]) {
          const competitorId = stableUuid('competitor', `${externalId}:${competitorName}`);
          await client.query(`insert into brand_competitors (id, brand_id, external_id, name, status, state) values ($1,$2,$3,$4,'active',$5::jsonb)`, [competitorId, brandId, `${externalId}:${competitorName}`, competitorName, JSON.stringify({ name: competitorName })]);
        }
      }
      const requestedBrandExternalId = text(snapshot.workspace?.brandId);
      const defaultBrandId = brandIds.get(requestedBrandExternalId) || brandIds.values().next().value;
      const defaultBrandExternalId = [...brandIds.entries()].find(([, value]) => value === defaultBrandId)?.[0] || 'brand-default';
      const brandExternalByDbId = new Map([...brandIds.entries()].map(([externalId, databaseId]) => [databaseId, externalId]));
      const brandDbIdFor = (resource) => brandIds.get(text(resource?.brandId)) || defaultBrandId;
      // Keep the selected brand pointer valid even when the incoming snapshot
      // was empty or referenced a deleted prototype brand.
      await client.query(`update workspaces set settings = jsonb_set(settings, '{brandId}', to_jsonb($1::text), true) where id = $2`, [defaultBrandExternalId, workspaceId]);
      const groupIds = new Map();
      const groupExternalIds = new Set();
      for (const group of asArray(snapshot.promptGroups)) {
        const promptBrandId = brandDbIdFor(group);
        const groupName = text(group.name, '默认分组');
        const externalId = uniqueExternalId(group.id, `${brandExternalByDbId.get(promptBrandId) || defaultBrandExternalId}:${groupName}`, groupExternalIds);
        const groupId = stableUuid('prompt-group', externalId);
        groupIds.set(`${promptBrandId}:${groupName}`, groupId);
        await client.query(
          `insert into prompt_groups (id,workspace_id,brand_id,external_id,name,sort_order,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,now(),now())`,
          [groupId, workspaceId, promptBrandId, externalId, groupName, Number(group.sortOrder) || groupIds.size]
        );
      }
      const promptDbIds = new Map();
      const promptBrandDbIds = new Map();
      const promptTextDbIds = new Map();
      const promptExternalIds = new Set();
      const insertPrompt = async (prompt, sourceExternalId, fallbackText) => {
        const cleanText = text(prompt?.text, fallbackText || '未命名监控问题');
        const externalId = uniqueExternalId(sourceExternalId, `prompt-${crypto.randomUUID()}`, promptExternalIds);
        const promptBrandId = brandDbIdFor(prompt);
        const dedupeKey = `${promptBrandId}:${cleanText.toLocaleLowerCase()}`;
        let promptId = promptTextDbIds.get(dedupeKey);
        if (!promptId) {
          const groupName = text(prompt?.group, '默认分组');
          const groupKey = `${promptBrandId}:${groupName}`;
          let groupId = groupIds.get(groupKey);
          if (!groupId) {
            groupId = stableUuid('prompt-group', groupKey);
            groupIds.set(groupKey, groupId);
            await client.query(`insert into prompt_groups (id,workspace_id,brand_id,external_id,name,sort_order) values ($1,$2,$3,$4,$5,$6)`, [groupId, workspaceId, promptBrandId, groupKey, groupName, groupIds.size]);
          }
          promptId = stableUuid('prompt', externalId);
          await client.query(`insert into prompts (id,workspace_id,brand_id,group_id,external_id,text,language,status,platforms,state,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,now(),now())`, [promptId, workspaceId, promptBrandId, groupId, externalId, cleanText, text(prompt?.language, 'zh-CN'), ['active', 'paused', 'archived'].includes(prompt?.status) ? prompt.status : 'active', asArray(prompt?.platforms).length ? prompt.platforms : PLATFORMS, JSON.stringify(Object.assign({}, prompt || {}, { brandId: brandExternalByDbId.get(promptBrandId) || defaultBrandExternalId }))]);
          promptTextDbIds.set(dedupeKey, promptId);
        }
        promptBrandDbIds.set(promptId, promptBrandId);
        if (sourceExternalId) promptDbIds.set(sourceExternalId, promptId);
        promptDbIds.set(externalId, promptId);
        return promptId;
      };
      for (const prompt of asArray(snapshot.prompts)) {
        const sourceExternalId = text(prompt.id, `prompt-${crypto.randomUUID()}`);
        await insertPrompt(prompt, sourceExternalId, prompt.text);
      }
      const platformIds = new Map();
      for (const platform of PLATFORMS) { const platformId = stableUuid('platform', platform); platformIds.set(platform, platformId); await client.query(`insert into model_platforms (id,code,name,adapter_key,enabled) values ($1,$2,$3,$4,true) on conflict (code) do update set name=excluded.name, adapter_key=excluded.adapter_key`, [platformId, platform, platform, platform.toLowerCase()]); }
      const taskDbIds = new Map();
      const taskExternalIds = new Set();
      for (const task of asArray(snapshot.tasks)) { const externalId = uniqueExternalId(task.id, `task-${crypto.randomUUID()}`, taskExternalIds); const taskId = stableUuid('task', externalId); taskDbIds.set(externalId, taskId); await client.query(`insert into runtime_tasks (id,workspace_id,external_id,task_type,status,state,created_at,updated_at) values ($1,$2,$3,$4,$5,$6::jsonb,now(),now())`, [taskId, workspaceId, externalId, text(task.type, '系统任务'), ['queued', 'running', 'completed', 'error', 'cancelled'].includes(task.status) ? task.status : 'queued', JSON.stringify(task)]); }
      const recordExternalIds = new Set();
      for (const record of asArray(snapshot.records)) {
        const externalId = uniqueExternalId(record.id, `record-${crypto.randomUUID()}`, recordExternalIds);
        const sourcePromptId = text(record.promptId);
        let promptId = promptDbIds.get(sourcePromptId);
        if (!promptId) promptId = await insertPrompt({ brandId: record.brandId, text: text(record.question || record.text, `未命名监控问题 · ${externalId}`), group: text(record.group, '导入记录'), language: 'zh-CN', platforms: [text(record.platform, PLATFORMS[0])] }, sourcePromptId || `prompt-${externalId}`, text(record.question || record.text, `未命名监控问题 · ${externalId}`));
        const taskId = record.taskId ? taskDbIds.get(record.taskId) || null : null;
        const platform = PLATFORMS.includes(text(record.platform)) ? text(record.platform) : PLATFORMS[0];
        const recordId = stableUuid('record', externalId);
        await client.query(`insert into answer_records (id,task_id,prompt_id,platform_id,external_id,model_version,status,raw_answer,raw_payload,mentioned,first_rank,exposure_score,evaluated_at,latency_ms,state,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15::jsonb,now())`, [recordId, taskId, promptId, platformIds.get(platform), externalId, text(record.modelVersion), ['queued', 'completed', 'error'].includes(record.status) ? record.status : 'queued', text(record.answer), JSON.stringify(record.rawPayload || {}), record.mentioned == null ? null : Boolean(record.mentioned), numberOrNull(record.rank), numberOrNull(record.score ?? record.exposure, 0), parseDateOrNull(record.time) || parseDateOrNull(record.date), numberOrNull(record.latencyMs), JSON.stringify(Object.assign({}, record, { platform }))]);
        for (const [index, source] of asArray(record.sources).entries()) {
          const sourceUrl = text(source?.url || source);
          if (!/^https?:\/\//i.test(sourceUrl)) continue;
          let domain = '';
          try { domain = new URL(sourceUrl).hostname.toLowerCase(); } catch { continue; }
          const domainId = stableUuid('source-domain', domain);
          await client.query(`insert into source_domains (id,domain,first_seen_at,last_seen_at) values ($1,$2,now(),now()) on conflict (domain) do update set last_seen_at=now()`, [domainId, domain]);
          const recordBrandExternalId = brandExternalByDbId.get(promptBrandDbIds.get(promptId)) || defaultBrandExternalId;
          const brandDomain = (() => { try { return new URL(brands.find((item) => item.id === recordBrandExternalId)?.website || '').hostname.toLowerCase(); } catch { return ''; } })();
          await client.query(`insert into answer_sources (
            id,answer_record_id,domain_id,url,title,position,is_brand_domain,source_type,verification_status,content,author,published_at,modality,brand_match,competitor_matches,raw_payload,fetched_at,error_message,created_at
          ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17,$18,now())`, [
            stableUuid('answer-source', `${externalId}:${sourceUrl}`), recordId, domainId, sourceUrl, text(source?.title), Number(source?.position) || index + 1,
            Boolean(brandDomain && (domain === brandDomain || domain.endsWith(`.${brandDomain}`))),
            ['model_citation', 'embedded_link', 'retrieval_candidate', 'manual_or_owned'].includes(text(source?.sourceType)) ? text(source.sourceType) : 'model_citation',
            ['unverified', 'fetched', 'failed'].includes(text(source?.verificationStatus)) ? text(source.verificationStatus) : 'unverified',
            text(source?.content || source?.contentText) || null, text(source?.author) || null, source?.publishedAt || null,
            text(source?.modality) || null, Boolean(source?.brandMatch), JSON.stringify(Array.isArray(source?.competitorMatches) ? source.competitorMatches : []), JSON.stringify(source?.rawPayload || {}),
            source?.fetchedAt || null, text(source?.errorMessage) || null
          ]);
        }
      }
      const assetExternalIds = new Set();
      for (const asset of asArray(snapshot.assets)) { const externalId = uniqueExternalId(asset.id, `asset-${crypto.randomUUID()}`, assetExternalIds); const assetBrandId = brandDbIdFor(asset); await client.query(`insert into assets (id,workspace_id,brand_id,external_id,title,asset_type,source_url,content_text,status,state,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,now(),now())`, [stableUuid('asset', externalId), workspaceId, assetBrandId, externalId, text(asset.title, '未命名素材'), text(asset.type, '品牌资料'), text(asset.source), text(asset.content), ['pending_review', 'approved', 'rejected', 'expired'].includes(asset.status) ? asset.status : 'pending_review', JSON.stringify(Object.assign({}, asset, { brandId: brandExternalByDbId.get(assetBrandId) || defaultBrandExternalId }))]); }
      const channelByName = new Map();
      for (const channel of asArray(snapshot.workspace?.channels)) { const externalId = text(channel.id, `channel-${crypto.randomUUID()}`); const channelId = stableUuid('channel', externalId); channelByName.set(channel.name, channelId); await client.query(`insert into publish_channels (id,workspace_id,external_id,name,channel_type,endpoint,status,state) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [channelId, workspaceId, externalId, text(channel.name, '官网'), text(channel.type, 'website'), text(channel.endpoint), text(channel.status, '未连接'), JSON.stringify(channel)]); }
      const articleExternalIds = new Set();
      const usedSlugs = new Set();
      for (const article of asArray(snapshot.articles)) { const externalId = uniqueExternalId(article.id, `article-${crypto.randomUUID()}`, articleExternalIds); const articleBrandId = brandDbIdFor(article); const seoKeywords = text(article.seoKeywords).split(',').map((value) => value.trim()).filter(Boolean); const requestedSlug = text(article.slug); const slugKey = `${articleBrandId}:${requestedSlug}`; const slug = requestedSlug && !usedSlugs.has(slugKey) ? requestedSlug : null; if (slug) usedSlugs.add(slugKey); await client.query(`insert into articles (id,workspace_id,brand_id,external_id,title,topic,body,status,seo_title,seo_description,seo_keywords,slug,fact_check_status,index_status,published_at,state,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,now(),now())`, [stableUuid('article', externalId), workspaceId, articleBrandId, externalId, text(article.title, '未命名文章'), text(article.topic), text(article.body), articleDbStatus(article.status), text(article.seoTitle), text(article.seoDescription), seoKeywords, slug, article.check === '已通过' ? 'passed' : 'pending', text(article.indexStatus, '未提交'), parseDateOrNull(article.publishedAt), JSON.stringify(Object.assign({}, article, { brandId: brandExternalByDbId.get(articleBrandId) || defaultBrandExternalId }))]); }
      const usersByExternal = new Map();
      const userExternalIds = new Set();
      for (const user of asArray(snapshot.users)) { const externalId = uniqueExternalId(user.id, `user-${crypto.randomUUID()}`, userExternalIds); const userId = stableUuid('user', externalId); usersByExternal.set(externalId, userId); await client.query(`insert into users (id,external_id,email,name,password_hash,status,last_login_at,created_at,updated_at,profile) values ($1,$2,$3,$4,$5,$6,$7,now(),now(),$8::jsonb) on conflict (id) do update set email=excluded.email,name=excluded.name,password_hash=excluded.password_hash,status=excluded.status,last_login_at=excluded.last_login_at,updated_at=now(),profile=excluded.profile`, [userId, externalId, text(user.email, `${externalId}@invalid.local`).toLowerCase(), text(user.name, '用户'), text(user.passwordHash, 'disabled$00$00'), user.status === 'active' ? 'active' : 'disabled', parseDateOrNull(user.lastLoginAt), JSON.stringify(user)]); }
      const memberExternalIds = new Set();
      const memberUserIds = new Set();
      for (const member of asArray(snapshot.members).filter((item) => item.status !== '待接受')) {
        const memberExternalId = uniqueExternalId(member.id, `member-${crypto.randomUUID()}`, memberExternalIds);
        const userExternalId = text(member.userId, `member-user-${memberExternalId}`);
        const userId = usersByExternal.get(userExternalId) || stableUuid('user', userExternalId);
        if (memberUserIds.has(userId)) continue;
        memberUserIds.add(userId);
        if (!usersByExternal.has(userExternalId)) {
          await client.query(`insert into users (id,external_id,email,name,password_hash,status,created_at,updated_at,profile) values ($1,$2,$3,$4,'disabled$00$00','disabled',now(),now(),$5::jsonb) on conflict (id) do nothing`, [userId, userExternalId, text(member.email, `${userExternalId}@invalid.local`).toLowerCase(), text(member.name, '成员'), JSON.stringify(member)]);
          usersByExternal.set(userExternalId, userId);
        }
        await client.query(`insert into workspace_members (id,workspace_id,user_id,external_id,role,status,scope,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7::jsonb,now(),now())`, [stableUuid('member', memberExternalId), workspaceId, userId, memberExternalId, roleToDb[member.role] || 'brand_member', memberDbStatus(member.status), JSON.stringify(member.scope || '全部品牌')]);
      }
      const invitationExternalIds = new Set();
      for (const member of asArray(snapshot.members).filter((item) => item.status === '待接受' && item.inviteTokenHash)) { const externalId = uniqueExternalId(member.id, `invite-${crypto.randomUUID()}`, invitationExternalIds); await client.query(`insert into workspace_invitations (id,workspace_id,external_id,email,role,brand_scope,token_hash,expires_at,state,created_at) values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9::jsonb,now())`, [stableUuid('invitation', externalId), workspaceId, externalId, text(member.email).toLowerCase(), roleToDb[member.role] || 'brand_member', JSON.stringify(member.scope || []), member.inviteTokenHash, parseDateOrNull(member.inviteExpiresAt) || new Date(Date.now() + 7 * 86400000), JSON.stringify(member)]); }
      for (const audit of asArray(snapshot.auditLogs)) {
        const actorId = usersByExternal.get(text(audit.actorId)) || null;
        await client.query(
          `insert into audit_logs (id,workspace_id,actor_id,action,resource_type,resource_id,external_resource_id,before_data,after_data,ip,created_at)
           values ($1,$2,$3,$4,$5,null,$6,$7::jsonb,$8::jsonb,$9,$10)
           on conflict (id) do nothing`,
          [stableUuid('audit', text(audit.id, crypto.randomUUID())), workspaceId, actorId, text(audit.action, 'unknown'), text(audit.resourceType, 'unknown'), text(audit.resourceId) || null, audit.before == null ? null : JSON.stringify(audit.before), audit.after == null ? null : JSON.stringify(audit.after), text(audit.ip) || null, parseDateOrNull(audit.createdAt) || new Date()]
        );
      }
      for (const token of asArray(snapshot.refreshTokens)) {
        const userId = usersByExternal.get(text(token.userId));
        const expiresAt = parseDateOrNull(token.expiresAt);
        if (!userId || !text(token.tokenHash) || !expiresAt) continue;
        await client.query(`insert into refresh_tokens (id,user_id,token_hash,expires_at,revoked_at,created_at) values ($1,$2,$3,$4,$5,$6) on conflict (token_hash) do update set user_id=excluded.user_id,expires_at=excluded.expires_at,revoked_at=excluded.revoked_at`, [stableUuid('refresh-token', text(token.id, token.tokenHash)), userId, token.tokenHash, expiresAt, parseDateOrNull(token.revokedAt), parseDateOrNull(token.createdAt) || new Date()]);
      }
      await client.query('commit');
      snapshot.meta = Object.assign({}, snapshot.meta || {}, { revision: nextRevision });
      this.ready = true;
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  async health() {
    const result = await this.pool.query(`select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1::text[])`, [[
      'workspaces', 'users', 'workspace_members', 'workspace_invitations', 'brands', 'prompt_groups', 'prompts',
      'model_platforms', 'runtime_tasks', 'answer_records', 'assets', 'articles', 'publish_channels', 'refresh_tokens', 'schema_migrations'
    ]]);
    const available = new Set(result.rows.map((row) => row.table_name));
    const required = ['workspaces', 'users', 'workspace_members', 'workspace_invitations', 'brands', 'prompt_groups', 'prompts', 'model_platforms', 'runtime_tasks', 'answer_records', 'assets', 'articles', 'publish_channels', 'refresh_tokens', 'schema_migrations'];
    const missing = required.filter((table) => !available.has(table));
    if (missing.length) throw new Error(`数据库迁移未完成，缺少表：${missing.join(', ')}`);
    const requiredMigrations = ['001_initial.sql', '002_state_store.sql', '003_runtime_extensions.sql', '004_incremental_audit.sql'];
    const migrationResult = await this.pool.query('select name from schema_migrations where name = any($1::text[])', [requiredMigrations]);
    const applied = new Set(migrationResult.rows.map((row) => row.name));
    const missingMigrations = requiredMigrations.filter((name) => !applied.has(name));
    if (missingMigrations.length) throw new Error(`数据库迁移未完成，缺少版本：${missingMigrations.join(', ')}`);
    await this.pool.query('select 1');
    this.ready = true;
    return true;
  }

  getRepositories() {
    return this.repositories;
  }

  getWorkspaceId() {
    return this.workspaceId;
  }

  async close() { await this.pool.end(); }
}

module.exports = { RelationalStore, stableUuid, parseDateOrNull, numberOrNull };
