const dns = require('dns/promises');

const SOURCE_TYPES = new Set(['model_citation', 'embedded_link', 'retrieval_candidate', 'manual_or_owned']);
const TYPE_PRIORITY = { retrieval_candidate: 1, embedded_link: 2, model_citation: 3, manual_or_owned: 4 };

function text(value, fallback = '') { return String(value == null ? fallback : value).trim(); }
function asArray(value) { return Array.isArray(value) ? value : []; }
function decodeHtml(value) {
  return text(value).replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}
function htmlMeta(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const first = new RegExp(`<meta[^>]+(?:name|property)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i').exec(html);
  const reverse = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${escaped}["'][^>]*>`, 'i').exec(html);
  return decodeHtml(first?.[1] || reverse?.[1] || '');
}
function htmlText(html) {
  return decodeHtml(text(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ').replace(/<!--([\s\S]*?)-->/g, ' ')
    .replace(/<\/(?:p|div|section|article|li|h[1-6]|tr|br)>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}
function modalityFor(url, contentType = '') {
  const value = `${url} ${contentType}`.toLowerCase();
  if (/video|\.(mp4|mov|avi|m3u8)(?:$|[?#])/.test(value)) return '视频';
  if (/image|\.(jpe?g|png|webp|gif)(?:$|[?#])/.test(value)) return '图片/图集';
  if (/audio|podcast|\.(mp3|wav|m4a)(?:$|[?#])/.test(value)) return '音频';
  if (/application\/pdf|\.pdf(?:$|[?#])/.test(value)) return '报告';
  return '图文';
}
function isBlockedAddress(address) {
  const value = text(address).toLowerCase();
  if (!value) return true;
  if (value === '::1' || value === '::' || value.startsWith('fe80:') || value.startsWith('fc') || value.startsWith('fd')) return true;
  const parts = value.split('.').map(Number);
  if (parts.length !== 4 || parts.some((item) => !Number.isInteger(item))) return false;
  return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || parts[0] >= 224 ||
    (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127);
}
function canonicalUrl(value) {
  const url = new URL(text(value));
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅支持 HTTP/HTTPS 信源。');
  url.hash = '';
  return url.toString();
}

class SourceEvidenceError extends Error {
  constructor(message, code = 'SOURCE_EVIDENCE_ERROR') { super(message); this.name = 'SourceEvidenceError'; this.code = code; }
}

class BraveSearchProvider {
  constructor(options = {}) {
    this.apiKey = text(options.apiKey);
    this.endpoint = text(options.endpoint, 'https://api.search.brave.com/res/v1/web/search');
    this.fetch = options.fetch || globalThis.fetch;
  }
  get configured() { return Boolean(this.apiKey); }
  async search(query, limit = 5) {
    if (!this.configured) return [];
    const url = new URL(this.endpoint);
    url.searchParams.set('q', text(query));
    url.searchParams.set('count', String(Math.min(10, Math.max(1, Number(limit) || 5))));
    url.searchParams.set('search_lang', 'zh-hans');
    const response = await this.fetch(url, { headers: { Accept: 'application/json', 'X-Subscription-Token': this.apiKey } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new SourceEvidenceError(payload?.message || `信源检索返回 HTTP ${response.status}`, 'SOURCE_SEARCH_FAILED');
    return asArray(payload?.web?.results).map((item, index) => ({
      url: item.url, title: text(item.title), content: text(item.description), position: index + 1,
      sourceType: 'retrieval_candidate', verificationStatus: 'unverified', rawPayload: { age: item.age || '', language: item.language || '' }
    })).filter((item) => /^https?:\/\//i.test(text(item.url)));
  }
}

class SourceEvidenceService {
  constructor(options = {}) {
    this.fetch = options.fetch || globalThis.fetch;
    this.lookup = options.lookup || dns.lookup;
    this.timeoutMs = Number(options.timeoutMs || 12_000);
    this.maxBytes = Number(options.maxBytes || 1_500_000);
    this.maxResults = Number(options.maxResults || 5);
    this.searchProvider = options.searchProvider || new BraveSearchProvider(options.search || {});
  }
  status() {
    return { provider: 'Brave Search', configured: this.searchProvider.configured, maxResults: this.maxResults, fetchEnabled: true };
  }
  async assertPublicUrl(rawUrl) {
    const url = new URL(canonicalUrl(rawUrl));
    if (['localhost', 'localhost.localdomain'].includes(url.hostname.toLowerCase())) throw new SourceEvidenceError('禁止抓取本机地址。', 'SOURCE_URL_BLOCKED');
    const addresses = await this.lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some((item) => isBlockedAddress(item.address))) throw new SourceEvidenceError('禁止抓取内网或保留地址。', 'SOURCE_URL_BLOCKED');
    return url;
  }
  async readLimited(response) {
    const declared = Number(response.headers?.get?.('content-length') || 0);
    if (declared > this.maxBytes) throw new SourceEvidenceError('信源正文超过大小限制。', 'SOURCE_TOO_LARGE');
    if (!response.body?.getReader) {
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > this.maxBytes) throw new SourceEvidenceError('信源正文超过大小限制。', 'SOURCE_TOO_LARGE');
      return body.toString('utf8');
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > this.maxBytes) { await reader.cancel(); throw new SourceEvidenceError('信源正文超过大小限制。', 'SOURCE_TOO_LARGE'); }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  async fetchSource(source) {
    let current = await this.assertPublicUrl(source.url);
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let response;
      try { response = await this.fetch(current, { redirect: 'manual', signal: controller.signal, headers: { Accept: 'text/html,application/xhtml+xml,application/pdf;q=0.8,*/*;q=0.2', 'User-Agent': 'AnswerTravelEvidenceBot/1.0' } }); }
      catch (error) { throw new SourceEvidenceError(error?.name === 'AbortError' ? '信源抓取超时。' : `信源抓取失败：${error.message}`, error?.name === 'AbortError' ? 'SOURCE_FETCH_TIMEOUT' : 'SOURCE_FETCH_FAILED'); }
      finally { clearTimeout(timer); }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers?.get?.('location');
        if (!location || redirects === 3) throw new SourceEvidenceError('信源重定向无效或次数过多。', 'SOURCE_REDIRECT_FAILED');
        current = await this.assertPublicUrl(new URL(location, current).toString());
        continue;
      }
      if (!response.ok) throw new SourceEvidenceError(`信源返回 HTTP ${response.status}`, 'SOURCE_FETCH_FAILED');
      const contentType = text(response.headers?.get?.('content-type')).toLowerCase();
      if (!/text\/html|application\/xhtml\+xml|text\/plain|application\/pdf/.test(contentType)) throw new SourceEvidenceError(`暂不支持该内容类型：${contentType || '未知'}`, 'SOURCE_CONTENT_TYPE_UNSUPPORTED');
      const raw = await this.readLimited(response);
      const isHtml = /html|xhtml/.test(contentType);
      const title = isHtml ? decodeHtml(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(raw)?.[1] || '') : '';
      return Object.assign({}, source, {
        url: current.toString(), domain: current.hostname.replace(/^www\./i, ''), title: title || source.title || current.hostname,
        content: isHtml ? htmlText(raw).slice(0, 120_000) : (/pdf/.test(contentType) ? '' : raw.slice(0, 120_000)),
        author: isHtml ? htmlMeta(raw, 'author') : '',
        publishedAt: isHtml ? htmlMeta(raw, 'article:published_time') || htmlMeta(raw, 'date') : '',
        modality: modalityFor(current.toString(), contentType), verificationStatus: 'fetched', fetchedAt: new Date().toISOString(), errorMessage: ''
      });
    }
    throw new SourceEvidenceError('信源抓取失败。', 'SOURCE_FETCH_FAILED');
  }
  classify(source, brand) {
    const haystack = `${source.title || ''} ${source.content || ''}`.toLowerCase();
    const names = [brand?.name, ...asArray(brand?.aliases)].map((item) => text(item).toLowerCase()).filter(Boolean);
    const competitors = asArray(brand?.competitors).map((item) => text(typeof item === 'string' ? item : item?.name)).filter(Boolean);
    return Object.assign({}, source, {
      brandMatch: names.some((name) => haystack.includes(name)),
      competitorMatches: competitors.filter((name) => haystack.includes(name.toLowerCase()))
    });
  }
  normalize(source, index = 0) {
    const raw = Array.isArray(source) ? { title: source[0], url: source[1] } : source || {};
    return Object.assign({}, raw, {
      url: canonicalUrl(raw.url), title: text(raw.title), position: Number(raw.position) || index + 1,
      sourceType: SOURCE_TYPES.has(raw.sourceType) ? raw.sourceType : 'model_citation',
      verificationStatus: ['unverified', 'fetched', 'failed'].includes(raw.verificationStatus) ? raw.verificationStatus : 'unverified'
    });
  }
  merge(sources) {
    const merged = new Map();
    asArray(sources).forEach((raw, index) => {
      let source;
      try { source = this.normalize(raw, index); } catch { return; }
      const current = merged.get(source.url);
      if (!current) merged.set(source.url, source);
      else merged.set(source.url, TYPE_PRIORITY[source.sourceType] > TYPE_PRIORITY[current.sourceType] ? Object.assign({}, current, source) : Object.assign({}, source, current));
    });
    return [...merged.values()].map((source, index) => Object.assign(source, { position: index + 1 }));
  }
  async enrichRecord(record, brand, prompt, options = {}) {
    const existing = this.merge(record.sources);
    let discovered = [];
    let searchError = '';
    if (options.discover !== false && this.searchProvider.configured) {
      try { discovered = await this.searchProvider.search(`${text(prompt?.text || record.question)} ${text(brand?.name)}`, options.limit || this.maxResults); }
      catch (error) { searchError = error.message; }
    }
    const sources = this.merge([...existing, ...discovered]);
    const maximum = Math.min(12, Math.max(1, Number(options.fetchLimit) || this.maxResults));
    let fetched = 0;
    let failed = 0;
    for (let index = 0; index < sources.length && fetched + failed < maximum; index += 1) {
      if (sources[index].verificationStatus === 'fetched') continue;
      try { sources[index] = this.classify(await this.fetchSource(sources[index]), brand); fetched += 1; }
      catch (error) { sources[index] = Object.assign({}, sources[index], { verificationStatus: 'failed', fetchedAt: new Date().toISOString(), errorMessage: error.message, errorCode: error.code || 'SOURCE_FETCH_FAILED' }); failed += 1; }
    }
    record.sources = sources;
    record.sourceEvidence = { searched: this.searchProvider.configured && options.discover !== false, discovered: discovered.length, fetched, failed, searchError, updatedAt: new Date().toISOString() };
    return { record, summary: record.sourceEvidence };
  }
}

function createSourceEvidenceService(config, options = {}) {
  return new SourceEvidenceService(Object.assign({}, options, {
    timeoutMs: config.sourceFetchTimeoutMs, maxBytes: config.sourceFetchMaxBytes, maxResults: config.sourceSearchMaxResults,
    searchProvider: options.searchProvider || new BraveSearchProvider({ apiKey: config.braveSearchApiKey, endpoint: config.braveSearchEndpoint, fetch: options.searchFetch })
  }));
}

module.exports = { SourceEvidenceService, SourceEvidenceError, BraveSearchProvider, createSourceEvidenceService, canonicalUrl, htmlText, isBlockedAddress };
