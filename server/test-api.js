const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { parseDateOrNull, numberOrNull } = require('./relational-store');

const HOST = '127.0.0.1';
const PORT = Number(process.env.ANSWERTRAVEL_API_TEST_PORT || 4175);
const BASE = `http://${HOST}:${PORT}/api`;

async function request(route, options = {}) {
  const headers = Object.assign({}, options.token ? { Authorization: `Bearer ${options.token}` } : {}, options.role ? { 'X-Demo-Role': options.role } : {}, options.body !== undefined ? { 'Content-Type': 'application/json' } : {}, options.headers || {});
  const requestBody = options.rawBody !== undefined ? options.rawBody : (options.body === undefined ? undefined : JSON.stringify(options.body));
  const response = await fetch(`${BASE}${route}`, { method: options.method || 'GET', headers, body: requestBody });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function waitFor(check, timeoutMs = 5000, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await check();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return last;
}

async function waitForServer(child) {
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  const ready = await waitFor(async () => {
    try {
      const result = await request('/health');
      return result.response.ok;
    } catch {
      return false;
    }
  }, 6000, 100);
  if (!ready) throw new Error(`API 服务未能启动。\n${output}`);
}

async function expectStatus(route, expected, options) {
  const result = await request(route, options);
  assert.equal(result.response.status, expected, `${options?.method || 'GET'} ${route} 应返回 ${expected}，实际为 ${result.response.status}: ${JSON.stringify(result.payload)}`);
  return result.payload;
}

async function main() {
  assert.equal(parseDateOrNull('昨天 14:12'), null, '展示时间不能直接写入 PostgreSQL 时间列');
  assert.ok(parseDateOrNull('2026-09-03T08:30:00Z') instanceof Date, '标准 ISO 时间应可解析');
  assert.equal(numberOrNull('not-a-number', 0), 0, '非法数值应回退为安全默认值');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'answertravel-api-test-'));
  const dataFile = path.join(tempDir, 'data.json');
  fs.copyFileSync(path.join(__dirname, 'data.json'), dataFile);
  const isolatedData = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  isolatedData.users = [];
  isolatedData.members = [];
  isolatedData.refreshTokens = [];
  fs.writeFileSync(dataFile, JSON.stringify(isolatedData));
  const child = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    cwd: __dirname,
    env: Object.assign({}, process.env, {
      ANSWERTRAVEL_API_HOST: HOST,
      ANSWERTRAVEL_API_PORT: String(PORT),
      DEEPSEEK_API_KEY: '',
      ANSWERTRAVEL_API_DATA_FILE: dataFile,
      ANSWERTRAVEL_AUTO_INDEX_DELAY_MS: '300',
      ANSWERTRAVEL_STORAGE: 'json',
      ANSWERTRAVEL_DEMO_AUTH: 'true',
      ANSWERTRAVEL_LOCAL_ADMIN_LOGIN: 'true',
      ANSWERTRAVEL_BOOTSTRAP_ADMIN_EMAIL: 'local-admin-test@example.com',
      ANSWERTRAVEL_BOOTSTRAP_ADMIN_PASSWORD: 'local-admin-test-password',
      NODE_ENV: 'test'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    await waitForServer(child);
    const healthResponse = await request('/health');
    assert.equal(healthResponse.response.status, 200);
    assert.equal(healthResponse.response.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(healthResponse.response.headers.get('x-request-id'), '每个响应应带请求 ID');
    const corsDenied = await request('/health', { headers: { Origin: 'https://not-allowed.example.com' } });
    assert.equal(corsDenied.response.status, 403, '非白名单来源应被 CORS 拦截');
    await expectStatus('/v1/health', 200);
    const ready = await expectStatus('/ready', 200);
    assert.equal(ready.ready, true, '开发环境应通过服务就绪检查');
    const localAdminStatus = await expectStatus('/auth/local-admin', 200);
    assert.equal(localAdminStatus.data.available, true, '本机测试环境应明确开放管理员快捷登录');
    const localAdminSession = await expectStatus('/auth/local-admin', 200, { method: 'POST', body: {} });
    assert.equal(localAdminSession.data.role, '团队管理员');
    await expectStatus('/auth/me', 200, { token: localAdminSession.data.token });
    for (const protectedRoute of ['/snapshot', '/workspace', '/providers', '/brand-intelligence', '/brands', '/prompts', '/records', '/assets', '/members', '/articles', '/tasks']) {
      await expectStatus(protectedRoute, 401);
    }

    assert.ok(localAdminSession.data.token && localAdminSession.data.refreshToken, '本地管理员登录应返回 access token 和 refresh token');
    const me = await expectStatus('/auth/me', 200, { token: localAdminSession.data.token });
    assert.equal(me.data.role, '团队管理员');
    const refreshed = await expectStatus('/auth/refresh', 200, { method: 'POST', body: { refreshToken: localAdminSession.data.refreshToken } });
    assert.ok(refreshed.data.token && refreshed.data.token !== localAdminSession.data.token, '刷新应轮换 access token');
    await expectStatus('/auth/logout', 200, { method: 'POST', token: refreshed.data.token, body: { refreshToken: refreshed.data.refreshToken } });
    await expectStatus('/auth/me', 401, { token: refreshed.data.token });

    const login = await expectStatus('/auth/login', 200, { method: 'POST', body: { user: 'test-admin', role: '团队管理员' } });
    const adminToken = login.data.token;
    assert.ok(adminToken, '登录应返回 Bearer token');
    const oversized = await expectStatus('/snapshot', 413, {
      method: 'PUT', token: adminToken,
      rawBody: JSON.stringify({ data: 'x'.repeat(2 * 1024 * 1024 + 1) }),
      headers: { 'Content-Type': 'application/json' }
    });
    assert.match(oversized.error.message, /请求体过大/, '超大请求应返回可解析的 413 JSON，而不是断开连接');
    await expectStatus('/health', 200);
    const providers = await expectStatus('/providers', 200, { token: adminToken });
    assert.deepEqual(providers.data, [{ platform: 'DeepSeek', configured: false, model: 'deepseek-chat', mode: 'unconfigured' }], '未配置密钥时必须明确显示平台不可用');
    const collectionStatus = await expectStatus('/collection/status', 200, { token: adminToken });
    assert.equal(collectionStatus.data.schedule.enabled, true, '采集调度器应处于启用状态');
    assert.ok(collectionStatus.data.quotas[0]?.brand?.limit > 0, '采集状态应返回当前品牌月度配额');
    assert.equal(collectionStatus.data.providers[0].platform, 'DeepSeek');
    const brandIntelligence = await expectStatus('/brand-intelligence', 200, { token: adminToken });
    assert.ok(brandIntelligence.data.brand.id, '品牌优化分析必须绑定当前品牌');
    assert.equal(typeof brandIntelligence.data.own.mentionRate, 'number');
    assert.ok(Array.isArray(brandIntelligence.data.opportunities));
    assert.ok(Array.isArray(brandIntelligence.data.contentBrief.proofRequired));
    assert.match(brandIntelligence.data.methodology, /启发式标签/, '诊断必须公开非客观指标的计算性质');
    const readOnlyLogin = await expectStatus('/auth/login', 200, { method: 'POST', body: { user: 'test-reader', role: '品牌成员（只读）' } });
    const readOnlyToken = readOnlyLogin.data.token;

    await expectStatus('/brands', 200, { headers: { 'X-Demo-Role': encodeURIComponent('团队管理员') } });

    const initialBrands = await expectStatus('/brands', 200, { token: adminToken });
    const primaryBrand = initialBrands.data[0];
    assert.ok(primaryBrand?.id, '测试数据应至少包含一个品牌');
    const groupName = `主题分组测试-${Date.now()}`;
    const createdGroup = await expectStatus('/prompt-groups', 201, {
      method: 'POST', token: adminToken,
      body: { id: `group-api-${Date.now()}`, brandId: primaryBrand.id, name: groupName }
    });
    assert.equal(createdGroup.data.name, groupName, '主题分组创建应返回名称');
    const listedGroups = await expectStatus(`/prompt-groups?brandId=${encodeURIComponent(primaryBrand.id)}`, 200, { token: adminToken });
    assert.ok(listedGroups.data.some((group) => group.id === createdGroup.data.id), '主题分组列表应包含新分组');
    const renamedGroup = await expectStatus(`/prompt-groups/${createdGroup.data.id}`, 200, {
      method: 'PATCH', token: adminToken, body: { name: `${groupName}-已改名` }
    });
    assert.equal(renamedGroup.data.name, `${groupName}-已改名`, '主题分组应支持重命名');
    await expectStatus('/brands', 403, { method: 'POST', token: readOnlyToken, body: { name: '无权创建的品牌' } });

    const isolatedBrand = await expectStatus('/brands', 201, {
      method: 'POST', token: adminToken,
      body: { id: 'brand-isolated-test', name: '隔离测试品牌', region: '四川' }
    });
    const brandAdminLogin = await expectStatus('/auth/login', 200, { method: 'POST', body: { user: 'brand-admin-test', role: '品牌管理员' } });
    await expectStatus(`/brands/${isolatedBrand.data.id}`, 403, { method: 'DELETE', token: brandAdminLogin.data.token });
    await expectStatus('/members', 400, { method: 'POST', token: adminToken, body: { name: '空范围成员', email: `empty-scope-${Date.now()}@example.com`, role: '品牌编辑者', scope: [] } });

    const invitedEmail = `invite-${Date.now()}@example.com`;
    const invitation = await expectStatus('/members', 201, { method: 'POST', token: adminToken, body: { name: '路线编辑', email: invitedEmail, role: '品牌编辑者', scope: primaryBrand.id } });
    assert.ok(invitation.data.inviteUrl, '团队邀请应返回可分享的邀请地址');
    assert.equal(invitation.data.inviteTokenHash, undefined, '邀请响应不得暴露令牌哈希');
    const firstInviteRoute = invitation.data.inviteUrl.replace(/^\/api/, '');
    let inviteToken = invitation.data.inviteUrl.split('/').at(-1);
    const invitationInfo = await expectStatus(firstInviteRoute, 200);
    assert.equal(invitationInfo.data.status, '待接受');
    assert.ok(Date.parse(invitationInfo.data.inviteExpiresAt) > Date.now(), '团队邀请应包含有效期');
    const resentInvitation = await expectStatus(`/members/${invitation.data.id}/resend-invitation`, 200, { method: 'POST', token: adminToken, body: {} });
    await expectStatus(firstInviteRoute, 404);
    inviteToken = resentInvitation.data.inviteUrl.split('/').at(-1);
    const inviteRoute = resentInvitation.data.inviteUrl.replace(/^\/api/, '');
    const accepted = await expectStatus('/auth/register', 201, { method: 'POST', body: { name: '路线编辑（已接受）', email: invitedEmail, password: 'invited-editor-password', inviteToken } });
    const editorToken = accepted.data.token;
    assert.ok(editorToken, '受邀成员注册后应获得真实会话');
    await expectStatus(inviteRoute, 404);

    const editorMe = await expectStatus('/auth/me', 200, { token: editorToken });
    assert.equal(editorMe.data.role, '品牌编辑者');
    assert.deepEqual(editorMe.data.brandIds, [primaryBrand.id], '受限成员只能获得被授权品牌范围');
    await expectStatus(`/members/${invitation.data.id}`, 409, { method: 'PATCH', token: adminToken, body: { status: '待接受' } });
    await expectStatus(`/members/${invitation.data.id}/resend-invitation`, 409, { method: 'POST', token: adminToken, body: {} });
    const editorBrands = await expectStatus('/brands', 200, { token: editorToken });
    assert.deepEqual(editorBrands.data.map((brand) => brand.id), [primaryBrand.id]);
    await expectStatus(`/brands/${isolatedBrand.data.id}`, 403, { token: editorToken });
    await expectStatus(`/brands/${primaryBrand.id}`, 200, { method: 'PATCH', token: editorToken, body: { note: '编辑者可维护授权品牌' } });
    await expectStatus(`/brands/${isolatedBrand.data.id}`, 403, { method: 'PATCH', token: editorToken, body: { note: '越权修改' } });

    const editorPrompt = await expectStatus('/prompts', 201, {
      method: 'POST', token: editorToken,
      body: { id: 'prompt-editor-owned', brandId: primaryBrand.id, group: '权限测试', text: '授权品牌的路线如何规划？' }
    });
    assert.equal(editorPrompt.data.prompt.brandId, primaryBrand.id);
    await expectStatus('/prompts', 403, { method: 'POST', token: editorToken, body: { brandId: isolatedBrand.data.id, text: '不应写入另一个品牌' } });
    const isolatedPrompt = await expectStatus('/prompts', 201, {
      method: 'POST', token: adminToken,
      body: { id: 'prompt-isolated-owned', brandId: isolatedBrand.data.id, group: '权限测试', text: '隔离品牌的独立问题' }
    });
    const editorPrompts = await expectStatus('/prompts', 200, { token: editorToken });
    assert.ok(editorPrompts.data.some((prompt) => prompt.id === editorPrompt.data.prompt.id));
    assert.ok(!editorPrompts.data.some((prompt) => prompt.id === isolatedPrompt.data.prompt.id), '列表不得返回未授权品牌的提问');
    await expectStatus(`/prompts/${isolatedPrompt.data.prompt.id}`, 403, { token: editorToken });
    const editorRecords = await expectStatus(`/records?brandId=${encodeURIComponent(isolatedBrand.data.id)}`, 200, { token: editorToken });
    assert.equal(editorRecords.data.length, 0, '成员不得读取未授权品牌的回答历史');
    const editorTasks = await expectStatus('/tasks', 200, { token: editorToken });
    assert.ok(!editorTasks.data.some((task) => task.id === isolatedPrompt.data.task.id), '成员不得读取未授权品牌的采集任务');

    const members = await expectStatus('/members', 200, { token: adminToken });
    assert.ok(members.data.every((member) => member.inviteTokenHash === undefined && member.inviteToken === undefined), '成员列表不得暴露邀请凭证');
    const editorSnapshot = await expectStatus('/snapshot', 200, { token: editorToken });
    assert.deepEqual(editorSnapshot.data.brands.map((brand) => brand.id), [primaryBrand.id]);
    assert.ok(editorSnapshot.data.prompts.every((prompt) => prompt.brandId === primaryBrand.id), '快照内资源必须按品牌范围过滤');

    await expectStatus(`/members/${invitation.data.id}`, 200, { method: 'PATCH', token: adminToken, body: { scope: isolatedBrand.data.id } });
    const updatedEditorMe = await expectStatus('/auth/me', 200, { token: editorToken });
    assert.deepEqual(updatedEditorMe.data.brandIds, [isolatedBrand.data.id], '管理员改权后旧 access token 应立即使用新范围');
    await expectStatus(`/brands/${primaryBrand.id}`, 403, { token: editorToken });
    await expectStatus(`/brands/${isolatedBrand.data.id}`, 200, { token: editorToken });
    await expectStatus(`/members/${invitation.data.id}`, 200, { method: 'PATCH', token: adminToken, body: { scope: [primaryBrand.id, isolatedBrand.data.id] } });
    const multiBrandEditorMe = await expectStatus('/auth/me', 200, { token: editorToken });
    assert.deepEqual(new Set(multiBrandEditorMe.data.brandIds), new Set([primaryBrand.id, isolatedBrand.data.id]), '成员必须支持同时授权多个品牌');

    const promptResult = await expectStatus('/prompts', 201, {
      method: 'POST', token: adminToken,
      body: { id: 'prompt-client-stable-id', brandId: primaryBrand.id, group: renamedGroup.data.name, text: '测试：从昆明到大理怎么安排交通？' }
    });
    const promptId = promptResult.data.prompt.id;
    assert.equal(promptId, 'prompt-client-stable-id', '创建接口应保留格式合法的客户端资源 ID');
    assert.equal(promptResult.data.task.status, 'queued');
    const promptPatched = await expectStatus(`/prompts/${promptId}`, 200, { method: 'PATCH', token: adminToken, body: { id: 'prompt-forged', text: '测试：从昆明到大理如何安排交通？' } });
    assert.equal(promptPatched.data.id, promptId, '更新接口不得通过请求体覆盖资源 ID');
    await expectStatus(`/prompt-groups/${createdGroup.data.id}`, 409, { method: 'DELETE', token: adminToken });
    await expectStatus(`/prompt-groups/${createdGroup.data.id}`, 200, { method: 'PATCH', token: adminToken, body: { name: `${groupName}-最终` } });
    const renamedPrompt = await expectStatus(`/prompts/${promptId}`, 200, { token: adminToken });
    assert.equal(renamedPrompt.data.group, `${groupName}-最终`, '重命名主题应同步提问分组');
    const completedTask = await waitFor(async () => {
      const result = await request('/tasks', { token: adminToken });
      return result.payload.data?.find((task) => task.id === promptResult.data.task.id && task.status === 'completed');
    }, 3000);
    assert.ok(completedTask, '提问采集任务应自动完成');
    const renamedRecords = await expectStatus(`/records?platform=DeepSeek&group=${encodeURIComponent(`${groupName}-最终`)}&status=completed&search=${encodeURIComponent('昆明')}`, 200, { token: adminToken });
    const originalRecord = renamedRecords.data.find((record) => record.promptId === promptId && record.status === 'completed');
    assert.ok(originalRecord, '提问完成后应生成已完成回答记录');
    assert.equal(originalRecord.taskId, promptResult.data.task.id, '首次采集记录应关联创建它的任务');
    const originalAnswer = originalRecord.answer;
    const rerun = await expectStatus(`/records/${originalRecord.id}/rerun`, 202, { method: 'POST', token: adminToken, body: {} });
    assert.notEqual(rerun.data.task.id, promptResult.data.task.id, '重跑应创建独立任务批次');
    assert.equal(rerun.data.records.length, 1, '单平台重跑只应创建一条新回答记录');
    assert.equal(rerun.data.records[0].taskId, rerun.data.task.id);
    const repeatedRerun = await expectStatus(`/records/${originalRecord.id}/rerun`, 200, { method: 'POST', token: adminToken, body: {} });
    assert.equal(repeatedRerun.data.reused, true, '同一平台运行中的重跑任务应被复用');
    assert.equal(repeatedRerun.data.task.id, rerun.data.task.id);
    const completedRerun = await waitFor(async () => {
      const result = await request('/tasks', { token: adminToken });
      return result.payload.data?.find((task) => task.id === rerun.data.task.id && task.status === 'completed');
    }, 3000);
    assert.ok(completedRerun, '重跑采集任务应自动完成');
    const history = await expectStatus(`/records?brandId=${encodeURIComponent(primaryBrand.id)}&search=${encodeURIComponent('昆明')}`, 200, { token: adminToken });
    const promptHistory = history.data.filter((record) => record.promptId === promptId && record.platform === originalRecord.platform);
    assert.equal(promptHistory.length, 2, '重跑后应同时保留旧回答和新回答');
    assert.equal(promptHistory.find((record) => record.id === originalRecord.id)?.answer, originalAnswer, '重跑不得覆盖原回答');
    await expectStatus(`/prompts/${promptId}`, 200, { method: 'PATCH', token: adminToken, body: { text: '测试：编辑后的昆明大理交通问题？' } });
    const preservedHistory = await expectStatus(`/records?brandId=${encodeURIComponent(primaryBrand.id)}&search=${encodeURIComponent('从昆明到大理')}`, 200, { token: adminToken });
    assert.ok(preservedHistory.data.some((record) => record.id === originalRecord.id && record.question === originalRecord.question), '编辑提问不得篡改已完成的回答历史');
    await expectStatus(`/prompts/${promptId}`, 200, { method: 'DELETE', token: adminToken });
    await expectStatus(`/prompt-groups/${createdGroup.data.id}`, 200, { method: 'DELETE', token: adminToken });

    const article = await expectStatus('/articles', 201, {
      method: 'POST', token: adminToken,
      body: {
        title: '测试：云南春季路线', topic: '路线规划', body: '测试文章正文', channel: '官网',
        seoTitle: '云南春季路线｜AnswerTravel', seoDescription: '测试描述', seoKeywords: '云南旅游,路线', slug: `test-${Date.now()}`,
        factSources: true, factUpdated: true, factAuthor: true, factContact: true, factPricing: true, status: '待发布',
        analysisSnapshot: { version: 1, own: { mentionRate: 50, averageRank: 2 } },
        contentBrief: { objective: '提升品牌真实提及率', proofRequired: ['公开来源网址'] },
        sourceRecordIds: ['record-analysis-source']
      }
    });
    const articleId = article.data.id;
    assert.equal(article.data.analysisSnapshot.own.mentionRate, 50, '文章必须保存生成时的品牌诊断快照');
    assert.equal(article.data.contentBrief.objective, '提升品牌真实提及率');
    assert.deepEqual(article.data.sourceRecordIds, ['record-analysis-source']);
    await expectStatus(`/articles/${articleId}/review`, 200, { method: 'POST', token: adminToken, body: { factSources: true, factUpdated: true, factAuthor: true, factContact: true, factPricing: true } });
    const publishing = await expectStatus(`/articles/${articleId}/publish`, 202, { method: 'POST', token: adminToken, body: { channel: '官网' } });
    assert.equal(publishing.data.article.status, '发布中');
    assert.equal(publishing.data.reused, false);
    const repeatedPublish = await expectStatus(`/articles/${articleId}/publish`, 202, { method: 'POST', token: adminToken, body: { channel: '官网' } });
    assert.equal(repeatedPublish.data.reused, true, '重复发布请求应复用正在执行的任务');
    assert.equal(repeatedPublish.data.task.id, publishing.data.task.id, '重复发布不能创建第二个发布任务');
    const published = await waitFor(async () => {
      const result = await request(`/articles/${articleId}`, { token: adminToken });
      return result.payload.data?.status === '已发布' ? result.payload.data : null;
    }, 3000);
    assert.ok(published, '文章发布任务应自动完成');
    assert.ok(['待收录', '已收录'].includes(published.indexStatus), '发布完成后收录状态应为待收录或已收录');
    const indexed = await waitFor(async () => {
      const result = await request(`/articles/${articleId}`, { token: adminToken });
      return result.payload.data?.indexStatus === '已收录' ? result.payload.data : null;
    }, 3000, 100);
    assert.ok(indexed, '文章应在收录截止时间后自动变为已收录');
    assert.ok(indexed.indexDueAt, '文章应记录自动收录截止时间');
    await expectStatus(`/articles/${articleId}/publish`, 409, { method: 'POST', token: adminToken, body: { channel: '官网' } });

    const queuedPrompt = await expectStatus('/prompts', 201, { method: 'POST', token: adminToken, body: { text: '测试：雨季出行需要带什么？', group: '测试安全' } });
    const tasks = await expectStatus('/tasks', 200, { token: adminToken });
    const queuedTask = tasks.data.find((task) => task.id === queuedPrompt.data.task.id);
    assert.ok(queuedTask, '应能查询新建提问任务');
    await expectStatus(`/tasks/${queuedTask.id}/cancel`, 200, { method: 'POST', token: adminToken });
    await expectStatus(`/tasks/${queuedTask.id}/retry`, 200, { method: 'POST', token: adminToken });

    const quotaBefore = await expectStatus('/collection/status', 200, { token: adminToken });
    const usedBefore = quotaBefore.data.quotas.find((item) => item.brandId === primaryBrand.id).brand.used;
    const quotaPrompt = await expectStatus('/prompts', 201, { method: 'POST', token: adminToken, body: { brandId: primaryBrand.id, text: '测试：删除后配额仍需保留？', group: '测试安全', platforms: ['DeepSeek'], frequency: 'manual' } });
    await expectStatus(`/prompts/${quotaPrompt.data.prompt.id}`, 200, { method: 'DELETE', token: adminToken });
    const quotaAfter = await expectStatus('/collection/status', 200, { token: adminToken });
    assert.equal(quotaAfter.data.quotas.find((item) => item.brandId === primaryBrand.id).brand.used, usedBefore + 1, '删除提问不得退回已经消耗的采集配额');

    const snapshot = await expectStatus('/snapshot', 200, { token: adminToken });
    assert.equal(snapshot.data.users, undefined, '公开快照不得包含账号密码数据');
    assert.equal(snapshot.data.refreshTokens, undefined, '公开快照不得包含刷新令牌数据');
    snapshot.data.workspace.team.description = '接口回归测试已写入';
    await expectStatus('/snapshot', 200, { method: 'PUT', token: adminToken, body: { data: snapshot.data } });
    const restored = await expectStatus('/workspace', 200, { token: adminToken });
    assert.equal(restored.data.team.description, '接口回归测试已写入', '快照写入后应能读取持久化内容');

    console.log('AnswerTravel API tests passed.');
  } finally {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
