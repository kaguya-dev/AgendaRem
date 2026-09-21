import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

if (existsSync('.env')) {
  let env = readFileSync('.env', 'utf8');
  const missing = ['LLM_ENCRYPTION_KEY', 'CRON_SECRET'].filter(
    (key) => !new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`, 'm').test(env),
  );
  if (missing.length) {
    if (env && !env.endsWith('\n')) env += '\n';
    env += `${missing.map((key) => `${key}=${randomBytes(32).toString('hex')}`).join('\n')}\n`;
    writeFileSync('.env', env, { mode: 0o600 });
    console.log(`Adicionadas ao .env somente as variáveis ausentes: ${missing.join(', ')}.`);
    console.log('As configurações e os segredos existentes foram preservados.');
  } else {
    console.log('.env já existe. Nenhuma configuração foi alterada.');
  }
} else {
  let env = readFileSync('.env.example', 'utf8');
  for (const key of ['PANEL_PASSWORD', 'SESSION_SECRET', 'LLM_ENCRYPTION_KEY', 'CRON_SECRET']) {
    env = env.replace(new RegExp(`^${key}=$`, 'm'), `${key}=${randomBytes(32).toString('hex')}`);
  }
  writeFileSync('.env', env, { mode: 0o600 });
  console.log('Configuração local criada em .env (permissão 600).');
  console.log('A senha do painel está no campo PANEL_PASSWORD. Abra o arquivo para consultá-la.');
  console.log('Execute npm run dev e abra http://localhost:3000.');
}
