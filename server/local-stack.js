const path = require('path');
const net = require('net');
const { spawn } = require('child_process');
const { Client } = require('pg');
const { DEFAULT_LOCAL_POSTGRES, databaseUrl, startLocalPostgres } = require('./local-postgres');

const root = path.resolve(__dirname, '..');
const apiHost = '127.0.0.1';
const preferredApiPort = Number(process.env.ANSWERTRAVEL_API_PORT || 4180);
const preferredWebPort = Number(process.env.ANSWERTRAVEL_WEB_PORT || 4173);
const adminEmail = process.env.ANSWERTRAVEL_BOOTSTRAP_ADMIN_EMAIL || 'admin@answertravel.local';
const adminPassword = process.env.ANSWERTRAVEL_BOOTSTRAP_ADMIN_PASSWORD || 'AnswerTravel-Local-2026!';

function portAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, apiHost, () => server.close(() => resolve(true)));
  });
}

async function availablePort(preferred) {
  for (let port = preferred; port < preferred + 20; port += 1) {
    if (await portAvailable(port)) return port;
  }
  throw new Error(`${preferred}-${preferred + 19} 均已被占用。`);
}

function runNode(script, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { cwd: __dirname, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(script)} 执行失败（${signal || `exit ${code}`}）。`));
    });
  });
}

async function waitForReady(url, child) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`API 服务提前退出（exit ${child.exitCode}）。`);
    try {
      const response = await fetch(url);
      const payload = await response.json();
      if (response.ok && payload.ready && payload.storage === 'postgres') return payload;
    } catch { /* 等待数据库与 API 就绪 */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('本地 PostgreSQL API 在 20 秒内未就绪。');
}

async function hasWorkspace(connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query('select exists(select 1 from workspaces) as present');
    return result.rows[0].present;
  } finally {
    await client.end();
  }
}

async function openLocalPostgres() {
  const connectionString = databaseUrl(DEFAULT_LOCAL_POSTGRES);
  const client = new Client({ connectionString, connectionTimeoutMillis: 1200 });
  try {
    await client.connect();
    await client.query('select 1');
    return {
      databaseUrl: connectionString,
      reused: true,
      postgres: { stop: async () => {} }
    };
  } catch {
    return startLocalPostgres();
  } finally {
    await client.end().catch(() => {});
  }
}

async function stopChild(child) {
  if (!child || child.exitCode != null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 10_000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill('SIGTERM');
  });
}

async function main() {
  let localDatabase;
  let api;
  let web;
  let stopping = false;
  const shutdown = async (exitCode = 0) => {
    if (stopping) return;
    stopping = true;
    await Promise.all([stopChild(api), stopChild(web)]);
    await localDatabase?.postgres.stop().catch(() => {});
    process.exit(exitCode);
  };

  try {
    const webPort = await availablePort(preferredWebPort);
    const apiPort = await availablePort(preferredApiPort);
    if (webPort !== preferredWebPort) console.log(`[AnswerTravel] ${preferredWebPort} 已占用，前端改用 ${webPort}。`);
    if (apiPort !== preferredApiPort) console.log(`[AnswerTravel] ${preferredApiPort} 已占用，API 改用 ${apiPort}。`);
    console.log('[AnswerTravel] 正在连接项目内 PostgreSQL 16...');
    localDatabase = await openLocalPostgres();
    if (localDatabase.reused) console.log('[AnswerTravel] 已复用正在运行的本地 PostgreSQL。');
    const serviceEnv = Object.assign({}, process.env, {
      NODE_ENV: 'staging',
      DATABASE_URL: localDatabase.databaseUrl,
      ANSWERTRAVEL_STORAGE: 'postgres',
      ANSWERTRAVEL_DEMO_AUTH: 'false',
      ANSWERTRAVEL_LOCAL_ADMIN_LOGIN: 'true',
      ANSWERTRAVEL_API_HOST: apiHost,
      ANSWERTRAVEL_API_PORT: String(apiPort),
      ANSWERTRAVEL_WEB_HOST: apiHost,
      ANSWERTRAVEL_WEB_PORT: String(webPort),
      ANSWERTRAVEL_ALLOWED_ORIGINS: `http://127.0.0.1:${webPort},http://localhost:${webPort}`,
      ANSWERTRAVEL_BOOTSTRAP_ADMIN_EMAIL: adminEmail,
      ANSWERTRAVEL_BOOTSTRAP_ADMIN_PASSWORD: adminPassword
    });

    await runNode(path.join(__dirname, 'migrate.js'), serviceEnv);
    if (!(await hasWorkspace(localDatabase.databaseUrl))) {
      console.log('[AnswerTravel] 首次启动，正在导入现有品牌与提问数据...');
      await runNode(path.join(__dirname, 'migrate-json.js'), serviceEnv);
    }

    api = spawn(process.execPath, [path.join(__dirname, 'index.js')], { cwd: __dirname, env: serviceEnv, stdio: 'inherit' });
    web = spawn(process.execPath, [path.join(root, 'dev-server.js')], { cwd: root, env: serviceEnv, stdio: 'inherit' });
    api.once('error', (error) => { console.error(error); shutdown(1); });
    web.once('error', (error) => { console.error(error); shutdown(1); });
    api.once('exit', (code) => { if (!stopping) shutdown(code || 1); });
    web.once('exit', (code) => { if (!stopping) shutdown(code || 1); });

    await waitForReady(`http://${apiHost}:${apiPort}/api/v1/ready`, api);
    const apiBase = encodeURIComponent(`http://${apiHost}:${apiPort}/api/v1`);
    console.log('');
    console.log('[AnswerTravel] 本地 PostgreSQL 环境已就绪');
    console.log(`[AnswerTravel] 页面：http://${apiHost}:${webPort}/index.html?api=1&apiBase=${apiBase}`);
    console.log(`[AnswerTravel] 管理员：${adminEmail}`);
    console.log(`[AnswerTravel] 本地密码：${adminPassword}`);
    console.log('[AnswerTravel] 按 Ctrl+C 可安全停止；数据会保留在 server/.local/postgres。');
  } catch (error) {
    console.error(`[AnswerTravel] 本地环境启动失败：${error.stack || error.message || error}`);
    await shutdown(1);
  }

  process.once('SIGINT', () => shutdown(0));
  process.once('SIGTERM', () => shutdown(0));
}

main();
