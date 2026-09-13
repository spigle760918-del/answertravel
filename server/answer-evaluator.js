function normalize(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

function evaluateAnswer(answer, brand, sources = []) {
  const content = normalize(answer);
  const names = [brand?.name, ...(Array.isArray(brand?.aliases) ? brand.aliases : [])].map(normalize).filter(Boolean);
  const competitors = (Array.isArray(brand?.competitors) ? brand.competitors : []).map(normalize).filter(Boolean);
  const brandPositions = names.map((name) => content.indexOf(name)).filter((position) => position >= 0);
  const mentioned = brandPositions.length > 0;
  const firstBrandPosition = mentioned ? Math.min(...brandPositions) : Number.POSITIVE_INFINITY;
  const rankedNames = [{ type: 'brand', position: firstBrandPosition }, ...competitors.map((name) => ({ type: 'competitor', position: content.indexOf(name) })).filter((item) => item.position >= 0)]
    .sort((left, right) => left.position - right.position);
  const firstRank = mentioned ? rankedNames.findIndex((item) => item.type === 'brand') + 1 : null;
  const sourceBonus = Math.min(15, (Array.isArray(sources) ? sources.length : 0) * 3);
  const exposureScore = mentioned ? Math.max(20, Math.min(100, 88 - ((firstRank || 1) - 1) * 14 + sourceBonus)) : 0;
  const context = mentioned ? content.slice(Math.max(0, firstBrandPosition - 120), firstBrandPosition + 260) : '';
  const positiveTerms = ['值得推荐', '强烈推荐', '推荐', '首选', '优选', '可靠', '靠谱', '专业', '放心', '优质', '满意'].filter((term) => context.includes(term));
  const negativeTerms = ['不建议', '不推荐', '谨慎', '投诉', '风险', '较差', '失望', '问题较多', '争议'].filter((term) => context.includes(term));
  const sentimentLabel = !mentioned ? '未提及' : negativeTerms.length > positiveTerms.length ? '不建议/谨慎' : positiveTerms.length > negativeTerms.length ? '值得推荐' : '一般/中性';
  return { mentioned, firstRank, exposureScore, sentimentLabel, sentimentEvidence: [...new Set([...positiveTerms, ...negativeTerms])] };
}

module.exports = { evaluateAnswer };
