// Testes da P-07: componentes e tokens de UI.
// Invariantes: (1) nenhuma aparência reconhecível muda; (2) nenhuma
// funcionalidade é removida; (3) a migração é INCREMENTAL (telas antigas
// continuam funcionando); (4) as classes existem de fato no CSS.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const raiz = path.resolve(import.meta.dirname, '..');
const ler = (p) => fs.readFileSync(path.join(raiz, p), 'utf8');

const comp = ler('public/css/componentes.css');
const app = ler('public/css/app.css');
const html = ler('public/index.html');
const sw = ler('public/sw.js');
const admin = ler('public/js/views/admin.js');

test('MOD-050: o CSS de componentes é carregado em toda página', () => {
  assert.ok(html.includes('/css/componentes.css'), 'index.html inclui o CSS');
  assert.ok(html.includes('/css/app.css'), 'app.css continua carregado (nada removido)');
  assert.ok(sw.includes('/css/componentes.css'), 'entra no cache offline');
});

test('MOD-051: os tokens de componentes estão definidos', () => {
  const classes = [
    '.campo', '.campo-titulo', '.campo-ajuda', '.campo-erro', '.campo-busca',
    '.linha', '.coluna', '.grade-2', '.entre', '.botoes', '.botoes-acoes',
    '.cartao-titulo', '.cartao-secao', '.vazio-central', '.carregando',
    '.aviso-inline', '.tabela-rolagem',
  ];
  for (const c of classes) {
    assert.ok(comp.includes(c), `classe ${c} definida`);
  }
});

test('MOD-052: os componentes usam os tokens de densidade do design system', () => {
  // O campo e o botão precisam respeitar --input-padding / --touch-min,
  // para que a densidade "compacto" continue valendo.
  assert.ok(comp.includes('var(--input-padding)'), 'campo usa --input-padding');
  assert.ok(comp.includes('var(--touch-min)'), 'campo/linha usa --touch-min');
  assert.ok(comp.includes('var(--gap)'), 'layout usa --gap');
  assert.ok(app.includes('--touch-min: 48px'), 'token de toque continua no app.css');
  assert.ok(app.includes('html.density-compacto'), 'modo compacto continua existindo');
});

test('MOD-053: a migração não altera a identidade visual', () => {
  // As cores dos componentes vêm das variáveis CSS. As únicas literais são as
  // cores de FOCO, as mesmas que app.css já usa (#FFFF00 e #1D4ED8).
  const literaisOk = ['#FFFF00', '#1D4ED8'];
  const coresFixas = (comp.match(/#[0-9a-fA-F]{3,6}/g) ?? [])
    .filter((c) => !literaisOk.includes(c.toUpperCase()));
  assert.deepEqual(coresFixas, [],
    `só cores de foco literais (como em app.css): ${coresFixas.join(', ')}`);
  // E o app.css de fato usa essas mesmas literais.
  assert.ok(app.includes('#FFFF00') && app.includes('#1D4ED8'), 'mesmas cores de foco já usadas');
  // Os temas continuam existindo.
  for (const t of ['tema-claro', 'tema-alto-contraste', 'tema-premium']) {
    assert.ok(app.includes(t), `tema ${t} preservado`);
  }
});

test('MOD-054: a migração é incremental — telas antigas seguem com estilos próprios', () => {
  // As telas que não foram migradas NÃO devem ter sido alteradas por ela.
  for (const tela of ['public/js/views/pdv.js', 'public/js/views/combos.js', 'public/js/views/kds.js']) {
    const src = ler(tela);
    assert.ok(src.includes('style="'), `${tela} mantém seus estilos (migração parcial e reversível)`);
  }
  // Nenhuma regra antiga do app.css foi removida ao adicionar o novo arquivo.
  assert.ok(app.includes('.cartao {'), 'app.css ainda tem .cartao');
  assert.ok(app.includes('.btn {'), 'app.css ainda tem .btn');
  assert.ok(app.includes('.grid-produtos'), 'app.css ainda tem .grid-produtos');
});

test('MOD-055: a tela de Configurações usa os tokens novos', () => {
  const tela = admin.slice(admin.indexOf('async function telaConfig'), admin.indexOf('async function telaComissoes'));
  assert.ok(tela.includes('class="campo"'), 'campos com a classe .campo');
  assert.ok(tela.includes('class="campo-titulo"'), 'rótulos com .campo-titulo');
  assert.ok(tela.includes('class="pers-check"'), 'checkboxes com layout consistente');
  // O estilo inline repetido some naquela tela.
  assert.ok(!tela.includes('background:var(--canvas);border-radius:10px;border:1px solid var(--borda)'),
    'sem o estilo inline repetido');
});

test('MOD-056: nenhuma funcionalidade perdida ao trocar por classes', () => {
  const tela = admin.slice(admin.indexOf('async function telaConfig'), admin.indexOf('async function telaComissoes'));
  // Campos de empresa vêm do array `campos`.
  const listaCampos = admin.slice(admin.indexOf('const campos = ['), admin.indexOf('const campos = [') + 400);
  for (const k of ['empresa_nome', 'empresa_cnpj', 'empresa_telefone', 'empresa_endereco']) {
    assert.ok(listaCampos.includes(`'${k}'`), `config "${k}" preservado no array campos`);
  }
  // Flags e demais chaves aparecem literalmente no template.
  for (const k of ['recibo_largura_mm', 'recibo_cabecalho', 'recibo_rodape',
    'bloquear_apos_venda', 'desconto_caixa_permitido', 'modulo_kds', 'modulo_comanda',
    'nomenclatura_pedido', 'mesa_ociosa_minutos', 'comissao_pct',
    'layout_salao_largura', 'layout_salao_altura',
    'checkin_obrigatorio', 'checkin_exige_cadastro',
    'taxa_servico_modo', 'taxa_servico_pct', 'taxa_servico_fixo_centavos', 'taxa_servico_cobrar_por']) {
    assert.ok(tela.includes(`data-cfg="${k}"`) || tela.includes(`data-flag="${k}"`),
      `config "${k}" preservado`);
  }
  // O botão salvar e a conversão de centavos continuam.
  assert.ok(tela.includes('id="salvar"'), 'botão salvar presente');
  assert.ok(admin.includes('data-centavos'), 'conversão de centavos para o valor fixo');
  assert.ok(admin.includes('reaisParaCentavos'), 'usa o parser oficial de dinheiro');
});

test('MOD-057: acessibilidade dos componentes', () => {
  assert.ok(comp.includes(':focus-visible'), 'foco visível nos componentes');
  assert.ok(comp.includes('.campo-erro:empty'), 'mensagem de erro some quando vazia');
  assert.ok(comp.includes('min-height: 48px') || comp.includes('--touch-min'), 'alvos de toque');
  // Rótulo é associado ao campo (padrão do projeto: <label><span>texto</span><input>).
  assert.ok(admin.includes('<label><span class="campo-titulo">'), 'rótulos dentro de <label>');
  // No celular a fonte do campo é 16px para o iOS não dar zoom automático.
  assert.ok(comp.includes('font-size: 16px'), 'evita zoom automático no iOS');
});

test('MOD-058: nada de dependência externa no CSS novo', () => {
  assert.ok(!/@import/.test(comp), 'sem @import (nada de CDN)');
  assert.ok(!/url\(https?:/.test(comp), 'sem url() apontando para serviço externo');
});