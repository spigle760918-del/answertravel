const assert = require('assert/strict');
const { SourceEvidenceService, BraveSearchProvider, SourceEvidenceError } = require('./source-evidence-service');

function response(body, status = 200, contentType = 'text/html; charset=utf-8', extra = {}) {
  const headers = new Map([['content-type', contentType], ...Object.entries(extra)]);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers.get(String(name).toLowerCase()) || headers.get(name) || null },
    arrayBuffer: async () => Buffer.from(body),
    json: async () => JSON.parse(body)
  };
}

async function main() {
  const lookup = async (hostname) => ['localhost', '127.0.0.1'].includes(hostname) ? [{ address: '127.0.0.1', family: 4 }] : [{ address: '93.184.216.34', family: 4 }];
  const service = new SourceEvidenceService({
    lookup,
    maxBytes: 2000,
    timeoutMs: 100,
    fetch: async () => response('<html><head><title>山河旅行服务</title><meta name="author" content="编辑"><meta property="article:published_time" content="2026-01-01"></head><body><article>山河旅行提供 24 小时专人服务。</article></body></html>')
  });
  const fetched = await service.fetchSource({ url: 'https://example.com/guide', title: '旧标题', sourceType: 'embedded_link' });
  assert.equal(fetched.verificationStatus, 'fetched');
  assert.equal(fetched.title, '山河旅行服务');
  assert.equal(fetched.author, '编辑');
  assert.equal(fetched.brandMatch, undefined);

  await assert.rejects(() => service.fetchSource({ url: 'http://localhost/private' }), (error) => error instanceof SourceEvidenceError && error.code === 'SOURCE_URL_BLOCKED');
  const redirectService = new SourceEvidenceService({ lookup, fetch: async (url) => url.toString().includes('/start') ? response('', 302, 'text/html', { location: 'http://127.0.0.1/private' }) : response('ok', 200, 'text/plain') });
  await assert.rejects(() => redirectService.fetchSource({ url: 'https://example.com/start' }), (error) => error.code === 'SOURCE_URL_BLOCKED');

  const tooLarge = new SourceEvidenceService({ lookup, maxBytes: 3, fetch: async () => response('12345') });
  await assert.rejects(() => tooLarge.fetchSource({ url: 'https://example.com/large' }), (error) => error.code === 'SOURCE_TOO_LARGE');

  const search = new BraveSearchProvider({ apiKey: 'test-key', fetch: async () => response(JSON.stringify({ web: { results: [{ url: 'https://example.com/a', title: '候选 A', description: '摘要' }] } }), 200, 'application/json') });
  const candidates = await search.search('山河旅行', 2);
  assert.equal(candidates[0].sourceType, 'retrieval_candidate');
  assert.equal(candidates[0].verificationStatus, 'unverified');

  const record = { id: 'record-1', question: '山河旅行值得推荐吗？', sources: [{ url: 'https://example.com/model', title: '模型引用', sourceType: 'model_citation' }, { url: 'https://example.com/body', title: '正文链接', sourceType: 'embedded_link' }] };
  const enriched = await new SourceEvidenceService({ lookup, maxBytes: 10000, maxResults: 2, searchProvider: search, fetch: async () => response('<title>山河旅行与远途旅行对比</title><p>山河旅行服务更细。</p>') }).enrichRecord(record, { name: '山河旅行', aliases: [], competitors: ['远途旅行'] }, { text: record.question }, { discover: true, fetchLimit: 3 });
  assert.equal(enriched.summary.discovered, 1);
  assert.equal(record.sources.find((item) => item.sourceType === 'model_citation').sourceType, 'model_citation');
  assert.equal(record.sources.some((item) => item.sourceType === 'retrieval_candidate'), true);
  assert.equal(record.sources.every((item) => ['fetched', 'failed'].includes(item.verificationStatus)), true);

  console.log('AnswerTravel source evidence tests passed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
