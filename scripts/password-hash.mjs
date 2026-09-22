// Gera PANEL_PASSWORD_HASH a partir de uma senha, para que o ambiente publicado não guarde a
// senha legível. A senha é lida da entrada padrão, nunca de um argumento: argumentos ficam no
// histórico do shell e na lista de processos da máquina.
//
//   npm run senha:hash
import { randomBytes, scryptSync } from 'node:crypto';
import { createInterface } from 'node:readline';

const input = createInterface({ input: process.stdin, terminal: process.stdin.isTTY });
if (process.stdin.isTTY) {
  process.stderr.write('Senha do painel (não aparece na tela): ');
  // `terminal: true` já ecoa o que é digitado; silenciar a saída esconde a senha.
  input.output = null;
  input._writeToOutput = () => {};
}
const password = await new Promise((resolve) => input.question('', resolve));
input.close();

if (process.stdin.isTTY) process.stderr.write('\n');
if (password.trim().length < 12) {
  console.error('Use uma senha de pelo menos 12 caracteres.');
  process.exit(1);
}
const salt = randomBytes(16).toString('hex');
console.log(`PANEL_PASSWORD_HASH=${salt}:${scryptSync(password, salt, 64).toString('hex')}`);
console.error(
  '\nCopie a linha acima para as variáveis do projeto e remova PANEL_PASSWORD do ambiente publicado.',
);
