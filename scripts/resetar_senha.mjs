// ============================================================
// Redefinir a senha de um operador — Mercury PDV 1.3
//
//   node scripts/resetar_senha.mjs
//
// A senha e digitada AQUI, no seu computador, com a tela mascarada.
// Ela nao aparece no historico do comando, nem em conversas, nem em log.
//
// O sistema guarda as senhas com scrypt + salt aleatorio + uma chave do
// arquivo .env. Nao existe "ver a senha antiga": a unica forma de entrar
// depois de esquecer e redefinir por este script.
// ============================================================
import readline from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { abrirBanco } = await import(`file:///${path.join(RAIZ, 'server/src/db/connection.js').replace(/\\/g, '/')}`);
const { config } = await import(`file:///${path.join(RAIZ, 'server/src/config.js').replace(/\\/g, '/')}`);
const { hashSegredo } = await import(`file:///${path.join(RAIZ, 'server/src/auth/crypto.js').replace(/\\/g, '/')}`);

const modoTeste = process.argv.includes('--teste');

// ---------------------------------------------------------------- entrada
function perguntar(rl, texto) {
  return new Promise((r) => rl.question(texto, r));
}

// Digitacao mascarada: os caracteres viram asterisco, nao a senha.
function perguntarSecreto(rl, texto) {
  return new Promise((resolve) => {
    process.stdout.write(texto);
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    let valor = '';
    const aoDigitar = (chave) => {
      const s = chave.toString();
      if (s === '\u0003') process.exit(130); // Ctrl+C
      if (s === '\r' || s === '\n') {
        process.stdin.setRawMode?.(false);
        process.stdin.pause();
        process.stdin.removeListener('data', aoDigitar);
        process.stdout.write('\n');
        resolve(valor);
        return;
      }
      if (s === '\u007F' || s === '\b') {
        if (valor.length > 0) { valor = valor.slice(0, -1); process.stdout.write('\b \b'); }
        return;
      }
      valor += s;
      process.stdout.write('*');
    };
    process.stdin.on('data', aoDigitar);
  });
}

function validar(senha) {
  if (senha.length < 10) return 'A senha precisa ter pelo menos 10 caracteres.';
  if (!/[a-zA-Z]/.test(senha)) return 'A senha precisa ter pelo menos uma letra.';
  if (!/[0-9]/.test(senha)) return 'A senha precisa ter pelo menos um numero.';
  return null;
}

const db = abrirBanco(config.dbPath);
const agora = new Date().toISOString();

// ------------------------------------------------------------------ teste
// Cria um usuario descartavel, grava uma senha conhecida, confirma que o
// login aceitaria, e apaga tudo. Serve para provar que o caminho funciona
// sem mexer nas contas reais.
if (modoTeste) {
  const login = '__teste_reset__';
  const senhaTeste = 'SenhaTeste123';
  const pin = null;
  db.prepare('DELETE FROM usuarios WHERE nome = ?').run(login);
  const info = db.prepare(
    'INSERT INTO usuarios (nome, cargo, senha_hash, pin_hash, ativo, criado_em) VALUES (?, ?, ?, ?, 1, ?)'
  ).run(login, 'admin', hashSegredo(senhaTeste, config.pepper), pin, agora);
  const { verificarSegredo } = await import(`file:///${path.join(RAIZ, 'server/src/auth/crypto.js').replace(/\\/g, '/')}`);
  const criado = db.prepare('SELECT senha_hash FROM usuarios WHERE id = ?').get(Number(info.lastInsertRowid));
  const aceitaria = verificarSegredo(senhaTeste, criado.senha_hash, config.pepper);
  const rejeitaria = verificarSegredo('senhaerrada123', criado.senha_hash, config.pepper);
  db.prepare('DELETE FROM usuarios WHERE id = ?').run(Number(info.lastInsertRowid));
  const restou = db.prepare('SELECT COUNT(*) AS n FROM usuarios WHERE nome = ?').get(login).n;
  console.log(`  grava a senha .............. ${criado.senha_hash ? 'sim' : 'NAO'}`);
  console.log(`  login aceitaria a senha .... ${aceitaria ? 'SIM' : 'NAO  <-- FALHOU'}`);
  console.log(`  rejeitaria senha errada ... ${!rejeitaria ? 'SIM' : 'NAO  <-- FALHOU'}`);
  console.log(`  usuario de teste removido . ${restou === 0 ? 'SIM' : 'NAO  <-- FALHOU'}`);
  const ok = aceitaria && !rejeitaria && restou === 0;
  console.log(ok ? '\nMECANISMO DE REDEFINICAO FUNCIONA.\n' : '\nFALHOU.\n');
  db.close();
  process.exit(ok ? 0 : 1);
}

// ------------------------------------------------------------------ normal
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const usuarios = db.prepare('SELECT id, nome, cargo, ativo FROM usuarios ORDER BY nome').all();
console.log('\nOperadores cadastrados:\n');
for (const u of usuarios) {
  console.log(`  ${String(u.id).padStart(3)}. ${u.nome.padEnd(16)} ${u.cargo.padEnd(8)} ${u.ativo ? 'ativo' : 'inativo'}`);
}
console.log('');

const alvo = (await perguntar(rl, 'Nome do operador (ou numero): ')).trim();
const escolhido = usuarios.find((u) => u.nome.toLowerCase() === alvo.toLowerCase() || String(u.id) === alvo);
if (!escolhido) {
  console.log(`\nNao encontrei "${alvo}". Nada foi alterado.\n`);
  db.close();
  rl.close();
  process.exit(1);
}

console.log(`\nRedefinindo a senha de: ${escolhido.nome} (${escolhido.cargo})\n`);
const senha = await perguntarSecreto(rl, 'Nova senha (nao aparece na tela): ');
const erro = validar(senha);
if (erro) {
  console.log(`\n${erro} Nada foi alterado.\n`);
  db.close();
  rl.close();
  process.exit(1);
}
const repetir = await perguntarSecreto(rl, 'Repita a senha: ');
if (senha !== repetir) {
  console.log('\nAs senhas nao batem. Nada foi alterado.\n');
  db.close();
  rl.close();
  process.exit(1);
}

db.prepare('UPDATE usuarios SET senha_hash = ?, tentativas_falidas = 0, bloqueado_em = NULL WHERE id = ?')
  .run(hashSegredo(senha, config.pepper), escolhido.id);

// Registra o que aconteceu, sem guardar a senha.
try {
  db.prepare('INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id, detalhes, criado_em) VALUES (?,?,?,?,?,?)')
    .run(escolhido.id, 'senha_redefinida', 'usuario', escolhido.id,
      JSON.stringify({ motivo: 'redefinicao local via script' }), agora);
} catch { /* auditoria pode estar bloqueada por trigger */ }

console.log('\nSenha redefinida.');
console.log('Use a nova senha para entrar.');
console.log('Se o login nao aceitar, feche o servidor e rode este script de novo.');
db.close();
rl.close();
process.exit(0);