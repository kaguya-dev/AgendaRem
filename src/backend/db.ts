import { mkdir } from 'node:fs/promises';
import { Pool } from 'pg';
import { PGlite } from '@electric-sql/pglite';
import { schema, featureMigration } from './schema';
import { emptyState, type State } from './domain';

export interface Sql {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
export interface Database extends Sql {
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export async function createDatabase(
  url?: string,
  path?: string,
  initialize = true,
): Promise<Database> {
  if (url) {
    const pool = new Pool({
      connectionString: url,
      max: 5,
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 30000,
    });
    if (initialize) await pool.query(schema + featureMigration);
    return {
      query: async <T>(sql: string, params?: unknown[]) => ({
        rows: (await pool.query(sql, params)).rows as T[],
      }),
      transaction: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn({
            query: async <T>(sql: string, params?: unknown[]) => ({
              rows: (await client.query(sql, params)).rows as T[],
            }),
          });
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      },
      close: () => pool.end(),
    };
  }
  if (path) await mkdir(path, { recursive: true });
  const pg = new PGlite(path);
  await pg.exec(schema + featureMigration);
  return {
    query: <T>(sql: string, params?: unknown[]) => pg.query<T>(sql, params),
    transaction: (fn) =>
      pg.transaction((tx) =>
        fn({ query: <T>(sql: string, params?: unknown[]) => tx.query<T>(sql, params) }),
      ),
    close: () => pg.close(),
  };
}
const globalDb = globalThis as unknown as {
  agendaDb?: Promise<Database>;
  agendaFeaturesV2?: Promise<unknown>;
};
export function db(): Promise<Database> {
  if (!globalDb.agendaDb) {
    if (process.env.VERCEL === '1' && process.env.DATABASE_MODE === 'local')
      throw new Error('Na Vercel, configure DATABASE_MODE=postgres e DATABASE_URL do Neon.');
    if (process.env.DATABASE_MODE !== 'local' && !process.env.DATABASE_URL)
      throw new Error('Configure DATABASE_URL (Neon) ou DATABASE_MODE=local no .env.');
    globalDb.agendaDb = createDatabase(
      process.env.DATABASE_MODE === 'local' ? undefined : process.env.DATABASE_URL,
      process.env.LOCAL_DATABASE_PATH ?? '.data/agenda',
      process.env.DATABASE_MODE === 'local' || process.env.DATABASE_AUTO_MIGRATE === 'true',
    );
    globalDb.agendaDb.catch(() => {
      delete globalDb.agendaDb;
    });
  }
  return globalDb.agendaDb.then(async (connection) => {
    // Only the local development database applies migrations on startup.
    // Production uses the migration connection, separate from the runtime role.
    if (process.env.DATABASE_MODE === 'local') {
      if (!globalDb.agendaFeaturesV2) {
        globalDb.agendaFeaturesV2 = (async () => {
          for (const statement of featureMigration.split(';').filter((s) => s.trim()))
            await connection.query(statement);
        })();
        globalDb.agendaFeaturesV2.catch(() => {
          delete globalDb.agendaFeaturesV2;
        });
      }
      await globalDb.agendaFeaturesV2;
    }
    return connection;
  });
}
export async function lock(tx: Sql) {
  await tx.query('SELECT id FROM agenda_meta WHERE id=1 FOR UPDATE');
}
const tables = {
  groups: 'agenda_groups',
  tasks: 'agenda_tasks',
  history: 'agenda_history',
  operations: 'agenda_operations',
  conversations: 'agenda_conversations',
} as const;
export async function loadState(tx: Sql): Promise<State> {
  const state = emptyState();
  state.settings = (
    await tx.query<{ data: State['settings'] }>('SELECT data FROM agenda_meta WHERE id=1')
  ).rows[0].data;
  for (const [key, table] of Object.entries(tables) as [keyof typeof tables, string][]) {
    const rows = await tx.query<{ data: unknown }>(`SELECT data FROM ${table} ORDER BY id`);
    Object.assign(state, { [key]: rows.rows.map((r) => r.data) });
  }
  state.operations.sort(
    (a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.at.localeCompare(b.at),
  );
  state.history.sort((a, b) => a.at.localeCompare(b.at));
  return state;
}
export async function saveState(tx: Sql, before: State, after: State) {
  if (JSON.stringify(before.settings) !== JSON.stringify(after.settings))
    await tx.query('UPDATE agenda_meta SET data=$1::jsonb WHERE id=1', [
      JSON.stringify(after.settings),
    ]);
  for (const [key, table] of Object.entries(tables) as [keyof typeof tables, string][]) {
    const old = new Map(before[key].map((item) => [String(item.id), JSON.stringify(item)]));
    // Remove changed group rows first so restoring a backup can swap unique names atomically.
    if (key === 'groups')
      for (const item of before.groups) {
        const next = after.groups.find((g) => g.id === item.id);
        if (!next || JSON.stringify(next) !== JSON.stringify(item))
          await tx.query('DELETE FROM agenda_groups WHERE id=$1', [item.id]);
      }
    for (const item of after[key]) {
      const id = String(item.id);
      const json = JSON.stringify(item);
      if (old.get(id) !== json)
        await tx.query(
          `INSERT INTO ${table} (id, data) VALUES ($1, $2::jsonb) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
          [id, json],
        );
      old.delete(id);
    }
    for (const id of old.keys()) await tx.query(`DELETE FROM ${table} WHERE id=$1`, [id]);
  }
}
export async function consumeLimit(
  tx: Sql,
  key: string,
  maximum: number,
  windowMs: number,
  now = new Date(),
) {
  const result = await tx.query<{ count: number }>(
    `INSERT INTO agenda_limits (key,count,expires_at) VALUES ($1,1,$2)
    ON CONFLICT (key) DO UPDATE SET count=CASE WHEN agenda_limits.expires_at <= $3 THEN 1 ELSE agenda_limits.count+1 END,
    expires_at=CASE WHEN agenda_limits.expires_at <= $3 THEN $2 ELSE agenda_limits.expires_at END RETURNING count`,
    [key, new Date(now.getTime() + windowMs).toISOString(), now.toISOString()],
  );
  return result.rows[0].count <= maximum;
}
