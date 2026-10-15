// Testes de fiação dos módulos frontend (itens 1, 2, 4, 5 — pré-existentes, agora com guarda de regressão)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { iniciarServidorTeste, semear } from './helpers.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ler = (p) => fs.readFileSync(path.join(raiz, p), 'utf8');

test('FE-001: acessibilidade essencial presente e fiada (item 1)', () => {
  const index = ler('public/index.html');
  assert.ok(index.includes('skip-link'), 'skip link existe');
  assert.ok(index.includes('aria-live="assertive"'), 'live region assertive existe');
  const css = ler('public/css/app.css');
  assert.ok(css.includes(':focus-visible'), 'foco visível existe');
  assert.ok(css.includes('prefers-reduced-motion'), 'redução de movimento existe');
  assert.ok(css.includes('tema-alto-contraste') || css.includes('alto-contraste'), 'alto contraste existe');
  const a11y = ler('public/js/a11y.js');
  assert.ok(a11y.includes('initA11y'), 'initA11y exportado');
  const app = ler('public/js/app.js');
  assert.ok(app.includes('initA11y'), 'app inicializa a11y');
  const sw = ler('public/sw.js');
  assert.ok(sw.includes('/js/a11y.js'), 'sw faz cache do a11y.js');
});

test('FE-002: tema com 4 bases + densidade fiado e persistência global (item 2)', async () => {
  const theme = ler('public/js/theme.js');
  assert.ok(theme.includes('alto-contraste'), 'tema alto contraste no theme.js');
  assert.ok(theme.includes('premium'), 'quarta opção premium no theme.js');
  const css = ler('public/css/app.css');
  assert.ok(css.includes('tema-claro'), 'tema claro no CSS');
  assert.ok(css.includes('tema-premium'), 'tema premium no CSS');
  assert.ok(css.includes('density-compacto'), 'densidade compacta no CSS');
  const app = ler('public/js/app.js');
  assert.ok(app.includes('carregarPreferenciasTema') && app.includes('aplicarTema'), 'app inicializa tema');
  assert.ok(app.includes('aplicarPadroesServidor'), 'app aplica padrões do servidor no 1º acesso');

  // backend: admin define defaults globais; validação rejeita cor inválida (anti-injeção CSS)
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    const ruim = await s.adminCli.put('/config', { cor_acao: 'red; } body{display:none' });
    assert.equal(ruim.status, 422);
    const ruim2 = await s.adminCli.put('/config', { tema_padrao: 'neon' });
    assert.equal(ruim2.status, 422);
    const premium = await s.adminCli.put('/config', { tema_padrao: 'premium' });
    assert.equal(premium.status, 200);
    assert.equal(premium.corpo.tema_padrao, 'premium');
    const ok = await s.adminCli.put('/config', { tema_padrao: 'claro', cor_acao: '#123ABC', densidade_padrao: 'compacto' });
    assert.equal(ok.status, 200);
    assert.equal(ok.corpo.tema_padrao, 'claro');
    const me = await s.caixaCli.get('/auth/me');
    assert.equal(me.corpo.config_publica.cor_acao, '#123ABC');
    // não-admin não altera config
    const negado = await s.caixaCli.put('/config', { tema_padrao: 'escuro' });
    assert.equal(negado.status, 403);
  } finally { await sv.fechar(); }
});

test('FE-003: som do KDS fiado aos eventos + toggle (item 5)', () => {
  const sound = ler('public/js/sound.js');
  for (const fn of ['tocarNovoPedido', 'tocarAtrasado', 'tocarPronto', 'toggleSom', 'setVolume', 'renderSoundConfig']) {
    assert.ok(sound.includes(`export function ${fn}`), `sound exporta ${fn}`);
  }
  assert.ok(!sound.includes('cdn.jsdelivr') && !sound.includes('https://'), 'som sem dependência externa (Web Audio nativo)');
  const kds = ler('public/js/views/kds.js');
  assert.ok(kds.includes('tocarNovoPedido'), 'KDS toca som em pedido novo');
  assert.ok(kds.includes('tocarPronto'), 'KDS toca som em pronto');
  assert.ok(kds.includes('tocarAtrasado'), 'KDS toca som em atraso');
  assert.ok(kds.includes('renderSoundConfig'), 'KDS tem painel de som');
  const sw = ler('public/sw.js');
  assert.ok(sw.includes('/js/sound.js'), 'sw faz cache do sound.js');
});

test('FE-004: PDF 100% local, sem CDN, fiado ao admin (item 4)', () => {
  const pdf = ler('public/js/pdfExport.js');
  assert.ok(!pdf.includes('cdn.jsdelivr') && !pdf.includes('https://'), 'pdfExport sem CDN (offline-first preservado)');
  assert.ok(pdf.includes('/vendor/jspdf'), 'carrega jsPDF do vendor local');
  assert.ok(fs.existsSync(path.join(raiz, 'public/vendor/jspdf.umd.min.js')), 'vendor jspdf existe');
  assert.ok(fs.existsSync(path.join(raiz, 'public/vendor/jspdf.plugin.autotable.min.js')), 'vendor autotable existe');
  const admin = ler('public/js/views/admin.js');
  assert.ok(admin.includes('exportarRelatorioPDF'), 'admin importa exportação PDF');
  const sw = ler('public/sw.js');
  assert.ok(sw.includes('/vendor/jspdf.umd.min.js'), 'sw faz cache do vendor');
  const combos = ler('public/js/views/combos.js');
  assert.ok(combos.includes('seletorCombo'), 'seletor de combo exportado para o PDV');
  const pdv = ler('public/js/views/pdv.js');
  assert.ok(pdv.includes('seletorCombo'), 'PDV usa seletor de combo');
  const mesas = ler('public/js/views/mesas.js');
  assert.ok(mesas.includes('seletorCombo'), 'comanda usa seletor de combo');
  assert.ok(mesas.includes('data-renumerar') && mesas.includes('data-excluir-mesa'), 'mapa tem edição inline (item 6)');
});
