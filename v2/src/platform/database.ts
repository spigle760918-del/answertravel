import pg from "pg";

const { Pool } = pg;

export async function assertRuntimeDatabaseRole(connection: pg.Pool | pg.PoolClient): Promise<void> {
  const result = await connection.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
    "select rolsuper, rolbypassrls from pg_roles where rolname = current_user"
  );
  const role = result.rows[0];
  if (!role || role.rolsuper || role.rolbypassrls) {
    throw new Error("Unsafe application database role: superuser/BYPASSRLS is forbidden.");
  }
}

export function createDatabasePool(databaseUrl: string): pg.Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "answertravel-v2"
  });
}

export async function withTenantTransaction<T>(
  pool: pg.Pool,
  tenantId: string,
  operation: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  let discardConnection = false;
  try {
    await client.query("begin");
    await assertRuntimeDatabaseRole(client);
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    try { await client.query("rollback"); } catch { discardConnection = true; }
    throw error;
  } finally {
    client.release(discardConnection);
  }
}
