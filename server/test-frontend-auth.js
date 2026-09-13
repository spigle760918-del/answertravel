const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

class MemoryStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

class TestEventTarget {
  constructor() {
    this.listeners = new Map();
  }

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
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
  }
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

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 30));
}

async function main() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api-client.js'), 'utf8');
  const events = [];
  const requests = [];
  const browser = new TestEventTarget();
  const location = new URL('http://127.0.0.1:4176/index.html?api=1&apiBase=http%3A%2F%2F127.0.0.1%3A4182%2Fapi%2Fv1&invite=test-invite');
  const storage = new MemoryStorage({
    'answertravel.api.token': 'stored-admin-access-token',
    'answertravel.api.refresh-token': 'stored-admin-refresh-token',
    'answertravel.api.role': '团队管理员'
  });
  const invitation = {
    id: 'member-invited',
    name: '受邀编辑',
    email: 'invited@example.local',
    role: '品牌编辑者',
    status: '待接受'
  };
  let snapshot = { auth: { loggedIn: true, user: 'Admin', role: '团队管理员', email: 'admin@answertravel.local' } };
  let replacedUrl = '';

  browser.window = browser;
  browser.localStorage = storage;
  browser.location = location;
  browser.history = {
    replaceState(_state, _title, url) {
      replacedUrl = String(url);
    }
  };
  browser.document = { documentElement: { dataset: {} } };
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
    requests.push({ path: requestUrl.pathname, options });
    if (requestUrl.pathname.endsWith('/health')) return response(200, { ok: true });
    if (requestUrl.pathname.endsWith('/invitations/test-invite')) return response(200, { data: invitation });
    if (requestUrl.pathname.endsWith('/auth/register')) {
      return response(201, {
        data: {
          token: 'invited-access-token',
          refreshToken: 'invited-refresh-token',
          user: invitation.name,
          email: invitation.email,
          role: invitation.role
        }
      });
    }
    throw new Error(`Unexpected frontend request: ${requestUrl.pathname}`);
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
  await settle();

  assert.deepEqual(requests.map((item) => item.path), ['/api/v1/health', '/api/v1/invitations/test-invite']);
  assert.equal(storage.getItem('answertravel.api.token'), null, '邀请 URL 必须清除已有管理员 access token');
  assert.equal(storage.getItem('answertravel.api.refresh-token'), null, '邀请 URL 必须清除已有管理员 refresh token');
  assert.equal(browser.answerTravelApiClient.status().authenticated, false);
  assert.equal(events.at(-1).status, 'required');
  assert.equal(events.at(-1).invitation.email, invitation.email);
  assert.equal(snapshot.auth.loggedIn, false);

  await browser.answerTravelApiClient.register({
    name: invitation.name,
    email: invitation.email,
    password: 'invited-password',
    inviteToken: 'test-invite'
  });

  const registerRequest = requests.at(-1);
  assert.equal(registerRequest.path, '/api/v1/auth/register');
  assert.deepEqual(JSON.parse(registerRequest.options.body), {
    name: invitation.name,
    email: invitation.email,
    password: 'invited-password',
    inviteToken: 'test-invite'
  });
  assert.equal(storage.getItem('answertravel.api.token'), 'invited-access-token');
  assert.equal(storage.getItem('answertravel.api.refresh-token'), 'invited-refresh-token');
  assert.equal(new URL(replacedUrl).searchParams.has('invite'), false, '注册成功后地址栏不得保留邀请令牌');
  assert.equal(events.at(-1).status, 'authenticated');
  assert.equal(snapshot.auth.loggedIn, true);
  assert.equal(snapshot.auth.email, invitation.email);

  console.log('AnswerTravel frontend invitation registration test passed.');
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
