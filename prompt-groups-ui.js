(function () {
  const STYLE_ID = 'prompt-groups-ui-style';

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function storeData() {
    return window.answerTravelStore?.get?.() || {};
  }

  function workspaceData() {
    return window.answerTravelWorkspaceData;
  }

  function currentGroups() {
    const data = storeData();
    if (workspaceData()?.groupsForBrand) return workspaceData().groupsForBrand(data);
    const brandId = data.workspace?.brandId || data.brands?.[0]?.id || '';
    const prompts = (data.prompts || []).filter((item) => !brandId || item.brandId === brandId);
    const groups = (data.promptGroups || []).filter((item) => !brandId || item.brandId === brandId).map((item) => Object.assign({}, item));
    const names = new Set(groups.map((item) => item.name));
    prompts.forEach((prompt) => {
      const name = String(prompt.group || '默认分组').trim() || '默认分组';
      if (!names.has(name)) {
        groups.push({ id: `group-derived-${encodeURIComponent(name)}`, brandId, name, sortOrder: groups.length });
        names.add(name);
      }
    });
    return groups.sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0) || left.name.localeCompare(right.name, 'zh-CN'));
  }

  function groupPrompts(group) {
    const data = storeData();
    if (workspaceData()?.promptsForBrand) return workspaceData().promptsForBrand(data, group.brandId).filter((item) => item.group === group.name);
    return (data.prompts || []).filter((item) => item.brandId === group.brandId && item.group === group.name);
  }

  function metric(value, digits = 1) {
    const number = Number(value || 0);
    return number ? number.toFixed(digits) : '—';
  }

  function renderTopicGroups() {
    const sec = document.getElementById('section-prompts');
    const body = sec?.querySelector('[data-topic-body]');
    if (!body) return;
    const groups = currentGroups();
    body.innerHTML = groups.map((group, index) => {
      const prompts = groupPrompts(group);
      const rank = prompts.length ? prompts.reduce((sum, item) => sum + Number(item.rank || 0), 0) / prompts.length : 0;
      const exposure = prompts.length ? prompts.reduce((sum, item) => sum + Number(item.exposure || 0), 0) / prompts.length : 0;
      const delta = prompts.length ? prompts.reduce((sum, item) => sum + Number(item.delta || 0), 0) / prompts.length : 0;
      const deltaClass = delta > 0 ? 'up' : delta < 0 ? 'down' : '';
      const deltaText = delta ? `${delta > 0 ? '↗' : '↘'} ${Math.abs(delta).toFixed(1)}%` : '—';
      const detail = prompts.length ? prompts.map((prompt) => `<div class="topic-question"><div><strong>${esc(prompt.text)}</strong><span>${esc((prompt.platforms || []).join(' · '))} · ${esc(prompt.status === 'paused' ? '已暂停' : '已启用')}</span></div><div><b>#${metric(prompt.rank)}</b><span>${prompt.exposure ? `${metric(prompt.exposure)}%` : '—'}</span></div></div>`).join('') : '<div class="topic-question-empty">该主题暂时没有提问，可以先添加问题。</div>';
      return `<tr class="prompt-topic-row" data-topic-row="${index}" data-prompt-group-id="${esc(group.id)}" tabindex="0" aria-expanded="false"><td><div class="cell-title topic-name">${esc(group.name)}</div><div class="cell-sub">${prompts.length ? '游客决策前的真实问法' : '空主题，可开始添加提问'}</div></td><td>${prompts.length}</td><td>#${metric(rank)}</td><td>${exposure ? `${metric(exposure)}%` : '—'}</td><td><span class="delta ${deltaClass}">${deltaText}</span></td><td><svg class="topic-sparkline" viewBox="0 0 100 34" role="img" aria-label="${esc(group.name)} 趋势"><polyline points="2,24 18,17 34,21 50,13 66,17 82,10 98,12" fill="none" stroke="#706cf5" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></polyline></svg></td><td><div class="prompt-group-status"><span class="tag ${prompts.length ? 'green' : 'amber'}">${prompts.length ? '已启用' : '空主题'}</span><span class="prompt-group-actions"><button type="button" class="btn-quiet" data-prompt-group-action="edit" data-prompt-group-id="${esc(group.id)}">编辑</button><button type="button" class="btn-quiet danger" data-prompt-group-action="delete" data-prompt-group-id="${esc(group.id)}">删除</button></span></div></td></tr><tr class="prompt-topic-detail-row" data-topic-detail="${index}" hidden><td colspan="7"><div class="topic-question-list">${detail}</div></td></tr>`;
    }).join('');
    const summary = sec.querySelector('[data-topic-summary]');
    if (summary) summary.textContent = `${groups.length} 个主题 · ${groups.reduce((sum, group) => sum + groupPrompts(group).length, 0)} 条提问`;
    const empty = sec.querySelector('[data-topic-empty]');
    if (empty) empty.hidden = groups.length > 0;
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `.prompt-group-toolbar{display:flex;align-items:center;gap:8px}.prompt-group-toolbar .btn{min-height:32px}.prompt-group-status{display:flex;align-items:center;gap:8px;min-width:150px}.prompt-group-actions{display:inline-flex;gap:4px}.prompt-group-actions .danger{color:var(--red)}.prompt-group-demo-note{margin:0 0 14px;padding:9px 11px;border:1px solid #f0dfb6;border-radius:8px;background:var(--amberSoft);color:#8b641e;font-size:11px;line-height:1.55}.prompt-group-dialog[hidden]{display:none}.prompt-group-dialog{position:fixed;inset:0;z-index:80;display:grid;place-items:center;padding:20px;background:#171a2f6b}.prompt-group-dialog-card{width:min(460px,100%);padding:24px;border:1px solid var(--line);border-radius:14px;background:#fff;box-shadow:0 24px 80px #25254433}.prompt-group-dialog-card h2{margin:0;font-size:18px}.prompt-group-dialog-card p{margin:7px 0 20px;color:var(--muted);font-size:11px;line-height:1.6}.prompt-group-dialog-card label{display:grid;gap:7px;color:var(--ink);font-size:12px;font-weight:700}.prompt-group-dialog-card input{height:42px;padding:0 11px;border:1px solid var(--line);border-radius:8px;color:var(--ink)}.prompt-group-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}`;
    document.head.appendChild(style);
  }

  function ensureDialog() {
    let dialog = document.querySelector('.prompt-group-dialog');
    if (dialog) return dialog;
    dialog = document.createElement('div');
    dialog.className = 'prompt-group-dialog';
    dialog.hidden = true;
    dialog.innerHTML = `<section class="prompt-group-dialog-card" role="dialog" aria-modal="true" aria-labelledby="promptGroupDialogTitle"><h2 id="promptGroupDialogTitle">新建主题</h2><p>主题用于聚合相近的游客问题。改名会同步更新该主题下的所有用户提问。</p><form><label>主题名称<input name="name" maxlength="120" required placeholder="例如：亲子出行"></label><div class="prompt-group-dialog-actions"><button type="button" class="btn btn-secondary" data-prompt-group-cancel>取消</button><button type="submit" class="btn btn-primary">保存主题</button></div></form></section>`;
    document.body.appendChild(dialog);
    dialog.addEventListener('click', (event) => { if (event.target === dialog || event.target.closest('[data-prompt-group-cancel]')) dialog.hidden = true; });
    dialog.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      const groupId = dialog.dataset.groupId || '';
      const name = String(new FormData(event.currentTarget).get('name') || '').trim();
      if (!name) return;
      const data = storeData();
      const brandId = data.workspace?.brandId || data.brands?.[0]?.id || '';
      try {
        if (workspaceData()) {
          if (groupId) {
            let group = currentGroups().find((item) => item.id === groupId);
            if (group?.derived) group = workspaceData().ensurePromptGroup(data, { brandId, name: group.name }).group;
            workspaceData().renamePromptGroup(data, group?.id || groupId, name);
          } else {
            const result = workspaceData().ensurePromptGroup(data, { id: `group-${crypto.randomUUID()}`, brandId, name });
            if (!result.created) return window.note?.('该主题分组已存在。');
          }
        } else {
          const groups = data.promptGroups || (data.promptGroups = []);
          if (groups.some((item) => item.id !== groupId && item.brandId === brandId && item.name.toLowerCase() === name.toLowerCase())) return window.note?.('该主题分组已存在。');
          if (groupId) {
            const group = groups.find((item) => item.id === groupId);
            if (!group) return window.note?.('主题分组不存在，请刷新后重试。');
            const oldName = group.name;
            group.name = name;
            (data.prompts || []).filter((item) => item.brandId === brandId && item.group === oldName).forEach((prompt) => {
              prompt.group = name;
              (data.records || []).filter((record) => record.promptId === prompt.id).forEach((record) => { record.group = name; });
            });
          } else groups.push({ id: `group-${crypto.randomUUID()}`, brandId, name, sortOrder: groups.filter((item) => item.brandId === brandId).length });
        }
      } catch (error) {
        return window.note?.(error.message || '主题分组保存失败。');
      }
      window.answerTravelStore?.save?.(data);
      dialog.hidden = true;
      renderTopicGroups();
      window.note?.(groupId ? '主题分组已重命名。' : '主题分组已创建。');
    });
    return dialog;
  }

  function openGroupDialog(group) {
    const dialog = ensureDialog();
    dialog.dataset.groupId = group?.id || '';
    dialog.querySelector('#promptGroupDialogTitle').textContent = group ? '编辑主题' : '新建主题';
    dialog.querySelector('input[name="name"]').value = group?.name || '';
    dialog.hidden = false;
    dialog.querySelector('input[name="name"]').focus();
  }

  function removeGroup(group) {
    if (groupPrompts(group).length) return window.note?.('该主题下还有用户提问，请先编辑提问并移动到其他主题。');
    if (!window.confirm(`确认删除主题“${group.name}”吗？`)) return;
    const data = storeData();
    try {
      if (workspaceData()?.removePromptGroup) workspaceData().removePromptGroup(data, group.id);
      else data.promptGroups = (data.promptGroups || []).filter((item) => item.id !== group.id);
    } catch (error) {
      return window.note?.(error.message || '主题分组删除失败。');
    }
    window.answerTravelStore?.save?.(data);
    renderTopicGroups();
    window.note?.('主题分组已删除。');
  }

  function ensureControls() {
    const sec = document.getElementById('section-prompts');
    const panel = sec?.querySelector('.prompt-view-panel[data-prompt-view="topic"]');
    if (!panel) return;
    const head = panel.querySelector('.panel-head');
    const apiEnabled = new URLSearchParams(location.search).get('api') === '1';
    const existingNotes = [...panel.querySelectorAll('.prompt-group-demo-note')];
    existingNotes.slice(1).forEach((note) => note.remove());
    if (apiEnabled) existingNotes[0]?.remove();
    if (head && !apiEnabled && !panel.querySelector('.prompt-group-demo-note')) {
      const note = document.createElement('div');
      note.className = 'prompt-group-demo-note';
      note.textContent = '当前为浏览器演示模式：主题和提问只保存在本机，不会写入 PostgreSQL。要验证真实登录，请打开带 api=1 和 apiBase 参数的本地地址。';
      head.insertAdjacentElement('afterend', note);
    }
    if (head && !head.querySelector('.prompt-group-toolbar')) {
      const toolbar = document.createElement('div');
      toolbar.className = 'prompt-group-toolbar';
      toolbar.innerHTML = '<button type="button" class="btn btn-secondary" data-prompt-group-action="add">＋ 新建主题</button>';
      head.appendChild(toolbar);
    }
    renderTopicGroups();
  }

  function refresh() {
    ensureStyle();
    ensureControls();
  }

  function installRefreshBridge() {
    if (window.answerTravelPromptGroupRefreshInstalled) return;
    const refreshExistingViews = window.answerTravelPromptViewsRefresh;
    window.answerTravelPromptViewsRefresh = () => {
      refreshExistingViews?.();
      renderTopicGroups();
    };
    window.answerTravelPromptGroupRefreshInstalled = true;
  }

  document.addEventListener('click', (event) => {
    const action = event.target.closest('[data-prompt-group-action]')?.dataset.promptGroupAction;
    if (!action) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!window.answerTravelStore?.canWrite?.()) return window.note?.('当前角色没有管理主题分组权限。');
    const id = event.target.closest('[data-prompt-group-id]')?.dataset.promptGroupId;
    const group = currentGroups().find((item) => item.id === id);
    if (action === 'add') openGroupDialog();
    if (action === 'edit' && group) openGroupDialog(group);
    if (action === 'delete' && group) removeGroup(group);
  }, true);

  window.addEventListener('answertravel:data-change', refresh);
  window.addEventListener('answertravel:auth-state', () => window.setTimeout(refresh, 0));
  installRefreshBridge();
  window.setTimeout(refresh, 0);
})();
