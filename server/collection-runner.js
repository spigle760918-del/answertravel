const { evaluateAnswer } = require('./answer-evaluator');
const { createProviderRegistry } = require('./providers');

function createCollectionRunner({ config, getDb, persist, intervalMs = 500, providerOptions = {}, sourceEvidenceService = null }) {
  const registry = createProviderRegistry(config, providerOptions);
  let timer = null;
  let active = false;

  function owns(task) {
    if (!task || task.type !== '回答采集' || !['queued', 'running'].includes(task.status)) return false;
    if (task.status === 'queued' && task.nextAttemptAt && Date.parse(task.nextAttemptAt) > Date.now()) return false;
    if (task.platform && task.platform !== '全平台') return Boolean(registry.get(task.platform)?.configured);
    const prompt = getDb().prompts.find((entry) => entry.id === task.promptId);
    return (prompt?.platforms || []).some((platform) => registry.get(platform)?.configured);
  }

  async function runNext() {
    if (active) return false;
    const db = getDb();
    const task = db.tasks.find((entry) => entry.status === 'queued' && owns(entry));
    if (!task) return false;
    const prompt = db.prompts.find((entry) => entry.id === task.promptId);
    if (!prompt) {
      task.status = 'error'; task.error = '关联的监控问题不存在。'; task.completedAt = new Date().toISOString();
      await persist({ task, records: [] });
      return true;
    }
    const requestedPlatforms = task.platform && task.platform !== '全平台' ? [task.platform] : (prompt.platforms || []);
    const batchRecords = db.records.filter((record) => record.taskId === task.id && requestedPlatforms.includes(record.platform));
    let targets = db.records.filter((record) => record.taskId === task.id && record.status !== 'completed' && requestedPlatforms.includes(record.platform) && registry.get(record.platform)?.configured);
    if (!targets.length) {
      targets = db.records.filter((record) => record.promptId === prompt.id && !record.taskId && record.status !== 'completed' && requestedPlatforms.includes(record.platform) && registry.get(record.platform)?.configured);
    }
    if (!targets.length) return false;
    active = true;
    task.status = 'running'; task.progress = 10; task.startedAt = new Date().toISOString(); task.error = ''; task.nextAttemptAt = '';
    task.attempt = Number(task.attempt || 0) + 1;
    task.maxAttempts = Number(task.maxAttempts || config.collectionMaxAttempts || 3);
    await persist({ task, records: targets });
    try {
      const brand = db.brands.find((entry) => entry.id === (prompt.brandId || task.brandId)) || db.brands[0] || {};
      let completed = 0;
      for (const record of targets) {
        if (task.status === 'cancelled') break;
        const provider = registry.get(record.platform);
        const result = await provider.collectAnswer({ prompt: prompt.text, language: prompt.language || brand.language || 'zh-CN', region: prompt.region || brand.region || '中国' });
        const evaluation = evaluateAnswer(result.answer, brand, result.sources);
        Object.assign(record, {
          answer: result.answer,
          sources: result.sources,
          mentioned: evaluation.mentioned,
          rank: evaluation.firstRank,
          score: evaluation.exposureScore,
          sentimentLabel: evaluation.sentimentLabel,
          sentimentEvidence: evaluation.sentimentEvidence,
          status: 'completed',
          modelVersion: result.model,
          latencyMs: result.latencyMs,
          rawPayload: result.rawPayload,
          usage: result.usage,
          collectionMode: 'live',
          date: new Date().toISOString().slice(0, 10),
          time: new Date().toISOString(),
          taskId: task.id
        });
        if (sourceEvidenceService) {
          const evidence = await sourceEvidenceService.enrichRecord(record, brand, prompt, { discover: config.sourceAutoDiscover !== false });
          record.sourceEvidence = evidence.summary;
        }
        completed += 1;
        task.progress = 10 + Math.round((completed / targets.length) * 85);
      }
      if (task.status !== 'cancelled') {
        const unavailable = batchRecords.filter((record) => !registry.get(record.platform)?.configured && record.status !== 'completed');
        unavailable.forEach((record) => Object.assign(record, {
          status: 'error', answer: `采集失败：${record.platform} 尚未配置真实采集接口。`, error: '平台未配置',
          errorCode: 'PROVIDER_NOT_CONFIGURED', collectionMode: 'unavailable', time: new Date().toISOString()
        }));
        task.status = 'completed'; task.progress = 100; task.completedAt = new Date().toISOString();
        task.provider = targets.map((record) => record.platform).join(', ');
        task.collectionMode = 'live';
        if (unavailable.length) task.warning = `${unavailable.map((record) => record.platform).join('、')} 尚未配置，相关回答已标记为不可用。`;
      }
    } catch (error) {
      const retryable = Boolean(error.retryable);
      const canRetry = retryable && task.attempt < task.maxAttempts && task.status !== 'cancelled';
      task.error = error.message; task.errorCode = error.code || 'PROVIDER_ERROR'; task.retryable = retryable;
      if (canRetry) {
        const base = Number(config.collectionRetryBaseMs || 5000);
        const maximum = Number(config.collectionRetryMaxMs || 300000);
        const retryAfterMs = Number(error.retryAfterMs || 0);
        const delay = Math.max(retryAfterMs, Math.min(maximum, base * (2 ** Math.max(0, task.attempt - 1))));
        task.status = 'queued'; task.progress = 0; task.nextAttemptAt = new Date(Date.now() + delay).toISOString(); task.completedAt = '';
        for (const record of targets.filter((entry) => entry.status !== 'completed')) {
          record.status = 'queued'; record.answer = `采集暂时失败，将自动重试：${error.message}`; record.error = error.message; record.time = task.nextAttemptAt; record.taskId = task.id;
        }
      } else {
        task.status = 'error'; task.progress = 100; task.completedAt = new Date().toISOString(); task.nextAttemptAt = '';
        for (const record of batchRecords.filter((entry) => entry.status !== 'completed')) {
          record.status = 'error'; record.answer = `采集失败：${error.message}`; record.error = error.message; record.time = new Date().toISOString(); record.taskId = task.id;
        }
      }
    } finally {
      await persist({ task, records: [...new Map([...targets, ...batchRecords].map((record) => [record.id, record])).values()] });
      active = false;
    }
    return true;
  }

  return {
    owns,
    runNext,
    status: registry.status,
    start() { if (!timer) { timer = setInterval(() => runNext().catch((error) => console.error('[answertravel-provider] runner failed', error)), intervalMs); timer.unref(); } },
    stop() { if (timer) clearInterval(timer); timer = null; }
  };
}

module.exports = { createCollectionRunner };
