const fs = require('fs/promises');
const path = require('path');
const { config } = require('./config');
const { createStore } = require('./db');

async function main() {
  if (config.storageDriver !== 'postgres') throw new Error('迁移前请设置 ANSWERTRAVEL_STORAGE=postgres。');
  const source = process.env.ANSWERTRAVEL_MIGRATION_SOURCE || path.join(__dirname, 'data.json');
  const snapshot = JSON.parse(await fs.readFile(source, 'utf8'));
  const store = createStore();
  try {
    const existing = await store.load();
    if (existing && process.env.ANSWERTRAVEL_MIGRATION_OVERWRITE !== 'true') {
      throw new Error('PostgreSQL 中已有 AnswerTravel 数据；如确认覆盖，请设置 ANSWERTRAVEL_MIGRATION_OVERWRITE=true。');
    }
    await store.save(snapshot);
    const counts = ['brands', 'prompts', 'records', 'assets', 'articles', 'tasks', 'members']
      .map((key) => `${key}=${Array.isArray(snapshot[key]) ? snapshot[key].length : 0}`)
      .join(', ');
    console.log(`已将 ${source} 迁移到 PostgreSQL 关系表。${counts}`);
  } finally {
    await store.close();
  }
}

main().catch((error) => { console.error(`[answertravel-migrate] ${error.message}`); process.exitCode = 1; });
