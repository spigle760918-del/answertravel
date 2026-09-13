const DEFAULT_PLATFORMS = ['DeepSeek', '豆包', 'Kimi', '元宝'];
const ROLE_TO_DB = { '团队管理员': 'team_admin', '品牌管理员': 'brand_admin', '品牌编辑者': 'brand_editor', '品牌成员（只读）': 'brand_member' };
const DB_TO_ROLE = Object.fromEntries(Object.entries(ROLE_TO_DB).map(([label, value]) => [value, label]));
const MEMBER_STATUS_TO_DB = { '正常': 'active', '待接受': 'invited', '暂停': 'suspended' };
const ARTICLE_STATUS_TO_DB = { '草稿': 'draft', '待审核': 'pending_review', '待发布': 'pending_publish', '发布中': 'publishing', '已发布': 'published', '已收录': 'indexed', '发布失败': 'publish_error' };
const DB_TO_ARTICLE_STATUS = Object.fromEntries(Object.entries(ARTICLE_STATUS_TO_DB).map(([label, value]) => [value, label]));
const ASSET_STATUS_TO_DB = { '待审核': 'pending_review', '已审核': 'approved', '已通过': 'approved', '已拒绝': 'rejected', '已过期': 'expired' };

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function json(value, fallback = {}) {
  return value && typeof value === 'object' ? value : fallback;
}

function text(value, fallback = '') {
  return String(value == null ? fallback : value).trim();
}

function iso(value) {
  return value?.toISOString?.() || value || '';
}

function dateOnly(value) {
  return iso(value).slice(0, 10);
}

function dateOrNull(value) {
  const raw = text(value);
  if (!raw || Number.isNaN(Date.parse(raw))) return null;
  return raw;
}

function assetDbStatus(value) {
  return ASSET_STATUS_TO_DB[value] || (['pending_review', 'approved', 'rejected', 'expired'].includes(value) ? value : 'pending_review');
}

function articleDbStatus(value) {
  return ARTICLE_STATUS_TO_DB[value] || (Object.values(ARTICLE_STATUS_TO_DB).includes(value) ? value : 'draft');
}

function buildWhere(clauses, values, clause, value) {
  values.push(value);
  clauses.push(`${clause} $${values.length}`);
}

async function requireBrandId(executor, workspaceId, externalId) {
  const result = await executor.query(
    `select id from brands
     where workspace_id = $1 and deleted_at is null and (external_id = $2 or id::text = $2)
     limit 1`,
    [workspaceId, externalId]
  );
  if (!result.rows[0]) throw Object.assign(new Error('品牌不存在。'), { statusCode: 404 });
  return result.rows[0].id;
}

async function requirePromptId(executor, workspaceId, externalId) {
  const result = await executor.query(
    `select id from prompts
     where workspace_id = $1 and deleted_at is null and (external_id = $2 or id::text = $2)
     limit 1`,
    [workspaceId, externalId]
  );
  if (!result.rows[0]) throw Object.assign(new Error('提问不存在。'), { statusCode: 404 });
  return result.rows[0].id;
}

async function requirePromptGroup(executor, workspaceId, externalId) {
  const result = await executor.query(
    `select pg.*, b.external_id as brand_external_id
     from prompt_groups pg
     join brands b on b.id = pg.brand_id and b.workspace_id = pg.workspace_id
     where pg.workspace_id = $1 and (pg.external_id = $2 or pg.id::text = $2)
     limit 1`,
    [workspaceId, externalId]
  );
  if (!result.rows[0]) throw Object.assign(new Error('主题分组不存在。'), { statusCode: 404 });
  return result.rows[0];
}

class WorkspaceRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async updateSettings(workspaceId, patch) {
    const current = await this.pool.query('select settings from workspaces where id = $1 limit 1', [workspaceId]);
    if (!current.rows[0]) throw Object.assign(new Error('工作空间不存在。'), { statusCode: 404 });
    const settings = Object.assign({}, json(current.rows[0].settings));
    if (Object.prototype.hasOwnProperty.call(patch, 'brandId')) settings.brandId = text(patch.brandId);
    if (Object.prototype.hasOwnProperty.call(patch, 'setupCompleted')) settings.setupCompleted = Boolean(patch.setupCompleted);
    if (patch.wizardDraft && typeof patch.wizardDraft === 'object') settings.wizardDraft = json(patch.wizardDraft);
    if (patch.collectionUsage && typeof patch.collectionUsage === 'object') settings.collectionUsage = json(patch.collectionUsage);
    await this.pool.query('update workspaces set settings = $2::jsonb, updated_at = now() where id = $1', [workspaceId, JSON.stringify(settings)]);
    return settings;
  }

  async updateTeam(workspaceId, team) {
    const result = await this.pool.query(
      `update workspaces
       set name = $2, description = $3, updated_at = now()
       where id = $1
       returning name, description`,
      [workspaceId, text(team.name, 'AnswerTravel 工作空间'), text(team.description)]
    );
    if (!result.rows[0]) throw Object.assign(new Error('工作空间不存在。'), { statusCode: 404 });
    return { name: result.rows[0].name, description: result.rows[0].description || '' };
  }

  async updateChannel(workspaceId, externalId, channel) {
    const result = await this.pool.query(
      `update publish_channels
       set name = $3, channel_type = $4, endpoint = $5, status = $6,
           state = $7::jsonb, updated_at = now()
       where workspace_id = $1 and (external_id = $2 or id::text = $2)
       returning id`,
      [
        workspaceId, externalId, text(channel.name, '官网'), text(channel.type, 'website'),
        text(channel.endpoint), text(channel.status, '未连接'), JSON.stringify(channel)
      ]
    );
    if (!result.rows[0]) throw Object.assign(new Error('发布渠道不存在。'), { statusCode: 404 });
    return channel;
  }
}

class BrandRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async list(workspaceId) {
    const result = await this.pool.query(
      `select b.*, coalesce(json_agg(bc.name order by bc.name) filter (where bc.id is not null), '[]'::json) as competitor_names
       from brands b
       left join brand_competitors bc on bc.brand_id = b.id and bc.status = 'active'
       where b.workspace_id = $1 and b.deleted_at is null
       group by b.id
       order by b.created_at asc`,
      [workspaceId]
    );
    return result.rows.map((row) => this.toPublic(row));
  }

  async get(workspaceId, externalId) {
    const result = await this.pool.query(
      `select b.*, coalesce(json_agg(bc.name order by bc.name) filter (where bc.id is not null), '[]'::json) as competitor_names
       from brands b
       left join brand_competitors bc on bc.brand_id = b.id and bc.status = 'active'
       where b.workspace_id = $1 and b.deleted_at is null and (b.external_id = $2 or b.id::text = $2)
       group by b.id
       limit 1`,
      [workspaceId, externalId]
    );
    return result.rows[0] ? this.toPublic(result.rows[0]) : null;
  }

  async upsert(workspaceId, brand) {
    const result = await this.pool.query(
      `insert into brands (
         workspace_id, external_id, name, aliases, website_url, language, region,
         description, note, tracking_enabled, state, created_at, updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,now(),now())
       on conflict (external_id) where external_id is not null do update set
         name = excluded.name,
         aliases = excluded.aliases,
         website_url = excluded.website_url,
         language = excluded.language,
         region = excluded.region,
         description = excluded.description,
         note = excluded.note,
         tracking_enabled = excluded.tracking_enabled,
         state = excluded.state,
         deleted_at = null,
         updated_at = now()
       where brands.workspace_id = excluded.workspace_id
       returning *`,
      [
        workspaceId, text(brand.id), text(brand.name, '未命名品牌'), asArray(brand.aliases),
        text(brand.website), text(brand.language, 'zh-CN'), text(brand.region),
        text(brand.description), text(brand.note), brand.tracking !== false, JSON.stringify(brand)
      ]
    );
    if (!result.rows[0]) throw Object.assign(new Error('品牌标识已被其他工作空间使用。'), { statusCode: 409 });
    return this.toPublic(Object.assign({}, result.rows[0], { competitor_names: asArray(brand.competitors) }));
  }

  async replaceCompetitors(workspaceId, externalId, competitors) {
    const brandId = await requireBrandId(this.pool, workspaceId, externalId);
    const names = [...new Set(asArray(competitors).map((value) => text(value)).filter(Boolean))].slice(0, 5);
    await this.pool.query('delete from brand_competitors where brand_id = $1', [brandId]);
    for (const name of names) {
      await this.pool.query(
        `insert into brand_competitors (brand_id, external_id, name, status, state)
         values ($1,$2,$3,'active',$4::jsonb)`,
        [brandId, `${externalId}:${name}`, name, JSON.stringify({ name })]
      );
    }
    await this.pool.query(
      `update brands
       set state = jsonb_set(coalesce(state, '{}'::jsonb), '{competitors}', $1::jsonb, true), updated_at = now()
       where id = $2`,
      [JSON.stringify(names), brandId]
    );
    return names;
  }

  async delete(workspaceId, externalId, selectedBrandId) {
    const brandId = await requireBrandId(this.pool, workspaceId, externalId);
    await this.pool.query(
      `delete from runtime_tasks
       where workspace_id = $1 and (state->>'brandId' = $2 or state->>'brandId' = $3)`,
      [workspaceId, externalId, String(brandId)]
    );
    await this.pool.query('delete from brands where id = $1 and workspace_id = $2', [brandId, workspaceId]);
    await this.pool.query(
      `update workspaces
       set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{brandId}', to_jsonb($1::text), true), updated_at = now()
       where id = $2`,
      [text(selectedBrandId), workspaceId]
    );
    return true;
  }

  toPublic(row) {
    return Object.assign({}, json(row.state), {
      id: row.external_id || row.id,
      name: row.name,
      aliases: asArray(row.aliases),
      website: row.website_url || '',
      language: row.language || 'zh-CN',
      region: row.region || '',
      description: row.description || '',
      note: row.note || '',
      tracking: row.tracking_enabled !== false,
      competitors: asArray(row.competitor_names)
    });
  }
}

class PromptRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async list(workspaceId, promptId = '', filters = {}) {
    const values = [workspaceId];
    const clauses = ['p.workspace_id = $1', 'p.deleted_at is null'];
    if (promptId) {
      values.push(promptId);
      clauses.push(`(p.external_id = $${values.length} or p.id::text = $${values.length})`);
    }
    const brandId = text(filters.brandId);
    const group = text(filters.group);
    const status = text(filters.status);
    const search = text(filters.search || filters.q).toLowerCase();
    if (brandId && brandId !== 'all') {
      values.push(brandId);
      clauses.push(`(b.external_id = $${values.length} or b.id::text = $${values.length})`);
    }
    if (group && group !== 'all' && group !== '全部分组') {
      values.push(group);
      clauses.push(`pg.name = $${values.length}`);
    }
    if (status && status !== 'all' && status !== '全部状态') {
      values.push(status);
      clauses.push(`p.status = $${values.length}`);
    }
    if (search) {
      values.push(`%${search}%`);
      clauses.push(`lower(concat_ws(' ', p.text, pg.name, b.name)) like $${values.length}`);
    }
    const result = await this.pool.query(
      `select p.*, pg.name as group_name, b.external_id as brand_external_id
       from prompts p
       left join prompt_groups pg on pg.id = p.group_id
       join brands b on b.id = p.brand_id and b.workspace_id = p.workspace_id
       where ${clauses.join(' and ')}
       order by p.created_at asc`,
      values
    );
    return result.rows.map((row) => this.toPublic(row));
  }

  async upsert(workspaceId, prompt) {
    const brandId = await requireBrandId(this.pool, workspaceId, prompt.brandId);
    const groupName = text(prompt.group, '默认分组');
    const groupExternalId = `${prompt.brandId}:${groupName}`;
    const groupResult = await this.pool.query(
      `insert into prompt_groups (workspace_id, brand_id, external_id, name, sort_order, created_at, updated_at)
       values ($1,$2,$3,$4,0,now(),now())
       on conflict (brand_id, name) do update set updated_at = now()
       returning id`,
      [workspaceId, brandId, groupExternalId, groupName]
    );
    const result = await this.pool.query(
      `insert into prompts (
         workspace_id, brand_id, group_id, external_id, text, language, region,
         frequency, status, platforms, state, created_at, updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,now(),now())
       on conflict (external_id) where external_id is not null do update set
         brand_id = excluded.brand_id,
         group_id = excluded.group_id,
         text = excluded.text,
         language = excluded.language,
         region = excluded.region,
         frequency = excluded.frequency,
         status = excluded.status,
         platforms = excluded.platforms,
         state = excluded.state,
         deleted_at = null,
         updated_at = now()
       where prompts.workspace_id = excluded.workspace_id
       returning id`,
      [
        workspaceId, brandId, groupResult.rows[0].id, text(prompt.id), text(prompt.text),
        text(prompt.language, 'zh-CN'), text(prompt.region), text(prompt.frequency, 'daily'),
        ['active', 'paused', 'archived'].includes(prompt.status) ? prompt.status : 'active',
        asArray(prompt.platforms).length ? prompt.platforms : DEFAULT_PLATFORMS,
        JSON.stringify(prompt)
      ]
    );
    if (!result.rows[0]) throw Object.assign(new Error('提问标识已被其他工作空间使用。'), { statusCode: 409 });
    return prompt;
  }

  async delete(workspaceId, externalId) {
    const promptId = await requirePromptId(this.pool, workspaceId, externalId);
    await this.pool.query(
      `delete from runtime_tasks
       where workspace_id = $1 and (state->>'promptId' = $2 or state->>'promptId' = $3)`,
      [workspaceId, externalId, String(promptId)]
    );
    await this.pool.query('delete from prompts where id = $1 and workspace_id = $2', [promptId, workspaceId]);
    return true;
  }

  toPublic(row) {
    return Object.assign({}, json(row.state), {
      id: row.external_id || row.id,
      brandId: row.brand_external_id || row.brand_id,
      group: row.group_name || '默认分组',
      text: row.text,
      platforms: asArray(row.platforms).length ? row.platforms : DEFAULT_PLATFORMS,
      status: row.status,
      language: row.language || 'zh-CN',
      region: row.region || '',
      frequency: row.frequency || 'daily',
      createdAt: dateOnly(row.created_at)
    });
  }
}

class PromptGroupRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async list(workspaceId, groupId = '', brandId = '') {
    const values = [workspaceId];
    const clauses = ['pg.workspace_id = $1'];
    if (groupId) {
      values.push(groupId);
      clauses.push(`(pg.external_id = $${values.length} or pg.id::text = $${values.length})`);
    }
    if (brandId && brandId !== 'all') {
      values.push(brandId);
      clauses.push(`(b.external_id = $${values.length} or b.id::text = $${values.length})`);
    }
    const result = await this.pool.query(
      `select pg.*, b.external_id as brand_external_id,
              count(p.id)::integer as prompt_count
       from prompt_groups pg
       join brands b on b.id = pg.brand_id and b.workspace_id = pg.workspace_id
       left join prompts p on p.group_id = pg.id and p.deleted_at is null
       where ${clauses.join(' and ')}
       group by pg.id, b.external_id
       order by pg.sort_order asc, pg.created_at asc`,
      values
    );
    return result.rows.map((row) => this.toPublic(row));
  }

  async upsert(workspaceId, group) {
    const brandId = await requireBrandId(this.pool, workspaceId, group.brandId);
    const name = text(group.name);
    if (!name) throw Object.assign(new Error('主题分组名称不能为空。'), { statusCode: 400 });
    if (name.length > 120) throw Object.assign(new Error('主题分组名称不能超过 120 个字符。'), { statusCode: 400 });
    const duplicate = await this.pool.query(
      `select 1 from prompt_groups where workspace_id = $1 and brand_id = $2 and lower(name) = lower($3) and ($4 = '' or external_id <> $4) limit 1`,
      [workspaceId, brandId, name, text(group.id)]
    );
    if (duplicate.rows[0]) throw Object.assign(new Error('该主题分组已存在。'), { statusCode: 409 });
    const externalId = text(group.id);
    const result = await this.pool.query(
      `insert into prompt_groups (workspace_id, brand_id, external_id, name, sort_order, created_at, updated_at)
       values ($1,$2,$3,$4,$5,now(),now())
       on conflict (external_id) where external_id is not null do update set
         brand_id = excluded.brand_id,
         name = excluded.name,
         sort_order = excluded.sort_order,
         updated_at = now()
       where prompt_groups.workspace_id = excluded.workspace_id
       returning *`,
      [workspaceId, brandId, externalId, name, Number(group.sortOrder) || 0]
    );
    if (!result.rows[0]) throw Object.assign(new Error('主题分组标识已被其他工作空间使用。'), { statusCode: 409 });
    return (await this.list(workspaceId, externalId))[0];
  }

  async delete(workspaceId, externalId) {
    const group = await requirePromptGroup(this.pool, workspaceId, externalId);
    const count = await this.pool.query('select count(*)::integer as count from prompts where group_id = $1 and deleted_at is null', [group.id]);
    if (Number(count.rows[0]?.count || 0) > 0) throw Object.assign(new Error('该主题下还有用户提问，请先移动或删除提问。'), { statusCode: 409 });
    await this.pool.query('delete from prompt_groups where id = $1 and workspace_id = $2', [group.id, workspaceId]);
    return true;
  }

  toPublic(row) {
    return {
      id: row.external_id || row.id,
      brandId: row.brand_external_id || row.brand_id,
      name: row.name,
      sortOrder: Number(row.sort_order || 0),
      promptCount: Number(row.prompt_count || 0),
      createdAt: dateOnly(row.created_at),
      updatedAt: iso(row.updated_at)
    };
  }
}

class RecordRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async list(workspaceId, filters = {}) {
    const values = [workspaceId];
    const clauses = ['p.workspace_id = $1'];
    const brandId = text(filters.brandId);
    if (brandId && brandId !== 'all') {
      values.push(brandId);
      clauses.push(`(b.external_id = $${values.length} or b.id::text = $${values.length})`);
    }
    const platform = text(filters.platform);
    const group = text(filters.group);
    const status = text(filters.status);
    const search = text(filters.search).toLowerCase();
    const sourceType = text(filters.sourceType);
    const verificationStatus = text(filters.verificationStatus);
    const mentioned = filters.mentioned === '' || filters.mentioned === 'all' || filters.mentioned == null ? null : String(filters.mentioned) === 'true';
    const from = text(filters.from);
    const to = text(filters.to);
    if (platform && platform !== '全部') buildWhere(clauses, values, 'coalesce(mp.name, ar.state->>\'platform\') =', platform);
    if (group && group !== 'all') buildWhere(clauses, values, 'coalesce(pg.name, ar.state->>\'group\') =', group);
    if (status && status !== 'all') buildWhere(clauses, values, 'ar.status =', status);
    if (mentioned !== null) buildWhere(clauses, values, 'ar.mentioned =', mentioned);
    if (search) {
      values.push(`%${search}%`);
      clauses.push(`lower(concat_ws(' ', p.text, pg.name, mp.name, ar.raw_answer, ar.state->>'question')) like $${values.length}`);
    }
    if (sourceType && sourceType !== 'all') {
      values.push(sourceType);
      clauses.push(`exists (select 1 from answer_sources filter_src where filter_src.answer_record_id = ar.id and filter_src.source_type = $${values.length})`);
    }
    if (verificationStatus && verificationStatus !== 'all') {
      values.push(verificationStatus);
      clauses.push(`exists (select 1 from answer_sources filter_src_status where filter_src_status.answer_record_id = ar.id and filter_src_status.verification_status = $${values.length})`);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(from)) buildWhere(clauses, values, 'coalesce(ar.evaluated_at, ar.created_at)::date >=', from);
    if (/^\d{4}-\d{2}-\d{2}$/.test(to)) buildWhere(clauses, values, 'coalesce(ar.evaluated_at, ar.created_at)::date <=', to);
    const result = await this.pool.query(
      `select ar.*, p.external_id as prompt_external_id, p.text as prompt_text,
              b.external_id as brand_external_id,
              pg.name as group_name, mp.name as platform_name,
              rt.external_id as task_external_id,
              coalesce(src.sources, '[]'::json) as sources
       from answer_records ar
       join prompts p on p.id = ar.prompt_id
       join brands b on b.id = p.brand_id and b.workspace_id = p.workspace_id
       left join prompt_groups pg on pg.id = p.group_id
       left join model_platforms mp on mp.id = ar.platform_id
       left join runtime_tasks rt on rt.external_id = ar.state->>'taskId'
       left join lateral (
         select json_agg(json_build_object(
           'url', s.url, 'title', s.title, 'position', s.position, 'domain', sd.domain,
           'sourceType', s.source_type, 'verificationStatus', s.verification_status,
           'content', s.content, 'author', s.author, 'publishedAt', s.published_at,
           'modality', s.modality, 'brandMatch', s.brand_match,
           'competitorMatches', s.competitor_matches
         ) order by s.position nulls last, s.created_at) as sources
         from answer_sources s
         left join source_domains sd on sd.id = s.domain_id
         where s.answer_record_id = ar.id
       ) src on true
       where ${clauses.join(' and ')}
       order by coalesce(ar.evaluated_at, ar.created_at) desc, ar.created_at desc`,
      values
    );
    return result.rows.map((row) => this.toPublic(row));
  }

  async upsert(workspaceId, record) {
    const promptId = await requirePromptId(this.pool, workspaceId, record.promptId);
    const platform = text(record.platform, DEFAULT_PLATFORMS[0]);
    const platformResult = await this.pool.query(
      `insert into model_platforms (code, name, adapter_key, enabled)
       values ($1,$2,$3,true)
       on conflict (code) do update set name = excluded.name
       returning id`,
      [platform, platform, platform.toLowerCase()]
    );
    const result = await this.pool.query(
      `insert into answer_records (
         prompt_id, platform_id, external_id, model_version, status, raw_answer,
         raw_payload, mentioned, first_rank, exposure_score, evaluated_at, latency_ms,
         state, created_at
       ) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13::jsonb,now())
       on conflict (external_id) where external_id is not null do update set
         prompt_id = excluded.prompt_id,
         platform_id = excluded.platform_id,
         model_version = excluded.model_version,
         status = excluded.status,
         raw_answer = excluded.raw_answer,
         raw_payload = excluded.raw_payload,
         mentioned = excluded.mentioned,
         first_rank = excluded.first_rank,
         exposure_score = excluded.exposure_score,
         evaluated_at = excluded.evaluated_at,
         latency_ms = excluded.latency_ms,
         state = excluded.state
       returning id`,
      [
        promptId, platformResult.rows[0].id, text(record.id), text(record.modelVersion),
        ['queued', 'completed', 'error'].includes(record.status) ? record.status : 'queued',
        text(record.answer), JSON.stringify(record.rawPayload || {}),
        record.mentioned == null ? null : Boolean(record.mentioned),
        Number.isFinite(Number(record.rank)) ? Number(record.rank) : null,
        Number.isFinite(Number(record.score)) ? Number(record.score) : 0,
        /^\d{4}-\d{2}-\d{2}T/.test(text(record.time)) ? record.time : null,
        Number.isFinite(Number(record.latencyMs)) ? Number(record.latencyMs) : null,
        JSON.stringify(record)
      ]
    );
    const recordId = result.rows[0].id;
    await this.pool.query('delete from answer_sources where answer_record_id = $1', [recordId]);
    for (const [index, source] of asArray(record.sources).entries()) {
      const sourceUrl = text(source?.url || source);
      if (!sourceUrl) continue;
      let domain = '';
      try { domain = new URL(sourceUrl).hostname.toLowerCase(); } catch { /* 非 URL 引用不创建域名记录 */ }
      let domainId = null;
      if (domain) {
        const domainResult = await this.pool.query(
          `insert into source_domains (domain, first_seen_at, last_seen_at)
           values ($1,now(),now())
           on conflict (domain) do update set last_seen_at = now()
           returning id`,
          [domain]
        );
        domainId = domainResult.rows[0].id;
      }
      await this.pool.query(
        `insert into answer_sources (
           answer_record_id, domain_id, url, title, position, is_brand_domain,
           source_type, verification_status, content, author, published_at,
           modality, brand_match, competitor_matches, raw_payload, fetched_at, error_message, created_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17,now())`,
        [
          recordId, domainId, sourceUrl, text(source?.title), Number(source?.position) || index + 1,
          Boolean(source?.brandMatch), ['model_citation', 'embedded_link', 'retrieval_candidate', 'manual_or_owned'].includes(text(source?.sourceType)) ? text(source.sourceType) : 'model_citation',
          ['unverified', 'fetched', 'failed'].includes(text(source?.verificationStatus)) ? text(source.verificationStatus) : 'unverified',
          text(source?.content || source?.contentText) || null, text(source?.author) || null,
          source?.publishedAt || null, text(source?.modality) || null, Boolean(source?.brandMatch),
          JSON.stringify(Array.isArray(source?.competitorMatches) ? source.competitorMatches : []), JSON.stringify(source?.rawPayload || {}),
          source?.fetchedAt || null, text(source?.errorMessage) || null
        ]
      );
    }
    return record;
  }

  async listSources(workspaceId, filters = {}) {
    const values = [workspaceId];
    const clauses = ['p.workspace_id = $1'];
    const brandId = text(filters.brandId);
    const sourceType = text(filters.sourceType);
    const verificationStatus = text(filters.verificationStatus);
    const domain = text(filters.domain).toLowerCase();
    if (brandId && brandId !== 'all') { values.push(brandId); clauses.push(`(b.external_id = $${values.length} or b.id::text = $${values.length})`); }
    if (sourceType && sourceType !== 'all') { values.push(sourceType); clauses.push(`s.source_type = $${values.length}`); }
    if (verificationStatus && verificationStatus !== 'all') { values.push(verificationStatus); clauses.push(`s.verification_status = $${values.length}`); }
    if (domain) { values.push(domain); clauses.push(`lower(sd.domain::text) = $${values.length}`); }
    const limit = Math.min(500, Math.max(1, Number(filters.limit) || 100));
    values.push(limit);
    const result = await this.pool.query(`
      select s.*, sd.domain, ar.external_id as record_external_id,
             p.external_id as prompt_external_id, p.text as prompt_text,
             b.external_id as brand_external_id, mp.name as platform_name
      from answer_sources s
      join answer_records ar on ar.id = s.answer_record_id
      join prompts p on p.id = ar.prompt_id
      join brands b on b.id = p.brand_id and b.workspace_id = p.workspace_id
      left join source_domains sd on sd.id = s.domain_id
      left join model_platforms mp on mp.id = ar.platform_id
      where ${clauses.join(' and ')}
      order by s.created_at desc
      limit $${values.length}`, values);
    return result.rows.map((row) => ({
      id: row.id,
      recordId: row.record_external_id || row.answer_record_id,
      promptId: row.prompt_external_id || '',
      question: row.prompt_text || '',
      brandId: row.brand_external_id || '',
      platform: row.platform_name || '',
      url: row.url,
      title: row.title || row.domain || '未命名信源',
      domain: row.domain || '',
      position: row.position == null ? null : Number(row.position),
      sourceType: row.source_type,
      verificationStatus: row.verification_status,
      content: row.content || '', author: row.author || '',
      publishedAt: iso(row.published_at), modality: row.modality || '',
      brandMatch: Boolean(row.brand_match), competitorMatches: json(row.competitor_matches, []),
      fetchedAt: iso(row.fetched_at), errorMessage: row.error_message || ''
    }));
  }

  toPublic(row) {
    const state = json(row.state);
    return Object.assign({}, state, {
      id: row.external_id || row.id,
      brandId: row.brand_external_id || state.brandId || '',
      promptId: row.prompt_external_id || row.prompt_id,
      question: row.prompt_text || state.question || '',
      group: row.group_name || state.group || '默认分组',
      platform: row.platform_name || state.platform || DEFAULT_PLATFORMS[0],
      status: row.status,
      mentioned: row.mentioned,
      score: row.exposure_score == null ? 0 : Number(row.exposure_score),
      rank: row.first_rank == null ? 0 : Number(row.first_rank),
      answer: row.raw_answer || state.answer || '',
      sources: asArray(row.sources),
      date: dateOnly(row.evaluated_at || row.created_at),
      time: iso(row.evaluated_at || row.created_at) || '待评估',
      taskId: row.task_external_id || state.taskId || ''
    });
  }
}

class AssetRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async upsert(workspaceId, asset) {
    const brandId = await requireBrandId(this.pool, workspaceId, asset.brandId);
    const result = await this.pool.query(
      `insert into assets (
         workspace_id, brand_id, external_id, title, asset_type, source_url,
         content_text, status, valid_from, valid_until, state, created_at, updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,now(),now())
       on conflict (external_id) where external_id is not null do update set
         brand_id = excluded.brand_id,
         title = excluded.title,
         asset_type = excluded.asset_type,
         source_url = excluded.source_url,
         content_text = excluded.content_text,
         status = excluded.status,
         valid_from = excluded.valid_from,
         valid_until = excluded.valid_until,
         state = excluded.state,
         deleted_at = null,
         updated_at = now()
       where assets.workspace_id = excluded.workspace_id
       returning id`,
      [
        workspaceId, brandId, text(asset.id), text(asset.title, '未命名素材'),
        text(asset.type, '品牌资料'), text(asset.sourceUrl || asset.source), text(asset.content),
        assetDbStatus(asset.status), dateOrNull(asset.validFrom), dateOrNull(asset.validUntil),
        JSON.stringify(asset)
      ]
    );
    if (!result.rows[0]) throw Object.assign(new Error('素材标识已被其他工作空间使用。'), { statusCode: 409 });
    return asset;
  }

  async delete(workspaceId, externalId) {
    const result = await this.pool.query(
      `delete from assets
       where workspace_id = $1 and (external_id = $2 or id::text = $2)
       returning id`,
      [workspaceId, externalId]
    );
    if (!result.rows[0]) throw Object.assign(new Error('素材不存在。'), { statusCode: 404 });
    return true;
  }
}

class ArticleRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async requireId(workspaceId, externalId) {
    const result = await this.pool.query(
      `select id from articles
       where workspace_id = $1 and deleted_at is null and (external_id = $2 or id::text = $2)
       limit 1`,
      [workspaceId, externalId]
    );
    if (!result.rows[0]) throw Object.assign(new Error('文章不存在。'), { statusCode: 404 });
    return result.rows[0].id;
  }

  async upsert(workspaceId, article) {
    const brandId = await requireBrandId(this.pool, workspaceId, article.brandId);
    const sourcePromptId = text(article.promptId)
      ? await requirePromptId(this.pool, workspaceId, article.promptId)
      : null;
    const seoKeywords = Array.isArray(article.seoKeywords)
      ? article.seoKeywords.map((value) => text(value)).filter(Boolean)
      : text(article.seoKeywords).split(',').map((value) => value.trim()).filter(Boolean);
    const result = await this.pool.query(
      `insert into articles (
         workspace_id, brand_id, source_prompt_id, external_id, title, topic, body,
         status, seo_title, seo_description, seo_keywords, slug, fact_check_status,
         index_status, reviewed_at, published_at, state, created_at, updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,now(),now())
       on conflict (external_id) where external_id is not null do update set
         brand_id = excluded.brand_id,
         source_prompt_id = excluded.source_prompt_id,
         title = excluded.title,
         topic = excluded.topic,
         body = excluded.body,
         status = excluded.status,
         seo_title = excluded.seo_title,
         seo_description = excluded.seo_description,
         seo_keywords = excluded.seo_keywords,
         slug = excluded.slug,
         fact_check_status = excluded.fact_check_status,
         index_status = excluded.index_status,
         reviewed_at = excluded.reviewed_at,
         published_at = excluded.published_at,
         state = excluded.state,
         deleted_at = null,
         updated_at = now()
       where articles.workspace_id = excluded.workspace_id
       returning id`,
      [
        workspaceId, brandId, sourcePromptId, text(article.id), text(article.title, '未命名文章'),
        text(article.topic), text(article.body), articleDbStatus(article.status), text(article.seoTitle),
        text(article.seoDescription), seoKeywords, text(article.slug) || null,
        article.check === '已通过' ? 'passed' : 'pending', text(article.indexStatus, '未提交'),
        dateOrNull(article.reviewedAt), dateOrNull(article.publishedAt), JSON.stringify(article)
      ]
    );
    if (!result.rows[0]) throw Object.assign(new Error('文章标识已被其他工作空间使用。'), { statusCode: 409 });
    return article;
  }

  async addReview(workspaceId, article, reviewerExternalId) {
    const articleId = await this.requireId(workspaceId, article.id);
    let reviewerId = null;
    if (text(reviewerExternalId)) {
      const reviewer = await this.pool.query('select id from users where external_id = $1 or id::text = $1 limit 1', [reviewerExternalId]);
      reviewerId = reviewer.rows[0]?.id || null;
    }
    await this.pool.query(
      `insert into article_reviews (article_id, reviewer_id, checks, created_at)
       values ($1,$2,$3::jsonb,now())`,
      [articleId, reviewerId, JSON.stringify({
        factSources: Boolean(article.factSources), factUpdated: Boolean(article.factUpdated),
        factAuthor: Boolean(article.factAuthor), factContact: Boolean(article.factContact),
        factPricing: Boolean(article.factPricing), result: article.check
      })]
    );
  }

  async delete(workspaceId, externalId) {
    const articleId = await this.requireId(workspaceId, externalId);
    await this.pool.query(
      `delete from runtime_tasks
       where workspace_id = $1 and (state->>'articleId' = $2 or state->>'articleId' = $3)`,
      [workspaceId, externalId, String(articleId)]
    );
    await this.pool.query('delete from articles where id = $1 and workspace_id = $2', [articleId, workspaceId]);
    return true;
  }
}

class IdentityRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async upsertUser(user) {
    const result = await this.pool.query(
      `insert into users (
         external_id, email, name, password_hash, status, last_login_at, profile, created_at, updated_at
       ) values ($1,$2,$3,$4,$5,$6,$7::jsonb,now(),now())
       on conflict (external_id) where external_id is not null do update set
         email = excluded.email,
         name = excluded.name,
         password_hash = excluded.password_hash,
         status = excluded.status,
         last_login_at = excluded.last_login_at,
         profile = excluded.profile,
         updated_at = now()
       returning id`,
      [text(user.id), text(user.email).toLowerCase(), text(user.name, '用户'), text(user.passwordHash), user.status === 'active' ? 'active' : 'disabled', dateOrNull(user.lastLoginAt), JSON.stringify(user)]
    );
    return result.rows[0].id;
  }

  async upsertInvitation(workspaceId, member) {
    const result = await this.pool.query(
      `insert into workspace_invitations (
         workspace_id, external_id, email, role, brand_scope, token_hash, expires_at, state, created_at
       ) values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8::jsonb,coalesce($9::timestamptz,now()))
       on conflict (external_id) where external_id is not null do update set
         email = excluded.email,
         role = excluded.role,
         brand_scope = excluded.brand_scope,
         token_hash = excluded.token_hash,
         expires_at = excluded.expires_at,
         accepted_at = null,
         state = excluded.state
       where workspace_invitations.workspace_id = excluded.workspace_id
       returning id`,
      [workspaceId, text(member.id), text(member.email).toLowerCase(), ROLE_TO_DB[member.role] || 'brand_member', JSON.stringify(member.scope || []), text(member.inviteTokenHash), dateOrNull(member.inviteExpiresAt), JSON.stringify(member), dateOrNull(member.invitedAt)]
    );
    if (!result.rows[0]) throw Object.assign(new Error('成员邀请标识已被其他工作空间使用。'), { statusCode: 409 });
    return member;
  }

  async upsertMember(workspaceId, member, user) {
    const userId = user ? await this.upsertUser(user) : (await this.pool.query('select id from users where external_id = $1 or id::text = $1 limit 1', [text(member.userId)])).rows[0]?.id;
    if (!userId) throw Object.assign(new Error('成员关联账号不存在。'), { statusCode: 409 });
    const result = await this.pool.query(
      `insert into workspace_members (
         workspace_id, user_id, external_id, role, status, scope, accepted_at, created_at, updated_at
       ) values ($1,$2,$3,$4,$5,$6::jsonb,$7,now(),now())
       on conflict (workspace_id, user_id) do update set
         external_id = excluded.external_id,
         role = excluded.role,
         status = excluded.status,
         scope = excluded.scope,
         accepted_at = coalesce(workspace_members.accepted_at, excluded.accepted_at),
         updated_at = now()
       returning id`,
      [workspaceId, userId, text(member.id), ROLE_TO_DB[member.role] || 'brand_member', MEMBER_STATUS_TO_DB[member.status] || 'active', JSON.stringify(member.scope || '全部品牌'), dateOrNull(member.acceptedAt)]
    );
    if (!result.rows[0]) throw Object.assign(new Error('成员标识已被其他账号使用。'), { statusCode: 409 });
    return member;
  }

  async acceptInvitation(workspaceId, member, user) {
    await this.upsertMember(workspaceId, member, user);
    await this.pool.query('delete from workspace_invitations where workspace_id = $1 and external_id = $2', [workspaceId, member.id]);
  }

  async updateMember(workspaceId, member, user) {
    if (!member.userId) return this.upsertInvitation(workspaceId, member);
    return this.upsertMember(workspaceId, member, user);
  }

  async deleteMember(workspaceId, member) {
    await this.pool.query('delete from workspace_invitations where workspace_id = $1 and external_id = $2', [workspaceId, member.id]);
    if (text(member.userId)) {
      const user = await this.pool.query('select id from users where external_id = $1 or id::text = $1 limit 1', [member.userId]);
      if (user.rows[0]) {
        await this.pool.query('delete from workspace_members where workspace_id = $1 and user_id = $2', [workspaceId, user.rows[0].id]);
        await this.pool.query("update users set status = 'disabled', updated_at = now() where id = $1", [user.rows[0].id]);
        await this.pool.query('update refresh_tokens set revoked_at = coalesce(revoked_at, now()) where user_id = $1', [user.rows[0].id]);
      }
    }
    return true;
  }

  async upsertRefreshToken(token) {
    const user = await this.pool.query('select id from users where external_id = $1 or id::text = $1 limit 1', [token.userId]);
    if (!user.rows[0]) throw Object.assign(new Error('刷新凭证关联账号不存在。'), { statusCode: 409 });
    await this.pool.query(
      `insert into refresh_tokens (user_id, token_hash, expires_at, revoked_at, created_at)
       values ($1,$2,$3,$4,coalesce($5::timestamptz,now()))
       on conflict (token_hash) do update set
         user_id = excluded.user_id,
         expires_at = excluded.expires_at,
         revoked_at = excluded.revoked_at`,
      [user.rows[0].id, token.tokenHash, dateOrNull(token.expiresAt), dateOrNull(token.revokedAt), dateOrNull(token.createdAt)]
    );
    return token;
  }

  async revokeRefreshToken(tokenHash, revokedAt) {
    await this.pool.query('update refresh_tokens set revoked_at = coalesce(revoked_at, $2) where token_hash = $1', [tokenHash, dateOrNull(revokedAt) || new Date().toISOString()]);
  }
}

class RuntimeTaskRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async upsert(workspaceId, task) {
    const result = await this.pool.query(
      `insert into runtime_tasks (workspace_id, external_id, task_type, status, state, created_at, updated_at)
       values ($1,$2,$3,$4,$5::jsonb,now(),now())
       on conflict (external_id) do update set
         task_type = excluded.task_type,
         status = excluded.status,
         state = excluded.state,
         updated_at = now()
       where runtime_tasks.workspace_id = excluded.workspace_id
       returning id`,
      [workspaceId, text(task.id), text(task.type, '系统任务'), ['queued', 'running', 'completed', 'error', 'cancelled'].includes(task.status) ? task.status : 'queued', JSON.stringify(task)]
    );
    if (!result.rows[0]) throw Object.assign(new Error('任务标识已被其他工作空间使用。'), { statusCode: 409 });
    return task;
  }
}

class AuditLogRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async append(workspaceId, entry) {
    let actorId = null;
    if (text(entry.actorId)) {
      const actorResult = await this.pool.query(
        'select id from users where external_id = $1 or id::text = $1 limit 1',
        [text(entry.actorId)]
      );
      actorId = actorResult.rows[0]?.id || null;
    }
    const result = await this.pool.query(
      `insert into audit_logs (
         workspace_id, actor_id, action, resource_type, resource_id, external_resource_id,
         before_data, after_data, ip, created_at
       ) values ($1,$2,$3,$4,null,$5,$6::jsonb,$7::jsonb,$8,coalesce($9::timestamptz,now()))
       returning id, created_at`,
      [
        workspaceId, actorId, text(entry.action), text(entry.resourceType),
        text(entry.resourceId) || null,
        entry.before == null ? null : JSON.stringify(entry.before),
        entry.after == null ? null : JSON.stringify(entry.after),
        text(entry.ip) || null, text(entry.createdAt) || null
      ]
    );
    return Object.assign({}, entry, { id: result.rows[0].id, createdAt: iso(result.rows[0].created_at) });
  }

  async list(workspaceId, filters = {}) {
    const values = [workspaceId];
    const clauses = ['al.workspace_id = $1'];
    const resourceType = text(filters.resourceType);
    const action = text(filters.action);
    if (resourceType && resourceType !== 'all') buildWhere(clauses, values, 'al.resource_type =', resourceType);
    if (action && action !== 'all') buildWhere(clauses, values, 'al.action =', action);
    const limit = Math.min(200, Math.max(1, Number(filters.limit) || 50));
    values.push(limit);
    const result = await this.pool.query(
      `select al.*, u.external_id as actor_external_id, u.name as actor_name, u.email as actor_email
       from audit_logs al
       left join users u on u.id = al.actor_id
       where ${clauses.join(' and ')}
       order by al.created_at desc
       limit $${values.length}`,
      values
    );
    return result.rows.map((row) => ({
      id: row.id,
      actorId: row.actor_external_id || '',
      actor: row.actor_name || row.actor_email || '系统',
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.external_resource_id || '',
      before: row.before_data,
      after: row.after_data,
      ip: row.ip || '',
      createdAt: iso(row.created_at)
    }));
  }
}

function createRepositories(pool) {
  if (!pool) throw new Error('创建 repository 需要 PostgreSQL 连接池。');
  return {
    workspace: new WorkspaceRepository(pool),
    brands: new BrandRepository(pool),
    promptGroups: new PromptGroupRepository(pool),
    prompts: new PromptRepository(pool),
    records: new RecordRepository(pool),
    assets: new AssetRepository(pool),
    articles: new ArticleRepository(pool),
    identity: new IdentityRepository(pool),
    tasks: new RuntimeTaskRepository(pool),
    auditLogs: new AuditLogRepository(pool)
  };
}

module.exports = {
  WorkspaceRepository, BrandRepository, PromptGroupRepository, PromptRepository, RecordRepository, AssetRepository, ArticleRepository,
  IdentityRepository, RuntimeTaskRepository, AuditLogRepository, createRepositories
};
