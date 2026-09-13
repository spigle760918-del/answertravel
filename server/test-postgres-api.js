const assert = require('assert/strict');
const { spawn } = require('child_process');
const { Pool } = require('pg');

const host = '127.0.0.1';
const port = Number(process.env.ANSWERTRAVEL_POSTGRES_TEST_PORT || 4176);
const base = `http://${host}:${port}/api/v1`;
const roleHeader = { 'X-Demo-Role': encodeURIComponent('团队管理员') };

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    method: options.method || 'GET',
    headers: Object.assign({}, roleHeader, options.body ? { 'Content-Type': 'application/json' } : {}),
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${path} 返回 ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

async function requestResult(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    method: options.method || 'GET',
    headers: Object.assign({}, roleHeader, options.body ? { 'Content-Type': 'application/json' } : {}),
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function waitForReady(child) {
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`PostgreSQL 测试服务提前退出。\n${output}`);
    try {
      const ready = await request('/ready');
      if (ready.ready && ready.storage === 'postgres') return;
    } catch { /* 等待服务与数据库就绪 */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`PostgreSQL 测试服务未就绪。\n${output}`);
}

async function startServer() {
  const child = spawn(process.execPath, [require.resolve('./index')], {
    cwd: __dirname,
    env: Object.assign({}, process.env, {
      ANSWERTRAVEL_API_HOST: host,
      ANSWERTRAVEL_API_PORT: String(port),
      DEEPSEEK_API_KEY: '',
      ANSWERTRAVEL_STORAGE: 'postgres',
      ANSWERTRAVEL_DEMO_AUTH: 'true',
      NODE_ENV: 'staging'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await waitForReady(child);
  return child;
}

async function stopServer(child) {
  if (!child || child.exitCode != null) return;
  child.kill('SIGTERM');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('PostgreSQL 测试服务未能正常退出。')), 12_000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

async function waitFor(check, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('PostgreSQL 集成测试需要 DATABASE_URL。');
  const suffix = Date.now().toString(36);
  const brandId = `brand-pg-${suffix}`;
  const promptGroupId = `group-pg-${suffix}`;
  const promptId = `prompt-pg-${suffix}`;
  const assetId = `asset-pg-${suffix}`;
  const articleId = `article-pg-${suffix}`;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  let originalWorkspace;
  let changedTeamName;
  let changedWizardDraft;
  let changedChannel;
  let originalCollectionRecord;
  let originalCollectionAnswer;
  let child = await startServer();
  try {
    originalWorkspace = (await request('/workspace')).data;
    changedTeamName = `PostgreSQL 团队 ${suffix}`;
    changedWizardDraft = { activeStep: 3, testRun: suffix };
    const channel = originalWorkspace.channels[0];
    assert.ok(channel?.id, '测试工作空间应至少包含一个发布渠道');
    changedChannel = Object.assign({}, channel, {
      status: '已连接', endpoint: `https://publish.example/${suffix}`, defaultAuthor: '集成测试编辑部'
    });
    await request('/workspace/team', { method: 'PATCH', body: { name: changedTeamName, description: `资源级写入验证 ${suffix}` } });
    await request('/workspace', { method: 'PATCH', body: { setupCompleted: !originalWorkspace.setupCompleted, wizardDraft: changedWizardDraft } });
    await request(`/workspace/channels/${encodeURIComponent(channel.id)}`, { method: 'PATCH', body: changedChannel });
    const baseline = await pool.query('select id, created_at from brands order by created_at asc limit 1');
    assert.ok(baseline.rows[0], '测试库应先创建默认品牌');
    const brand = await request('/brands', { method: 'POST', body: { id: brandId, name: `PostgreSQL 持久化品牌 ${suffix}`, region: '云南' } });
    assert.equal(brand.data.id, brandId);
    const competitors = await request(`/brands/${brandId}/competitors`, { method: 'PUT', body: { competitors: ['云南文旅', '贵州文旅'] } });
    assert.deepEqual(competitors.data, ['云南文旅', '贵州文旅']);
    const editedBrand = await request(`/brands/${brandId}`, { method: 'PATCH', body: { name: `PostgreSQL 增量品牌 ${suffix}`, website: 'https://example.com' } });
    assert.equal(editedBrand.data.name, `PostgreSQL 增量品牌 ${suffix}`);
    await request('/workspace', { method: 'PATCH', body: { brandId } });
    const createdGroup = await request('/prompt-groups', { method: 'POST', body: { id: promptGroupId, brandId, name: '数据库验证' } });
    assert.equal(createdGroup.data.id, promptGroupId);
    const listedGroups = await request(`/prompt-groups?brandId=${encodeURIComponent(brandId)}`);
    const listedGroup = listedGroups.data.find((group) => group.id === promptGroupId);
    assert.ok(listedGroup, '主题分组应按品牌出现在 PostgreSQL 列表中');
    assert.equal(listedGroup.promptCount, 0, '新建主题分组初始不应包含提问');
    const prompt = await request('/prompts', { method: 'POST', body: { id: promptId, brandId, group: createdGroup.data.name, text: `PostgreSQL 重启后仍应存在的问题 ${suffix}` } });
    assert.equal(prompt.data.prompt.id, promptId);
    const rejectedDelete = await requestResult(`/prompt-groups/${promptGroupId}`, { method: 'DELETE' });
    assert.equal(rejectedDelete.response.status, 409, '非空主题分组删除应被 PostgreSQL 约束阻止');
    const renamedGroup = await request(`/prompt-groups/${promptGroupId}`, { method: 'PATCH', body: { name: '增量写入验证' } });
    assert.equal(renamedGroup.data.name, '增量写入验证');
    const editedPrompt = await request(`/prompts/${promptId}`, { method: 'PATCH', body: { text: `PostgreSQL 增量编辑后仍应存在的问题 ${suffix}` } });
    assert.equal(editedPrompt.data.group, '增量写入验证');
    const scopedPrompts = await request(`/prompts?brandId=${encodeURIComponent(brandId)}`);
    assert.deepEqual(scopedPrompts.data.map((item) => item.id), [promptId], '提问接口应按品牌过滤');
    const completedTask = await waitFor(async () => {
      const tasks = await request('/tasks');
      return tasks.data.find((item) => item.id === prompt.data.task.id && item.status === 'completed');
    });
    assert.ok(completedTask, '后台采集任务状态应通过增量写入完成');
    const initialRecords = await request(`/records?brandId=${encodeURIComponent(brandId)}`);
    originalCollectionRecord = initialRecords.data.find((record) => record.promptId === promptId && record.status === 'completed');
    assert.ok(originalCollectionRecord?.taskId === prompt.data.task.id, '首次 PostgreSQL 采集记录应关联任务');
    originalCollectionAnswer = originalCollectionRecord.answer;
    const rerun = await request(`/records/${originalCollectionRecord.id}/rerun`, { method: 'POST', body: {} });
    assert.notEqual(rerun.data.task.id, prompt.data.task.id, '重跑应创建新的 PostgreSQL 任务');
    assert.equal(rerun.data.records[0].taskId, rerun.data.task.id);
    const repeatedRerun = await request(`/records/${originalCollectionRecord.id}/rerun`, { method: 'POST', body: {} });
    assert.equal(repeatedRerun.data.reused, true, '同一运行中任务不应重复创建');
    const completedRerun = await waitFor(async () => {
      const tasks = await request('/tasks');
      return tasks.data.find((item) => item.id === rerun.data.task.id && item.status === 'completed');
    });
    assert.ok(completedRerun, 'PostgreSQL 重跑任务应完成');
    const collectionHistory = await request(`/records?brandId=${encodeURIComponent(brandId)}`);
    const platformHistory = collectionHistory.data.filter((record) => record.promptId === promptId && record.platform === originalCollectionRecord.platform);
    assert.equal(platformHistory.length, 2, 'PostgreSQL 应保留同一平台的多次采集历史');
    assert.equal(platformHistory.find((record) => record.id === originalCollectionRecord.id)?.answer, originalCollectionAnswer, '原回答不得被重跑覆盖');
    const asset = await request('/assets', { method: 'POST', body: { id: assetId, brandId, title: '云南线路手册', type: '目的地资料', content: '第一版资料' } });
    assert.equal(asset.data.id, assetId);
    const editedAsset = await request(`/assets/${assetId}`, { method: 'PATCH', body: { title: '云南线路手册 2026', content: '第二版资料', status: '已审核' } });
    assert.equal(editedAsset.data.content, '第二版资料');
    const article = await request('/articles', { method: 'POST', body: {
      id: articleId, brandId, title: '云南首次旅行规划', topic: '行前规划', body: '初稿', channel: '官网',
      seoTitle: '云南首次旅行规划', seoDescription: '面向首次游客的云南旅行指南',
      seoKeywords: '云南旅行,行前规划', slug: `yunnan-${suffix}`
    } });
    assert.equal(article.data.id, articleId);
    await request(`/articles/${articleId}`, { method: 'PATCH', body: { body: '编辑后的文章正文' } });
    const reviewed = await request(`/articles/${articleId}/review`, { method: 'POST', body: { factSources: true, factUpdated: true, factAuthor: true, factContact: true, factPricing: true } });
    assert.equal(reviewed.data.status, '待发布');
    const publishing = await request(`/articles/${articleId}/publish`, { method: 'POST', body: { channel: '官网' } });
    assert.equal(publishing.data.article.status, '发布中');
    const repeatedPublishing = await request(`/articles/${articleId}/publish`, { method: 'POST', body: { channel: '官网' } });
    assert.equal(repeatedPublishing.data.reused, true, 'PostgreSQL 模式下重复发布应复用现有任务');
    assert.equal(repeatedPublishing.data.task.id, publishing.data.task.id);
    const published = await waitFor(async () => {
      const current = await request(`/articles/${articleId}`);
      return current.data.status === '已发布' && current.data.indexStatus === '已收录' ? current.data : null;
    });
    assert.ok(published, '文章发布与自动收录状态应通过增量写入完成');
    const unchanged = await pool.query('select id, created_at from brands where id = $1', [baseline.rows[0].id]);
    assert.equal(unchanged.rows[0].id, baseline.rows[0].id, '增量写入不应替换无关品牌主键');
    assert.equal(unchanged.rows[0].created_at.toISOString(), baseline.rows[0].created_at.toISOString(), '增量写入不应重建无关品牌');
  } finally {
    await stopServer(child);
  }

  child = await startServer();
  try {
    const restartedWorkspace = (await request('/workspace')).data;
    assert.equal(restartedWorkspace.team.name, changedTeamName, '服务重启后团队资料应保留');
    assert.equal(restartedWorkspace.setupCompleted, !originalWorkspace.setupCompleted, '服务重启后设置向导状态应保留');
    assert.deepEqual(restartedWorkspace.wizardDraft, changedWizardDraft, '服务重启后设置向导草稿应保留');
    assert.equal(restartedWorkspace.brandId, brandId, '服务重启后当前品牌应保留');
    const restartedChannel = restartedWorkspace.channels.find((item) => item.id === changedChannel.id);
    assert.equal(restartedChannel?.endpoint, changedChannel.endpoint, '服务重启后发布渠道配置应保留');
    assert.equal(restartedChannel?.defaultAuthor, changedChannel.defaultAuthor, '发布渠道扩展字段应从 state 读回');
    const brand = await request(`/brands/${brandId}`);
    assert.equal(brand.data.id, brandId, '服务重启后品牌应从关系表读回');
    assert.equal(brand.data.name, `PostgreSQL 增量品牌 ${suffix}`);
    assert.deepEqual(brand.data.competitors, ['云南文旅', '贵州文旅']);
    const prompt = await request(`/prompts/${promptId}`);
    assert.equal(prompt.data.id, promptId, '服务重启后提问应从关系表读回');
    assert.equal(prompt.data.group, '增量写入验证');
    const records = await request(`/records?group=${encodeURIComponent('增量写入验证')}`);
    assert.ok(records.data.some((record) => record.promptId === promptId), '服务重启后回答记录筛选应走关系查询');
    const scopedRecords = await request(`/records?brandId=${encodeURIComponent(brandId)}`);
    assert.ok(scopedRecords.data.every((record) => record.brandId === brandId), '回答记录接口应按品牌过滤');
    assert.ok(scopedRecords.data.some((record) => record.promptId === promptId && record.status === 'completed'), '后台采集结果应在重启后保留');
    const restartedHistory = scopedRecords.data.filter((record) => record.promptId === promptId && record.platform === originalCollectionRecord.platform);
    assert.equal(restartedHistory.length, 2, '重启后应保留多次采集历史');
    assert.ok(restartedHistory.some((record) => record.id === originalCollectionRecord.id && record.answer === originalCollectionAnswer), '重启后原回答 ID 和内容应保留');
    const assets = await request('/assets');
    assert.ok(assets.data.some((asset) => asset.id === assetId && asset.content === '第二版资料'), '素材增量更新应在重启后保留');
    const articles = await request('/articles');
    assert.ok(articles.data.some((article) => article.id === articleId && article.body === '编辑后的文章正文' && article.status === '已发布'), '文章审核发布结果应在重启后保留');
    await request('/workspace/team', { method: 'PATCH', body: originalWorkspace.team });
    await request('/workspace', { method: 'PATCH', body: { brandId: originalWorkspace.brandId, setupCompleted: originalWorkspace.setupCompleted, wizardDraft: originalWorkspace.wizardDraft } });
    await request(`/workspace/channels/${encodeURIComponent(changedChannel.id)}`, { method: 'PATCH', body: originalWorkspace.channels.find((item) => item.id === changedChannel.id) });
    await request(`/assets/${assetId}`, { method: 'DELETE' });
    await request(`/articles/${articleId}`, { method: 'DELETE' });
    await request(`/prompts/${promptId}`, { method: 'DELETE' });
    await request(`/prompt-groups/${promptGroupId}`, { method: 'DELETE' });
    const deletedGroup = await pool.query('select id from prompt_groups where external_id = $1', [promptGroupId]);
    assert.equal(deletedGroup.rowCount, 0, '清空提问后应能删除主题分组');
    const deletedPrompt = await pool.query('select id from prompts where external_id = $1', [promptId]);
    assert.equal(deletedPrompt.rowCount, 0, '删除提问应直接清除关系表记录');
    await request(`/brands/${brandId}`, { method: 'DELETE' });
    const deletedBrand = await pool.query('select id from brands where external_id = $1', [brandId]);
    assert.equal(deletedBrand.rowCount, 0, '删除品牌应直接清除关系表记录');
    const auditLogs = await request('/audit-logs?limit=50');
    const actions = new Set(auditLogs.data.map((entry) => entry.action));
    for (const action of ['workspace.team.update', 'workspace.settings.update', 'channel.update', 'brand.create', 'competitor.replace', 'brand.update', 'prompt_group.create', 'prompt_group.update', 'prompt_group.delete', 'prompt.create', 'prompt.update', 'asset.create', 'asset.update', 'asset.delete', 'article.create', 'article.update', 'article.review', 'article.publish', 'article.delete', 'prompt.delete', 'brand.delete']) {
      assert.ok(actions.has(action), `审计日志应记录 ${action}`);
    }
    assert.ok(auditLogs.data.some((entry) => entry.resourceId === articleId), '文章审计应保留可定位的资源标识');
    console.log('AnswerTravel PostgreSQL restart persistence test passed.');
  } finally {
    await stopServer(child);
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
