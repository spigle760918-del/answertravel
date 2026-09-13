const assert = require('assert/strict');
const { DeepSeekProvider, ProviderError, sourceLinks } = require('./providers/deepseek-provider');
const { evaluateAnswer } = require('./answer-evaluator');
const { createCollectionRunner } = require('./collection-runner');
const { createCollectionScheduler } = require('./collection-scheduler');
const { nextCollectionAt, quotaStatus, assertCollectionQuota } = require('./collection-policy');

async function main() {
  const requests = [];
  const mockFetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ model: 'deepseek-chat-test', choices: [{ message: { content: '云南文旅适合首次到访者。参考 https://travel.example/guide。贵州文旅也可作为对比。' } }], usage: { total_tokens: 42 } }) };
  };
  const provider = new DeepSeekProvider({ apiKey: 'test-key-not-sent', fetch: mockFetch });
  const result = await provider.collectAnswer({ prompt: '第一次去云南如何规划？', language: '中文', region: '云南' });
  assert.equal(result.model, 'deepseek-chat-test');
  assert.equal(result.sources[0].url, 'https://travel.example/guide');
  assert.equal(result.sources[0].sourceType, 'embedded_link', '回答正文 URL 不能冒充模型实际引用');
  const cited = sourceLinks({ citations: [{ url: 'https://official.example/source', title: '官方来源' }] }, '正文链接 https://body.example/link');
  assert.equal(cited[0].sourceType, 'model_citation');
  assert.equal(cited[1].sourceType, 'embedded_link');
  assert.equal(cited[0].verificationStatus, 'unverified');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer test-key-not-sent');
  const requestBody = JSON.parse(requests[0].options.body);
  assert.equal(requestBody.messages[1].content, '第一次去云南如何规划？');

  const evaluation = evaluateAnswer(result.answer, { name: '云南文旅', aliases: ['云南旅游'], competitors: ['贵州文旅'] }, result.sources);
  assert.equal(evaluation.mentioned, true);
  assert.equal(evaluation.firstRank, 1);
  assert.ok(evaluation.exposureScore > 80);
  assert.deepEqual(sourceLinks({}, '无链接'), []);
  await assert.rejects(() => new DeepSeekProvider().collectAnswer({ prompt: 'test' }), (error) => error instanceof ProviderError && error.code === 'PROVIDER_NOT_CONFIGURED');

  const db = {
    workspace: { brandId: 'brand-1' },
    brands: [{ id: 'brand-1', name: '云南文旅', aliases: [], competitors: [] }],
    prompts: [{ id: 'prompt-1', text: '第一次去云南如何规划？', platforms: ['DeepSeek'] }],
    records: [
      { id: 'record-old', promptId: 'prompt-1', taskId: 'task-old', platform: 'DeepSeek', status: 'completed', answer: '历史回答' },
      { id: 'record-1', promptId: 'prompt-1', taskId: 'task-1', platform: 'DeepSeek', status: 'queued' }
    ],
    tasks: [{ id: 'task-1', type: '回答采集', promptId: 'prompt-1', platform: '全平台', status: 'queued', progress: 0 }]
  };
  let persists = 0;
  const runner = createCollectionRunner({
    config: { deepseekApiKey: 'test-key', deepseekEndpoint: 'https://api.deepseek.test/chat', deepseekModel: 'deepseek-chat', providerTimeoutMs: 1000 },
    getDb: () => db,
    persist: async () => { persists += 1; },
    providerOptions: { fetch: mockFetch }
  });
  assert.equal(runner.owns(db.tasks[0]), true);
  await runner.runNext();
  assert.equal(db.tasks[0].status, 'completed');
  assert.equal(db.tasks[0].collectionMode, 'live');
  assert.equal(db.records[0].answer, '历史回答', '采集执行器不得覆盖其他任务的历史回答');
  assert.equal(db.records[1].status, 'completed');
  assert.equal(db.records[1].collectionMode, 'live');
  assert.equal(db.records[1].mentioned, true);
  assert.equal(db.records[1].taskId, 'task-1');
  assert.equal(persists, 2);

  let retryCalls = 0;
  const retryFetch = async () => {
    retryCalls += 1;
    if (retryCalls === 1) return { ok: false, status: 429, headers: { get: () => '1' }, json: async () => ({ error: { message: 'rate limited', code: 'RATE_LIMITED' } }) };
    return { ok: true, status: 200, json: async () => ({ model: 'deepseek-chat-test', choices: [{ message: { content: '云南文旅适合首次到访者。' } }], usage: { total_tokens: 20 } }) };
  };
  const retryDb = {
    workspace: { brandId: 'brand-1' }, brands: db.brands, prompts: db.prompts,
    records: [{ id: 'record-retry', promptId: 'prompt-1', taskId: 'task-retry', platform: 'DeepSeek', status: 'queued' }],
    tasks: [{ id: 'task-retry', type: '回答采集', promptId: 'prompt-1', platform: 'DeepSeek', status: 'queued', progress: 0, attempt: 0, maxAttempts: 3 }]
  };
  const retryRunner = createCollectionRunner({
    config: { deepseekApiKey: 'test-key', deepseekEndpoint: 'https://api.deepseek.test/chat', deepseekModel: 'deepseek-chat', providerTimeoutMs: 1000, collectionRetryBaseMs: 100, collectionRetryMaxMs: 2000, collectionMaxAttempts: 3 },
    getDb: () => retryDb, persist: async () => {}, providerOptions: { fetch: retryFetch }
  });
  await retryRunner.runNext();
  assert.equal(retryDb.tasks[0].status, 'queued', '429 应进入自动退避而不是立即终止');
  assert.equal(retryDb.tasks[0].attempt, 1);
  assert.ok(Date.parse(retryDb.tasks[0].nextAttemptAt) > Date.now());
  assert.equal(retryRunner.owns(retryDb.tasks[0]), false, '退避时间未到时不能再次请求平台');
  retryDb.tasks[0].nextAttemptAt = new Date(Date.now() - 1).toISOString();
  await retryRunner.runNext();
  assert.equal(retryDb.tasks[0].status, 'completed');
  assert.equal(retryDb.tasks[0].attempt, 2);
  assert.equal(retryCalls, 2);

  const scheduledPrompt = { id: 'prompt-scheduled', brandId: 'brand-1', text: '定时问题', status: 'active', frequency: 'daily', nextCollectionAt: '2026-09-09T00:00:00.000Z', platforms: ['DeepSeek'] };
  const schedulerDb = { prompts: [scheduledPrompt] };
  const scheduledTasks = [];
  let scheduledPersists = 0;
  const scheduler = createCollectionScheduler({
    getDb: () => schedulerDb,
    createTask: (prompt, options) => { scheduledTasks.push(options); return { task: { id: 'scheduled-task' }, records: [{ id: 'scheduled-record' }] }; },
    persist: async () => { scheduledPersists += 1; },
    now: () => new Date('2026-09-10T00:00:00.000Z')
  });
  await scheduler.tick();
  assert.equal(scheduledTasks.length, 1, '到期的每日提问应生成一个采集任务');
  assert.equal(scheduledTasks[0].reason, 'scheduled');
  assert.equal(scheduledPrompt.lastScheduledAt, '2026-09-10T00:00:00.000Z');
  assert.equal(scheduledPrompt.nextCollectionAt, '2026-09-11T00:00:00.000Z');
  await scheduler.tick();
  assert.equal(scheduledTasks.length, 1, '未到下次时间不得重复调度');
  assert.equal(scheduledPersists, 1);
  assert.equal(nextCollectionAt('manual'), '');

  const quotaDb = {
    workspace: {}, brands: [{ id: 'brand-1' }],
    tasks: [{ id: 'quota-task', type: '回答采集', brandId: 'brand-1', createdAt: new Date().toISOString() }],
    records: [{ id: 'quota-record', brandId: 'brand-1', taskId: 'quota-task' }]
  };
  const quotaConfig = { collectionTeamMonthlyQuota: 2, collectionBrandMonthlyQuota: 1 };
  const quota = quotaStatus(quotaDb, quotaConfig, 'brand-1');
  assert.equal(quota.team.remaining, 1);
  assert.equal(quota.brand.remaining, 0);
  assert.throws(() => assertCollectionQuota(quotaDb, quotaConfig, 'brand-1', 1), (error) => error.code === 'BRAND_COLLECTION_QUOTA_EXCEEDED' && error.statusCode === 429);

  console.log('AnswerTravel provider tests passed.');
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
