import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

if (existsSync('.env')) {
  console.log('.env já existe. Nenhuma configuração foi alterada.');
} else {
  let env = readFileSync('.env.example', 'utf8');
  for (const key of [
    'PANEL_PASSWORD',
    'SESSION_SECRET',
    'INTERNAL_API_TOKEN',
    'WAHA_API_KEY',
    'WAHA_WEBHOOK_SECRET',
    'N8N_WEBHOOK_TOKEN',
    'N8N_ENCRYPTION_KEY',
  ]) {
    env = env.replace(new RegExp(`^${key}=$`, 'm'), `${key}=${randomBytes(32).toString('hex')}`);
  }
  writeFileSync('.env', env, { mode: 0o600 });
  console.log('Configuração local criada em .env (permissão 600).');
  console.log('A senha do painel está no campo PANEL_PASSWORD. Abra o arquivo para consultá-la.');
  console.log('Execute npm run dev e abra http://localhost:3000.');
}
