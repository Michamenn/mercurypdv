// Testes da P-04: reorganização das abas administrativas por categoria.
// O invariante crítico é a PRESERVAÇÃO: as 13 telas existentes e os hashes
// antigos continuam válidos, e as permissões seguem filtrando o acesso.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const raiz = path.resolve(import.meta.dirname, '..');
const ler = (p) => fs.readFileSync(path.join(raiz, p), 'utf8');
const admin = ler('public/js/views/admin.js');

// As 13 telas que existiam ANTES da reorganização (inventário validado).
const TELAS_ORIGINAIS = [
  ['relatorios', 'pode_ver_relatorios'],
  ['salao', 'pode_ver_relatorios'],
  ['produtos', 'pode_gerenciar_produtos'],
  ['combos', 'pode_gerenciar_combos'],
  ['estoque', 'pode_estoque_gerenciar'],
  ['usuarios', 'pode_gerenciar_usuarios'],
  ['permissoes', 'pode_config_sistema'],
  ['config', 'pode_config_sistema'],
  ['tema', 'pode_config_sistema'],
  ['backups', 'pode_backup'],
  ['auditoria', 'pode_gerenciar_usuarios'],
  ['dev', 'pode_painel_dev'],
];

// Telas acrescentadas na 1.3.1 (impressão térmica e sessões ativas).
const TELAS_V131 = [
  ['impressao', 'pode_config_sistema'],
  ['sessoes', 'pode_gerenciar_usuarios'],
];

// Cada tela original precisa estar declarada em CATEGORIAS_ADMIN.
const blocoCategorias = admin.slice(
  admin.indexOf('const CATEGORIAS_ADMIN'),
  admin.indexOf('const TELAS_ADMIN')
);

test('MOD-010: todas as telas originais continuam declaradas', () => {
  for (const [id] of TELAS_ORIGINAIS) {
    assert.ok(
      blocoCategorias.includes(`['${id}',`),
      `tela "${id}" ausente das categorias`
    );
  }
});

test('MOD-011: nenhuma tela foi removida e nenhuma foi inventada', () => {
  const declaradas = [...blocoCategorias.matchAll(/\['(\w+)',\s*'(\w+)',\s*'([^']+)',\s*'(pode_\w+)'/g)]
    .map((m) => m[1]);
  const esperadas = [...TELAS_ORIGINAIS.map(([id]) => id), 'comissoes', ...TELAS_V131.map(([id]) => id)];
  for (const id of declaradas) {
    assert.ok(esperadas.includes(id), `tela inesperada "${id}"`);
  }
  assert.equal(declaradas.length, esperadas.length,
    `esperava ${esperadas.length} telas, encontrei ${declaradas.length}`);
  assert.equal(new Set(declaradas).size, declaradas.length, 'sem telas duplicadas');
});

test('MOD-012: a permissão de cada tela foi preservada', () => {
  for (const [id, perm] of TELAS_ORIGINAIS) {
    const linha = blocoCategorias.match(new RegExp(`\\['${id}',\\s*'\\w+',\\s*'[^']+',\\s*'(pode_\\w+)'`));
    assert.ok(linha, `tela "${id}" sem permissão declarada`);
    assert.equal(linha[1], perm, `permissão mudou em "${id}"`);
  }
});

test('MOD-013: todas as telas continuam com sua implementação registrada', () => {
  const bloco = admin.slice(admin.indexOf('const TELAS_ADMIN'), admin.indexOf('export async function render'));
  for (const [id] of TELAS_ORIGINAIS) {
    assert.ok(bloco.includes(`${id}:`), `implementação de "${id}" ausente do mapa`);
  }
});

test('MOD-014: os hashes antigos continuam abrindo a tela correta', () => {
  // O render deve aceitar `sub` como id e navegar por #admin/<id>.
  assert.ok(admin.includes('const guiaAtiva = sub && info(sub) ? sub'),
    'usa o sub do hash como aba ativa quando válido');
  assert.ok(admin.includes('location.hash = `#admin/${b.dataset.g}`'),
    'navegação mantém o padrão de hash #admin/<id>');
  // Aba desconhecida cai em "relatorios" em vez de quebrar.
  assert.ok(admin.includes("?? telaRelatorios"), 'fallback seguro para tela inválida');
});

test('MOD-015: as categorias são agrupamentos, não telas novas', () => {
  const cats = [...blocoCategorias.matchAll(/id:\s*'(\w+)',\s*rotulo:\s*'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(cats, ['operacao', 'financeiro', 'pessoas', 'sistema'],
    'quatro categorias de alto nível');
  // Cada categoria tem rótulo legível em português.
  for (const [, rotulo] of blocoCategorias.matchAll(/id:\s*'\w+',\s*rotulo:\s*'([^']+)'/g)) {
    assert.ok(rotulo.length >= 3, `rótulo curto: "${rotulo}"`);
  }
});

test('MOD-016: a busca filtra por nome, descrição e id', () => {
  assert.ok(admin.includes('id="busca-admin"'), 'campo de busca presente');
  assert.ok(admin.includes('aria-label="Buscar nas configurações"') || admin.includes('for="busca-admin"'),
    'busca tem rótulo acessível');
  assert.ok(admin.includes('busca.oninput'), 'busca filtra em tempo real');
  // A comparação considera rótulo, descrição, id e o nome da categoria.
  assert.ok(admin.includes('const casa = ([id, , rotulo, , desc], cat) =>'),
    'função de correspondência declarada');
  assert.ok(admin.includes('`${rotulo} ${desc} ${id} ${cat.rotulo}`.toLowerCase().includes(termo)'),
    'filtra por rótulo, descrição, id e categoria');
  assert.ok(admin.includes('Nada encontrado para'), 'estado vazio da busca');
  // Com busca, todas as categorias que casam continuam visíveis.
  assert.ok(admin.includes('const visiveis = termo ? grupos : grupos.filter'),
    'a busca revela abas de outras categorias');
});

test('MOD-016b: sem busca, só a categoria ativa ocupa espaço', () => {
  const trecho = admin.slice(admin.indexOf('const desenharNav'), admin.indexOf('busca.oninput'));
  // Filtra pela categoria ativa quando não há termo de busca.
  assert.ok(trecho.includes('termo ? grupos : grupos.filter((c) => c.id === categoriaAtiva?.id)'),
    'sem busca, só a categoria ativa é expandida');
  // A descrição longa vira title (tooltip) para as abas compactas não ocuparem altura.
  assert.ok(trecho.includes('title="${escapar(desc)}"'),
    'descrição preservada como title na aba compacta');
  assert.ok(trecho.includes('admin-aba-txt'),
    'rótulo da aba tem wrapper para truncar com elipse');
});

test('MOD-017: o filtro por permissão continua aplicado', () => {
  assert.ok(admin.includes('abas.filter(([, , , perm]) => estadoApp.permissoes[perm])'),
    'categorias filtram abas sem permissão');
  assert.ok(admin.includes('.filter((c) => c.abas.length > 0)'),
    'categorias vazias somem da navegação');
});

test('MOD-018: acessibilidade da navegação', () => {
  assert.ok(admin.includes('role="tablist"'), 'categorias têm papel de tablist');
  assert.ok(admin.includes('aria-selected='), 'indica a categoria ativa');
  assert.ok(admin.includes('aria-current='), 'indica a tela atual');
  assert.ok(admin.includes('aria-live="polite"'), 'resultado da busca é anunciado');
  assert.ok(admin.includes('role="status"'), 'status da busca tem papel de status');
});

test('MOD-019: nenhum estilo inline de largura na navegação nova', () => {
  // Os cards de tela devem usar as classes CSS, não estilos ad-hoc.
  const trecho = admin.slice(admin.indexOf('const desenharNav'), admin.indexOf('busca.oninput'));
  assert.ok(!/style="width:\d/.test(trecho), 'sem largura fixa inline nos cards');
  assert.ok(trecho.includes('admin-aba-grupo'), 'usa a classe de grade');
});