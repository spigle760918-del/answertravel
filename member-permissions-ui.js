(function () {
  const STYLE_ID = 'answertravel-member-permissions-style';
  const ROLES = ['团队管理员', '品牌管理员', '品牌编辑者', '品牌成员（只读）'];
  let dialog;
  let auditLoading = false;
  let lastAuditAt = 0;

  const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const state = () => window.answerTravelStore?.get?.() || {};
  const isTeamAdmin = () => state().auth?.role === '团队管理员';
  const scopeList = (scope) => Array.isArray(scope) ? scope : scope && typeof scope === 'object' ? [...(scope.brandIds || []), ...(scope.brands || [])] : scope ? [scope] : [];

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `.member-permission-dialog[hidden]{display:none}.member-permission-dialog{position:fixed;inset:0;z-index:88;display:grid;place-items:center;padding:20px;background:#171a2f6b}.member-permission-card{width:min(640px,100%);max-height:calc(100vh - 40px);overflow:auto;padding:24px;border:1px solid var(--line);border-radius:14px;background:#fff;box-shadow:0 24px 80px #25254433}.member-permission-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.member-permission-head h2{margin:0;font-size:18px}.member-permission-head p{margin:7px 0 20px;color:var(--muted);font-size:11px}.member-permission-close{font-size:20px;color:var(--muted);background:transparent}.member-permission-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.member-permission-field{display:grid;gap:7px;font-size:12px;font-weight:700}.member-permission-field input,.member-permission-field select{height:42px;padding:0 11px;border:1px solid var(--line);border-radius:8px}.member-scope-box{grid-column:1/-1;padding:14px;border:1px solid var(--line);border-radius:10px;background:#fafafd}.member-scope-box>strong{display:block;margin-bottom:10px;font-size:12px}.member-scope-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.member-scope-option{display:flex;align-items:center;gap:8px;padding:9px 10px;border:1px solid var(--line);border-radius:8px;background:#fff;font-size:11px;font-weight:600}.member-scope-option input{width:16px;height:16px}.member-permission-confirm{grid-column:1/-1;display:flex;align-items:flex-start;gap:9px;padding:12px;border-radius:8px;background:#fff8e9;font-size:11px;line-height:1.5}.member-permission-actions{grid-column:1/-1;display:flex;justify-content:flex-end;gap:8px;margin-top:6px}.member-permission-note{margin:10px 0 0;color:var(--muted);font-size:10px;line-height:1.5}.member-row-extra{display:block;margin-top:4px;color:var(--muted);font-size:9px}.member-admin-only[hidden]{display:none!important}.member-audit-list{display:grid}.member-audit-row{display:grid;grid-template-columns:160px 1fr 150px;gap:12px;padding:11px 0;border-top:1px solid var(--line);font-size:11px}.member-audit-row:first-child{border-top:0}.member-audit-row strong{font-size:11px}.member-audit-row span{color:var(--muted)}@media(max-width:680px){.member-permission-grid,.member-scope-list{grid-template-columns:1fr}.member-audit-row{grid-template-columns:1fr}}`;
    document.head.appendChild(style);
  }

  function ensureDialog() {
    if (dialog) return dialog;
    dialog = document.createElement('div');
    dialog.className = 'member-permission-dialog';
    dialog.hidden = true;
    document.body.appendChild(dialog);
    dialog.addEventListener('click', (event) => { if (event.target === dialog || event.target.closest('[data-member-dialog-close]')) closeDialog(); });
    return dialog;
  }

  function closeDialog() {
    if (dialog) dialog.hidden = true;
  }

  function selectedScopes(form) {
    return [...form.querySelectorAll('[name="brandScope"]:checked')].map((input) => input.value);
  }

  function syncScopeState(form) {
    const teamAdmin = form.elements.role.value === '团队管理员';
    const box = form.querySelector('.member-scope-box');
    box.querySelectorAll('input').forEach((input) => { input.disabled = teamAdmin; if (teamAdmin) input.checked = true; });
    box.querySelector('strong').textContent = teamAdmin ? '品牌范围：全部品牌（团队管理员固定）' : '品牌范围（可多选，至少一个）';
  }

  async function refreshMembers() {
    await window.answerTravelApiClient?.refreshFromServer?.({ silent: true });
    window.setTimeout(enhanceRows, 0);
  }

  async function submitMember(event, member) {
    event.preventDefault();
    const form = event.currentTarget;
    if (form.dataset.submitting === 'true') return;
    const role = String(form.elements.role.value);
    const scope = role === '团队管理员' ? '全部品牌' : selectedScopes(form);
    if (role !== '团队管理员' && !scope.length) return window.note?.('请至少选择一个可访问品牌。');
    if (member && !form.elements.confirmPermission.checked) return window.note?.('请先确认本次权限变更。');
    const payload = {
      name: String(form.elements.name.value).trim(),
      email: String(form.elements.email.value).trim(),
      role,
      scope,
      ...(member ? { status: String(form.elements.status.value) } : {})
    };
    form.dataset.submitting = 'true';
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    submit.textContent = member ? '保存中...' : '生成邀请中...';
    try {
      const client = window.answerTravelApiClient;
      if (client?.status?.().ready) {
        if (member) await client.updateMember(member.id, payload);
        else {
          const invited = await client.inviteMember(payload);
          if (invited?.registrationUrl) window.dispatchEvent(new CustomEvent('answertravel:invitation-created', { detail: { member: invited, registrationUrl: invited.registrationUrl } }));
        }
        await refreshMembers();
      } else if (member) await window.answerTravelApi?.updateMember?.(member.id, payload);
      else await window.answerTravelApi?.inviteMember?.(payload);
      closeDialog();
      window.note?.(member ? '成员权限已更新并立即生效。' : '邀请链接已生成。');
    } catch (error) {
      form.dataset.submitting = 'false';
      submit.disabled = false;
      submit.textContent = member ? '保存权限' : '生成邀请链接';
      window.note?.(error.message || '成员操作失败。');
    }
  }

  function openDialog(member = null) {
    if (!isTeamAdmin()) return window.note?.('只有团队管理员可以管理成员权限。');
    ensureStyle();
    const overlay = ensureDialog();
    const snapshot = state();
    const brands = snapshot.brands || [];
    const assigned = new Set(scopeList(member?.scope));
    const allBrands = assigned.has('全部品牌') || assigned.has('*') || member?.role === '团队管理员';
    const registered = Boolean(member?.userId || member?.acceptedAt);
    overlay.innerHTML = `<section class="member-permission-card" role="dialog" aria-modal="true" aria-labelledby="memberPermissionTitle"><div class="member-permission-head"><div><h2 id="memberPermissionTitle">${member ? '管理成员权限' : '邀请团队成员'}</h2><p>${member ? '角色、品牌范围和账号状态保存后立即生效。' : '选择成员可访问的一个或多个品牌，再生成注册链接。'}</p></div><button type="button" class="member-permission-close" data-member-dialog-close aria-label="关闭">×</button></div><form class="member-permission-grid"><label class="member-permission-field">姓名<input name="name" required maxlength="80" value="${escapeHtml(member?.name || '')}" placeholder="成员姓名"></label><label class="member-permission-field">邮箱<input name="email" type="email" required ${member ? 'readonly' : ''} value="${escapeHtml(member?.email || '')}" placeholder="name@company.com"></label><label class="member-permission-field">角色<select name="role">${ROLES.map((role) => `<option ${role === (member?.role || '品牌成员（只读）') ? 'selected' : ''}>${role}</option>`).join('')}</select></label>${member ? `<label class="member-permission-field">账号状态<select name="status">${registered ? `<option ${member.status === '正常' ? 'selected' : ''}>正常</option><option ${member.status === '暂停' ? 'selected' : ''}>暂停</option>` : `<option ${member.status === '待接受' ? 'selected' : ''}>待接受</option><option ${member.status === '暂停' ? 'selected' : ''}>暂停</option>`}</select></label>` : ''}<div class="member-scope-box"><strong>品牌范围（可多选，至少一个）</strong><div class="member-scope-list">${brands.map((brand) => `<label class="member-scope-option"><input type="checkbox" name="brandScope" value="${escapeHtml(brand.id)}" ${allBrands || assigned.has(brand.id) || assigned.has(brand.name) ? 'checked' : ''}><span>${escapeHtml(brand.name)}</span></label>`).join('')}</div><p class="member-permission-note">未勾选的品牌及其提问、竞品、回答、素材和文章对该成员不可见。</p></div>${member ? '<label class="member-permission-confirm"><input type="checkbox" name="confirmPermission"><span><strong>确认权限变更</strong><br>修改角色、品牌范围或暂停账号后，新的权限会立即应用到现有会话。</span></label>' : ''}<div class="member-permission-actions"><button type="button" class="btn btn-secondary" data-member-dialog-close>取消</button><button type="submit" class="btn btn-primary">${member ? '保存权限' : '生成邀请链接'}</button></div></form></section>`;
    overlay.hidden = false;
    const form = overlay.querySelector('form');
    form.elements.role.addEventListener('change', () => syncScopeState(form));
    form.addEventListener('submit', (event) => submitMember(event, member));
    syncScopeState(form);
    window.setTimeout(() => form.elements.name.focus(), 0);
  }

  async function removeMember(member) {
    if (!isTeamAdmin()) return window.note?.('只有团队管理员可以移除成员。');
    const snapshot = state();
    const activeAdmins = (snapshot.members || []).filter((entry) => entry.role === '团队管理员' && entry.status === '正常');
    if (member.role === '团队管理员' && member.status === '正常' && activeAdmins.length <= 1) return window.note?.('工作空间必须至少保留一位正常状态的团队管理员。');
    if (!window.confirm(`确认移除成员“${member.name || member.email}”吗？\n\n移除后，该成员会立即失去全部访问权限。`)) return;
    try {
      if (window.answerTravelApiClient?.status?.().ready) {
        await window.answerTravelApiClient.removeMember(member.id);
        await refreshMembers();
      } else await window.answerTravelApi?.removeMember?.(member.id);
      window.note?.('成员已移除，登录会话和刷新凭证已撤销。');
    } catch (error) { window.note?.(error.message || '成员移除失败。'); }
  }

  async function resendInvitation(member) {
    if (!isTeamAdmin()) return window.note?.('只有团队管理员可以重新生成邀请。');
    try {
      await window.answerTravelApiClient.resendMemberInvitation(member.id);
      await refreshMembers();
      window.note?.('新邀请链接已生成，旧链接已失效。');
    } catch (error) { window.note?.(error.message || '重新邀请失败。'); }
  }

  function enhanceRows() {
    ensureStyle();
    const snapshot = state();
    const admin = isTeamAdmin();
    const section = document.getElementById('section-team');
    if (!section) return;
    section.querySelectorAll('[data-action="member"], [data-action="edit-member"], [data-action="delete-member"]').forEach((button) => {
      button.classList.add('member-admin-only');
      button.hidden = !admin;
    });
    section.querySelectorAll('tr[data-member-id]').forEach((row) => {
      const member = (snapshot.members || []).find((entry) => entry.id === row.dataset.memberId);
      if (!member) return;
      const statusCell = row.children[4];
      const activityCell = row.children[3];
      if (activityCell) activityCell.textContent = member.lastActiveAt ? new Date(member.lastActiveAt).toLocaleString('zh-CN', { hour12: false }) : '尚未登录';
      if (statusCell && member.inviteExpiresAt && member.status === '待接受' && !statusCell.querySelector('.member-row-extra')) {
        const extra = document.createElement('small'); extra.className = 'member-row-extra'; extra.textContent = `有效至 ${new Date(member.inviteExpiresAt).toLocaleString('zh-CN', { hour12: false })}`; statusCell.appendChild(extra);
      }
      const actions = row.querySelector('.persist-actions');
      if (admin && actions && member.status === '待接受' && !actions.querySelector('[data-member-resend]')) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'btn-quiet'; button.dataset.memberResend = member.id; button.textContent = '重新邀请'; actions.prepend(button);
      }
    });
    refreshAudit();
  }

  async function refreshAudit(force = false) {
    const section = document.getElementById('section-team');
    if (!section) return;
    let panel = section.querySelector('[data-member-audit]');
    if (!isTeamAdmin()) { panel?.remove(); return; }
    if (!force && (auditLoading || Date.now() - lastAuditAt < 10000)) return;
    auditLoading = true;
    try {
      const logs = await window.answerTravelApiClient?.listAuditLogs?.({ resourceType: 'member', limit: 12 }) || [];
      lastAuditAt = Date.now();
      if (!panel) {
        panel = document.createElement('div');
        panel.className = 'panel';
        panel.dataset.memberAudit = '';
        section.appendChild(panel);
      }
      const labels = { 'member.invite': '邀请成员', 'member.invite.resend': '重新生成邀请', 'member.accept': '成员接受邀请', 'member.permission.update': '修改成员权限', 'member.remove': '移除成员' };
      panel.innerHTML = `<div class="panel-head"><div><h2>最近权限操作</h2><p>记录邀请、改权、暂停与移除操作，供团队管理员追溯。</p></div><button type="button" class="btn btn-secondary" data-member-audit-refresh>刷新</button></div><div class="member-audit-list">${logs.length ? logs.map((entry) => `<div class="member-audit-row"><strong>${escapeHtml(labels[entry.action] || entry.action)}</strong><span>${escapeHtml(entry.actor || '系统')} · ${escapeHtml(entry.resourceId || '')}</span><span>${escapeHtml(new Date(entry.createdAt).toLocaleString('zh-CN', { hour12: false }))}</span></div>`).join('') : '<div class="member-permission-note">暂无成员权限操作记录。</div>'}</div>`;
    } catch { /* 非管理员或 API 离线时不展示审计面板 */ }
    finally { auditLoading = false; }
  }

  document.addEventListener('click', (event) => {
    const section = event.target.closest('#section-team');
    if (!section) return;
    const resend = event.target.closest('[data-member-resend]');
    const auditRefresh = event.target.closest('[data-member-audit-refresh]');
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (auditRefresh) { event.preventDefault(); event.stopImmediatePropagation(); lastAuditAt = 0; return refreshAudit(true); }
    if (!resend && !['member', 'edit-member', 'delete-member'].includes(action)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const row = event.target.closest('tr[data-member-id]');
    const memberId = resend?.dataset.memberResend || row?.dataset.memberId;
    const member = (state().members || []).find((entry) => entry.id === memberId);
    if (resend && member) return resendInvitation(member);
    if (action === 'edit-member' && member) return openDialog(member);
    if (action === 'delete-member' && member) return removeMember(member);
    openDialog();
  }, true);

  window.addEventListener('answertravel:data-change', () => window.setTimeout(enhanceRows, 0));
  window.addEventListener('answertravel:remote-refresh', () => window.setTimeout(enhanceRows, 0));
  window.addEventListener('answertravel:auth-state', () => window.setTimeout(enhanceRows, 0));
  window.setTimeout(enhanceRows, 0);
})();
