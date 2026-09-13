const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { startLocalPostgres } = require('./local-postgres');
const { exportBackup, restoreBackup, readBackup } = require('./portable-backup');
const { RelationalStore } = require('./relational-store');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function runNode(script, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, script)], { cwd: __dirname, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} 执行失败（${signal || `exit ${code}`}）。`));
    });
  });
}

async function createTestDatabase(postgres, database) {
  const client = postgres.getPgClient('postgres', '127.0.0.1');
  await client.connect();
  try {
    await client.query(`create database ${client.escapeIdentifier(database)}`);
  } finally {
    await client.end();
  }
}

function withDatabase(connectionString, database) {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'answertravel-postgres-'));
  const databasePort = await freePort();
  const persistenceApiPort = await freePort();
  const authApiPort = await freePort();
  let localDatabase;
  try {
    localDatabase = await startLocalPostgres({
      databaseDir: path.join(tempRoot, 'data'),
      port: databasePort,
      database: 'answertravel_persistence_test',
      persistent: false
    });
    await createTestDatabase(localDatabase.postgres, 'answertravel_auth_test');
    await createTestDatabase(localDatabase.postgres, 'answertravel_restore_test');

    const persistenceUrl = localDatabase.databaseUrl;
    const authUrl = withDatabase(localDatabase.databaseUrl, 'answertravel_auth_test');
    const restoreUrl = withDatabase(localDatabase.databaseUrl, 'answertravel_restore_test');
    await runNode('migrate.js', Object.assign({}, process.env, { DATABASE_URL: persistenceUrl }));
    await runNode('test-postgres-api.js', Object.assign({}, process.env, {
      DATABASE_URL: persistenceUrl,
      ANSWERTRAVEL_POSTGRES_TEST_PORT: String(persistenceApiPort)
    }));

    await runNode('migrate.js', Object.assign({}, process.env, { DATABASE_URL: authUrl }));
    await runNode('test-production-auth.js', Object.assign({}, process.env, {
      DATABASE_URL: authUrl,
      ANSWERTRAVEL_TEST_STORAGE: 'postgres',
      ANSWERTRAVEL_AUTH_TEST_PORT: String(authApiPort)
    }));
    const backupFile = path.join(tempRoot, 'answertravel-backup.json');
    const exported = await exportBackup(authUrl, backupFile);
    const verified = await readBackup(backupFile);
    if (verified.backup.checksum !== exported.backup.checksum) throw new Error('备份读取后的校验值不一致。');
    await runNode('migrate.js', Object.assign({}, process.env, { DATABASE_URL: restoreUrl }));
    await restoreBackup(restoreUrl, backupFile);
    const restoredStore = new RelationalStore(restoreUrl);
    try {
      const restored = await restoredStore.load();
      if (restored.brands.length !== exported.backup.snapshot.brands.length) throw new Error('恢复后的品牌数量不一致。');
      if (restored.users.length !== exported.backup.snapshot.users.length) throw new Error('恢复后的用户数量不一致。');
      if (restored.members.length !== exported.backup.snapshot.members.length) throw new Error('恢复后的成员数量不一致。');
      if (restored.auditLogs.length !== exported.backup.snapshot.auditLogs.length) throw new Error('恢复后的审计日志数量不一致。');
    } finally {
      await restoredStore.close();
    }
    console.log('AnswerTravel portable backup and restore test passed.');
    console.log('AnswerTravel embedded PostgreSQL 16 integration suite passed.');
  } finally {
    await localDatabase?.postgres.stop().catch(() => {});
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
