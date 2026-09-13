(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.answerTravelBrandIntelligence = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const POSITIVE = ['值得推荐', '强烈推荐', '推荐', '首选', '优选', '可靠', '靠谱', '专业', '放心', '优质', '领先', '贴心', '满意', '好评'];
  const NEGATIVE = ['不建议', '不推荐', '谨慎', '投诉', '风险', '较差', '失望', '问题较多', '争议', '避坑'];
  const COMMITMENTS = ['承诺', '保障', '保证', '赔付', '退款', '退改', '无理由', '不满意', '先行赔付', '24小时', '全天候', '专人负责', '响应时限'];
  const SERVICE_DETAILS = ['接送', '接驳', '导游', '领队', '行程', '住宿', '酒店', '用车', '保险', '餐食', '门票', '签证', '退改', '客服', '应急', '老人', '儿童', '亲子', '无障碍'];
  const ROLE_PATTERNS = [
    ['官方', /官方|文旅局|政府|协会/], ['媒体', /媒体|记者|编辑|报道/], ['游客', /游客|用户|消费者|客户/],
    ['达人', /达人|博主|旅行家|测评人/], ['专家', /专家|顾问|从业者|导游/], ['第三方', /第三方|认证|评测机构|平台评分/]
  ];

  function text(value) { return String(value == null ? '' : value).trim(); }
  function list(value) { return Array.isArray(value) ? value : []; }
  function round(value, digits = 1) {
    const factor = 10 ** digits;
    return Math.round((Number(value) || 0) * factor) / factor;
  }
  function normalize(value) { return text(value).toLocaleLowerCase(); }
  function includesName(content, names) { return names.some((name) => name && content.includes(name)); }
  function competitorName(value) { return text(typeof value === 'string' ? value : value?.name); }

  function sourceData(source) {
    if (Array.isArray(source)) return { title: text(source[0]), url: text(source[1]), content: text(source[2]) };
    return { title: text(source?.title || source?.domain), url: text(source?.url), content: text(source?.content || source?.contentText) };
  }

  function domainOf(url) {
    try { return new URL(url).hostname.replace(/^www\./i, ''); } catch { return ''; }
  }

  function modalityOf(source) {
    const value = normalize(`${source.url} ${source.title}`);
    if (/\.(mp4|mov|avi|m3u8)(?:$|[?#])|video|bilibili|douyin|youtube|v\.qq/.test(value)) return '视频';
    if (/\.(jpg|jpeg|png|webp|gif)(?:$|[?#])|image|photo|gallery|图片|图集/.test(value)) return '图片/图集';
    if (/xiaohongshu|weibo|weixin|公众号|小红书|微博/.test(value)) return '社交内容';
    if (/podcast|audio|音频|播客/.test(value)) return '音频';
    if (/pdf|报告|白皮书|研究/.test(value)) return '报告';
    return '图文';
  }

  function findTerms(content, terms) {
    return terms.filter((term) => content.includes(normalize(term)));
  }

  function structureSignals(content) {
    const raw = text(content);
    const signals = [];
    if (/(^|\n)#{1,4}\s|(^|\n)[一二三四五六七八九十]+[、.．]/m.test(raw)) signals.push('分层标题');
    if (/(^|\n)\s*(?:[-*•]|\d+[.)、])\s+/m.test(raw)) signals.push('清单/步骤');
    if (/对比|相比|优缺点|适合.+不适合|vs\.?/i.test(raw)) signals.push('对比框架');
    if (/\d+(?:\.\d+)?\s*%|\d+\s*元|\d+\s*小时|\d+\s*分钟|\d+\s*天|数据|样本/.test(raw)) signals.push('量化信息');
    if (/标准|维度|依据|认证|来源|参考/.test(raw)) signals.push('评价依据');
    if (/常见问题|问：|答：|FAQ/i.test(raw)) signals.push('问答结构');
    return signals;
  }

  function sentimentFor(content, names) {
    const normalized = normalize(content);
    if (!includesName(normalized, names)) return { label: '未提及', positive: [], negative: [] };
    const positive = findTerms(normalized, POSITIVE);
    const negative = findTerms(normalized, NEGATIVE);
    const label = negative.length > positive.length ? '不建议/谨慎' : positive.length > negative.length ? '值得推荐' : '一般/中性';
    return { label, positive, negative };
  }

  function rankFor(content, targetNames, allEntities, storedRank) {
    const explicit = Number(storedRank);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const normalized = normalize(content);
    const positions = allEntities.map((entity) => ({
      name: entity.name,
      target: entity.target,
      position: entity.names.map((name) => normalized.indexOf(name)).filter((value) => value >= 0).sort((a, b) => a - b)[0]
    })).filter((item) => Number.isFinite(item.position)).sort((a, b) => a.position - b.position);
    const index = positions.findIndex((item) => item.target);
    return index >= 0 ? index + 1 : null;
  }

  function evidenceMetrics(records, names, entities, useStoredRank) {
    const completed = records.filter((record) => record.status === 'completed' && text(record.answer));
    const mentionedRecords = [];
    const sentiments = { '值得推荐': 0, '一般/中性': 0, '不建议/谨慎': 0 };
    const sentimentEvidence = new Set();
    const ranks = [];
    const platforms = new Set();
    const sourceMap = new Map();
    const sourceTypes = {};
    const verifiedSourceMap = new Map();
    const modalities = {};
    const roles = new Set();
    const commitments = new Set();
    const serviceDetails = new Set();
    const structures = new Set();

    completed.forEach((record) => {
      const content = normalize(record.answer);
      const mentioned = includesName(content, names);
      if (!mentioned) return;
      mentionedRecords.push(record);
      platforms.add(text(record.platform) || '未知平台');
      const sentiment = sentimentFor(record.answer, names);
      sentiments[sentiment.label] = (sentiments[sentiment.label] || 0) + 1;
      [...sentiment.positive, ...sentiment.negative].forEach((term) => sentimentEvidence.add(term));
      const rank = rankFor(record.answer, names, entities, useStoredRank ? record.rank : null);
      if (rank) ranks.push(rank);
      findTerms(content, COMMITMENTS).forEach((term) => commitments.add(term));
      findTerms(content, SERVICE_DETAILS).forEach((term) => serviceDetails.add(term));
      ROLE_PATTERNS.forEach(([label, pattern]) => { if (pattern.test(record.answer)) roles.add(label); });
      structureSignals(record.answer).forEach((signal) => structures.add(signal));
      list(record.sources).forEach((rawSource) => {
        const source = sourceData(rawSource);
        const key = source.url || source.title;
        if (!key) return;
        const modality = modalityOf(source);
        const sourceType = text(rawSource?.sourceType || (Array.isArray(rawSource) ? 'model_citation' : 'embedded_link'));
        sourceTypes[sourceType] = (sourceTypes[sourceType] || 0) + 1;
        modalities[modality] = (modalities[modality] || 0) + 1;
        const current = sourceMap.get(key) || { url: source.url, title: source.title || domainOf(source.url) || '未命名信源', domain: domainOf(source.url), modality, count: 0, structure: '待抓取正文', sourceType, verificationStatus: text(rawSource?.verificationStatus, 'unverified') };
        current.count += 1;
        if (source.content) current.structure = structureSignals(source.content).join('、') || '普通叙述';
        sourceMap.set(key, current);
        if (sourceType === 'model_citation' && text(rawSource?.verificationStatus) === 'fetched') verifiedSourceMap.set(key, current);
      });
    });

    const sentimentTotal = Object.values(sentiments).reduce((sum, value) => sum + value, 0);
    const dominantSentiment = Object.entries(sentiments).sort((left, right) => right[1] - left[1])[0]?.[0] || '一般/中性';
    const sourceFrequency = [...sourceMap.values()].sort((left, right) => right.count - left.count || left.title.localeCompare(right.title, 'zh-CN'));
    return {
      answerCount: completed.length,
      mentionCount: mentionedRecords.length,
      mentionRate: completed.length ? round(mentionedRecords.length / completed.length * 100) : 0,
      averageRank: ranks.length ? round(ranks.reduce((sum, value) => sum + value, 0) / ranks.length) : null,
      sentiment: { label: sentimentTotal ? dominantSentiment : '暂无判断', distribution: sentiments, evidence: [...sentimentEvidence] },
      platforms: [...platforms],
      platformCount: platforms.size,
      sources: {
        citationCount: sourceFrequency.reduce((sum, source) => sum + source.count, 0),
        uniqueUrlCount: sourceFrequency.filter((source) => source.url).length,
        uniqueDomainCount: new Set(sourceFrequency.map((source) => source.domain).filter(Boolean)).size,
        frequency: sourceFrequency,
        modalities,
        contentCoverage: sourceFrequency.filter((source) => source.structure !== '待抓取正文').length,
        structureStatus: sourceFrequency.length && sourceFrequency.some((source) => source.structure !== '待抓取正文') ? '部分已分析' : '待抓取信源正文'
        ,sourceTypes, verifiedUniqueUrlCount: verifiedSourceMap.size,
        modelCitationCount: Number(sourceTypes.model_citation || 0), embeddedLinkCount: Number(sourceTypes.embedded_link || 0)
      },
      roles: [...roles],
      commitments: { score: Math.min(100, commitments.size * 18), evidence: [...commitments] },
      serviceGranularity: { score: Math.min(100, serviceDetails.size * 9), evidence: [...serviceDetails] },
      answerStructure: { score: Math.min(100, structures.size * 16), signals: [...structures] }
    };
  }

  function competitorAdvantages(own, competitor) {
    const items = [];
    if (competitor.mentionRate > own.mentionRate) items.push(`提及率高 ${round(competitor.mentionRate - own.mentionRate)} 个百分点`);
    if (competitor.platformCount > own.platformCount) items.push(`多覆盖 ${competitor.platformCount - own.platformCount} 个回答平台`);
    if (competitor.sources.uniqueUrlCount > own.sources.uniqueUrlCount) items.push(`多 ${competitor.sources.uniqueUrlCount - own.sources.uniqueUrlCount} 个信源网址`);
    if (Object.keys(competitor.sources.modalities).length > Object.keys(own.sources.modalities).length) items.push('内容模态更丰富');
    if (competitor.roles.length > own.roles.length) items.push('第三方测评角色更多');
    if (competitor.commitments.score > own.commitments.score) items.push('服务承诺表达更强');
    if (competitor.serviceGranularity.score > own.serviceGranularity.score) items.push('产品服务颗粒度更细');
    if (competitor.answerStructure.score > own.answerStructure.score) items.push('回答结构更利于 AI 摘取');
    return items.length ? items : ['当前采集样本中未发现明确领先项'];
  }

  function recommendations(own, competitors) {
    const items = [];
    const leader = competitors.slice().sort((a, b) => b.metrics.mentionRate - a.metrics.mentionRate)[0];
    if (own.answerCount === 0) return ['先完成至少一轮真实回答采集，再生成优化内容。'];
    if (own.mentionRate < 60) items.push('优先覆盖未提及率最高的问题，直接回答游客的选择条件和适用场景。');
    if (own.averageRank == null || own.averageRank > 2) items.push('在标题、开头结论和对比表中前置品牌与核心优势，争取进入前两名。');
    if (own.sentiment.label !== '值得推荐') items.push('补充第三方评价、真实案例和可核验服务结果，推动情感标签从中性转为值得推荐。');
    if (own.sources.uniqueUrlCount < 3) items.push('建设至少 3 个可公开访问、可独立引用的权威信源页面。');
    if (Object.keys(own.sources.modalities).length < 2) items.push('除图文外补充视频、图集或报告，形成跨模态证据。');
    if (own.commitments.score < 45) items.push('写清服务响应时限、退改/赔付边界和责任人，把担当转成可验证承诺。');
    if (own.serviceGranularity.score < 55) items.push('把接送、用车、住宿、导游、保险和应急预案拆成可比较的服务颗粒。');
    if (own.answerStructure.score < 55) items.push('采用结论先行、评价维度、量化对比、步骤清单和 FAQ 结构。');
    if (leader && leader.metrics.mentionRate > own.mentionRate) items.push(`针对${leader.name}的领先项建立逐项对照，避免空泛宣称“更好”。`);
    return items.slice(0, 8);
  }

  function analyzeWorkspace(state, brandId) {
    const brands = list(state?.brands);
    const selectedId = text(brandId || state?.workspace?.brandId || brands[0]?.id);
    const brand = brands.find((item) => text(item.id) === selectedId);
    if (!brand) throw new Error('品牌不存在，无法生成优化分析。');
    const prompts = list(state?.prompts).filter((item) => text(item.brandId) === selectedId);
    const promptIds = new Set(prompts.map((item) => item.id));
    const records = list(state?.records).filter((item) => text(item.brandId) === selectedId || (!text(item.brandId) && promptIds.has(item.promptId)));
    const completedRecords = records.filter((item) => item.status === 'completed' && text(item.answer));
    const liveRecords = completedRecords.filter((item) => item.collectionMode === 'live');
    const analysisRecords = liveRecords.length ? liveRecords : completedRecords;
    const ownNames = [brand.name, ...list(brand.aliases)].map(normalize).filter(Boolean);
    const competitorNames = list(brand.competitors).map(competitorName).filter(Boolean);
    const entities = [
      { name: brand.name, names: ownNames, target: true },
      ...competitorNames.map((name) => ({ name, names: [normalize(name)], target: false }))
    ];
    const own = evidenceMetrics(analysisRecords, ownNames, entities, true);
    const competitors = competitorNames.map((name) => {
      const names = [normalize(name)];
      const competitorEntities = entities.map((entity) => Object.assign({}, entity, { target: entity.name === name }));
      const metrics = evidenceMetrics(analysisRecords, names, competitorEntities, false);
      return { name, metrics, advantages: [] };
    });
    competitors.forEach((competitor) => { competitor.advantages = competitorAdvantages(own, competitor.metrics); });
    const actions = recommendations(own, competitors);
    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      methodology: `${liveRecords.length ? '仅使用真实 API 采集回答' : '当前没有真实 API 回答，暂用演示/历史回答'}；基于品牌/别名匹配、引用元信息与可解释规则生成；情感、结构、担当和颗粒度为启发式标签。`,
      brand: { id: brand.id, name: brand.name, aliases: list(brand.aliases), website: text(brand.website) },
      sample: { promptCount: prompts.length, recordCount: records.length, allCompletedAnswerCount: completedRecords.length, completedAnswerCount: own.answerCount, liveAnswerCount: liveRecords.length, excludedNonLiveCount: liveRecords.length ? completedRecords.length - liveRecords.length : 0, mode: liveRecords.length ? 'live-only' : 'fallback' },
      own,
      competitors,
      opportunities: actions,
      contentBrief: {
        objective: `提升${brand.name}在游客出发前问题中的提及率、前两名占比与“值得推荐”情感标签。`,
        mustAnswer: prompts.map((prompt) => prompt.text).filter(Boolean).slice(0, 8),
        proofRequired: ['公开可访问的来源网址', '服务范围与适用边界', '响应时限与退改/赔付规则', '真实游客或第三方测评证据', '价格、日期与责任主体'],
        differentiators: actions,
        structure: ['结论先行', '适用人群', '评价维度', '量化对比', '服务明细', '承诺与边界', '证据链接', 'FAQ'],
        prohibited: ['无法核验的第一/唯一/最好', '没有适用条件的绝对承诺', '伪造引用、评价或数据']
      }
    };
  }

  return { analyzeWorkspace, modalityOf, structureSignals, sentimentFor };
});
