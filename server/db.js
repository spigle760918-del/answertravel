const { config } = require('./config');
const fs = require('fs/promises');

class JsonStore {
  constructor(file) {
    this.driver = 'json';
    this.file = file;
    this.ready = true;
    this.writeChain = Promise.resolve();
  }

  async load() {
    try {
      return JSON.parse(await fs.readFile(this.file, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async save(snapshot) {
    const serialized = JSON.stringify(snapshot, null, 2);
    this.writeChain = this.writeChain
      .catch(() => {})
      .then(async () => {
        const temp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
        await fs.writeFile(temp, serialized, 'utf8');
        try {
          await fs.rename(temp, this.file);
        } catch (error) {
          if (!['EPERM', 'EEXIST'].includes(error.code)) throw error;
          // Windows can reject rename-over-existing even within one writer queue.
          await fs.copyFile(temp, this.file);
          await fs.unlink(temp).catch(() => {});
        }
      });
    return this.writeChain;
  }

  async health() {
    await fs.access(this.file).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    return true;
  }

  async close() {
    await this.writeChain.catch(() => {});
  }
}

function createStore() {
  if (config.storageDriver === 'json') {
    return new JsonStore(config.dataFile);
  }
  if (config.storageDriver === 'postgres') {
    let PostgresStore;
    try {
      ({ RelationalStore: PostgresStore } = require('./relational-store'));
    } catch (error) {
      throw new Error(`PostgreSQL 驱动加载失败：${error.message}。请先在服务端安装 pg 依赖。`);
    }
    return new PostgresStore(config.databaseUrl);
  }
  throw new Error(`不支持的存储驱动：${config.storageDriver}`);
}

function postgresDriverAvailable() {
  if (config.storageDriver !== 'postgres') return false;
  try { require.resolve('pg'); return true; } catch { return false; }
}

module.exports = { createStore, postgresDriverAvailable };
