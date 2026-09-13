const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
const { config } = require('./config');

async function main() {
  if (!config.databaseUrl) throw new Error('执行迁移需要 DATABASE_URL。');
  const directory = path.join(__dirname, 'migrations');
  const files = (await fs.readdir(directory)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort();
  const pool = new Pool({ connectionString: config.databaseUrl, max: 1, application_name: 'answertravel-migrate' });
  const client = await pool.connect();
  try {
    await client.query(`create table if not exists schema_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )`);
    await client.query("select pg_advisory_lock(hashtext('answertravel_migrations'))");
    for (const file of files) {
      const sql = await fs.readFile(path.join(directory, file), 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      const applied = await client.query('select checksum from schema_migrations where name = $1', [file]);
      if (applied.rows[0]) {
        if (applied.rows[0].checksum !== checksum) throw new Error(`已执行的迁移 ${file} 内容发生变化，请新增迁移文件，不要修改历史迁移。`);
        console.log(`skip ${file}`);
        continue;
      }
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (name, checksum) values ($1, $2)', [file, checksum]);
        await client.query('commit');
        console.log(`apply ${file}`);
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    }
  } finally {
    await client.query("select pg_advisory_unlock(hashtext('answertravel_migrations'))").catch(() => {});
    client.release();
    await pool.end();
  }
}

main().catch((error) => { console.error(`[answertravel-migrate] ${error.message}`); process.exitCode = 1; });
