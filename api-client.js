/* Optional bridge for the substantive API phase.
 * Enable with ?api=1. Use &bootstrap=local to upload the current browser state first.
 */
(function () {
  const params = new URLSearchParams(location.search);
  if (params.get('api') !== '1') return;
  const localApi = ['127.0.0.1', 'localhost'].includes(location.hostname) && location.port === '4173'
    ? 'http://127.0.0.1:4174/api/v1'
    : '/api/v1';
  const localOverride = ['127.0.0.1', 'localhost'].includes(location.hostname) ? params.get('apiBase') : '';
  const base = (document.documentElement.dataset.apiBase || localOverride || localApi).replace(/\/$/, '');
  const tokenKey = 'answertravel.api.token';
  const refreshTokenKey = 'answertravel.api.refresh-token';
  const tokenRoleKey = 'answertravel.api.role';
  const tokenDemoKey = 'answertravel.api.demo';
  let ready = false;
  let syncing = false;
  let timer = 0;
  let retryTimer = 0;
  let token = '';
  let tokenRole = '';
  let tokenDemo = false;
  let refreshToken = '';
  let lastError = '';
  let lastSnapshot = null;
  let pendingSnapshot = null;
  let authStatusKey = '';
  let authRevision = 0;
  let bootstrapPromise = null;
  let refreshSessionPromise = null;
  const requestTimeoutMs = 15000;

  function storage() {
    try { return window.localStorage; } catch { return null; }
  }

  function readToken() {
    try { return storage()?.getItem(tokenKey) || ''; } catch { return ''; }
  }

  function readRefreshToken() {
    try { return storage()?.getItem(refreshTokenKey) || ''; } catch { return ''; }
  }

  function readSessionValue(key) {
    try { return storage()?.getItem(key) || ''; } catch { return ''; }
  }

  function writeToken(value) {
    token = value || '';
    try {
      const store = storage();
      if (!store) return;
      if (token) store.setItem(tokenKey, token); else store.removeItem(tokenKey);
    } catch { /* 浏览器禁用存储时仍可用当前页面会话 */ }
  }

  function writeSession(session) {
    writeToken(session?.token || session?.accessToken || '');
    refreshToken = session?.refreshToken || '';
    tokenRole = session?.role || '';
    tokenDemo = Boolean(session?.demo);
    try {
      const store = storage();
      if (!store) return;
      if (refreshToken) store.setItem(refreshTokenKey, refreshToken); else store.removeItem(refreshTokenKey);
      if (tokenRole) store.setItem(tokenRoleKey, tokenRole); else store.removeItem(tokenRoleKey);
      if (tokenDemo) store.setItem(tokenDemoKey, 'true'); else store.removeItem(tokenDemoKey);
    } catch { /* 浏览器禁用存储时仍可用当前页面会话 */ }
  }

  token = readToken();
  refreshToken = readRefreshToken();
  tokenRole = readSessionValue(tokenRoleKey);
  tokenDemo = readSessionValue(tokenDemoKey) === 'true';

  function role() {
    return window.answerTravelStore?.get?.()?.auth?.role || '团队管理员';
  }

  function headers(json) {
    const authHeaders = token && (!tokenDemo || tokenRole === role()) ? { Authorization: `Bearer ${token}` } : { 'X-Demo-Role': encodeURIComponent(role()) };
    return Object.assign(authHeaders, json ? { 'Content-Type': 'application/json' } : {});
  }

  function authError(message) {
    const error = new Error(message || '请先登录 AnswerTravel。');
    error.code = 'ANSWERTRAVEL_AUTH_REQUIRED';
    return error;
  }

  function emitAuth(status, detail = {}) {
    const state = Object.assign({ status, authenticated: Boolean(token), role: tokenRole, demo: tokenDemo, base }, detail);
    const stateKey = JSON.stringify({
      status: state.status,
      authenticated: state.authenticated,
      role: state.role,
      demo: state.demo,
      message: state.message || '',
      invitationId: state.invitation?.id || '',
      invitationEmail: state.invitation?.email || ''
    });
    if (stateKey === authStatusKey) return false;
    authStatusKey = stateKey;
    authRevision += 1;
    state.revision = authRevision;
    window.dispatchEvent(new CustomEvent('answertravel:auth-state', { detail: state }));
    return true;
  }

  function applyLocalAuth(session, loggedIn) {
    const store = window.answerTravelStore;
    const current = store?.get?.();
    if (!current || !store?.save) return;
    current.auth = Object.assign({}, current.auth || {}, {
      loggedIn: Boolean(loggedIn),
      user: session?.user || current.auth?.user || '',
      role: session?.role || current.auth?.role || '品牌成员（只读）',
      email: session?.email || current.auth?.email || ''
    });
    store.save(current);
  }

  function isNetworkError(error) {
    return error?.name === 'AbortError' || error instanceof TypeError || /网络|network|fetch|连接|socket|响应|response/i.test(String(error?.message || ''));
  }

  async function fetchWithTimeout(url, options, timeoutMs = requestTimeoutMs) {
    const controller = new AbortController();
    const timerId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
    } finally {
      window.clearTimeout(timerId);
    }
  }

  async function request(path, options = {}, retryAuth = true) {
    const method = String(options.method || 'GET').toUpperCase();
    const safeMethod = method === 'GET' || method === 'HEAD';
    const requestOptions = Object.assign({}, options, { headers: Object.assign({}, headers(Boolean(options.body)), options.headers || {}) });
    let response;
    let raw = '';
    let lastNetworkError;
    for (let attempt = 0; attempt <= (safeMethod ? 2 : 0); attempt += 1) {
      try {
        response = await fetchWithTimeout(`${base}${path}`, requestOptions);
        raw = await response.text();
        break;
      } catch (error) {
        lastNetworkError = error;
        if (!safeMethod || attempt >= 2 || !isNetworkError(error)) break;
        await new Promise((resolve) => window.setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    if (!response) {
      const message = lastNetworkError?.name === 'AbortError' ? 'API 请求超时，请稍后重试。' : 'API 网络连接中断，请稍后重试。';
      const error = new Error(message);
      error.code = 'ANSWERTRAVEL_NETWORK_ERROR';
      error.cause = lastNetworkError;
      throw error;
    }
    let payload = {};
    if (raw.trim()) {
      try { payload = JSON.parse(raw); }
      catch (error) {
        const parseError = new Error('API 返回了无法解析的响应，请稍后重试。');
        parseError.code = 'ANSWERTRAVEL_INVALID_RESPONSE';
        parseError.cause = error;
        throw parseError;
      }
    }
    if (response.status === 401 && retryAuth && !['/auth/login', '/auth/register', '/auth/refresh'].includes(path)) {
      if (refreshToken) {
        try {
          await refreshSession();
          return request(path, options, false);
        } catch { /* 刷新失败后统一回到登录页，避免并发请求反复自动登录 */ }
      }
      writeSession({});
      ready = false;
      applyLocalAuth({}, false);
      emitAuth('required', { message: payload?.error?.message || '登录已失效，请重新登录。' });
      throw authError(payload?.error?.message || '登录已失效，请重新登录。');
    }
    if (!response.ok) throw new Error(payload?.error?.message || `API 请求失败（${response.status}）`);
    return payload;
  }

  async function login() {
    const snapshot = window.answerTravelStore?.get?.() || {};
    const response = await fetchWithTimeout(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: snapshot.auth?.user || 'Admin', role: role() })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.data?.token) throw authError(payload?.error?.message || `需要邮箱登录（${response.status}）`);
    writeSession(payload.data);
    applyLocalAuth(payload.data, true);
    emitAuth('authenticated', { session: payload.data });
    return payload.data;
  }

  async function loginWithPassword(email, password) {
    emitAuth('authenticating');
    const response = await fetchWithTimeout(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.data?.token) {
      const error = new Error(payload?.error?.message || `登录失败（${response.status}）`);
      emitAuth('required', { message: error.message });
      throw error;
    }
    writeSession(payload.data);
    applyLocalAuth(payload.data, true);
    emitAuth('authenticated', { session: payload.data });
    return payload.data;
  }

  async function localAdminStatus() {
    const response = await fetchWithTimeout(`${base}/auth/local-admin`, { method: 'GET' });
    const payload = await response.json().catch(() => ({}));
    return Boolean(response.ok && payload?.data?.available);
  }

  async function loginAsLocalAdmin() {
    emitAuth('authenticating');
    const response = await fetchWithTimeout(`${base}/auth/local-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.data?.token) {
      const error = new Error(payload?.error?.message || `本地快捷登录失败（${response.status}）`);
      emitAuth('required', { message: error.message });
      throw error;
    }
    writeSession(payload.data);
    applyLocalAuth(payload.data, true);
    emitAuth('authenticated', { session: payload.data });
    return payload.data;
  }

  async function register(input) {
    emitAuth('authenticating');
    const response = await fetchWithTimeout(`${base}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input || {})
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.data?.token) {
      const error = new Error(payload?.error?.message || `注册失败（${response.status}）`);
      emitAuth('required', { message: error.message });
      throw error;
    }
    writeSession(payload.data);
    if (params.has('invite')) {
      params.delete('invite');
      const nextUrl = new URL(location.href);
      nextUrl.searchParams.delete('invite');
      history.replaceState(null, '', nextUrl.href);
    }
    applyLocalAuth(payload.data, true);
    emitAuth('authenticated', { session: payload.data });
    return payload.data;
  }

  async function logout() {
    try {
      await request('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }, false);
    } finally {
      writeSession({});
      ready = false;
      applyLocalAuth({}, false);
      emitAuth('required', { message: '你已安全退出。' });
    }
  }

  async function refreshSession() {
    if (refreshSessionPromise) return refreshSessionPromise;
    if (!refreshToken) throw new Error('没有可用的刷新凭证。');
    const currentRefreshToken = refreshToken;
    refreshSessionPromise = (async () => {
      const response = await fetchWithTimeout(`${base}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: currentRefreshToken })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.data?.token) {
        writeSession({});
        throw new Error(payload?.error?.message || `刷新会话失败（${response.status}）`);
      }
      writeSession(payload.data);
      applyLocalAuth(payload.data, true);
      emitAuth('authenticated', { session: payload.data });
      return payload.data;
    })();
    try {
      return await refreshSessionPromise;
    } finally {
      refreshSessionPromise = null;
    }
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function same(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function byId(items) {
    return new Map((Array.isArray(items) ? items : []).filter((item) => item?.id).map((item) => [item.id, item]));
  }

  function replaceBaselineItem(baseline, key, item) {
    if (!Array.isArray(baseline[key])) baseline[key] = [];
    const index = baseline[key].findIndex((entry) => entry.id === item.id);
    if (index >= 0) baseline[key][index] = clone(item); else baseline[key].push(clone(item));
  }

  function removeBaselineItem(baseline, key, itemId) {
    baseline[key] = (baseline[key] || []).filter((entry) => entry.id !== itemId);
  }

  function invitationRegistrationUrl(inviteUrl) {
    const inviteToken = String(inviteUrl || '').split('/').filter(Boolean).at(-1) || '';
    const url = new URL(location.href);
    url.searchParams.set('api', '1');
    url.searchParams.set('invite', inviteToken);
    url.searchParams.delete('bootstrap');
    url.searchParams.delete('section');
    url.hash = '';
    return url.href;
  }

  function scheduleRetry() {
    window.clearTimeout(retryTimer);
    retryTimer = window.setTimeout(() => reconcile(pendingSnapshot || window.answerTravelStore?.get?.()), 10000);
  }

  async function importSnapshot(snapshot) {
    if (!snapshot || syncing) return false;
    syncing = true;
    try {
      await request('/snapshot', { method: 'PUT', body: JSON.stringify({ data: snapshot }) });
      lastError = '';
      return true;
    } catch (error) {
      lastError = error.message;
      window.note?.(`服务端同步失败：${error.message}`);
      return false;
    } finally {
      syncing = false;
    }
  }

  async function loadRemoteResources() {
    const [workspace, brands, promptGroups, prompts, records, assets, articles, tasks, members] = await Promise.all([
      request('/workspace'), request('/brands'), request('/prompt-groups'), request('/prompts'), request('/records'),
      request('/assets'), request('/articles'), request('/tasks'), request('/members')
    ]);
    const local = clone(window.answerTravelStore?.get?.() || {});
    const workspaceData = workspace?.data || {};
    local.workspace = Object.assign({}, local.workspace || {}, workspaceData);
    local.setupCompleted = Boolean(workspaceData.setupCompleted);
    local.wizardDraft = workspaceData.wizardDraft || local.wizardDraft || {};
    delete local.workspace.setupCompleted;
    delete local.workspace.wizardDraft;
    Object.assign(local, {
      brands: brands?.data || [], promptGroups: promptGroups?.data || [], prompts: prompts?.data || [], records: (records?.data || []).map((record) => Object.assign({}, record, { sources: (record.sources || []).map((source) => Array.isArray(source) ? source : Object.assign({}, source)) })),
      assets: assets?.data || [], articles: articles?.data || [], tasks: tasks?.data || [], members: members?.data || []
    });
    return local;
  }

  let refreshPromise = null;
  async function refreshFromServer(options = {}) {
    if (!ready || syncing || pendingSnapshot || timer) return false;
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      syncing = true;
      try {
        const remoteData = await loadRemoteResources();
        if (!remoteData || !window.answerTravelStore?.save) return false;
        window.answerTravelStore.save(remoteData);
        lastSnapshot = clone(remoteData);
        lastError = '';
        window.dispatchEvent(new CustomEvent('answertravel:remote-refresh', { detail: { at: new Date().toISOString() } }));
        if (!options.silent) window.note?.('已取得团队和后台任务的最新数据。');
        return true;
      } catch (error) {
        lastError = error.message;
        if (!options.silent) window.note?.(`刷新失败：${error.message}`);
        return false;
      } finally {
        syncing = false;
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  }

  async function syncCollection(previous, next, key, handlers, baseline) {
    const before = byId(previous?.[key]);
    const after = byId(next?.[key]);
    for (const [itemId, oldItem] of before) {
      if (after.has(itemId)) continue;
      await handlers.remove(itemId, oldItem);
      removeBaselineItem(baseline, key, itemId);
    }
    for (const [itemId, item] of after) {
      const oldItem = before.get(itemId);
      if (!oldItem) await handlers.create(item);
      else if (!same(oldItem, item)) await handlers.update(itemId, item, oldItem);
      if (!oldItem || !same(oldItem, item)) replaceBaselineItem(baseline, key, item);
    }
  }

  async function reconcile(snapshot) {
    if (!snapshot || !ready || syncing) return false;
    pendingSnapshot = clone(snapshot);
    syncing = true;
    const previous = lastSnapshot || clone(snapshot);
    const baseline = clone(previous);
    try {
      const workspaceChanged = !same(previous.workspace?.brandId, snapshot.workspace?.brandId) ||
        !same(previous.setupCompleted, snapshot.setupCompleted) || !same(previous.wizardDraft, snapshot.wizardDraft);
      if (workspaceChanged) {
        await request('/workspace', { method: 'PATCH', body: JSON.stringify({ brandId: snapshot.workspace?.brandId || '', setupCompleted: Boolean(snapshot.setupCompleted), wizardDraft: snapshot.wizardDraft || {} }) });
        baseline.workspace = Object.assign({}, baseline.workspace || {}, { brandId: snapshot.workspace?.brandId || '' });
        baseline.setupCompleted = Boolean(snapshot.setupCompleted);
        baseline.wizardDraft = clone(snapshot.wizardDraft || {});
      }
      if (!same(previous.workspace?.team, snapshot.workspace?.team)) {
        await request('/workspace/team', { method: 'PATCH', body: JSON.stringify(snapshot.workspace?.team || {}) });
        baseline.workspace = Object.assign({}, baseline.workspace || {}, { team: clone(snapshot.workspace?.team || {}) });
      }

      await syncCollection(previous, snapshot, 'brands', {
        create: async (item) => { await request('/brands', { method: 'POST', body: JSON.stringify(item) }); if (item.competitors?.length) await request(`/brands/${encodeURIComponent(item.id)}/competitors`, { method: 'PUT', body: JSON.stringify({ competitors: item.competitors }) }); },
        update: async (itemId, item, oldItem) => { await request(`/brands/${encodeURIComponent(itemId)}`, { method: 'PATCH', body: JSON.stringify(item) }); if (!same(oldItem.competitors || [], item.competitors || [])) await request(`/brands/${encodeURIComponent(itemId)}/competitors`, { method: 'PUT', body: JSON.stringify({ competitors: item.competitors || [] }) }); },
        remove: (itemId) => request(`/brands/${encodeURIComponent(itemId)}`, { method: 'DELETE' })
      }, baseline);

      await syncCollection(previous, snapshot, 'promptGroups', {
        create: (item) => request('/prompt-groups', { method: 'POST', body: JSON.stringify(item) }),
        update: (itemId, item) => request(`/prompt-groups/${encodeURIComponent(itemId)}`, { method: 'PATCH', body: JSON.stringify(item) }),
        remove: (itemId) => request(`/prompt-groups/${encodeURIComponent(itemId)}`, { method: 'DELETE' })
      }, baseline);

      await syncCollection(previous, snapshot, 'prompts', {
        create: (item) => request('/prompts', { method: 'POST', body: JSON.stringify(item) }),
        update: (itemId, item) => request(`/prompts/${encodeURIComponent(itemId)}`, { method: 'PATCH', body: JSON.stringify(item) }),
        remove: (itemId) => request(`/prompts/${encodeURIComponent(itemId)}`, { method: 'DELETE' })
      }, baseline);

      await syncCollection(previous, snapshot, 'assets', {
        create: (item) => request('/assets', { method: 'POST', body: JSON.stringify(item) }),
        update: (itemId, item) => request(`/assets/${encodeURIComponent(itemId)}`, { method: 'PATCH', body: JSON.stringify(item) }),
        remove: (itemId) => request(`/assets/${encodeURIComponent(itemId)}`, { method: 'DELETE' })
      }, baseline);

      await syncCollection(previous, snapshot, 'articles', {
        create: async (item) => {
          await request('/articles', { method: 'POST', body: JSON.stringify(item) });
          if (item.status === '发布中') await request(`/articles/${encodeURIComponent(item.id)}/publish`, { method: 'POST', body: JSON.stringify({ channel: item.channel }) });
        },
        update: async (itemId, item, oldItem) => {
          await request(`/articles/${encodeURIComponent(itemId)}`, { method: 'PATCH', body: JSON.stringify(item) });
          const factKeys = ['factSources', 'factUpdated', 'factAuthor', 'factContact', 'factPricing'];
          if (factKeys.some((key) => oldItem[key] !== item[key])) await request(`/articles/${encodeURIComponent(itemId)}/review`, { method: 'POST', body: JSON.stringify(item) });
          if (oldItem.status !== '发布中' && item.status === '发布中') await request(`/articles/${encodeURIComponent(itemId)}/publish`, { method: 'POST', body: JSON.stringify({ channel: item.channel }) });
          if (oldItem.indexStatus !== '已收录' && item.indexStatus === '已收录') await request(`/articles/${encodeURIComponent(itemId)}/index`, { method: 'POST', body: '{}' });
        },
        remove: (itemId) => request(`/articles/${encodeURIComponent(itemId)}`, { method: 'DELETE' })
      }, baseline);

      await syncCollection(previous, snapshot, 'members', {
        create: async (item) => {
          const payload = await request('/members', { method: 'POST', body: JSON.stringify(item) });
          if (payload?.data?.inviteUrl) {
            window.dispatchEvent(new CustomEvent('answertravel:invitation-created', {
              detail: { member: clone(item), registrationUrl: invitationRegistrationUrl(payload.data.inviteUrl) }
            }));
          }
          return payload;
        },
        update: (itemId, item) => request(`/members/${encodeURIComponent(itemId)}`, { method: 'PATCH', body: JSON.stringify(item) }),
        remove: (itemId) => request(`/members/${encodeURIComponent(itemId)}`, { method: 'DELETE' })
      }, baseline);

      const beforeChannels = byId(previous.workspace?.channels);
      for (const channel of snapshot.workspace?.channels || []) {
        const oldChannel = beforeChannels.get(channel.id);
        if (oldChannel && !same(oldChannel, channel)) await request(`/workspace/channels/${encodeURIComponent(channel.id)}`, { method: 'PATCH', body: JSON.stringify(channel) });
      }
      baseline.workspace = Object.assign({}, baseline.workspace || {}, { channels: clone(snapshot.workspace?.channels || []) });
      lastSnapshot = baseline;
      pendingSnapshot = null;
      lastError = '';
      return true;
    } catch (error) {
      lastSnapshot = baseline;
      lastError = error.message;
      window.note?.(`增量保存失败，将自动重试：${error.message}`);
      scheduleRetry();
      return false;
    } finally {
      syncing = false;
    }
  }

  function bootstrap() {
    if (bootstrapPromise) return bootstrapPromise;
    const run = (async () => {
      window.clearTimeout(retryTimer);
      emitAuth('checking');
      try {
      await request('/health');
      const pendingInviteToken = params.get('invite');
      if (pendingInviteToken) {
        writeSession({});
        applyLocalAuth({}, false);
        try {
          const invitation = await request(`/invitations/${encodeURIComponent(pendingInviteToken)}`, {}, false);
          ready = true;
          lastError = '';
          emitAuth('required', {
            message: '邀请已验证，请设置密码并加入团队。',
            invitation: invitation?.data || null
          });
        } catch (error) {
          ready = false;
          lastError = error.message;
          emitAuth('required', { message: error.message, invitation: null });
        }
        return;
      }
      let session;
      if (token) {
        const current = await request('/auth/me');
        session = current?.data;
        if (session) {
          tokenRole = session.role || tokenRole;
          applyLocalAuth(session, true);
          emitAuth('authenticated', { session });
        }
      } else {
        session = await login();
      }
      const local = window.answerTravelStore?.get?.();
      if (params.get('bootstrap') === 'local') {
        await importSnapshot(local);
        window.note?.('已将当前浏览器数据同步到 AnswerTravel API。');
        lastSnapshot = clone(local);
      } else {
        const remoteData = await loadRemoteResources();
        if (remoteData && window.answerTravelStore?.save) {
          syncing = true;
          window.answerTravelStore.save(remoteData);
          syncing = false;
        }
        lastSnapshot = clone(remoteData);
        window.note?.('已连接 AnswerTravel API，页面数据通过增量接口读写。');
      }
      ready = true;
      lastError = '';
      emitAuth('ready', { session });
      } catch (error) {
        ready = false;
        lastError = error.message;
        if (error.code === 'ANSWERTRAVEL_AUTH_REQUIRED') {
          emitAuth('required', { message: error.message });
          return;
        }
        window.note?.(`AnswerTravel API 暂不可用，继续使用浏览器本地数据：${error.message}`);
        emitAuth('offline', { message: error.message });
        scheduleRetry();
      }
    })();
    bootstrapPromise = run;
    run.then(
      () => { if (bootstrapPromise === run) bootstrapPromise = null; },
      () => { if (bootstrapPromise === run) bootstrapPromise = null; }
    );
    return run;
  }

  window.answerTravelApiClient = {
    base,
    status: () => ({ enabled: true, ready, syncing, authenticated: Boolean(token), refreshable: Boolean(refreshToken), role: tokenRole, demo: tokenDemo, base, lastError }),
    sync: () => reconcile(window.answerTravelStore?.get?.()),
    importSnapshot: () => importSnapshot(window.answerTravelStore?.get?.()),
    reload: bootstrap,
    refreshFromServer,
    login,
    loginWithPassword,
    localAdminStatus,
    loginAsLocalAdmin,
    register,
    logout,
    refresh: refreshSession,
    clearSession: () => { writeSession({}); ready = false; applyLocalAuth({}, false); emitAuth('required'); },
    listBrands: () => request('/brands').then((payload) => payload.data),
    createBrand: (input) => request('/brands', { method: 'POST', body: JSON.stringify(input || {}) }).then((payload) => payload.data),
    updateBrand: (id, input) => request(`/brands/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input || {}) }).then((payload) => payload.data),
    deleteBrand: (id) => request(`/brands/${encodeURIComponent(id)}`, { method: 'DELETE' }).then((payload) => payload.data),
    listPrompts: () => request('/prompts').then((payload) => payload.data),
    listPromptGroups: (brandId = '') => request(`/prompt-groups${brandId ? `?brandId=${encodeURIComponent(brandId)}` : ''}`).then((payload) => payload.data),
    createPromptGroup: (input) => request('/prompt-groups', { method: 'POST', body: JSON.stringify(input || {}) }).then((payload) => payload.data),
    updatePromptGroup: (id, input) => request(`/prompt-groups/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input || {}) }).then((payload) => payload.data),
    deletePromptGroup: (id) => request(`/prompt-groups/${encodeURIComponent(id)}`, { method: 'DELETE' }).then((payload) => payload.data),
    createPrompt: (input) => request('/prompts', { method: 'POST', body: JSON.stringify(input || {}) }).then((payload) => payload.data),
    updatePrompt: (id, input) => request(`/prompts/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input || {}) }).then((payload) => payload.data),
    deletePrompt: (id) => request(`/prompts/${encodeURIComponent(id)}`, { method: 'DELETE' }).then((payload) => payload.data),
    listRecords: (filters = {}) => request(`/records?${new URLSearchParams(filters)}`).then((payload) => payload.data),
    refreshSources: (recordId, options = {}) => request('/sources/refresh', { method: 'POST', body: JSON.stringify(Object.assign({ recordId }, options || {})) }).then((payload) => payload.data),
    listProviders: () => request('/providers').then((payload) => payload.data),
    getCollectionStatus: () => request('/collection/status').then((payload) => payload.data),
    getBrandIntelligence: (brandId = '') => request(`/brand-intelligence${brandId ? `?brandId=${encodeURIComponent(brandId)}` : ''}`).then((payload) => payload.data),
    listTasks: () => request('/tasks').then((payload) => payload.data),
    rerunRecord: (id) => request(`/records/${encodeURIComponent(id)}/rerun`, { method: 'POST', body: '{}' }).then((payload) => payload.data),
    retryTask: (id) => request(`/tasks/${encodeURIComponent(id)}/retry`, { method: 'POST', body: '{}' }).then((payload) => payload.data),
    cancelTask: (id) => request(`/tasks/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: '{}' }).then((payload) => payload.data),
    listAssets: () => request('/assets').then((payload) => payload.data),
    listArticles: () => request('/articles').then((payload) => payload.data),
    listAuditLogs: (filters = {}) => request(`/audit-logs?${new URLSearchParams(filters)}`).then((payload) => payload.data),
    inviteMember: (input) => request('/members', { method: 'POST', body: JSON.stringify(input || {}) }).then((payload) => {
      const data = payload.data;
      if (data?.inviteUrl) data.registrationUrl = invitationRegistrationUrl(data.inviteUrl);
      return data;
    }),
    updateMember: (id, input) => request(`/members/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(input || {}) }).then((payload) => payload.data),
    resendMemberInvitation: (id) => request(`/members/${encodeURIComponent(id)}/resend-invitation`, { method: 'POST', body: '{}' }).then((payload) => {
      const data = payload.data;
      if (data?.inviteUrl) {
        data.registrationUrl = invitationRegistrationUrl(data.inviteUrl);
        window.dispatchEvent(new CustomEvent('answertravel:invitation-created', { detail: { member: clone(data), registrationUrl: data.registrationUrl } }));
      }
      return data;
    }),
    removeMember: (id) => request(`/members/${encodeURIComponent(id)}`, { method: 'DELETE' }).then((payload) => payload.data)
  };

  window.addEventListener('answertravel:data-change', (event) => {
    if (!ready || syncing) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = null;
      reconcile(event.detail || window.answerTravelStore?.get?.());
    }, 180);
  });

  if (typeof window.setInterval === 'function') window.setInterval(() => {
    if (!document.hidden) refreshFromServer({ silent: true });
  }, 5000);
  window.addEventListener('focus', () => refreshFromServer({ silent: true }));
  document.addEventListener?.('visibilitychange', () => {
    if (!document.hidden) refreshFromServer({ silent: true });
  });

  window.setTimeout(bootstrap, 0);
})();
