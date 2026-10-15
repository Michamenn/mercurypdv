// Testes das correções de acessibilidade encontradas na auditoria real.
//
// Contexto: estes problemas NÃO eram hipótese. Cada um foi medido no navegador
// com o Lighthouse/axe ou com medição direta de contraste, e reproduzido aqui
// como teste para não voltar.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const raiz = path.resolve(import.meta.dirname, '..');
const ler = (p) => fs.readFileSync(path.join(raiz, p), 'utf8');

const css = ler('public/css/app.css');
const html = ler('public/index.html');
const admin = ler('public/js/views/admin.js');
const mesas = ler('public/js/views/mesas.js');
const kds = ler('public/js/views/kds.js');
const caixa = ler('public/js/views/caixa.js');
const combos = ler('public/js/views/combos.js');

// --- Função de contraste WCAG, usada para validar as cores realmente ---
function lum(hex) {
  const c = hex.length === 4
    ? [1, 2, 3].map((i) => parseInt(hex[i] + hex[i], 16))
    : [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const f = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2];
}
function razao(a, b) {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

test('MOD-070: o zoom não pode estar bloqueado (WCAG 1.4.4)', () => {
  const meta = html.match(/<meta name="viewport"[^>]*>/)[0];
  assert.ok(!/user-scalable\s*=\s*no/i.test(meta), 'não desabilita pinch-zoom');
  assert.ok(!/maximum-scale\s*=\s*[0-4]/.test(meta), 'não limita o zoom abaixo de 5x');
  assert.ok(meta.includes('width=device-width'), 'mantém a largura do aparelho');
});

test('MOD-071: o documento tem descrição (SEO/acessibilidade)', () => {
  assert.ok(html.includes('name="description"'), 'meta description presente');
});

test('MOD-072: botão "Sair" tem contraste suficiente em TODOS os temas', () => {
  // branco sobre #FF0000 dava 4,0:1; o tema de alto contraste também.
  // Atenção: /color:/ também casa dentro de "border-color:", então o
  // padrão precisa exigir uma fronteira antes de "color".
  const RE_BG = /(?:^|[;{])\s*background:\s*(#[0-9a-fA-F]{3,6})/;
  const RE_FG = /(?:^|[;{])\s*color:\s*(#[0-9a-fA-F]{3,6})/;
  const linhas = css.split('\n').filter((l) => /\.btn\.perigo\s*\{/.test(l));
  assert.ok(linhas.length >= 2, `encontradas ${linhas.length} variantes do botão de perigo`);
  let verificadas = 0;
  for (const linha of linhas) {
    const bg = linha.match(RE_BG);
    const fg = linha.match(RE_FG);
    if (!bg || !fg) continue;
    verificadas++;
    const r = razao(fg[1], bg[1]);
    assert.ok(r >= 4.5,
      `${fg[1]} sobre ${bg[1]} = ${r.toFixed(2)}:1 (mínimo 4,5:1)`);
  }
  assert.ok(verificadas >= 2, `pelo menos 2 variantes com cor explícita foram verificadas (${verificadas})`);
});

test('MOD-073: botão de confirmação tem contraste suficiente (medido: 2,83:1)', () => {
  const RE_BG = /(?:^|[;{])\s*background:\s*(var\(--ok\)|#[0-9a-fA-F]{3,6})/;
  const RE_FG = /(?:^|[;{])\s*color:\s*(#[0-9a-fA-F]{3,6})/;
  const linhas = css.split('\n').filter((l) => /(^|[^-\w])\.btn\.ok\s*\{/.test(l));
  assert.ok(linhas.length >= 2, `variantes do botão de confirmação: ${linhas.length}`);

  let verificadas = 0;
  for (const linha of linhas) {
    const bg = linha.match(RE_BG);
    const fg = linha.match(RE_FG);
    if (!bg || !fg) continue;
    const fundo = bg[1].startsWith('var') ? '#10B981' : bg[1]; // --ok do tema escuro
    verificadas++;
    const r = razao(fg[1], fundo);
    assert.ok(r >= 4.5, `${fg[1]} sobre ${fundo} = ${r.toFixed(2)}:1 (mínimo 4,5:1)`);
  }
  assert.ok(verificadas >= 2, `duas variantes verificadas (${verificadas})`);

  // O tema premium não pode clarear o texto de novo (já dava 2,2:1).
  const premium = css.split('\n').find((l) => l.includes('tema-premium .btn.ok'));
  assert.ok(premium.includes('#042F1E'), 'tema premium mantém o texto escuro');
});

test('MOD-074: texto secundário da mesa é legível sobre o fundo mesclado', () => {
  // Era --texto-fraco (#94A3B8) sobre o fundo mesclado da mesa ocupada:
  // contraste medido de 2,73:1.
  const bloco = css.slice(css.indexOf('.mesa-salao .m-info'), css.indexOf('.mesa-salao .m-info') + 200);
  assert.ok(/color:\s*var\(--texto\)/.test(bloco),
    'usa --texto (contraste alto) em vez de --texto-fraco');
  // Contra o fundo mesclado medido em produção (rgb(96,90,48) ≈ #605A30).
  const r = razao('#E5E7EB', '#605A30');
  assert.ok(r >= 4.5, `contraste de ${r.toFixed(2)}:1 sobre o fundo da mesa ocupada`);
});

test('MOD-075: nome acessível contém o texto visível (WCAG 2.5.3)', () => {
  // Mesas: o aria-label dizia "Mesa 1, ocupada, ..." enquanto o texto
  // visível era "1 1 conta(s) ...". Quem navega por voz não achava o botão.
  const bloco = mesas.slice(mesas.indexOf('const rotulo = `Mesa'), mesas.indexOf('const rotulo = `Mesa') + 1200);
  assert.ok(bloco.includes('const rotulo = `Mesa'), 'o rótulo visível é "Mesa N"');
  assert.ok(bloco.includes('const nome = `${rotulo}'), 'o nome acessível começa pelo rótulo visível');
  assert.ok(bloco.includes('aria-label="${escapar(nome)}"'), 'usa esse nome no aria-label');
  assert.ok(bloco.includes('aria-describedby'), 'o status vai em aria-describedby (não sobrescreve o nome)');
  assert.ok(bloco.includes('class="sr-only"'), 'o status extra é só para leitor de tela');
  // O rótulo precisa aparecer DENTRO do span visível também (não só no aria-label).
  assert.ok(bloco.includes('<span class="m-num">${rotulo}</span>'), 'o texto na tela é o mesmo rótulo');

  // KDS: rótulo visível "Som" com aria-label "Configurar sons da cozinha".
  assert.ok(kds.includes('aria-label="Som — configurar sons da cozinha"'),
    'o rótulo visível "Som" aparece dentro do nome acessível');
});

test('MOD-076: tabelas declaram o escopo dos cabeçalhos (WCAG 1.3.1)', () => {
  for (const [nome, src] of [['admin.js', admin], ['caixa.js', caixa], ['combos.js', combos]]) {
    // Todo <th> dentro de um <thead> precisa declarar o escopo (WCAG 1.3.1).
    // <th> de <tfoot> é total de linha/coluna e usa scope="row"/"col".
    const theads = src.match(/<thead>[\s\S]*?<\/thead>/g) || [];
    assert.ok(theads.length > 0, `${nome}: a tabela tem cabeçalho`);
    for (const th of theads) {
      const semEscopo = (th.match(/<th(?=[ >])(?![^>]*\bscope=)[^>]*>/g) || []);
      assert.deepEqual(semEscopo, [], `${nome}: todo <th> de coluna tem scope`);
    }
    // Nenhum cabeçalho de coluna pode ficar sem texto: sem nome, o leitor de
    // tela não sabe o que aquela coluna representa.
    for (const thead of theads) {
      const semTexto = (thead.match(/<th[^>]*>\s*<\/th>/g) || [])
        .filter((t) => !/sr-only/.test(t));
      assert.deepEqual(semTexto, [], `${nome}: cabeçalho de coluna sem texto`);
    }
  }
  // A coluna de ações (nos cabeçalhos que têm botões) tem rótulo para leitor de tela.
  assert.ok(admin.includes('<span class="sr-only">Ações</span>'),
    'coluna de ações tem rótulo para leitor de tela');
});

test('MOD-077: campos de formulário têm nome acessível', () => {
  // Eram rótulos puramente visuais/ausentes: um leitor de tela anunciava
  // "campo de data" sem dizer qual.
  for (const id of ['de', 'ate']) {
    assert.ok(admin.includes(`id="${id}" aria-label="Data`), `input #${id} nomeado`);
  }
  assert.ok(admin.includes('id="arq-cardapio" aria-label='), 'importador de cardápio nomeado');
  assert.ok(admin.includes('id="arq-backup" aria-label='), 'importador de backup nomeado');
});

test('MOD-078: listas têm a marcação correta', () => {
  // Era <ol><small><li>...</small></ol>: o <small> quebrava a lista e o
  // leitor de tela não anunciava "item 1 de 4".
  assert.ok(!/<ol><small>/.test(admin) && !/<ul><small>/.test(admin),
    'nenhuma lista com elemento não-lista envolvendo os itens');
  assert.ok(admin.includes('<ol class="lista-passos">'), 'a lista de passos usa <ol> direto');
  assert.ok(css.includes('.lista-passos li'), 'estilo da lista aplicado aos itens');
});

test('MOD-079: nenhum botão nasce vazio', () => {
  const appjs = ler('public/js/app.js');
  const vazios = (appjs.match(/<button[^>]*>\s*<\/button>/g) || []);
  assert.deepEqual(vazios, [], 'todo botão tem ícone ou texto desde o primeiro render');
});