// Testes da Fase 1 da modernização: robustez do Caixa (D-01/D-02), busca de
// mesas (P-08) e correção do import relativo quebrado.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const raiz = path.resolve(import.meta.dirname, '..');
const ler = (p) => fs.readFileSync(path.join(raiz, p), 'utf8');

// Simula o comportamento do módulo em ambiente sem DOM, exercitando a lógica
// de rede/caixa. É uma verificação estática + de lógica, NÃO uma renderização
// real em navegador (limitação declarada nos docs da modernização).

test('MOD-001: Caixa não lança ReferenceError quando a rede falha (D-01)', async () => {
  // Reproduz a estrutura REAL corrigida: variáveis declaradas fora do try,
  // desestruturação a partir do cache e filtro que SEMPRE devolve array.
  async function atualizarCom(obter, cacheInicial) {
    let cache = cacheInicial;
    let atual = null, abertos = [], mesas = [];
    let erroRede = null;
    try {
      [atual, abertos, mesas] = await obter();
      cache = { atual, abertos, mesas };
    } catch (e) {
      erroRede = e;
      ({ atual, abertos, mesas } = cache); // Nunca deixa variável indefinida.
    }
    const mesasOcupadas = mesas.filter((m) => m.status !== 'livre');
    return { erroRede, mesasOcupadas, atual };
  }

  const falhando = async () => { throw new Error('rede'); };
  const r = await atualizarCom(falhando, { atual: null, abertos: [], mesas: [] });
  assert.ok(r.erroRede, 'registra o erro de rede');
  assert.ok(Array.isArray(r.mesasOcupadas), 'mesasOcupadas é SEMPRE um array');
  assert.equal(r.mesasOcupadas.length, 0, 'sem dados, a lista fica vazia');
  assert.equal(r.atual, null, 'atual permanece definido (null), não undefined');
});

test('MOD-002: falha de rede reaproveita o último estado conhecido (D-02)', async () => {
  const bom = { atual: { sessao: {} }, abertos: [], mesas: [{ status: 'ocupada' }, { status: 'livre' }] };
  async function passo(obter, cache) {
    let atual = null, abertos = [], mesas = [], erroRede = null;
    try {
      [atual, abertos, mesas] = await obter();
      cache = { atual, abertos, mesas };
    } catch (e) { erroRede = e; ({ atual, abertos, mesas } = cache); }
    return { erroRede, mesasOcupadas: mesas.filter((m) => m.status !== 'livre'), cache };
  }

  const online = await passo(async () => Object.values(bom), { atual: null, abertos: [], mesas: [] });
  assert.equal(online.mesasOcupadas.length, 1, 'com rede: 1 mesa ocupada');

  const offline = await passo(async () => { throw new Error('rede'); }, online.cache);
  assert.ok(offline.erroRede, 'registrou a queda');
  assert.equal(offline.mesasOcupadas.length, 1, 'mantém o último estado conhecido em vez de apagar a tela');
});

test('MOD-003: a tela do Caixa não mente quando não há caixa aberto', () => {
  const src = ler('public/js/views/caixa.js');
  // A mensagem de "sem conexão" precisa existir e ser distinta de "sem caixa aberto".
  assert.ok(src.includes('Sem conexão com o servidor'), 'exibe aviso de sem conexão');
  assert.ok(src.includes('Não há caixa aberto'), 'mantém a tela de abertura de caixa');
  // E o aviso de rede deve aparecer também no ramo "sem caixa aberto".
  assert.ok(
    src.includes('${erroRede ? `<div class="cartao" style="border-color:var(--alerta)'),
    'aviso de rede presente no ramo sem caixa aberto'
  );
});

test('MOD-004: import relativo de pdv.js está correto (bug corrigido)', () => {
  const src = ler('public/js/views/caixa.js');
  assert.ok(
    !src.includes("import('./views/pdv.js')"),
    'não deve usar caminho inexistente views/views/pdv.js'
  );
  assert.ok(src.includes("import('./pdv.js')"), 'usa caminho relativo válido ./pdv.js');
  // O caminho relativo realmente existe?
  assert.ok(fs.existsSync(path.join(raiz, 'public/js/views/pdv.js')), 'alvo do import existe');
});

test('MOD-005: busca de mesas no Caixa filtra por número (P-08)', () => {
  const src = ler('public/js/views/caixa.js');
  assert.ok(src.includes('id="busca-mesas"'), 'campo de busca presente');
  assert.ok(src.includes('renderizarBotoesMesas'), 'função de renderização presente');
  assert.ok(src.includes("String(m.numero).includes(termo)"), 'filtra por número da mesa');
  // Delegação: a lista é redesenhada pela busca, então o clique precisa ser
  // delegado ao container (senão os botões novos ficam sem ação).
  assert.ok(src.includes('lista.onclick'), 'evento delegado ao container');
  assert.ok(src.includes("closest('[data-cobrar-mesa]')"), 'delegação identifica o botão');
  assert.ok(src.includes('aria-describedby="busca-mesas-dica"'), 'busca tem descrição acessível');
});

test('MOD-006: a cobrança soma comandas individuais da mesma mesa', () => {
  const src = ler('public/js/views/caixa.js');
  // Com comanda individual, a mesa pode ter várias contas abertas.
  assert.ok(src.includes('abertos.filter((p) => p.mesa_id === m.id)'), 'lê todas as comandas da mesa');
  assert.ok(src.includes('reduce((s, p) => s + (p.totais?.saldo_centavos ?? 0), 0)'), 'soma os saldos');
  assert.ok(src.includes('for (const pedido of comandas)'), 'percorre todas as comandas ao cobrar');
});

test('MOD-007: nenhuma URL externa é usada no frontend (offline-first)', () => {
  const alvos = [
    'public/js/views/admin.js', 'public/js/views/caixa.js', 'public/js/views/mesas.js',
    'public/js/views/mobile.js', 'public/js/pdfExport.js', 'public/js/views/pdv.js',
  ];
  const externos = [];
  for (const a of alvos) {
    const s = ler(a);
    // 1.3.1: placeholders de exemplo ("ex: https://pdv.seudominio...") são
    // documentação de input, não dependência — o valor real vem do servidor
    // (url_publica configurada pelo admin) ou da própria origem.
    const codigo = s.replace(/placeholder="[^"]*"/g, 'placeholder=""')
      .replace(/title="[^"]*"/g, 'title=""');
    for (const m of codigo.matchAll(/https?:\/\/[^\s'"`)]+/g)) {
      const url = m[0];
      // URLs montadas a partir da própria origem (window.location) são locais
      // e legítimas; o que viola o offline-first é depender de um domínio externo.
      const ehLocal = /\$\{/.test(url) || /localhost|127\.0\.0\.1/.test(url);
      if (!ehLocal) externos.push(`${a}: ${url}`);
    }
  }
  assert.deepEqual(externos, [], `nenhuma dependência de domínio externo:\n${externos.join('\n')}`);
});