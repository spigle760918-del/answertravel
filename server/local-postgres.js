const fs = require('fs');
const fsPromises = require('fs/promises');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { Client } = require('pg');

const DEFAULT_LOCAL_POSTGRES = Object.freeze({
  host: '127.0.0.1',
  port: 55432,
  user: 'answertravel',
  password: 'answertravel-local-database-only',
  database: 'answertravel'
});

function databaseUrl(options = {}) {
  const settings = Object.assign({}, DEFAULT_LOCAL_POSTGRES, options);
  return `postgresql://${encodeURIComponent(settings.user)}:${encodeURIComponent(settings.password)}@${settings.host}:${settings.port}/${encodeURIComponent(settings.database)}`;
}

function validateIdentifier(value, label) {
  if (!/^[a-z][a-z0-9_]*$/i.test(value)) throw new Error(`${label} 只能包含字母、数字和下划线。`);
}

function postgresEnvironment() {
  return Object.assign({}, process.env, { LANG: 'C', LC_ALL: 'C', PGCLIENTENCODING: 'UTF8' });
}

async function createJunction(target, junction) {
  await fsPromises.mkdir(target, { recursive: true });
  try {
    const actual = await fsPromises.realpath(junction);
    const expected = await fsPromises.realpath(target);
    if (actual.toLowerCase() !== expected.toLowerCase()) throw new Error(`${junction} 已指向其他目录。`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await fsPromises.mkdir(path.dirname(junction), { recursive: true });
    await fsPromises.symlink(target, junction, 'junction');
  }
  return junction;
}

function runExecutable(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: postgresEnvironment(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk.toString(); options.onLog?.(chunk.toString()); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); options.onLog?.(chunk.toString()); });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${path.basename(executable)} 失败（${signal || `exit ${code}`}）。\n${output}`));
    });
  });
}

class WindowsPostgres {
  constructor(options) {
    this.options = options;
    this.process = null;
  }

  async preparePaths() {
    const packageEntry = require.resolve('@embedded-postgres/windows-x64');
    const nativeSource = path.resolve(path.dirname(packageEntry), '..', 'native');
    const runtimeRoot = path.join(os.tmpdir(), 'answertravel-postgres-16.14');
    this.nativeDir = await createJunction(nativeSource, path.join(runtimeRoot, 'native'));
    if (/^[\x00-\x7f]+$/.test(this.options.databaseDir)) {
      await fsPromises.mkdir(this.options.databaseDir, { recursive: true });
      this.dataDir = this.options.databaseDir;
    } else {
      const physicalParent = path.dirname(this.options.databaseDir);
      const dataHash = crypto.createHash('sha256').update(physicalParent).digest('hex').slice(0, 16);
      const parentAlias = await createJunction(physicalParent, path.join(runtimeRoot, 'data-roots', dataHash));
      this.dataDir = path.join(parentAlias, path.basename(this.options.databaseDir));
      await fsPromises.mkdir(this.dataDir, { recursive: true });
    }
    this.binDir = path.join(this.nativeDir, 'bin');
  }

  async initialise() {
    await this.preparePaths();
    const passwordFile = path.join(os.tmpdir(), `answertravel-pg-password-${crypto.randomUUID()}.txt`);
    const needsStaging = !/^[\x00-\x7f]+$/.test(this.options.databaseDir);
    const stagingRoot = needsStaging ? path.join(os.tmpdir(), `answertravel-pg-init-${crypto.randomUUID()}`) : '';
    const initialiseAt = needsStaging ? path.join(stagingRoot, 'data') : this.dataDir;
    if (needsStaging) await fsPromises.mkdir(initialiseAt, { recursive: true });
    await fsPromises.writeFile(passwordFile, `${this.options.password}\n`, { encoding: 'utf8', mode: 0o600 });
    try {
      await runExecutable(path.join(this.binDir, 'initdb.exe'), [
        `--pgdata=${initialiseAt}`,
        `--auth=${this.options.authMethod}`,
        `--username=${this.options.user}`,
        `--pwfile=${passwordFile}`,
        '--encoding=UTF8',
        '--locale=C'
      ], { cwd: this.binDir, onLog: this.options.onLog });
      if (needsStaging) {
        const existing = await fsPromises.readdir(this.options.databaseDir);
        if (existing.length) throw new Error('本地数据库目录包含未识别的数据，已停止初始化以避免覆盖。');
        for (const entry of await fsPromises.readdir(initialiseAt)) {
          await fsPromises.cp(path.join(initialiseAt, entry), path.join(this.options.databaseDir, entry), { recursive: true });
        }
      }
    } finally {
      await fsPromises.unlink(passwordFile).catch(() => {});
      if (stagingRoot) await fsPromises.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
    }
  }

  async start() {
    if (!this.binDir) await this.preparePaths();
    await new Promise((resolve, reject) => {
      const executable = path.join(this.binDir, 'postgres.exe');
      const child = spawn(executable, ['-D', this.dataDir, '-p', String(this.options.port), '-h', this.options.host], {
        cwd: this.binDir,
        env: postgresEnvironment(),
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe']
      });
      this.process = child;
      let output = '';
      const timeout = setTimeout(() => reject(new Error(`PostgreSQL 启动超时。\n${output}`)), 20_000);
      child.stderr.on('data', (chunk) => {
        const message = chunk.toString();
        output += message;
        this.options.onLog(message);
        if (message.includes('database system is ready to accept connections')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      child.once('error', (error) => { clearTimeout(timeout); reject(error); });
      child.once('exit', (code, signal) => {
        clearTimeout(timeout);
        if (this.process === child) this.process = null;
        reject(new Error(`PostgreSQL 提前退出（${signal || `exit ${code}`}）。\n${output}`));
      });
    });
  }

  getPgClient(database = 'postgres', host = this.options.host) {
    return new Client({
      host,
      port: this.options.port,
      user: this.options.user,
      password: this.options.password,
      database
    });
  }

  async stop() {
    if (!this.process) return;
    const child = this.process;
    this.process = null;
    await runExecutable(path.join(this.binDir, 'pg_ctl.exe'), ['-D', this.dataDir, '-m', 'fast', 'stop'], {
      cwd: this.binDir,
      onLog: this.options.onLog
    }).catch((error) => this.options.onError(error));
    if (child.exitCode == null) await new Promise((resolve) => child.once('exit', resolve));
  }
}

async function ensureDatabase(postgres, settings) {
  validateIdentifier(settings.database, '数据库名称');
  const client = postgres.getPgClient('postgres', settings.host);
  await client.connect();
  try {
    const existing = await client.query('select 1 from pg_database where datname = $1', [settings.database]);
    if (!existing.rowCount) await client.query(`create database ${client.escapeIdentifier(settings.database)}`);
  } finally {
    await client.end();
  }
}

async function startLocalPostgres(options = {}) {
  const settings = Object.assign({}, DEFAULT_LOCAL_POSTGRES, options);
  const databaseDir = path.resolve(options.databaseDir || path.join(__dirname, '.local', 'postgres'));
  const postgresOptions = {
    databaseDir,
    user: settings.user,
    password: settings.password,
    host: settings.host,
    port: settings.port,
    persistent: options.persistent !== false,
    authMethod: 'scram-sha-256',
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
    postgresFlags: ['-h', settings.host],
    onLog: options.onLog || (() => {}),
    onError: options.onError || ((error) => console.error('[answertravel-postgres]', error))
  };
  let postgres;
  if (process.platform === 'win32') {
    postgres = new WindowsPostgres(postgresOptions);
  } else {
    const { default: EmbeddedPostgres } = await import('embedded-postgres');
    postgres = new EmbeddedPostgres(postgresOptions);
  }

  if (!fs.existsSync(path.join(databaseDir, 'PG_VERSION'))) {
    fs.mkdirSync(databaseDir, { recursive: true });
    await postgres.initialise();
  }
  await postgres.start();
  await ensureDatabase(postgres, settings);
  return {
    postgres,
    settings,
    databaseDir,
    databaseUrl: databaseUrl(settings)
  };
}

module.exports = { DEFAULT_LOCAL_POSTGRES, databaseUrl, startLocalPostgres };
