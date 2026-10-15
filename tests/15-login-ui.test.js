// Regressão da tela de login: interpolação correta e sem lixo de template literal
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const login = fs.readFileSync(path.join(raiz, 'public/js/views/login.js'), 'utf8');

test('LOGIN-001: ícones da tela de login interpolados (sem texto literal de concatenação)', () => {
  // o bug: " + ic('chave') + " dentro do template literal aparecia como texto na tela
  assert.ok(login.includes("${ic('chave')} Acesso"), 'título "Acesso" usa ${ic(...)} interpolado');
  assert.ok(!login.includes(`" + ic('chave') + "`), 'nenhum lixo de concatenação no template');
  // varredura geral: nenhum view pode ter concatenação solta em template literal
  const dirViews = path.join(raiz, 'public/js/views');
  for (const arquivo of fs.readdirSync(dirViews)) {
    const conteudo = fs.readFileSync(path.join(dirViews, arquivo), 'utf8');
    const linhas = conteudo.split('\n');
    linhas.forEach((linha, i) => {
      const lixo = linha.match(/>\s*["'][^"']*["']\s*\+\s*(?:ic|escapar|fmt|rotulo)\(/);
      assert.ok(!lixo, `${arquivo}:${i + 1} contém concatenação solta em template literal: ${lixo?.[0]}`);
    });
  }
});

test('LOGIN-002: fluxos de login presentes (PIN pad, senha, setup e operadores)', () => {
  assert.ok(login.includes('#pin-pad'), 'PIN pad presente');
  assert.ok(login.includes('#pin-ok'), 'botão Entrar do PIN presente');
  assert.ok(login.includes('#form-senha'), 'form de senha presente');
  assert.ok(login.includes('#form-setup'), 'form de setup presente');
  assert.ok(login.includes('/auth/operadores'), 'lista de operadores consumida');
  assert.ok(login.includes('/auth/login'), 'endpoint de login consumido');
  assert.ok(login.includes('/auth/setup'), 'endpoint de setup consumido');
  assert.ok(login.includes('escapar(u.nome)'), 'nomes de usuários escapados (anti-XSS)');
});
