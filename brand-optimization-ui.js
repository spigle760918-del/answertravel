(function () {
  const STYLE_ID = 'answertravel-brand-optimization-style';
  let cached = null;
  let loading = false;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function state() { return window.answerTravelStore?.get?.() || {}; }
  function activeBrandId() { return state().workspace?.brandId || state().brands?.[0]?.id || ''; }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `.brand-diagnosis{margin:0 0 18px;border:1px solid #dedfff;border-radius:12px;background:#fff;box-shadow:0 6px 22px rgba(35,38,67,.04);overflow:hidden}.brand-diagnosis-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:18px 20px;border-bottom:1px solid #ececf4;background:#fbfbff}.brand-diagnosis-head h2{margin:0;font-size:16px}.brand-diagnosis-head p{margin:6px 0 0;color:#8991a4;font-size:11px;line-height:1.6}.brand-diagnosis-actions{display:flex;gap:8px}.diagnosis-body{padding:18px 20px}.diagnosis-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.diagnosis-kpi{padding:13px;border:1px solid #ebecf2;border-radius:9px;background:#fff}.diagnosis-kpi span{display:block;color:#8991a4;font-size:10px}.diagnosis-kpi strong{display:block;margin-top:6px;font-size:20px}.diagnosis-kpi small{display:block;margin-top:5px;color:#71798b;font-size:10px;line-height:1.5}.diagnosis-grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(300px,.9fr);gap:14px;margin-top:14px}.diagnosis-block{padding:15px;border:1px solid #ebecf2;border-radius:9px}.diagnosis-block h3{margin:0 0 11px;font-size:13px}.diagnosis-evidence{display:flex;gap:6px;flex-wrap:wrap}.diagnosis-evidence span{padding:4px 7px;border-radius:99px;background:#f2f1ff;color:#5551d7;font-size:9px}.diagnosis-evidence .empty{background:#f5f5f7;color:#9299a8}.diagnosis-bars{display:grid;gap:9px}.diagnosis-bar{display:grid;grid-template-columns:72px 1fr 34px;gap:8px;align-items:center;color:#71798b;font-size:10px}.diagnosis-track{height:7px;border-radius:99px;background:#eeeef4;overflow:hidden}.diagnosis-track i{display:block;height:100%;border-radius:99px;background:#625ef5}.diagnosis-actions-list{margin:0;padding-left:18px;color:#535c70;font-size:11px;line-height:1.75}.diagnosis-table{width:100%;margin-top:14px;border-collapse:collapse}.diagnosis-table th,.diagnosis-table td{padding:10px 9px;border-bottom:1px solid #eff0f4;text-align:left;font-size:10px;vertical-align:top}.diagnosis-table th{color:#8991a4;background:#f8f9fb}.diagnosis-table td strong{display:block;color:#303748}.diagnosis-table td small{display:block;margin-top:4px;color:#8991a4}.diagnosis-gap{color:#c17b1b;line-height:1.55}.diagnosis-method{margin-top:13px;padding:10px 12px;border-radius:8px;background:#f7f7fb;color:#737b8e;font-size:10px;line-height:1.65}.diagnosis-empty{padding:26px;text-align:center;color:#8991a4;font-size:11px}.diagnosis-live{color:#16865d;font-weight:700}@media(max-width:960px){.diagnosis-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.diagnosis-grid{grid-template-columns:1fr}}@media(max-width:600px){.brand-diagnosis-head{flex-direction:column}.diagnosis-kpis{grid-template-columns:1fr}.brand-diagnosis-actions{width:100%}.brand-diagnosis-actions .btn{flex:1}.diagnosis-body{padding:14px}.diagnosis-table{display:block;overflow-x:auto}}`;
    document.head.appendChild(style);
  }

  function chipList(items, empty = '暂无证据') {
    const values = Array.isArray(items) ? items.filter(Boolean) : [];
    return values.length ? values.map((item) => `<span>${esc(item)}</span>`).join('') : `<span class="empty">${esc(empty)}</span>`;
  }

  function percent(value) { return `${Number(value || 0).toFixed(1)}%`; }

  function renderAnalysis(panel, analysis) {
    const own = analysis.own;
    const sentiment = own.sentiment?.distribution || {};
    const sentimentTotal = Object.values(sentiment).reduce((sum, value) => sum + Number(value || 0), 0) || 1;
    const sourceTypeLabel = { model_citation: '模型实际引用', embedded_link: '回答正文链接', retrieval_candidate: '检索候选', manual_or_owned: '人工/自有' };
    const sourceRows = own.sources.frequency.slice(0, 8).map((source) => `<tr><td><strong>${esc(source.title)}</strong><small>${esc(source.domain || source.url || '无网址')} · ${esc(sourceTypeLabel[source.sourceType] || '信源')} · ${source.verificationStatus === 'fetched' ? '已抓取' : source.verificationStatus === 'failed' ? '抓取失败' : '未验证'}</small></td><td>${source.count}</td><td>${esc(source.modality)}</td><td>${esc(source.structure)}</td></tr>`).join('');
    const competitors = analysis.competitors.map((competitor) => `<tr><td><strong>${esc(competitor.name)}</strong><small>${competitor.metrics.mentionCount}/${competitor.metrics.answerCount} 次提及</small></td><td>${percent(competitor.metrics.mentionRate)}</td><td>${competitor.metrics.averageRank == null ? '—' : `#${competitor.metrics.averageRank}`}</td><td>${competitor.metrics.sources.uniqueUrlCount} / ${competitor.metrics.platformCount}</td><td>${Object.keys(competitor.metrics.sources.modalities).length} / ${competitor.metrics.roles.length}</td><td>${competitor.metrics.commitments.score} / ${competitor.metrics.serviceGranularity.score}</td><td class="diagnosis-gap">${esc(competitor.advantages.join('；'))}</td></tr>`).join('');
    panel.innerHTML = `<div class="brand-diagnosis-head"><div><h2>品牌优化诊断 · ${esc(analysis.brand.name)}</h2><p>从监控回答、AI 排名/情感与引用证据出发，决定内容应该补什么，而不是先套文章模板。</p></div><div class="brand-diagnosis-actions"><button class="btn btn-secondary" type="button" data-refresh-brand-diagnosis>刷新分析</button><button class="btn btn-primary" type="button" data-action="write">按诊断生成内容</button></div></div><div class="diagnosis-body"><div class="diagnosis-kpis"><div class="diagnosis-kpi"><span>自身提及率</span><strong>${percent(own.mentionRate)}</strong><small>${own.mentionCount} 次提及 ÷ ${own.answerCount} 次有效采集 · ${own.platformCount} 个回答平台</small></div><div class="diagnosis-kpi"><span>被提及时平均排名</span><strong>${own.averageRank == null ? '—' : `#${own.averageRank}`}</strong><small>只统计答案中出现品牌的记录</small></div><div class="diagnosis-kpi"><span>AI 情感标签</span><strong>${esc(own.sentiment.label)}</strong><small>${esc(own.sentiment.evidence.join('、') || '暂无明确情感词')}</small></div><div class="diagnosis-kpi"><span>引用覆盖</span><strong>${own.sources.uniqueUrlCount} 个网址</strong><small>${own.sources.citationCount} 次引用 · ${own.sources.uniqueDomainCount} 个域名 · ${Object.keys(own.sources.modalities).length} 种模态</small></div></div><div class="diagnosis-grid"><section class="diagnosis-block"><h3>情感分布与可解释证据</h3><div class="diagnosis-bars">${[['值得推荐','值得推荐'],['一般/中性','一般'],['不建议/谨慎','谨慎']].map(([key,label])=>`<div class="diagnosis-bar"><span>${label}</span><div class="diagnosis-track"><i style="width:${Math.round(Number(sentiment[key]||0)/sentimentTotal*100)}%"></i></div><b>${sentiment[key]||0}</b></div>`).join('')}</div><h3 style="margin-top:16px">担当 ${own.commitments.score}/100 · 服务颗粒度 ${own.serviceGranularity.score}/100</h3><div class="diagnosis-evidence">${chipList(own.commitments.evidence,'尚未识别到可核验承诺')}</div><div class="diagnosis-evidence" style="margin-top:7px">${chipList(own.serviceGranularity.evidence,'尚未识别到服务细节')}</div></section><section class="diagnosis-block"><h3>优先优化动作</h3><ol class="diagnosis-actions-list">${analysis.opportunities.map((item)=>`<li>${esc(item)}</li>`).join('')}</ol><div class="diagnosis-evidence" style="margin-top:10px">${chipList(own.answerStructure.signals,'回答结构信号不足')}</div></section></div><table class="diagnosis-table"><thead><tr><th>自身信源</th><th>频次</th><th>模态</th><th>AI 偏好结构</th></tr></thead><tbody>${sourceRows || `<tr><td colspan="4">当前已完成回答尚未返回可验证的信源网址</td></tr>`}</tbody></table><table class="diagnosis-table"><thead><tr><th>竞品</th><th>提及率</th><th>平均排名</th><th>信源网址 / 平台</th><th>模态 / 测评角色</th><th>承诺 / 颗粒度</th><th>相对优势</th></tr></thead><tbody>${competitors || `<tr><td colspan="7">尚未配置竞品，请先在品牌管理中添加竞争对手</td></tr>`}</tbody></table><div class="diagnosis-method"><span class="diagnosis-live">样本：${analysis.sample.completedAnswerCount} 条已完成回答，其中 ${analysis.sample.liveAnswerCount} 条真实采集。</span> ${esc(analysis.methodology)} 信源正文已覆盖 ${own.sources.contentCoverage}/${own.sources.uniqueUrlCount} 个网址，当前结构状态：${esc(own.sources.structureStatus)}。</div></div>`;
    const sampleLabel = panel.querySelector('.diagnosis-live');
    if (sampleLabel && analysis.sample.excludedNonLiveCount) {
      sampleLabel.textContent = `正式诊断采用 ${analysis.sample.completedAnswerCount} 条真实回答；已排除 ${analysis.sample.excludedNonLiveCount} 条模拟/历史回答。`;
    }
  }

  async function analysisForCurrentBrand(remote = false) {
    const brandId = activeBrandId();
    if (!brandId) return null;
    if (remote && window.answerTravelApiClient?.status?.().ready && window.answerTravelApiClient?.getBrandIntelligence) {
      try { return await window.answerTravelApiClient.getBrandIntelligence(brandId); } catch { /* 使用同口径的本地数据继续渲染 */ }
    }
    return window.answerTravelBrandIntelligence?.analyzeWorkspace?.(state(), brandId) || null;
  }

  async function render(options = {}) {
    ensureStyle();
    const section = document.getElementById('section-articles');
    const head = section?.querySelector('.page-head');
    if (!section || !head) return;
    let panel = section.querySelector('[data-brand-diagnosis]');
    if (!panel) {
      panel = document.createElement('section');
      panel.className = 'brand-diagnosis';
      panel.dataset.brandDiagnosis = '';
      head.insertAdjacentElement('afterend', panel);
    }
    if (loading) return;
    loading = true;
    try {
      cached = await analysisForCurrentBrand(Boolean(options.remote));
      if (cached) renderAnalysis(panel, cached); else panel.innerHTML = '<div class="diagnosis-empty">请先选择品牌并完成监控问题采集。</div>';
      window.answerTravelCurrentBrandAnalysis = cached;
    } catch (error) {
      panel.innerHTML = `<div class="diagnosis-empty">分析暂不可用：${esc(error.message)}</div>`;
    } finally { loading = false; }
  }

  window.addEventListener('click', (event) => {
    if (event.target.closest('[data-section="articles"]')) window.setTimeout(() => render({ remote: true }), 0);
    if (event.target.closest('[data-refresh-brand-diagnosis]')) { event.preventDefault(); render({ remote: true }); }
  }, true);
  window.addEventListener('answertravel:data-change', () => window.setTimeout(() => render(), 0));
  window.addEventListener('answertravel:remote-refresh', () => window.setTimeout(() => render(), 0));
  window.addEventListener('answertravel:auth-state', (event) => { if (event.detail?.status === 'ready') render({ remote: true }); });
  window.answerTravelRefreshBrandDiagnosis = render;
  window.setTimeout(() => render({ remote: true }), 0);
})();
