#!/usr/bin/env bash
# Dashboard local: ./iniciar.sh [porta]. Não inicia serviços externos.
set -euo pipefail

agenda_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$agenda_dir"
agenda_port="${1:-3000}"

if [[ "$agenda_port" == "--help" || "$agenda_port" == "-h" ]]; then
  printf 'Uso: ./iniciar.sh [porta]\nExemplo: ./iniciar.sh 3002\nRequer Node.js 22+ e npm. Os dados ficam em .data/local.\n'
  exit 0
fi
if [[ ! "$agenda_port" =~ ^[0-9]{4,5}$ ]] || (( 10#$agenda_port < 1024 || 10#$agenda_port > 65535 )); then
  printf 'Informe uma porta entre 1024 e 65535. Exemplo: ./iniciar.sh 3002\n' >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  printf 'Instale Node.js 22 ou superior (incluindo npm) e execute novamente.\n' >&2
  exit 1
fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  printf 'Este projeto precisa de Node.js 22 ou superior. Versão atual: %s\n' "$(node --version)" >&2
  exit 1
fi

if [[ ! -x node_modules/.bin/next || ! -d node_modules/@electric-sql/pglite ]]; then
  printf '\nInstalando dependências do painel…\n'
  npm ci --no-audit --no-fund
fi
node scripts/setup.mjs

# Este atalho usa sempre um banco local, mesmo se o .env já tiver uma URL Neon.
# A configuração original permanece intacta.
export DATABASE_MODE=local
export LOCAL_DATABASE_PATH="$agenda_dir/.data/local"
export APP_URL="http://localhost:$agenda_port"
export NEXT_TELEMETRY_DISABLED=1

printf '\nAgendaMagno — ambiente local\n'
printf 'Painel: %s\n' "$APP_URL"
printf 'Senha: consulte PANEL_PASSWORD no arquivo %s/.env\n' "$agenda_dir"
printf 'Dados locais: %s\n' "$LOCAL_DATABASE_PATH"
printf 'Use a conversa no painel para organizar sua agenda.\n'
printf 'Cadastre suas APIs de IA pelo painel quando quiser usar linguagem natural.\n'
printf 'Para encerrar: Ctrl+C. Seus dados serão preservados.\n\n'

exec npm run dev -- --port "$agenda_port"
