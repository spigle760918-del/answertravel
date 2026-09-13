const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const HOST = '127.0.0.1';
let PORT = Number(process.env.ANSWERTRAVEL_AUTH_TEST_PORT || 0);
let BASE = '';
const ADMIN_EMAIL = 'production-admin@example.com';
const ADMIN_PASSWORD = 'production-auth-test-password';
const STORAGE = process.env.ANSWERTRAVEL_TEST_STORAGE || 'json';

async function selectPort() {
  if (PORT) {
    BASE = `http://${HOST}:${PORT}/api/v1`;
    return;
  }
  PORT = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, HOST, () => {
      const selected = probe.address().port;
      probe.close((error) => error ? reject(error) : resolve(selected));
    });
  });
  BASE = `http://${HOST}:${PORT}/api/v1`;
}

async function request(route, options = {}) {
  const headers = Object.assign(
    {},
    options.token ? { Authorization: `Bearer ${options.token}` } : {},
    options.body !== undefined ? { 'Content-Type': 'application/json' } : {}
  );
  const response = await fetch(`${BASE}${route}`, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function expectStatus(route, expected, options = {}) {
  const result = await request(route, options);
  assert.equal(
    result.response.status,
    expected,
    `${options.method || 'GET'} ${route} 应返回 ${expected}，实际为 ${result.response.status}: ${JSON.stringify(result.payload)}`
  );
  return result.payload;
}

async function waitForServer(child) {
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`生产认证测试服务提前退出。\n${output}`);
    try {
      const health = await request('/health');
      if (health.response.ok) return;
    } catch { /* 等待端口可用 */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`生产认证测试服务未就绪。\n${output}`);
}

async function startServer(dataFile) {
  const child = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    cwd: __dirname,
    env: Object.assign({}, process.env, {
      ANSWERTRAVEL_API_HOST: HOST,
      ANSWERTRAVEL_API_PORT: String(PORT),
      DEEPSEEK_API_KEY: '',
      ANSWERTRAVEL_API_DATA_FILE: dataFile,
      ANSWERTRAVEL_STORAGE: STORAGE,
      ANSWERTRAVEL_DEMO_AUTH: 'false',
      ANSWERTRAVEL_LOCAL_ADMIN_LOGIN: 'false',
      ANSWERTRAVEL_BOOTSTRAP_ADMIN_EMAIL: ADMIN_EMAIL,
      ANSWERTRAVEL_BOOTSTRAP_ADMIN_PASSWORD: ADMIN_PASSWORD,
      NODE_ENV: 'staging'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await waitForServer(child);
  return child;
}

async function stopServer(child) {
  if (!child || child.exitCode != null) return;
  child.kill('SIGTERM');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('生产认证测试服务未能正常退出。')), 12_000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

async function main() {
  await selectPort();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'answertravel-production-auth-'));
  const dataFile = path.join(tempDir, 'data.json');
  const seed = {
    version: 1,
    workspace: {
      id: 'workspace-production-auth',
      team: { name: '生产认证测试团队', description: '' },
      brandId: 'brand-auth-primary',
      channels: []
    },
    brands: [{
      id: 'brand-auth-primary', name: '授权品牌', aliases: [], competitors: [], tracking: true,
      language: 'zh-CN', website: '', description: '', note: ''
    }],
    prompts: [], records: [], assets: [], articles: [], tasks: [],
    members: [{
      id: 'member-disabled-placeholder', userId: 'user-disabled-placeholder', name: '迁移占位成员',
      email: 'placeholder@example.com', role: '品牌成员（只读）', scope: 'brand-auth-primary', status: '正常'
    }],
    users: [{
      id: 'user-disabled-placeholder', email: 'placeholder@example.com', name: '迁移占位成员',
      passwordHash: 'disabled$00$00', status: 'disabled'
    }],
    refreshTokens: [], auditLogs: [], wizardDraft: {}, setupCompleted: true, meta: {}
  };
  if (STORAGE === 'postgres') {
    if (!process.env.DATABASE_URL) throw new Error('PostgreSQL 认证测试需要 DATABASE_URL。');
    const { RelationalStore } = require('./relational-store');
    const store = new RelationalStore(process.env.DATABASE_URL);
    try {
      await store.save(seed);
    } finally {
      await store.close();
    }
  } else {
    fs.writeFileSync(dataFile, JSON.stringify(seed, null, 2));
  }

  let child;
  try {
    child = await startServer(dataFile);
    await expectStatus('/brands', 401);
    const localAdminStatus = await expectStatus('/auth/local-admin', 200);
    assert.equal(localAdminStatus.data.available, false, '未显式启用时不得开放本地管理员快捷登录');
    await expectStatus('/auth/local-admin', 404, { method: 'POST', body: {} });
    await expectStatus('/auth/login', 400, { method: 'POST', body: { user: 'Demo', role: '团队管理员' } });
    await expectStatus('/auth/login', 401, { method: 'POST', body: { email: ADMIN_EMAIL, password: 'wrong-password' } });
    const pastedPasswordSession = await expectStatus('/auth/login', 200, {
      method: 'POST', body: { email: ` ${ADMIN_EMAIL} `, password: ` \u200B${ADMIN_PASSWORD}\uFEFF ` }
    });
    assert.equal(pastedPasswordSession.data.role, '团队管理员', '本地验收应兼容复制粘贴带入的空格和零宽字符');

    let adminSession = await expectStatus('/auth/login', 200, {
      method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }
    });
    assert.equal(adminSession.data.role, '团队管理员');
    assert.ok(adminSession.data.token && adminSession.data.refreshToken);

    const secondBrand = await expectStatus('/brands', 201, {
      method: 'POST', token: adminSession.data.token,
      body: { id: 'brand-auth-private', name: '未授权品牌', region: '上海' }
    });
    const invitedEmail = `production-editor-${Date.now()}@example.com`;
    const invitation = await expectStatus('/members', 201, {
      method: 'POST', token: adminSession.data.token,
      body: { name: '品牌编辑', email: invitedEmail, role: '品牌编辑者', scope: 'brand-auth-primary' }
    });
    const firstInviteToken = invitation.data.inviteUrl.split('/').at(-1);
    const resentInvitation = await expectStatus(`/members/${invitation.data.id}/resend-invitation`, 200, {
      method: 'POST', token: adminSession.data.token, body: {}
    });
    await expectStatus(`/invitations/${firstInviteToken}`, 404);
    const inviteToken = resentInvitation.data.inviteUrl.split('/').at(-1);
    await expectStatus(`/members/${invitation.data.id}`, 200, { method: 'PATCH', token: adminSession.data.token, body: { status: '暂停' } });
    await stopServer(child);
    child = await startServer(dataFile);
    const pausedInvitation = await expectStatus(`/invitations/${inviteToken}`, 200);
    assert.equal(pausedInvitation.data.status, '暂停', '暂停邀请应在服务重启后保持状态');
    await expectStatus('/auth/register', 403, {
      method: 'POST', body: { name: '品牌编辑', email: invitedEmail, password: 'production-editor-password', inviteToken }
    });
    adminSession = await expectStatus('/auth/login', 200, { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
    await expectStatus(`/members/${invitation.data.id}`, 200, { method: 'PATCH', token: adminSession.data.token, body: { status: '待接受' } });
    let editorSession = await expectStatus('/auth/register', 201, {
      method: 'POST',
      body: { name: '品牌编辑', email: invitedEmail, password: 'production-editor-password', inviteToken }
    });
    assert.equal(editorSession.data.role, '品牌编辑者');
    await expectStatus('/audit-logs', 403, { token: editorSession.data.token });
    await expectStatus(`/members/${invitation.data.id}`, 200, {
      method: 'PATCH', token: adminSession.data.token,
      body: { name: '品牌编辑（权限已复核）', scope: 'brand-auth-primary' }
    });
    await expectStatus(`/members/${invitation.data.id}`, 200, { method: 'PATCH', token: adminSession.data.token, body: { status: '暂停' } });
    await expectStatus('/auth/me', 401, { token: editorSession.data.token });
    await expectStatus('/auth/refresh', 401, { method: 'POST', body: { refreshToken: editorSession.data.refreshToken } });
    await expectStatus(`/members/${invitation.data.id}`, 200, { method: 'PATCH', token: adminSession.data.token, body: { status: '正常' } });
    editorSession = await expectStatus('/auth/login', 200, { method: 'POST', body: { email: invitedEmail, password: 'production-editor-password' } });

    const editorBrands = await expectStatus('/brands', 200, { token: editorSession.data.token });
    assert.deepEqual(editorBrands.data.map((brand) => brand.id), ['brand-auth-primary']);
    await expectStatus('/prompts', 201, {
      method: 'POST', token: editorSession.data.token,
      body: { brandId: 'brand-auth-primary', text: '授权品牌的游客问题', group: '权限验证' }
    });
    await expectStatus('/prompts', 403, {
      method: 'POST', token: editorSession.data.token,
      body: { brandId: secondBrand.data.id, text: '不应写入未授权品牌' }
    });

    await stopServer(child);
    child = await startServer(dataFile);

    await expectStatus('/auth/me', 401, { token: editorSession.data.token });
    const refreshedEditor = await expectStatus('/auth/refresh', 200, {
      method: 'POST', body: { refreshToken: editorSession.data.refreshToken }
    });
    const restartedBrands = await expectStatus('/brands', 200, { token: refreshedEditor.data.token });
    assert.deepEqual(restartedBrands.data.map((brand) => brand.id), ['brand-auth-primary']);
    const restartedAdmin = await expectStatus('/auth/login', 200, { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
    const auditLogs = await expectStatus('/audit-logs?limit=50', 200, { token: restartedAdmin.data.token });
    const actions = new Set(auditLogs.data.map((entry) => entry.action));
    for (const action of ['member.invite', 'member.invite.resend', 'member.accept', 'member.permission.update']) assert.ok(actions.has(action), `成员审计应记录 ${action}`);
    await expectStatus('/auth/logout', 200, {
      method: 'POST', token: refreshedEditor.data.token,
      body: { refreshToken: refreshedEditor.data.refreshToken }
    });
    await expectStatus('/auth/refresh', 401, {
      method: 'POST', body: { refreshToken: refreshedEditor.data.refreshToken }
    });

    console.log(`AnswerTravel production-style authentication tests passed (${STORAGE}).`);
  } finally {
    await stopServer(child).catch(() => {});
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exitCode = 1;
});
