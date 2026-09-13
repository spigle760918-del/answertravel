(function () {
  const STYLE_ID = 'answertravel-collection-status-style';
  let providers = [];
  let collection = null;

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `.collection-status{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:0 0 16px;padding:12px 15px;border:1px solid #f0dfb6;border-radius:8px;background:#fffaf0;color:#76591e;font-size:12px;line-height:1.55}.collection-status.live{border-color:#cde9d8;background:#f1fbf5;color:#24633d}.collection-status strong{display:block;color:inherit}.collection-status span{color:inherit;opacity:.82}.collection-status button{white-space:nowrap}.collection-status-meta{display:flex;gap:7px;flex-wrap:wrap;margin-top:5px}.collection-status-meta i{font-style:normal;padding:2px 7px;border-radius:99px;background:rgba(255,255,255,.75)}.collection-mode-chip{margin-left:6px;padding:2px 6px;border-radius:99px;background:#fff2cf;color:#8b641e;font-size:9px;font-weight:700}.collection-mode-chip.live{background:#dff5e8;color:#267246}.collection-evidence{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:14px 0;padding:12px;border:1px solid #e5e8ee;border-radius:8px;background:#f8f9fb}.collection-evidence-item{min-width:0}.collection-evidence-item span{display:block;color:#8991a4;font-size:10px}.collection-evidence-item strong{display:block;overflow:hidden;margin-top:5px;color:#303748;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.collection-evidence-item strong.live{color:#16865d}.collection-source-empty{margin-top:10px;color:#8991a4;font-size:11px;line-height:1.6}@media(max-width:760px){.collection-status{align-items:flex-start;flex-direction:column}.collection-evidence{grid-template-columns:repeat(2,minmax(0,1fr))}}`;
    document.head.appendChild(style);
  }

  function recordMap() {
    const state = window.answerTravelStore?.get?.() || {};
    return new Map((state.records || []).map((record) => [record.id, record]));
  }

  function statusLabel(status) {
    if (status === 'completed') return '已完成';
    if (status === 'running') return '采集中';
    if (status === 'error') return '失败';
    return '排队中';
  }

  function modeLabel(mode) {
    if (mode === 'live') return '真实 API';
    if (mode === 'simulated') return '模拟数据';
    return '待确认';
  }

  function decorateRecordDetail(records) {
    const section = document.getElementById('section-records');
    const detail = section?.querySelector('#recordDetail');
    const activeId = section?.querySelector('#recordList [data-record-id].active')?.dataset.recordId;
    const record = records.get(activeId);
    detail?.querySelector('[data-collection-evidence]')?.remove();
    detail?.querySelector('[data-collection-source-empty]')?.remove();
    if (!detail || !record) return;

    const evidence = document.createElement('div');
    evidence.className = 'collection-evidence';
    evidence.dataset.collectionEvidence = '';
    const values = [
      ['数据来源', modeLabel(record.collectionMode)],
      ['模型版本', record.modelVersion || record.platform || '—'],
      ['响应耗时', Number.isFinite(Number(record.latencyMs)) ? `${(Number(record.latencyMs) / 1000).toFixed(2)} 秒` : '—'],
      ['采集状态', statusLabel(record.status)]
    ];
    values.forEach(([label, value], index) => {
      const item = document.createElement('div');
      item.className = 'collection-evidence-item';
      const caption = document.createElement('span');
      caption.textContent = label;
      const content = document.createElement('strong');
      content.textContent = value;
      if (index === 0 && record.collectionMode === 'live') content.className = 'live';
      item.append(caption, content);
      evidence.appendChild(item);
    });
    const meta = detail.querySelector('.record-meta-tags');
    if (meta) meta.insertAdjacentElement('afterend', evidence); else detail.prepend(evidence);

    if ((record.sources || []).length === 0 && record.status === 'completed') {
      const sourceBox = detail.querySelector('.record-source-box');
      const toggle = sourceBox?.querySelector('[data-action="toggle-persist-sources"]');
      if (toggle) {
        toggle.disabled = true;
        toggle.textContent = '无引用';
      }
      if (sourceBox) {
        const empty = document.createElement('div');
        empty.className = 'collection-source-empty';
        empty.dataset.collectionSourceEmpty = '';
        empty.textContent = record.collectionMode === 'live'
          ? '本次真实回答已保存，但模型接口没有返回可验证的引用链接。'
          : '本条回答没有引用来源。';
        sourceBox.appendChild(empty);
      }
    }
  }

  function render() {
    ensureStyle();
    const section = document.getElementById('section-records');
    const head = section?.querySelector('.page-head');
    if (!section || !head) return;
    let banner = section.querySelector('[data-collection-status]');
    if (!banner) {
      banner = document.createElement('div');
      banner.dataset.collectionStatus = '';
      head.insertAdjacentElement('afterend', banner);
    }
    const configured = providers.filter((provider) => provider.configured);
    const state = window.answerTravelStore?.get?.() || {};
    const quota = collection?.quotas?.find((item) => item.brandId === state.workspace?.brandId) || collection?.quotas?.[0];
    const quotaText = quota ? `${quota.brand.used}/${quota.brand.unlimited ? '不限' : quota.brand.limit}` : '—';
    const nextRun = collection?.schedule?.nextRunAt ? new Date(collection.schedule.nextRunAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '无';
    const meta = `<div class="collection-status-meta"><i>本品牌本月 ${quotaText} 次</i><i>定时问题 ${collection?.schedule?.activePrompts || 0} 个</i><i>下次调度 ${nextRun}</i></div>`;
    banner.className = `collection-status ${configured.length ? 'live' : ''}`;
    banner.innerHTML = configured.length
      ? `<div><strong>真实大模型采集已连接</strong><span>${configured.map((provider) => `${provider.platform} · ${provider.model}`).join('，')}；失败会自动退避重试。</span>${meta}</div><button type="button" class="btn btn-secondary" data-refresh-collection>刷新状态</button>`
      : `<div><strong>当前为模拟采集</strong><span>定时、配额、任务和回答流程均正常；配置 DeepSeek 密钥后自动切换真实采集。</span>${meta}</div><button type="button" class="btn btn-secondary" data-refresh-collection>刷新状态</button>`;

    const records = recordMap();
    section.querySelectorAll('[data-record-id]').forEach((row) => {
      const record = records.get(row.dataset.recordId);
      const main = row.querySelector('.record-result-main');
      if (!record || !main) return;
      let chip = main.querySelector('.collection-mode-chip');
      if (!record.collectionMode) { chip?.remove(); return; }
      if (!chip) { chip = document.createElement('span'); main.appendChild(chip); }
      chip.className = `collection-mode-chip ${record.collectionMode === 'live' ? 'live' : ''}`;
      chip.textContent = record.collectionMode === 'live' ? '真实采集' : record.collectionMode === 'simulated' ? '模拟' : '未连接';
    });
    decorateRecordDetail(records);
  }

  async function refresh(options = {}) {
    try {
      collection = await window.answerTravelApiClient?.getCollectionStatus?.() || null;
      providers = collection?.providers || await window.answerTravelApiClient?.listProviders?.() || [];
      if (options.remote !== false) await window.answerTravelApiClient?.refreshFromServer?.({ silent: true });
    } catch { /* API 离线时保留当前状态提示 */ }
    window.setTimeout(render, 0);
  }

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-refresh-collection]')) refresh();
    if (event.target.closest('[data-section="records"]') || event.target.closest('[data-record-id]')) window.setTimeout(render, 0);
  }, true);
  window.addEventListener('answertravel:data-change', () => window.setTimeout(render, 0));
  window.addEventListener('answertravel:remote-refresh', () => window.setTimeout(render, 0));
  window.addEventListener('answertravel:auth-state', (event) => {
    if (event.detail?.authenticated || event.detail?.status === 'ready') refresh({ remote: false });
  });
  window.setTimeout(() => refresh({ remote: false }), 0);
})();
