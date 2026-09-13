class ProviderError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = options.code || 'PROVIDER_ERROR';
    this.status = options.status || 0;
    this.retryable = Boolean(options.retryable);
    this.retryAfterMs = Number(options.retryAfterMs || 0);
  }
}

function sourceLinks(payload, answer) {
  const sources = [];
  const seen = new Set();
  const add = (url, title = '', sourceType = 'embedded_link') => {
    if (!/^https?:\/\//i.test(url) || seen.has(url)) return;
    seen.add(url);
    sources.push({
      url,
      title: title || new URL(url).hostname,
      position: sources.length + 1,
      sourceType,
      verificationStatus: 'unverified'
    });
  };
  for (const citation of Array.isArray(payload?.citations) ? payload.citations : []) {
    if (typeof citation === 'string') add(citation, '', 'model_citation');
    else if (citation?.url) add(citation.url, citation.title, 'model_citation');
  }
  for (const match of String(answer || '').matchAll(/https?:\/\/[^\s<>()\]"'，。；、]+/g)) {
    add(match[0].replace(/[，。；、,.!?]+$/, ''), '', 'embedded_link');
  }
  return sources;
}

class DeepSeekProvider {
  constructor(options = {}) {
    this.name = 'DeepSeek';
    this.apiKey = options.apiKey || '';
    this.endpoint = (options.endpoint || 'https://api.deepseek.com/chat/completions').replace(/\/$/, '');
    this.model = options.model || 'deepseek-chat';
    this.timeoutMs = options.timeoutMs || 45_000;
    this.fetch = options.fetch || globalThis.fetch;
  }

  get configured() {
    return Boolean(this.apiKey);
  }

  async collectAnswer(input) {
    if (!this.configured) throw new ProviderError('DeepSeek API Key 未配置。', { code: 'PROVIDER_NOT_CONFIGURED' });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const startedAt = Date.now();
    let response;
    try {
      response = await this.fetch(this.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          stream: false,
          messages: [
            { role: 'system', content: `你是一名旅行决策助手。请使用${input.language || '中文'}回答，并优先给出游客出发前可验证、可执行的信息。地区：${input.region || '中国'}。` },
            { role: 'user', content: input.prompt }
          ]
        }),
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw new ProviderError('DeepSeek 请求超时。', { code: 'PROVIDER_TIMEOUT', retryable: true });
      throw new ProviderError(`DeepSeek 网络请求失败：${error.message}`, { code: 'PROVIDER_NETWORK_ERROR', retryable: true });
    } finally {
      clearTimeout(timeout);
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error?.message || `DeepSeek 返回 HTTP ${response.status}`;
      const retryAfter = response.headers?.get?.('retry-after') || '';
      const seconds = Number(retryAfter);
      const retryAfterMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : Math.max(0, Date.parse(retryAfter) - Date.now()) || 0;
      throw new ProviderError(message, { code: payload?.error?.code || 'PROVIDER_HTTP_ERROR', status: response.status, retryable: response.status === 408 || response.status === 429 || response.status >= 500, retryAfterMs });
    }
    const answer = payload?.choices?.[0]?.message?.content;
    if (!answer) throw new ProviderError('DeepSeek 未返回有效回答。', { code: 'PROVIDER_EMPTY_RESPONSE', retryable: true });
    return {
      platform: this.name,
      model: payload.model || this.model,
      answer,
      sources: sourceLinks(payload, answer),
      latencyMs: Date.now() - startedAt,
      rawPayload: payload,
      usage: payload.usage || null
    };
  }
}

module.exports = { DeepSeekProvider, ProviderError, sourceLinks };
