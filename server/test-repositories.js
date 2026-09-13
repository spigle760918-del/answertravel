const assert = require('assert/strict');
const { WorkspaceRepository, BrandRepository, PromptRepository, RecordRepository } = require('./repositories');

async function main() {
  const calls = [];
  const pool = {
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('select settings from workspaces')) return { rows: [{ settings: { meta: { revision: 3 }, setupCompleted: false } }] };
      if (sql.includes('update workspaces set settings')) return { rows: [] };
      if (sql.includes('returning name, description')) return { rows: [{ name: values[1], description: values[2] }] };
      if (sql.includes('update publish_channels')) return { rows: [{ id: 'channel-db' }] };
      if (sql.includes('from brands b')) return { rows: [{ id: 'brand-db', external_id: 'brand-1', name: '云南文旅', aliases: ['云南旅行'], website_url: 'https://travel.example', language: 'zh-CN', region: '云南', description: '目的地品牌', note: '', tracking_enabled: true, competitor_names: ['贵州文旅'], state: { custom: true } }] };
      if (sql.includes('from prompts p')) return { rows: [{ id: 'prompt-db', external_id: 'prompt-1', brand_external_id: 'brand-1', text: '第一次去云南如何规划？', group_name: '行前规划', platforms: ['DeepSeek'], status: 'active', language: 'zh-CN', region: '云南', frequency: 'daily', created_at: new Date('2026-09-08T00:00:00Z'), state: {} }] };
      if (/^\s*select s\.\*, sd\.domain/.test(sql)) return { rows: [{ id: 'source-db', answer_record_id: 'record-db', record_external_id: 'record-1', prompt_external_id: 'prompt-1', brand_external_id: 'brand-1', prompt_text: '第一次去云南如何规划？', platform_name: 'DeepSeek', url: 'https://travel.example/guide', title: '旅行指南', domain: 'travel.example', position: 1, source_type: 'model_citation', verification_status: 'fetched', content: '正文', competitor_matches: [], brand_match: true }] };
      return { rows: [{ id: 'record-db', external_id: 'record-1', brand_external_id: 'brand-1', prompt_external_id: 'prompt-1', prompt_text: '第一次去云南如何规划？', group_name: '行前规划', platform_name: 'DeepSeek', status: 'completed', mentioned: true, exposure_score: '86.5', first_rank: '2', raw_answer: '建议先确定旅行天数。', evaluated_at: new Date('2026-09-08T01:00:00Z'), sources: [{ url: 'https://travel.example/guide' }], state: {} }] };
    }
  };

  const workspaceRepository = new WorkspaceRepository(pool);
  const settings = await workspaceRepository.updateSettings('workspace-db', { brandId: 'brand-1', setupCompleted: true, wizardDraft: { step: 4 } });
  assert.equal(settings.meta.revision, 3, '工作空间增量更新不得覆盖其他设置');
  assert.equal(settings.setupCompleted, true);
  assert.equal(settings.wizardDraft.step, 4);
  const team = await workspaceRepository.updateTeam('workspace-db', { name: '目的地运营团队', description: '负责西南线路' });
  assert.equal(team.name, '目的地运营团队');
  await workspaceRepository.updateChannel('workspace-db', 'channel-website', { id: 'channel-website', name: '官网', type: 'website', endpoint: 'https://travel.example', status: '已连接', defaultAuthor: '内容团队' });
  assert.ok(calls.at(-1).sql.includes('workspace_id = $1'), '发布渠道更新必须限制在当前工作空间');

  const brands = await new BrandRepository(pool).list('workspace-db');
  assert.equal(brands[0].id, 'brand-1');
  assert.deepEqual(brands[0].competitors, ['贵州文旅']);

  const prompts = await new PromptRepository(pool).list('workspace-db', 'prompt-1');
  assert.equal(prompts[0].group, '行前规划');
  assert.equal(prompts[0].brandId, 'brand-1');
  assert.match(calls.at(-1).sql, /p\.external_id = \$2 or p\.id::text = \$2/);
  assert.deepEqual(calls.at(-1).values, ['workspace-db', 'prompt-1']);

  const records = await new RecordRepository(pool).list('workspace-db', { platform: 'DeepSeek', group: '行前规划', status: 'completed', mentioned: 'true', search: '云南', from: '2026-09-01', to: '2026-09-08' });
  assert.equal(records[0].score, 86.5);
  assert.equal(records[0].brandId, 'brand-1');
  assert.equal(records[0].rank, 2);
  assert.equal(records[0].sources.length, 1);
  assert.equal(calls.at(-1).values.length, 8);
  assert.ok(calls.at(-1).sql.includes('answer_sources'), '回答查询应同时加载引用来源');

  const sources = await new RecordRepository(pool).listSources('workspace-db', { brandId: 'brand-1', sourceType: 'model_citation', verificationStatus: 'fetched', domain: 'travel.example' });
  assert.equal(sources[0].sourceType, 'model_citation');
  assert.equal(sources[0].verificationStatus, 'fetched');
  assert.equal(sources[0].brandId, 'brand-1');
  assert.ok(calls.at(-1).sql.includes('p.workspace_id = $1'), '信源查询必须限制在当前工作空间');

  console.log('AnswerTravel repository tests passed.');
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
