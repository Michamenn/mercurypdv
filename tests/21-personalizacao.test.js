// Testes da P-05: Central de Personalização unificada.
// Invariante crítico: a central AGRUPA o que já existia — não pode remover
// nem substituir nenhum controle original de theme.js / a11y.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const raiz = path.resolve(import.meta.dirname, '..');
const ler = (p) => fs.readFileSync(path.join(raiz, p), 'utf8');

const pers = ler('public/js/personalizacao.js');
const theme = ler('public/js/theme.js');
const a11y = ler('public/js/a11y.js');
const admin = ler('public/js/views/admin.js');
const sw = ler('public/sw.js');

test('MOD-020: a central reutiliza as funções originais (não duplica lógica)', () => {
  // Importa de a11y.js...
  assert.ok(pers.includes("from './a11y.js'"), 'importa o módulo de acessibilidade');
  // ...e de theme.js.
  assert.ok(pers.includes("from './theme.js'"), 'importa o módulo de tema');
  // Usa as funções reais, não reimplementa aplicação de CSS.
  for (const fn of ['definirTamanhoFonte', 'toggleAltoContraste', 'toggleReduzirMotion', 'toggleModoUmaMao']) {
    assert.ok(pers.includes(fn), `reaproveita ${fn}`);
  }
  for (const fn of ['setTema', 'setCorPersonalizada', 'resetarCorPersonalizada', 'setDensity']) {
    assert.ok(pers.includes(fn), `reaproveita ${fn}`);
  }
  // Não deve escrever diretamente nas variáveis CSS (bypass da lógica central).
  assert.ok(!/documentElement\.style\.setProperty/.test(pers),
    'não aplica CSS por conta própria — delega aos módulos');
});

test('MOD-021: nenhum controle original foi removido dos módulos base', () => {
  // theme.js continua com suas funções e a tela antiga.
  for (const fn of ['export function setTema', 'export function setCorPersonalizada',
    'export function resetarCorPersonalizada', 'export function setDensity',
    'export function renderThemeConfig', 'export function usarTemaGlobal']) {
    assert.ok(theme.includes(fn), `theme.js perdeu ${fn}`);
  }
  // a11y.js continua com seus controles.
  for (const fn of ['export function definirTamanhoFonte', 'export function toggleAltoContraste',
    'export function toggleReduzirMotion', 'export function toggleModoUmaMao',
    'export function renderA11yConfig']) {
    assert.ok(a11y.includes(fn), `a11y.js perdeu ${fn}`);
  }
});

test('MOD-022: todos os controles anteriores estão na central', () => {
  // Aparência
  assert.ok(pers.includes('data-tema='), 'seletor de tema');
  assert.ok(pers.includes('data-densidade='), 'seletor de densidade');
  assert.ok(pers.includes('data-cor='), 'cores personalizadas');
  // Leitura
  assert.ok(pers.includes('pers-fonte-mais') && pers.includes('pers-fonte-menos'), 'tamanho da fonte');
  assert.ok(pers.includes('pers-alto-contraste'), 'alto contraste');
  assert.ok(pers.includes('pers-reduzir-motion'), 'reduzir animações');
  assert.ok(pers.includes('pers-uma-mao'), 'modo uma mão');
  // Navegação
  assert.ok(pers.includes('data-nav-pos='), 'posição do menu');
  assert.ok(pers.includes('nav-compacta'), 'menu compacto');
  assert.ok(pers.includes('nav-auto'), 'menu auto-recolher');
});

test('MOD-023: botão "Restaurar padrões" limpa as três chaves de armazenamento', () => {
  assert.ok(pers.includes('id="pers-resetar"'), 'botão presente');
  assert.ok(pers.includes('confirmar('), 'pede confirmação antes de apagar');
  for (const chave of ['lp-a11y-prefs', 'lp-theme-prefs', 'lp-nav']) {
    assert.ok(pers.includes(chave), `limpa ${chave}`);
    assert.ok(pers.includes(`localStorage.removeItem(${chave})`) || pers.includes('removeItem'),
      `remoção efetiva de ${chave}`);
  }
  // Não pode apagar preferências do SERVIDOR (padrões do estabelecimento).
  assert.ok(!/localStorage\.removeItem\(['"]lp-config/.test(pers), 'não toca em configurações do servidor');
});

test('MOD-024: as chaves de armazenamento são as mesmas dos módulos originais', () => {
  assert.ok(theme.includes("const STORAGE_KEY = 'lp-theme-prefs'"), 'theme.js usa lp-theme-prefs');
  assert.ok(a11y.includes("const STORAGE_KEY = 'lp-a11y-prefs'"), 'a11y.js usa lp-a11y-prefs');
  assert.ok(pers.includes("'lp-theme-prefs'"), 'central usa a mesma chave do tema');
  assert.ok(pers.includes("'lp-a11y-prefs'"), 'central usa a mesma chave de a11y');
});

test('MOD-025: os nomes de tema e cor correspondem à API real de theme.js', () => {
  // Os valores precisam ser exatamente os aceitos por setTema().
  const temasAceitos = [...theme.matchAll(/^\s{2}'?([a-z-]+)'?:\s*\{/gm)].map((m) => m[1]);
  for (const v of ['escuro', 'claro', 'alto-contraste', 'premium']) {
    assert.ok(temasAceitos.includes(v), `tema "${v}" existe em theme.js`);
    assert.ok(pers.includes(`"${v}"`) || pers.includes(`'${v}'`), `central oferece "${v}"`);
  }
  // As chaves de cor precisam ser as de ThemeState.cores.
  assert.ok(theme.includes('acao: null'), 'theme.js usa a chave "acao"');
  for (const c of ['acao', 'ok', 'alerta']) {
    assert.ok(pers.includes(`'${c}'`), `central usa a cor "${c}"`);
    assert.ok(!pers.includes(`'cor_${c}'`), `não inventa a chave "cor_${c}"`);
  }
});

test('MOD-026: a aba Aparência usa a central e continua acessível por hash', () => {
  assert.ok(admin.includes("['tema', 'paleta', 'Aparência'"), 'aba "Aparência" declarada');
  assert.ok(admin.includes('renderPersonalizacao'), 'chama a central unificada');
  assert.ok(admin.includes("await import('../personalizacao.js')"), 'carregamento dinâmico (não pesa no PDV)');
  // O hash antigo #admin/tema continua existindo.
  assert.ok(admin.includes('tema: telaTema'), 'tema continua mapeado no roteador');
});

test('MOD-027: acessibilidade da central', () => {
  assert.ok(pers.includes('<fieldset'), 'agrupa controles com fieldset/legend');
  assert.ok(pers.includes('role="radiogroup"'), 'grupos de escolha têm papel de radiogroup');
  assert.ok(pers.includes('aria-checked='), 'indica a opção selecionada');
  assert.ok(pers.includes('aria-live="polite"'), 'alterações são anunciadas');
  assert.ok(pers.includes('role="status"'), 'área de status presente');
  assert.ok(pers.includes('aria-label='), 'controles têm rótulo acessível');
  assert.ok(pers.includes('sr-only'), 'texto só para leitores de tela onde necessário');
});

test('MOD-028: nenhuma URL externa e nenhum CSS inline de largura', () => {
  const externos = [...pers.matchAll(/https?:\/\/(?!www\.w3\.org)[^\s'"`)]+/g)].map((m) => m[0]);
  assert.deepEqual(externos, [], `sem dependência externa: ${externos.join(', ')}`);
  assert.ok(!/style="width:\d/.test(pers), 'sem largura fixa inline');
});

test('MOD-029: os novos módulos entram no cache offline', () => {
  assert.ok(sw.includes('/js/qrcode.js'), 'qrcode.js no cache do service worker');
  assert.ok(sw.includes('/js/personalizacao.js'), 'personalizacao.js no cache do service worker');
});