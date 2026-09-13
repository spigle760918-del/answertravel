(function () {
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

  function openEditor(promptId) {
    const snapshot = window.answerTravelStore?.get?.() || {};
    const prompt = (snapshot.prompts || []).find((item) => item.id === promptId);
    if (!prompt) return;
    const backdrop = document.getElementById('modalBackdrop');
    const content = document.getElementById('modalContent');
    if (!backdrop || !content) return;
    backdrop.classList.add('open');
    document.querySelector('.modal')?.classList.add('modal-wide');
    document.getElementById('modalTitle').textContent = '编辑监控问题';
    document.getElementById('modalSub').textContent = '设置采集平台、频率、语言和游客地区。';
    const groups = [...new Set((snapshot.promptGroups || []).filter((item) => item.brandId === prompt.brandId).map((item) => item.name).concat(prompt.group))];
    const selected = new Set(prompt.platforms || ['DeepSeek']);
    const platforms = ['DeepSeek', '豆包', 'Kimi', '元宝'];
    content.innerHTML = `<form class="form-grid" data-collection-prompt-form><div class="field full"><label>游客问题<span>*</span></label><textarea name="text" required>${esc(prompt.text)}</textarea></div><div class="field"><label>所属主题<span>*</span></label><select name="group" required>${groups.map((name) => `<option ${name === prompt.group ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select></div><div class="field"><label>状态</label><select name="status"><option value="active" ${prompt.status !== 'paused' ? 'selected' : ''}>已启用</option><option value="paused" ${prompt.status === 'paused' ? 'selected' : ''}>已暂停</option></select></div><div class="field"><label>采集频率</label><select name="frequency"><option value="daily" ${!prompt.frequency || prompt.frequency === 'daily' ? 'selected' : ''}>每日</option><option value="weekly" ${prompt.frequency === 'weekly' ? 'selected' : ''}>每周</option><option value="manual" ${prompt.frequency === 'manual' ? 'selected' : ''}>仅手动</option></select></div><div class="field"><label>语言</label><select name="language"><option value="zh-CN" ${!prompt.language || prompt.language === 'zh-CN' ? 'selected' : ''}>简体中文</option><option value="en-US" ${prompt.language === 'en-US' ? 'selected' : ''}>English</option><option value="ja-JP" ${prompt.language === 'ja-JP' ? 'selected' : ''}>日本語</option></select></div><div class="field full"><label>游客地区</label><input name="region" value="${esc(prompt.region || '中国')}" placeholder="例如：中国、华东、日本"></div><div class="field full"><label>采集平台<span>*</span></label><div class="phase-checklist">${platforms.map((name) => `<label class="phase-check"><input type="checkbox" name="platforms" value="${name}" ${selected.has(name) ? 'checked' : ''}><span><strong>${name}</strong><small>${name === 'DeepSeek' ? '支持真实 API' : '待平台接入'}</small></span></label>`).join('')}</div><small>一个问题 × 一个平台计为 1 次月度配额。</small></div><div class="form-actions field full"><button type="button" class="btn btn-secondary" data-action="close-modal">取消</button><button class="btn btn-primary" type="submit">保存提问</button></div></form>`;
    content.querySelector('form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const values = new FormData(form);
      const platformValues = values.getAll('platforms');
      if (!platformValues.length) { window.note?.('请至少选择一个采集平台。'); return; }
      const button = form.querySelector('[type="submit"]');
      button.disabled = true;
      try {
        const patch = { text: String(values.get('text') || '').trim(), group: String(values.get('group') || '').trim(), status: values.get('status'), frequency: values.get('frequency'), language: values.get('language'), region: String(values.get('region') || '').trim(), platforms: platformValues };
        if (window.answerTravelApiClient?.status?.().ready) {
          await window.answerTravelApiClient.updatePrompt(prompt.id, patch);
          await window.answerTravelApiClient.refreshFromServer({ silent: true });
        } else {
          await window.answerTravelApi?.updatePrompt?.(prompt.id, patch);
        }
        form.querySelector('[data-action="close-modal"]')?.click();
        window.note?.('监控问题与采集计划已保存。');
      } catch (error) {
        window.note?.(`保存失败：${error.message}`);
      } finally {
        button.disabled = false;
      }
    });
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="edit-prompt"][data-prompt-id]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openEditor(button.dataset.promptId);
  }, true);
})();
