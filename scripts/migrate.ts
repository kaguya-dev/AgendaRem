import { pathToFileURL } from 'node:url';
import { createDatabase, databaseHint } from '../src/backend/db';

// Qual banco esta execução vai migrar. DATABASE_MIGRATION_URL é uma declaração de intenção:
// quem a define está dizendo qual banco quer preparar. Sem esta precedência, um .env de
// desenvolvimento com DATABASE_MODE=local fazia a migração recair no banco embutido e anunciar
// sucesso, sem ter tocado no banco publicado — e o erro só aparecia no primeiro acesso.
export function migrationTarget(env: Record<string, string | undefined> = process.env) {
  const url =
    env.DATABASE_MIGRATION_URL?.trim() ||
    (env.DATABASE_MODE === 'local' ? '' : env.DATABASE_URL?.trim());
  if (!url) {
    if (env.DATABASE_MODE !== 'local')
      throw new Error(
        'Falta a conexão de migração. Informe DATABASE_MIGRATION_URL com a credencial administrativa do banco, ou DATABASE_MODE=local para preparar o banco embutido.',
      );
    return { url: undefined, label: `banco local em ${env.LOCAL_DATABASE_PATH ?? '.data/agenda'}` };
  }
  // Só host e nome do banco: a URL carrega usuário e senha, que não vão para a saída.
  const parsed = new URL(url);
  return { url, label: `${parsed.host}${parsed.pathname}` };
}
export async function main() {
  const target = migrationTarget();
  const database = await createDatabase(
    target.url,
    process.env.LOCAL_DATABASE_PATH ?? '.data/agenda',
  );
  // Dizer onde foi aplicada evita a dúvida que motivou a precedência acima.
  console.log(`Schema do AgendaMagna aplicado em ${target.label}. Migração idempotente.`);
  await database.close();
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(`Falha ao preparar o banco. ${databaseHint(error)}`);
    if (error instanceof Error && !(error as { code?: string }).code) console.error(error.message);
    process.exitCode = 1;
  });
