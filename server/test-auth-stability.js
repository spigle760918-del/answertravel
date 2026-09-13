const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class MemoryStorage {
  constructor(initial = {}) { this.values = new Map(Object.entries(initial)); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

class TestEventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) || []) listener.call(this, event);
    return true;
  }
}

class TestCustomEvent {
  constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
}

function response(status, payload) {
  const raw = JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => raw
  };
}

async function waitUntil(check, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(message);
}

async function main() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api-client.js'), 'utf8');
  const events = [];
  const requests = [];
  const browser = new TestEventTarget();
  const location = new URL('http://127.0.0.1:4177/index.html?api=1&apiBase=http%3A%2F%2F127.0.0.1%3A4183%2Fapi%2Fv1');
  const storage = new MemoryStorage({
    'answertravel.api.token': 'access-token-1',
    'answertravel.api.refresh-token': 'refresh-token-1',
    'answertravel.api.role': '团队管理员'
  });
  const collectionPaths = new Set(['/workspace', '/brands', '/prompt-groups', '/prompts', '/records', '/assets', '/articles', '/tasks', '/members']);
  let snapshot = { auth: { loggedIn: true, user: 'Admin', role: '团队管理员', email: 'admin@answertravel.local' } };
  let phase = 'initial';
  let refreshCount = 0;

  browser.window = browser;
  browser.localStorage = storage;
  browser.location = location;
  browser.history = { replaceState() {} };
  browser.document = { hidden: false, documentElement: { dataset: {} }, addEventListener() {} };
  browser.setTimeout = setTimeout;
  browser.clearTimeout = clearTimeout;
  browser.note = () => {};
  browser.answerTravelStore = {
    get: () => snapshot,
    save: (value) => { snapshot = value; }
  };
  browser.addEventListener('answertravel:auth-state', (event) => events.push(event.detail));

  const fetch = async (url, options = {}) => {
    const requestUrl = new URL(url);
    const apiPath = requestUrl.pathname.replace('/api/v1', '');
    const authorization = options.headers?.Authorization || '';
    requests.push({ apiPath, authorization });
    if (apiPath === '/health') return response(200, { ok: true });
    if (apiPath === '/auth/me') {
      return response(200, { data: { user: 'Admin', email: 'admin@answertravel.local', role: '团队管理员' } });
    }
    if (apiPath === '/auth/refresh') {
      refreshCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return response(200, {
        data: {
          token: 'access-token-2', refreshToken: 'refresh-token-2',
          user: 'Admin', email: 'admin@answertravel.local', role: '团队管理员'
        }
      });
    }
    if (collectionPaths.has(apiPath)) {
      if (phase === 'parallel-401' && authorization === 'Bearer access-token-1') {
        return response(401, { error: { message: '会话已过期' } });
      }
      if (apiPath === '/workspace') return response(200, { data: { team: {}, channels: [], brandId: '', setupCompleted: true, wizardDraft: {} } });
      return response(200, { data: [] });
    }
    throw new Error(`Unexpected frontend request: ${apiPath}`);
  };

  const context = vm.createContext({
    window: browser,
    document: browser.document,
    location,
    history: browser.history,
    fetch,
    URL,
    URLSearchParams,
    AbortController,
    CustomEvent: TestCustomEvent,
    structuredClone,
    setTimeout,
    clearTimeout,
    console
  });
  vm.runInContext(source, context, { filename: 'api-client.js' });
  await waitUntil(() => browser.answerTravelApiClient?.status().ready, '初始认证没有完成');

  phase = 'parallel-401';
  const firstReload = browser.answerTravelApiClient.reload();
  const secondReload = browser.answerTravelApiClient.reload();
  assert.equal(firstReload, secondReload, '并发重新连接必须复用同一个初始化过程');
  await firstReload;

  assert.equal(refreshCount, 1, '并发 401 只能刷新一次会话');
  assert.equal(events.filter((event) => event.status === 'required').length, 0, '成功刷新期间不得闪回登录页');
  assert.equal(events.filter((event) => event.status === 'offline').length, 0, '成功刷新期间不得误报离线');
  assert.equal(events.at(-1).status, 'ready');
  assert.equal(storage.getItem('answertravel.api.token'), 'access-token-2');
  assert.equal(requests.filter((item) => item.apiPath === '/auth/refresh').length, 1);

  console.log('AnswerTravel authentication stability test passed.');
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
