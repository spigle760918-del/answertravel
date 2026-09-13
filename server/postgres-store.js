const { Pool } = require('pg');

/**
 * Legacy snapshot PostgreSQL store kept for migration experiments.
 *
 * The active service uses relational-store.js. This module remains available
 * only for compatibility with early migration experiments and should not be
 * selected by server/config.js.
 */
class PostgresStore {
  constructor(connectionString) {
    if (!connectionString) throw new Error('PostgreSQL 存储需要 DATABASE_URL。');
    this.driver = 'postgres';
    this.pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000, application_name: 'answertravel-api' });
    this.ready = false;
    this.revision = null;
    this.writeChain = Promise.resolve();
  }

  async load() {
    const result = await this.pool.query('select data, revision from answertravel_state where id = 1');
    this.ready = true;
    this.revision = result.rows[0] ? Number(result.rows[0].revision) : 0;
    return result.rows[0]?.data || null;
  }

  async save(snapshot) {
    const serialized = JSON.stringify(snapshot);
    this.writeChain = this.writeChain.catch(() => {}).then(() => this.saveSerialized(serialized));
    return this.writeChain;
  }

  async saveSerialized(serialized) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query("select pg_advisory_xact_lock(hashtext('answertravel_state'))");
      const current = await client.query('select revision from answertravel_state where id = 1 for update');
      const databaseRevision = current.rows[0] ? Number(current.rows[0].revision) : 0;
      if (this.revision !== null && databaseRevision !== this.revision) {
        const conflict = new Error('数据库状态已被另一个服务实例更新，请重新载入后再提交。');
        conflict.code = 'ANSWERTRAVEL_WRITE_CONFLICT';
        throw conflict;
      }
      const nextRevision = databaseRevision + 1;
      await client.query(
        `insert into answertravel_state (id, data, revision, updated_at)
         values (1, $1::jsonb, $2, now())
         on conflict (id) do update set data = excluded.data, revision = excluded.revision, updated_at = excluded.updated_at`,
        [serialized, nextRevision]
      );
      await client.query('commit');
      this.revision = nextRevision;
      this.ready = true;
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async health() {
    await this.pool.query('select 1 from answertravel_state limit 1');
    this.ready = true;
    return true;
  }

  async close() {
    await this.writeChain.catch(() => {});
    await this.pool.end();
  }
}

module.exports = { PostgresStore };
