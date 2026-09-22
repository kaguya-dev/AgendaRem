import { createDatabase } from '../src/backend/db';
async function main() {
  const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
  if (process.env.DATABASE_MODE !== 'local' && !url)
    throw new Error('Configure a conexão de migração.');
  const database = await createDatabase(
    process.env.DATABASE_MODE === 'local' ? undefined : url,
    process.env.LOCAL_DATABASE_PATH ?? '.data/agenda',
  );
  console.log('Schema do AgendaMagno pronto. Migração idempotente aplicada.');
  await database.close();
}
main().catch(() => {
  console.error('Falha ao preparar o banco. Confira DATABASE_MODE e DATABASE_URL no .env.');
  process.exitCode = 1;
});
