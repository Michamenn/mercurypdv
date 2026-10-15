// UI 100% monocromática: nenhum emoji colorido no frontend.
// Exceção: U+26AB (●, círculo geométrico — já é monocromático por natureza).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ic } from '../public/js/icons.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RX_EMOJI = new RegExp('[' + [
  '\\u{1F300}-\\u{1FAFF}', '\\u{2600}-\\u{27BF}', '\\u{2B00}-\\u{2BFF}',
].join('') + ']', 'u');
const PERMITIDOS = new Set(['\u26AB']);

function arquivosJS(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...arquivosJS(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

test('UI-001: nenhum emoji colorido no frontend', () => {
  const achados = [];
  for (const f of arquivosJS(path.join(raiz, 'public'))) {
    const t = fs.readFileSync(f, 'utf8');
    for (const m of t.matchAll(new RegExp(RX_EMOJI.source, 'ug'))) {
      if (!PERMITIDOS.has(m[0])) achados.push(`${path.relative(raiz, f)}: U+${m[0].codePointAt(0).toString(16)}`);
    }
  }
  assert.deepEqual(achados, [], `emojis coloridos restantes: ${achados.slice(0, 10).join(', ')}`);
});

test('UI-002: biblioteca de ícones cobre os nomes usados e renderiza SVG', async () => {
  // todos os ic('nome') do código existem na biblioteca
  const nomes = new Set();
  for (const f of arquivosJS(path.join(raiz, 'public', 'js'))) {
    const t = fs.readFileSync(f, 'utf8');
    for (const m of t.matchAll(/ic\('([a-z-]+)'\)/g)) nomes.add(m[1]);
    for (const m of t.matchAll(/icone: '([a-z-]+)'/g)) nomes.add(m[1]);
    for (const m of t.matchAll(/ICONE_TIPO[^}]*}/gs)) {
      for (const n of m[0].matchAll(/'([a-z-]+)'/g)) nomes.add(n[1]);
    }
  }
  assert.ok(nomes.size > 20, 'ícones em uso detectados');
  for (const n of ['recibo', 'dinheiro', 'lupa', 'check', 'x', 'sino']) {
    assert.ok(nomes.has(n), `ícone central "${n}" em uso`);
  }
  const svg = ic('dinheiro');
  assert.match(svg, /^<svg /);
  assert.ok(svg.includes('stroke="currentColor"'), 'monocromático via currentColor');
  assert.ok(svg.includes('aria-hidden="true"'), 'decorativo para leitor de tela');
});
