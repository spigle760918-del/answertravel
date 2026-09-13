(function () {
  const params = new URLSearchParams(location.search);
  if (params.get('api') !== '1') return;

  const componentVersion = '20260910-4';
  const inviteToken = params.get('invite') || '';
  let mode = inviteToken ? 'register' : 'login';
  let gate;
  let message;
  let invitationDialog;
  let gateVisible = false;
  let localAdminCheck = 0;
  let lastAuthRevision = 0;

  function client() {
    return window.answerTravelApiClient;
  }

  function setMessage(value, success = false) {
    if (!message) return;
    message.textContent = value || '';
    message.classList.toggle('success', success);
  }

  function setBusy(busy) {
    gate?.classList.toggle('auth-busy', Boolean(busy));
    gate?.querySelectorAll('button,input').forEach((control) => { control.disabled = Boolean(busy); });
  }

  function setMode(next) {
    mode = next === 'register' ? 'register' : 'login';
    gate.querySelectorAll('[data-auth-tab]').forEach((tab) => tab.classList.toggle('active', tab.dataset.authTab === mode));
    gate.querySelector('#answertravelLoginForm').hidden = mode !== 'login';
    gate.querySelector('#answertravelRegisterForm').hidden = mode !== 'register';
    gate.querySelector('#answertravelAuthTitle').textContent = mode === 'login' ? '登录工作空间' : '接受邀请并注册';
    gate.querySelector('#answertravelAuthSubtitle').textContent = mode === 'login' ? '使用团队账号继续管理品牌监控。' : '创建账号后加入受邀团队。';
    setMessage('');
  }

  function show(detail = {}) {
    const opening = !gateVisible;
    gateVisible = true;
    gate.hidden = false;
    document.documentElement.dataset.authGate = 'open';
    if (detail.invitation) {
      setMode('register');
      const form = gate.querySelector('#answertravelRegisterForm');
      const nameInput = form?.querySelector('input[name="name"]');
      const emailInput = form?.querySelector('input[name="email"]');
      if (nameInput && detail.invitation.name) nameInput.value = detail.invitation.name;
      if (emailInput) {
        emailInput.value = detail.invitation.email || '';
        emailInput.readOnly = true;
      }
    }
    setMessage(detail.message || '');
    if (opening) {
      updateLocalAdminLogin();
      window.setTimeout(() => {
        if (gateVisible) gate.querySelector(mode === 'login' ? 'input[name="email"]' : 'input[name="name"]')?.focus({ preventScroll: true });
      }, 0);
    }
  }

  async function updateLocalAdminLogin() {
    const button = gate?.querySelector('[data-auth-local-admin]');
    if (!button || typeof client()?.localAdminStatus !== 'function') return;
    const check = ++localAdminCheck;
    button.hidden = true;
    try {
      const available = await client().localAdminStatus();
      if (gateVisible && check === localAdminCheck) button.hidden = !available;
    } catch {
      if (check === localAdminCheck) button.hidden = true;
    }
  }

  async function loginAsLocalAdmin() {
    if (!client()?.loginAsLocalAdmin) return;
    setBusy(true);
    setMessage('正在进入本地管理员工作空间...');
    try {
      await client().loginAsLocalAdmin();
      setMessage('登录成功，正在载入工作空间...', true);
      await client().reload();
      hide();
    } catch (error) {
      setMessage(error.message || '本地快捷登录失败，请重试。');
    } finally {
      setBusy(false);
    }
  }

  function hide() {
    if (!gateVisible && gate.hidden) return;
    gateVisible = false;
    localAdminCheck += 1;
    gate.hidden = true;
    delete document.documentElement.dataset.authGate;
    setMessage('');
  }

  function syncAccessPanel(detail = {}) {
    const panel = document.getElementById('persistAccessPanel');
    if (!panel) return;
    const status = client()?.status?.() || {};
    const copy = panel.querySelector('.access-panel-head p');
    const state = panel.querySelector('.access-state');
    const roleControl = panel.querySelector('.access-controls label');
    const button = panel.querySelector('[data-action="toggle-login"]');
    const hint = panel.querySelector('.persist-muted');
    if (copy) copy.textContent = status.authenticated ? '账号会话由 AnswerTravel API 验证，权限变更由服务端统一控制。' : '登录后可读取团队数据并执行当前角色获准的操作。';
    if (roleControl) roleControl.hidden = true;
    if (state) {
      state.textContent = status.authenticated ? '● 已连接' : '● 未登录';
      state.classList.toggle('offline', !status.authenticated);
    }
    if (button) button.textContent = status.authenticated ? '退出账号' : '登录账号';
    if (hint) hint.textContent = status.authenticated ? `权限：${detail.session?.role || status.role || '已登录成员'} · 服务端权限控制` : '需要有效账号或团队邀请';
  }

  async function submitLogin(form) {
    const email = String(form.querySelector('input[name="email"]')?.value || '').trim();
    const password = String(form.querySelector('input[name="password"]')?.value || '');
    if (!email) throw new Error('请输入登录邮箱。');
    if (!password) throw new Error('请输入登录密码。');
    await client().loginWithPassword(email, password);
  }

  async function submitRegister(form) {
    const values = new FormData(form);
    const password = String(values.get('password') || '');
    if (password !== String(values.get('passwordConfirm') || '')) throw new Error('两次输入的密码不一致。');
    await client().register({
      name: String(values.get('name') || '').trim(),
      email: String(values.get('email') || '').trim(),
      password,
      inviteToken: String(values.get('inviteToken') || '').trim()
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!client()) return setMessage('认证服务尚未载入，请稍后重试。');
    setBusy(true);
    setMessage('正在验证账号...');
    try {
      if (mode === 'register') await submitRegister(event.currentTarget); else await submitLogin(event.currentTarget);
      setMessage('登录成功，正在载入工作空间...', true);
      await client().reload();
      hide();
    } catch (error) {
      setMessage(error.message || '操作失败，请重试。');
    } finally {
      setBusy(false);
    }
  }

  function togglePassword(checked) {
    gate.querySelectorAll('input[type="password"], input[data-auth-password]').forEach((input) => {
      input.type = checked ? 'text' : 'password';
      input.dataset.authPassword = 'true';
    });
  }

  function closeInvitation() {
    if (invitationDialog) invitationDialog.hidden = true;
  }

  async function copyInvitation() {
    const input = invitationDialog?.querySelector('input');
    if (!input) return;
    try {
      await navigator.clipboard.writeText(input.value);
    } catch {
      input.focus();
      input.select();
      document.execCommand('copy');
    }
    const button = invitationDialog.querySelector('[data-copy-invitation]');
    if (button) {
      button.textContent = '已复制';
      window.setTimeout(() => { button.textContent = '复制链接'; }, 1600);
    }
  }

  function showInvitation(detail = {}) {
    if (!invitationDialog || !detail.registrationUrl) return;
    invitationDialog.querySelector('input').value = detail.registrationUrl;
    invitationDialog.querySelector('[data-invitation-member]').textContent = detail.member?.email || '受邀成员';
    invitationDialog.hidden = false;
    invitationDialog.querySelector('input').focus();
    invitationDialog.querySelector('input').select();
  }

  function mount() {
    gate = document.createElement('div');
    gate.className = 'auth-gate';
    gate.hidden = true;
    gate.innerHTML = `
      <section class="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="answertravelAuthTitle">
        <aside class="auth-context">
          <div class="auth-brand"><span class="auth-brand-mark">AT</span><span>AnswerTravel</span></div>
          <div class="auth-context-copy"><h2>看见游客出发前的每一个问题</h2><p>持续追踪目的地品牌在多平台大模型中的提及、排名与引用来源。</p></div>
          <div class="auth-context-foot">文旅目的地 AI 推荐监控与内容优化工作台</div>
        </aside>
        <main class="auth-main">
          <header class="auth-head"><h1 id="answertravelAuthTitle">登录工作空间</h1><p id="answertravelAuthSubtitle">使用团队账号继续管理品牌监控。</p></header>
          <div class="auth-tabs" role="tablist"><button class="auth-tab" type="button" data-auth-tab="login">账号登录</button><button class="auth-tab" type="button" data-auth-tab="register">邀请注册</button></div>
          <form class="auth-form" id="answertravelLoginForm">
            <div class="auth-field"><label for="answertravelLoginEmail">邮箱</label><input id="answertravelLoginEmail" name="email" type="email" autocomplete="username" required></div>
            <div class="auth-field"><label for="answertravelLoginPassword">密码</label><input id="answertravelLoginPassword" name="password" type="password" autocomplete="current-password" minlength="10" required></div>
            <label class="auth-check"><input type="checkbox" data-auth-show-password>显示密码</label>
            <button class="auth-submit" type="submit">登录</button>
            <button class="auth-local-admin" type="button" data-auth-local-admin hidden>本地管理员快捷登录</button>
          </form>
          <form class="auth-form" id="answertravelRegisterForm" hidden>
            <div class="auth-field"><label for="answertravelRegisterName">姓名</label><input id="answertravelRegisterName" name="name" autocomplete="name" required></div>
            <div class="auth-field"><label for="answertravelRegisterEmail">邮箱</label><input id="answertravelRegisterEmail" name="email" type="email" autocomplete="username" required></div>
            <div class="auth-field"><label for="answertravelInviteToken">邀请码</label><input id="answertravelInviteToken" name="inviteToken" value="${inviteToken.replace(/[&<>"']/g, '')}" required></div>
            <div class="auth-field"><label for="answertravelRegisterPassword">设置密码</label><input id="answertravelRegisterPassword" name="password" type="password" autocomplete="new-password" minlength="10" required></div>
            <div class="auth-field"><label for="answertravelRegisterPasswordConfirm">确认密码</label><input id="answertravelRegisterPasswordConfirm" name="passwordConfirm" type="password" autocomplete="new-password" minlength="10" required></div>
            <label class="auth-check"><input type="checkbox" data-auth-show-password>显示密码</label>
            <button class="auth-submit" type="submit">注册并加入团队</button>
          </form>
          <div class="auth-message" role="status" aria-live="polite"></div>
          <div class="auth-offline"><span>连接地址：${client()?.base || 'AnswerTravel API'} · 登录组件 ${componentVersion}</span><button class="auth-retry" type="button" data-auth-retry>重新连接</button></div>
        </main>
      </section>`;
    document.body.appendChild(gate);
    invitationDialog = document.createElement('div');
    invitationDialog.className = 'invitation-share';
    invitationDialog.hidden = true;
    invitationDialog.innerHTML = `
      <section class="invitation-share-dialog" role="dialog" aria-modal="true" aria-labelledby="answertravelInvitationTitle">
        <div class="invitation-share-head"><div><h2 id="answertravelInvitationTitle">邀请链接已生成</h2><p><span data-invitation-member></span> 可通过此链接注册并加入团队。</p></div><button type="button" class="invitation-share-close" data-close-invitation aria-label="关闭">×</button></div>
        <label class="invitation-share-field"><span>注册链接</span><input type="text" readonly></label>
        <div class="invitation-share-actions"><button type="button" class="btn btn-secondary" data-close-invitation>完成</button><button type="button" class="btn btn-primary" data-copy-invitation>复制链接</button></div>
      </section>`;
    document.body.appendChild(invitationDialog);
    invitationDialog.querySelectorAll('[data-close-invitation]').forEach((button) => button.addEventListener('click', closeInvitation));
    invitationDialog.querySelector('[data-copy-invitation]').addEventListener('click', copyInvitation);
    invitationDialog.addEventListener('click', (event) => { if (event.target === invitationDialog) closeInvitation(); });
    message = gate.querySelector('.auth-message');
    gate.querySelectorAll('[data-auth-tab]').forEach((tab) => tab.addEventListener('click', () => setMode(tab.dataset.authTab)));
    gate.querySelectorAll('[data-auth-show-password]').forEach((checkbox) => checkbox.addEventListener('change', () => togglePassword(checkbox.checked)));
    gate.querySelector('#answertravelLoginForm').addEventListener('submit', handleSubmit);
    gate.querySelector('[data-auth-local-admin]').addEventListener('click', loginAsLocalAdmin);
    gate.querySelector('#answertravelRegisterForm').addEventListener('submit', handleSubmit);
    gate.querySelector('[data-auth-retry]').addEventListener('click', async () => {
      setBusy(true);
      setMessage('正在重新连接...');
      try { await client()?.reload(); } finally { setBusy(false); }
    });
    setMode(mode);
  }

  window.addEventListener('answertravel:auth-state', (event) => {
    const detail = event.detail || {};
    if (detail.revision && detail.revision < lastAuthRevision) return;
    if (detail.revision) lastAuthRevision = detail.revision;
    window.setTimeout(() => syncAccessPanel(detail), 0);
    if (detail.status === 'required') show(detail);
    if (detail.status === 'ready') hide();
    if (detail.status === 'offline') show({ message: `服务暂时不可用：${detail.message || '请稍后重试。'}` });
  });

  window.addEventListener('answertravel:invitation-created', (event) => showInvitation(event.detail || {}));
  window.addEventListener('answertravel:data-change', () => window.setTimeout(() => syncAccessPanel(), 0));

  window.addEventListener('click', async (event) => {
    if (event.target.closest('[data-section="team"]')) window.setTimeout(() => syncAccessPanel(), 0);
    const trigger = event.target.closest('[data-action="toggle-login"]');
    if (!trigger) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const status = client()?.status?.();
    if (!status?.authenticated) return show();
    trigger.disabled = true;
    try { await client().logout(); } catch (error) { show({ message: error.message }); } finally { trigger.disabled = false; }
  }, true);

  mount();
})();
