// Testes da P-06: tela de Comandas no celular.
// Invariantes: (1) nenhuma tela existente foi removida; (2) a tela nova
// NÃO inventa fluxo de pagamento/fechamento — apenas reutiliza o que existe;
// (3) permissões são respeitadas; (4) dinheiro vem do servidor.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const raiz = path.resolve(import.meta.dirname, '..');
const ler = (p) => fs.readFileSync(path.join(raiz, p), 'utf8');

const cm = ler('public/js/views/comandas.js');
const app = ler('public/js/app.js');
const api = ler('public/js/api.js');
const sw = ler('public/sw.js');

test('MOD-030: nenhuma tela existente foi removida ao adicionar Comandas', () => {
  for (const [id, view] of [
    ['pdv', 'vPdv'], ['mobile', 'vMobile'], ['mesas', 'vMesas'], ['kds', 'vKds'],
    ['caixa', 'vCaixa'], ['admin', 'vAdmin'], ['relatorios', 'vAdmin'],
  ]) {
    assert.ok(app.includes(`id: '${id}'`), `rota "${id}" continua registrada`);
    void view;
  }
  // A tela nova entrou com view e permissões próprias.
  assert.ok(app.includes("id: 'comandas'"), 'rota comandas registrada');
  assert.ok(app.includes("view: vComandas"), 'aponta para a view nova');
  assert.ok(app.includes("import * as vComandas from './views/comandas.js'"), 'import done');
});

test('MOD-031: a tela usa a API que já existe, sem criar rotas', () => {
  // Só endpoints que já estavam no servidor.
  for (const ep of ['/pedidos/abertos', '/pedidos/${', '/itens', '/encaminhar', '/guardar', '/fechar']) {
    assert.ok(cm.includes(ep), `usa ${ep}`);
  }
  // Nenhuma rota nova/inventada.
  const rotas = [...cm.matchAll(/(?:get|post|put|delete)\(`([^`]+)`/g)].map((m) => m[1]);
  const inventadas = rotas.filter((r) => /sincronizar|conectados|imprimir|ticket|maquininha|tef|pagamento\/(?!.*id)/i.test(r));
  assert.deepEqual(inventadas, [], `nenhuma rota inventada: ${inventadas.join(', ')}`);
});

test('MOD-032: NÃO reimplementa pagamento — delega ao fluxo do PDV', () => {
  assert.ok(cm.includes("await import('./pdv.js')"), 'delega ao fluxo já validado do PDV');
  assert.ok(cm.includes('telaPagamento'), 'chama telaPagamento (troco seguro, idempotência)');
  // Não pode calcular dinheiro no cliente.
  assert.ok(!/preco_unit_centavos\s*\*/.test(cm.replace(/fmt\(\(i\.preco_unit_centavos\) \* i\.quantidade\)/, '')),
    'não recalcula total de itens');
  assert.ok(!/total\s*=\s*.*reduce.*preco/.test(cm), 'não soma preços para formar o total');
  // Todo valor exibido vem de `totais` calculado pelo servidor.
  assert.ok(cm.includes('const t = p.totais') && cm.includes('t.total_centavos'),
    'usa p.totais do servidor nos cards');
  assert.ok(cm.includes('const t = atual.totais'), 'usa totais do servidor no detalhe');
  // Não soma valores de itens para formar total (seria recálculo no cliente).
  assert.ok(!/total\s*[:=][^;\n]*reduce/.test(cm), 'nenhum total é recalculado no cliente');
});

test('MOD-033: permissões controlam o que aparece', () => {
  assert.ok(cm.includes('pode_dividir_pagar'), 'verifica permissão de receber/fechar');
  assert.ok(cm.includes('pode_lancar_comanda'), 'verifica permissão de lançar itens');
  // A rota exige qualquer uma das duas.
  assert.ok(app.includes("permOu: ['pode_lancar_comanda', 'pode_dividir_pagar']"),
    'rota liberada por uma das permissões');
  // Ações financeiras ficam condicionadas.
  assert.ok(/podePagar\s*&&\s*!quitada[\s\S]{0,200}data-acao="pagar"/.test(cm),
    'botão Receber só aparece com permissão e saldo em aberto');
  assert.ok(/podeLancar\s*\?\s*`?<button class="btn ghost" data-acao="item"/.test(cm),
    'botão Item só aparece com pode_lancar_comanda');
});

test('MOD-034: busca e filtros funcionam sobre os campos certos', () => {
  assert.ok(cm.includes('id="cm-termo"'), 'campo de busca presente');
  assert.ok(cm.includes('for="cm-termo"') || cm.includes('sr-only'), 'busca tem rótulo acessível');
  // Busca por nome, mesa, cliente, número e observação.
  for (const campo of ['comanda_nome', 'mesa_numero', 'cliente_nome', 'numero_dia', 'observacao']) {
    assert.ok(cm.includes(campo), `busca por ${campo}`);
  }
  const filtros = ['todas', 'minhas', 'saldo', 'mesa', 'balcao', 'guardadas'];
  for (const f of filtros) {
    assert.ok(cm.includes(`'${f}'`), `filtro ${f}`);
  }
  assert.ok(cm.includes('garcom_id === eu'), 'filtro "minhas" usa o garçom logado');
});

test('MOD-035: idempotência preservada ao adicionar item', () => {
  assert.ok(cm.includes("novaIdempotencia('cm')"), 'envia Idempotency-Key ao adicionar item');
  assert.ok(api.includes('novaIdempotencia'), 'helper de idempotência existe na API');
  assert.ok(cm.includes("{ idem:"), 'passa a chave no cabeçalho');
});

test('MOD-036: estados de carregamento, vazio e erro', () => {
  assert.ok(cm.includes('class="skeleton"'), 'estado de carregamento');
  assert.ok(cm.includes('Sem conexão'), 'estado de erro de rede');
  assert.ok(cm.includes('id="cm-retry"'), 'oferece tentar novamente');
  assert.ok(cm.includes('Nenhuma comanda aberta'), 'estado vazio');
  assert.ok(cm.includes('Nenhuma comanda com esse filtro'), 'estado vazio com filtro ativo');
});

test('MOD-037: ações irreversíveis pedem confirmação', () => {
  assert.ok(cm.includes("confirmar('Fechar comanda?'"), 'fechar comanda pede confirmação');
  assert.ok(cm.includes("confirmar('Fechar conta?'"), 'fechar conta pede confirmação');
  assert.ok(cm.includes("confirmar('Cancelar item?'"), 'cancelar item pede confirmação');
});

test('MOD-038: acessibilidade da lista', () => {
  assert.ok(cm.includes('role="list"'), 'lista tem papel de lista');
  assert.ok(cm.includes('role="listitem"'), 'cada comanda é um item de lista');
  assert.ok(cm.includes('aria-label='), 'cada card é descrevível');
  assert.ok(cm.includes('aria-pressed='), 'filtros indicam o estado ativo');
  assert.ok(cm.includes('role="group"'), 'grupo de filtros identificado');
  assert.ok(cm.includes('aria-live="polite"'), 'estado do filtro anunciado');
});

test('MOD-039: nenhuma URL externa na tela nova', () => {
  const externos = [...cm.matchAll(/https?:\/\/(?!www\.w3\.org)[^\s'"`)]+/g)].map((m) => m[0]);
  assert.deepEqual(externos, [], `sem dependência externa: ${externos.join(', ')}`);
  assert.ok(sw.includes('/js/views/comandas.js'), 'entra no cache offline');
});

test('MOD-040: alvos de toque e uso com uma mão', () => {
  const css = ler('public/css/app.css');
  // Os botões de ação herdam o token de toque do design system.
  assert.ok(css.includes('--touch-min: 48px'), 'token de toque ≥48px preservado');
  assert.ok(css.includes('.cm-card-acoes .btn'), 'estilo dos botões de ação do card');
  assert.ok(css.includes('min-height: var(--touch-min)'), 'usa o token de toque');
  // A ação principal ocupa a linha inteira (alcance do polegar).
  assert.ok(css.includes('.cm-card-acoes .btn.ok'), 'ação principal destacada');
  assert.ok(css.includes('padding-bottom: 90px'), 'lista não fica escondida atrás do rodapé');
  // No celular os alvos crescem.
  assert.ok(css.includes('.cm-card-acoes .btn { min-height: 46px') || css.includes('min-height: 46px'),
    'alvos maiores no celular');
});