const assert = require('assert/strict');
const { analyzeWorkspace, modalityOf, structureSignals } = require('../brand-intelligence');

const state = {
  workspace: { brandId: 'brand-a' },
  brands: [{ id: 'brand-a', name: '山河旅行', aliases: ['山河'], website: 'https://shanhe.example', competitors: ['远途旅行'] }],
  prompts: [
    { id: 'prompt-1', brandId: 'brand-a', text: '南京旅行社哪家值得推荐？' },
    { id: 'prompt-2', brandId: 'brand-a', text: '亲子游应该怎么选？' }
  ],
  records: [
    { id: 'record-1', brandId: 'brand-a', promptId: 'prompt-1', status: 'completed', platform: 'DeepSeek', answer: '1. 山河旅行值得推荐，提供24小时专人负责和退改保障。\n2. 服务包含导游、接送与保险。', mentioned: true, rank: 1, collectionMode: 'live', sources: [{ title: '山河服务承诺', url: 'https://shanhe.example/service' }] },
    { id: 'record-2', brandId: 'brand-a', promptId: 'prompt-2', status: 'completed', platform: 'Kimi', collectionMode: 'live', answer: '山河旅行提供亲子行程，整体表现一般。', mentioned: true, rank: 2, sources: [{ title: '山河服务承诺', url: 'https://shanhe.example/service' }] },
    { id: 'record-3', brandId: 'brand-a', promptId: 'prompt-1', status: 'completed', platform: '豆包', collectionMode: 'live', answer: '远途旅行是首选，第三方测评认为其退款承诺和接驳服务更清楚。', mentioned: false, sources: [{ title: '远途旅行测评视频', url: 'https://video.example/review.mp4' }] },
    { id: 'record-4', brandId: 'brand-a', promptId: 'prompt-2', status: 'completed', platform: '元宝', collectionMode: 'live', answer: '可以综合比较价格和路线。', mentioned: false, sources: [] },
    { id: 'record-5', brandId: 'brand-a', promptId: 'prompt-2', status: 'completed', platform: '模拟器', collectionMode: 'simulated', answer: '山河旅行值得推荐。', mentioned: true, rank: 1, sources: [] }
  ]
};

const result = analyzeWorkspace(state, 'brand-a');
assert.equal(result.own.answerCount, 4);
assert.equal(result.sample.allCompletedAnswerCount, 5);
assert.equal(result.sample.excludedNonLiveCount, 1);
assert.equal(result.sample.mode, 'live-only');
assert.equal(result.own.mentionCount, 2);
assert.equal(result.own.mentionRate, 50);
assert.equal(result.own.averageRank, 1.5);
assert.equal(result.own.sentiment.distribution['值得推荐'], 1);
assert.equal(result.own.sources.citationCount, 2);
assert.equal(result.own.sources.uniqueUrlCount, 1);
assert.equal(result.own.commitments.evidence.includes('24小时'), true);
assert.equal(result.own.serviceGranularity.evidence.includes('保险'), true);
assert.equal(result.competitors[0].metrics.mentionRate, 25);
assert.equal(result.competitors[0].metrics.sources.modalities['视频'], 1);
assert.equal(result.contentBrief.proofRequired.includes('公开可访问的来源网址'), true);
assert.equal(result.methodology.includes('启发式标签'), true);
assert.equal(modalityOf({ url: 'https://example.com/report.pdf' }), '报告');
assert.equal(structureSignals('1. 结论\n2. 对比维度\n价格 300 元').includes('量化信息'), true);

console.log('AnswerTravel brand optimization intelligence tests passed.');
