import { db } from '../src/backend/db';
async function main() {
  const database = await db();
  console.log('Schema do AgendaMagno pronto. Migração idempotente aplicada.');
  await database.close();
}
main().catch(() => {
  console.error('Falha ao preparar o banco. Confira DATABASE_MODE e DATABASE_URL no .env.');
  process.exitCode = 1;
});
