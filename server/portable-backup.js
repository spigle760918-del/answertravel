const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { Client } = require('pg');
const { RelationalStore } = require('./relational-store');

const FORMAT = 'answertravel-portable-backup';
const FORMAT_VERSION = 1;

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function checksum(snapshot) {
  return crypto.createHash('sha256').update(stableJson(snapshot)).digest('hex');
}

function assertSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') throw new Error('备份缺少有效业务数据。');
  if (!snapshot.workspace || !Array.isArray(snapshot.brands)) throw new Error('备份缺少工作空间或品牌数据。');
}

async function exportBackup(connectionString, outputFile) {
  if (!connectionString) throw new Error('备份需要 DATABASE_URL。');
  const store = new RelationalStore(connectionString);
  try {
    const snapshot = await store.load();
    assertSnapshot(snapshot);
    const backup = {
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      createdAt: new Date().toISOString(),
      checksum: checksum(snapshot),
      snapshot
    };
    const target = path.resolve(outputFile);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(backup, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporary, target);
    return { target, backup };
  } finally {
    await store.close();
  }
}

async function readBackup(inputFile) {
  const source = path.resolve(inputFile);
  const backup = JSON.parse(await fs.readFile(source, 'utf8'));
  if (backup.format !== FORMAT || backup.formatVersion !== FORMAT_VERSION) throw new Error('不支持的 AnswerTravel 备份格式。');
  assertSnapshot(backup.snapshot);
  const actual = checksum(backup.snapshot);
  if (actual !== backup.checksum) throw new Error('备份校验失败，文件可能不完整或已被修改。');
  return { source, backup };
}

async function workspaceExists(connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query("select to_regclass('public.workspaces') is not null as migrated");
    if (!result.rows[0].migrated) throw new Error('目标数据库尚未执行迁移。');
    const count = await client.query('select count(*)::int as count from workspaces');
    return count.rows[0].count > 0;
  } finally {
    await client.end();
  }
}

async function restoreBackup(connectionString, inputFile, options = {}) {
  if (!connectionString) throw new Error('恢复需要 DATABASE_URL。');
  const { source, backup } = await readBackup(inputFile);
  if (await workspaceExists(connectionString) && options.overwrite !== true) {
    throw new Error('目标数据库已有 AnswerTravel 数据，默认拒绝覆盖。');
  }
  const store = new RelationalStore(connectionString);
  try {
    const existing = await store.load();
    if (existing && options.overwrite === true) {
      backup.snapshot.meta = Object.assign({}, backup.snapshot.meta || {}, { revision: Number(existing.meta?.revision || 0) });
    }
    await store.save(backup.snapshot);
    return { source, snapshot: backup.snapshot, checksum: backup.checksum };
  } finally {
    await store.close();
  }
}

module.exports = { FORMAT, FORMAT_VERSION, checksum, exportBackup, readBackup, restoreBackup, workspaceExists };
