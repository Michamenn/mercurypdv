// ============================================================
// Comandas no celular (P-06) — tela mobile-first para o garçom.
//
// REGRA CENTRAL: esta tela NÃO inventa fluxo de pagamento, fechamento,
// impressão ou integração. Ela apenas lista as comandas abertas e
// oferece atalhos para as telas que JÁ existem (mesa, PDV, caixa).
// Todo cálculo de dinheiro continua vindo do servidor.
// ============================================================
import { ic } from '../icons.js';
import { get, post, fmt } from '../api.js';
import { toast, modal, confirmar, escapar } from '../ui.js';
import { seletorCombo } from './combos.js';
import { aoEvento } from '../ws.js';
import { anunciar } from '../a11y.js';
import { abrirContaDoPedido } from '../conta.js';
import { novaIdempotencia } from '../api.js';

let cancelarEventos = null;
let filtro = 'todas';
let termo = '';

// Busca sem acento: "pao" encontra "Pão" (filtro local — instantâneo, sem debounce).
const semAcento = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

const FILTROS = [
  ['todas', 'Todas', null],
  ['minhas', 'Minhas', (p, eu) => p.garcom_id === eu],
  ['saldo', 'Com saldo', (p) => p.totais.saldo_centavos > 0],
  ['mesa', 'Mesas', (p) => p.tipo === 'mesa'],
  ['balcao', 'Balcão', (p) => p.tipo === 'balcao'],
  ['guardadas', 'Guardadas', (p) => p.guardado === 1],
];

export async function render(conteudo, _sub, estadoApp) {
  cancelarEventos?.();
  cancelarEventos = aoEvento((ev) => {
    // Reação a mudanças vindas da cozinha, do caixa e de outros dispositivos.
    if (['pedido.criado', 'pedido.atualizado', 'pedido.fechado', 'kds.enviado', 'mesa.atualizada'].includes(ev.tipo)) {
      carregar(conteudo, estadoApp);
    }
  });
  await carregar(conteudo, estadoApp);
}

async function carregar(conteudo, estadoApp) {
  conteudo.innerHTML = `
    <div class="skeleton" style="height:90px;margin-bottom:12px"></div>
    <div class="skeleton" style="height:200px"></div>`;
  let abertos = [];
  try {
    abertos = await get('/pedidos/abertos');
  } catch (e) {
    conteudo.innerHTML = `
      <div class="cartao" style="border-color:var(--alerta)">
        <strong>${ic('antena')} Sem conexão</strong>
        <p style="color:var(--texto-fraco)">Não foi possível carregar as comandas. ${escapar(e.message ?? '')}</p>
        <button class="btn primario" id="cm-retry" style="width:100%">Tentar novamente</button>
      </div>`;
    conteudo.querySelector('#cm-retry').onclick = () => carregar(conteudo, estadoApp);
    return;
  }
  desenhar(conteudo, estadoApp, abertos);
}

function desenhar(conteudo, estadoApp, abertos) {
  const cfg = estadoApp.config ?? {};
  const rotulo = cfg.nomenclatura_pedido === 'comanda' ? 'Comanda' : 'Mesa';
  const meuId = estadoApp.usuario?.id;

  const contagens = Object.fromEntries(
    FILTROS.map(([id, , fn]) => [id, fn ? abertos.filter((p) => fn(p, meuId)).length : abertos.length])
  );

  const aplicar = (p) => {
    const f = FILTROS.find(([id]) => id === filtro)?.[2];
    if (f && !f(p, meuId)) return false;
    if (!termo) return true;
    const alvo = `${p.comanda_nome ?? ''} ${p.mesa_numero ?? ''} ${p.cliente_nome ?? ''} #${p.numero_dia ?? p.id} ${p.observacao ?? ''}`.toLowerCase();
    return alvo.includes(termo);
  };

  const lista = abertos.filter(aplicar);
  // Sem saldo primeiro (prontas para fechar), depois por valor.
  const ordenada = [...lista].sort((a, b) => {
    const sa = a.totais.saldo_centavos, sb = b.totais.saldo_centavos;
    if ((sa === 0) !== (sb === 0)) return sa === 0 ? -1 : 1;
    return b.totais.total_centavos - a.totais.total_centavos;
  });

  const totalEmAberto = lista.reduce((s, p) => s + p.totais.saldo_centavos, 0);
  const podeLancar = !!estadoApp.permissoes.pode_lancar_comanda;

  conteudo.innerHTML = `
    <div class="cm-topo">
      <div>
        <h2 style="margin:0">${ic('recibo')} Comandas</h2>
        <small style="color:var(--texto-fraco)">
          ${contagens.todas} aberta(s) · ${fmt(totalEmAberto)} a receber
        </small>
      </div>
      <button class="btn ghost" id="cm-atualizar" aria-label="Atualizar lista">${ic('reciclar')}</button>
    </div>

    <div class="cm-busca">
      <label class="sr-only" for="cm-termo">Buscar comanda por nome, mesa ou número</label>
      ${ic('lupa')}
      <input id="cm-termo" type="search" autocomplete="off"
        placeholder="Buscar por nome, mesa ou nº…" value="${escapar(termo)}" />
    </div>

    <div class="abas cm-filtros" role="group" aria-label="Filtros">
      ${FILTROS.map(([id, nome]) => `<button class="btn ${id === filtro ? 'ativa' : ''}" data-filtro="${id}"
        aria-pressed="${id === filtro}">${nome}${contagens[id] ? ` <small style="opacity:.75">${contagens[id]}</small>` : ''}</button>`).join('')}
    </div>

    <p class="cm-rodape-info" id="cm-status" role="status" aria-live="polite">
      ${ordenada.length} comanda(s) exibida(s)${ordenada.length !== contagens.todas ? ` de ${contagens.todas}` : ''}.
    </p>
    <div id="cm-lista" class="cm-lista" role="list">
      ${ordenada.map((p) => cartao(p, rotulo, estadoApp)).join('')
        || `<div class="vazio">
             ${ic('lupa')}
             <p>${abertos.length ? 'Nenhuma comanda com esse filtro.' : 'Nenhuma comanda aberta no momento.'}</p>
           </div>`}
    </div>

    <div class="cm-rodape">
      <span class="cm-rodape-info">${ic('celular')} A lista atualiza sozinha quando algo muda no salão.</span>
    </div>`;

  // --- Eventos ---
  conteudo.querySelector('#cm-atualizar').onclick = () => carregar(conteudo, estadoApp);

  const busca = conteudo.querySelector('#cm-termo');
  busca.oninput = () => {
    termo = busca.value.trim().toLowerCase();
    desenhar(conteudo, estadoApp, abertos);
    conteudo.querySelector('#cm-termo')?.focus();
  };

  conteudo.querySelectorAll('[data-filtro]').forEach((b) => {
    b.onclick = () => {
      filtro = b.dataset.filtro;
      desenhar(conteudo, estadoApp, abertos);
    };
  });

  conteudo.querySelector('#cm-lista').onclick = (ev) => {
    const alvo = ev.target.closest('[data-acao]');
    if (!alvo) return;
    const id = Number(alvo.closest('[data-comanda]').dataset.comanda);
    const p = abertos.find((x) => x.id === id);
    if (!p) return;
    acao(alvo.dataset.acao, p, conteudo, estadoApp);
  };

  // Abrir o detalhe da comanda
  conteudo.querySelectorAll('[data-comanda]').forEach((card) => {
    card.onclick = (ev) => {
      if (ev.target.closest('[data-acao]')) return;
      const p = abertos.find((x) => x.id === Number(card.dataset.comanda));
      if (p) detalhe(p, conteudo, estadoApp, rotulo);
    };
  });

  void podeLancar;
}

function cartao(p, rotulo, estadoApp) {
  const t = p.totais;
  const quitada = t.saldo_centavos === 0;
  const nome = p.comanda_nome || (p.tipo === 'mesa' ? `${rotulo} ${p.mesa_numero}` : `Balcão #${p.numero_dia ?? p.id}`);
  const podePagar = !!estadoApp.permissoes.pode_dividir_pagar;
  const podeLancar = !!estadoApp.permissoes.pode_lancar_comanda;

  return `<article class="cm-card ${quitada ? 'quitada' : ''}" data-comanda="${p.id}" role="listitem"
      aria-label="${escapar(nome)}, total ${fmt(t.total_centavos)}${quitada ? ', quitada' : `, falta ${fmt(t.saldo_centavos)}`}">
    <div class="cm-card-topo">
      <div class="cm-card-id">
        <strong>${escapar(nome)}</strong>
        <span class="cm-tags">
          ${p.tipo === 'mesa' ? `<span class="badge">${ic('prato')} ${rotulo} ${p.mesa_numero ?? ''}</span>` : ''}
          ${p.canal === 'viagem' ? `<span class="badge">${ic('marmita')} viagem</span>` : ''}
          ${p.individual ? '<span class="badge">individual</span>' : ''}
          ${p.guardado ? `<span class="badge">${ic('relogio')} guardada</span>` : ''}
          ${p.cliente_nome ? `<span class="badge">${ic('pessoas')} ${escapar(p.cliente_nome)}</span>` : ''}
        </span>
      </div>
      <div class="cm-card-valor">
        <strong class="mono">${fmt(t.total_centavos)}</strong>
        ${quitada
          ? '<span class="badge ok">quitada</span>'
          : `<span class="cm-saldo mono">falta ${fmt(t.saldo_centavos)}</span>`}
      </div>
    </div>
    <div class="cm-card-sub">
      <span>${p.itens.reduce((s, i) => s + (i.status === 'ativo' ? i.quantidade : 0), 0)} item(ns)</span>
      <span>${escapar(p.garcom_nome ?? 'sem garçom')}</span>
      <span>${tempoDesde(p.aberto_em)}</span>
    </div>
    <div class="cm-card-acoes">
      ${podeLancar ? `<button class="btn ghost" data-acao="item">${ic('presente')} Item</button>` : ''}
      ${podeLancar ? `<button class="btn ghost" data-acao="encaminhar">${ic('upload')} Cozinha</button>` : ''}
      <button class="btn ghost" data-acao="guardar">${p.guardado ? '▶ Retomar' : '⏸ Guardar'}</button>
      ${podePagar && !quitada ? `<button class="btn ok" data-acao="pagar">${ic('dinheiro')} Receber</button>` : ''}
      ${podePagar && quitada ? `<button class="btn ok" data-acao="fechar">${ic('check')} Fechar</button>` : ''}
      ${quitada && !podePagar ? '<span class="cm-selo">pronta para o caixa</span>' : ''}
    </div>
  </article>`;
}

function tempoDesde(iso) {
  if (!iso) return '';
  const min = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h}h${String(min % 60).padStart(2, '0')}`;
}

// ---------- Ações (todas já suportadas pelo sistema) ----------
async function acao(tipo, p, conteudo, estadoApp) {
  try {
    if (tipo === 'encaminhar') {
      await post(`/pedidos/${p.id}/encaminhar`, {});
      toast('Enviado à cozinha', 'ok');
      anunciar('Comanda enviada à cozinha.', true);
    } else if (tipo === 'guardar') {
      const novo = !p.guardado;
      await post(`/pedidos/${p.id}/guardar`, { guardado: novo });
      toast(novo ? 'Comanda guardada' : 'Comanda retomada', 'ok');
    } else if (tipo === 'fechar') {
      if (!await confirmar('Fechar comanda?', 'A comanda será encerrada e subtraída da lista de abertas.')) return;
      await post(`/pedidos/${p.id}/fechar`, {});
      toast('Comanda fechada', 'ok');
    } else if (tipo === 'item') {
      detalhe(p, conteudo, estadoApp, null, 'item');
      return;
    } else if (tipo === 'pagar') {
      // Não reimplementa pagamento: delega ao fluxo já validado do PDV.
      const { telaPagamento } = await import('./pdv.js');
      const r = await telaPagamento(p, estadoApp);
      if (r?.saldo_zero) toast('Comanda quitada — pode ser fechada', 'ok');
    }
    await carregar(conteudo, estadoApp);
  } catch (e) {
    toast(e.message, 'erro');
  }
}

// ---------- Detalhe ----------
async function detalhe(p, conteudo, estadoApp, rotulo, abaInicial = 'itens') {
  const m = modal(`<div id="cm-det">Carregando…</div>`, { aoFechar: () => carregar(conteudo, estadoApp) });
  const corpo = m.caixa.querySelector('#cm-det');
  corpo.classList.add('painel-comanda');

  const desenhar = async () => {
    let atual = p;
    try { atual = await get(`/pedidos/${p.id}`); } catch { /* mantém a cópia local */ }
    const t = atual.totais;
    const nome = atual.comanda_nome || `Balcão #${atual.numero_dia ?? atual.id}`;
    const quitada = t.saldo_centavos === 0;
    const podeLancar = !!estadoApp.permissoes.pode_lancar_comanda;

    corpo.innerHTML = `
      <div class="painel-comanda-topo">
        <h2>${ic('recibo')} ${escapar(nome)}</h2>
        <p style="color:var(--texto-fraco)">
          ${atual.tipo === 'mesa' ? `${rotulo ?? 'Mesa'} ${atual.mesa_numero ?? ''} · ` : 'Balcão · '}
          aberta ${tempoDesde(atual.aberto_em)} atrás · ${escapar(atual.garcom_nome ?? 'sem garçom')}
        </p>
        ${atual.observacao ? `<p class="cm-obs">${ic('lapis')} ${escapar(atual.observacao)}</p>` : ''}
      </div>

      <div class="painel-comanda-itens">
        ${atual.itens.map((i) => `<div class="linha-itens ${i.status === 'cancelado' ? 'cm-cancelado' : ''}">
          <span>${i.quantidade}× ${escapar(i.nome_produto)}
            ${i.variacao_nome ? `<br><small style="color:var(--texto-fraco)">${escapar(i.variacao_nome)}</small>` : ''}
            ${i.adicionais ? `<br><small style="color:var(--texto-fraco)">+ ${escapar(i.adicionais)}</small>` : ''}
            ${i.observacoes ? `<br><small style="color:var(--amarelo)">${ic('lapis')} ${escapar(i.observacoes)}</small>` : ''}
            ${i.enviado_cozinha_em ? '<br><small class="badge">na cozinha</small>' : '<br><small class="badge">local</small>'}
          </span>
          <span style="display:flex;align-items:center;gap:8px">
            <strong class="mono">${fmt((i.preco_unit_centavos) * i.quantidade)}</strong>
            ${i.status === 'ativo' && podeLancar && abaInicial !== 'item'
              ? `<button class="btn ghost" data-cancelar="${i.id}" aria-label="Cancelar ${escapar(i.nome_produto)}">${ic('x')}</button>` : ''}
          </span>
        </div>`).join('') || '<div class="vazio">Comanda vazia</div>'}
      </div>

      <div class="painel-comanda-rodape">
        <div class="cm-totais">
        <div><span>Subtotal</span><span class="mono">${fmt(t.subtotal_centavos ?? t.bruto_centavos)}</span></div>
        ${t.taxa_servico_centavos ? `<div><span>Taxa de serviço</span><span class="mono">${fmt(t.taxa_servico_centavos)}</span></div>` : ''}
        <div class="cm-total"><span>Total</span><span class="mono">${fmt(t.total_centavos)}</span></div>
        ${quitada ? '<div><span class="badge ok">Quitada</span></div>'
          : `<div class="cm-falta"><span>Falta</span><span class="mono">${fmt(t.saldo_centavos)}</span></div>`}
        </div>
      </div>

      <div class="painel-comanda-acoes">
        ${podeLancar ? `<button class="btn" data-d="item">${ic('presente')} Item</button>` : ''}
        ${podeLancar ? `<button class="btn" data-d="combo">${ic('presente')} Combo</button>` : ''}
        ${podeLancar ? `<button class="btn" data-d="encaminhar">${ic('upload')} Cozinha</button>` : ''}
        <button class="btn" data-d="conta">${ic('recibo')} Conta</button>
        <button class="btn" data-d="guardar">${atual.guardado ? '▶ Retomar' : '⏸ Guardar'}</button>
        ${estadoApp.permissoes.pode_dividir_pagar && !quitada
          ? `<button class="btn ok larga" data-d="pagar">${ic('dinheiro')} Receber</button>` : ''}
        ${estadoApp.permissoes.pode_dividir_pagar && quitada
          ? `<button class="btn ok larga" data-d="fechar">${ic('check')} Fechar conta</button>` : ''}
      </div>
      <button class="btn ghost" data-d="voltar" style="width:100%;margin-top:8px">Voltar</button>`;

    const recarregar = async () => { await desenhar(); };

    corpo.querySelector('[data-d="voltar"]').onclick = m.fechar;
    const btnConta = corpo.querySelector('[data-d="conta"]');
    if (btnConta) btnConta.onclick = () => abrirContaDoPedido(atual);
    corpo.querySelector('[data-d="item"]')?.addEventListener('click', async () => {
      const catalogo = await get('/catalogo');
      seletorItem(catalogo, async (item) => {
        await post(`/pedidos/${atual.id}/itens`, item, { idem: novaIdempotencia('cm') });
        toast('Item adicionado', 'ok');
        await recarregar();
      });
    });
    corpo.querySelector('[data-d="combo"]')?.addEventListener('click', async () => {
      const atualizado = await seletorCombo(atual.id);
      if (atualizado) await recarregar();
    });
    corpo.querySelector('[data-d="encaminhar"]')?.addEventListener('click', async () => {
      try {
        await post(`/pedidos/${atual.id}/encaminhar`, {});
        toast('Enviado à cozinha', 'ok');
        await recarregar();
      } catch (e) { toast(e.message, 'erro'); }
    });
    corpo.querySelector('[data-d="guardar"]').onclick = async () => {
      try {
        await post(`/pedidos/${atual.id}/guardar`, { guardado: !atual.guardado });
        await recarregar();
      } catch (e) { toast(e.message, 'erro'); }
    };
    corpo.querySelector('[data-d="fechar"]')?.addEventListener('click', async () => {
      if (!await confirmar('Fechar conta?', 'A comanda será encerrada.')) return;
      try {
        await post(`/pedidos/${atual.id}/fechar`, {});
        toast('Conta fechada', 'ok');
        m.fechar();
      } catch (e) { toast(e.message, 'erro'); }
    });
    corpo.querySelector('[data-d="pagar"]')?.addEventListener('click', async () => {
      try {
        const { telaPagamento } = await import('./pdv.js');
        const r = await telaPagamento(atual, estadoApp);
        if (r?.saldo_zero) { toast('Quitada! Feche a conta.', 'ok'); await recarregar(); }
      } catch (e) { toast(e.message, 'erro'); }
    });
    corpo.querySelectorAll('[data-cancelar]').forEach((b) => {
      b.onclick = async () => {
        const item = atual.itens.find((i) => i.id === Number(b.dataset.cancelar));
        // Nunca prompt() nativo (quebra UX mobile): modal com motivo integrado.
        const dlg = modal(`<h2>Cancelar item</h2>
          <p>"${escapar(item.nome_produto)}" sairá da comanda.</p>
          <label class="campo-titulo" for="cm-motivo">Motivo do cancelamento</label>
          <input id="cm-motivo" class="campo" maxlength="200" autocomplete="off"
            placeholder="Motivo (mínimo 3 caracteres)" />
          <div class="modal-acoes">
            <button class="btn ghost" data-a="manter">Manter item</button>
            <button class="btn perigo" data-a="cancelar">Cancelar item</button>
          </div>`);
        dlg.caixa.querySelector('[data-a="manter"]').onclick = dlg.fechar;
        dlg.caixa.querySelector('[data-a="cancelar"]').onclick = async () => {
          const motivo = dlg.caixa.querySelector('#cm-motivo').value.trim();
          if (motivo.length < 3) { toast('Informe um motivo (mínimo 3 caracteres)', 'erro'); return; }
          dlg.fechar();
          if (!await confirmar('Cancelar item?', `"${escapar(item.nome_produto)}" sairá da comanda.`)) return;
          try {
            await post(`/pedidos/${atual.id}/itens/${item.id}/cancelar`, { motivo });
            toast('Item cancelado', 'ok');
            await recarregar();
          } catch (e) { toast(e.message, 'erro'); }
        };
      };
    });
  };

  desenhar();
}

function seletorItem(catalogo, aoEscolher) {
  let categoria = catalogo.categorias[0]?.id ?? null;
  const m = modal(`<h2>Adicionar item</h2>
    <div class="campo-busca" style="margin-bottom:10px">
      ${ic('lupa')}
      <input id="cm-busca" class="campo" type="search" inputmode="search" enterkeyhint="search"
        placeholder="Buscar produto…" aria-label="Buscar produto"
        autocomplete="off" autocapitalize="none" spellcheck="false" />
    </div>
    <div class="abas">${catalogo.categorias.map((c) => `<button class="btn ${c.id === categoria ? 'ativa' : ''}" data-c="${c.id}">${escapar(c.nome)}</button>`).join('')}</div>
    <div class="grid-produtos" id="cm-prods"></div>
    <button class="btn ghost" data-a="v" style="width:100%;margin-top:10px">Voltar</button>`);

  const grade = m.caixa.querySelector('#cm-prods');
  const busca = m.caixa.querySelector('#cm-busca');
  const abas = [...m.caixa.querySelectorAll('[data-c]')];

  const mostrar = () => {
    const buscaAtiva = semAcento(busca.value.trim());
    // Com busca ativa a categoria é ignorada: procura em todo o cardápio (nome ou apelido).
    abas.forEach((b) => b.classList.toggle('ativa', !buscaAtiva && Number(b.dataset.c) === categoria));
    const lista = catalogo.produtos.filter((p) => p.disponivel && (buscaAtiva
      ? semAcento(p.nome).includes(buscaAtiva) || semAcento(p.apelidos).includes(buscaAtiva)
      : p.categoria_id === categoria));
    grade.innerHTML = lista
      .map((p) => `<button class="btn produto-btn" data-p="${p.id}"><span>${escapar(p.nome)}</span><span class="preco">${fmt(p.preco_centavos)}</span></button>`)
      .join('') || `<div class="vazio">${buscaAtiva ? 'Nenhum produto encontrado.' : 'Nenhum produto nesta categoria.'}</div>`;
    grade.querySelectorAll('[data-p]').forEach((b) => {
      b.onclick = () => {
        const prod = lista.find((x) => x.id === Number(b.dataset.p));
        m.fechar();
        escolherQuantidade(prod, aoEscolher);
      };
    });
  };

  busca.oninput = mostrar;
  abas.forEach((b) => {
    b.onclick = () => { categoria = Number(b.dataset.c); busca.value = ''; mostrar(); };
  });
  m.caixa.querySelector('[data-a="v"]').onclick = m.fechar;
  mostrar();
  busca.focus();
}

function escolherQuantidade(prod, aoEscolher) {
  const m = modal(`<h2>${escapar(prod.nome)}</h2>
    <p class="mono" style="font-size:1.2rem;color:var(--ok)">${fmt(prod.preco_centavos)}</p>
    <div class="qtd-stepper">
      <button type="button" class="btn" data-q="-1" aria-label="Diminuir">−</button>
      <input id="cm-qtd" type="number" min="1" max="999" value="1" inputmode="numeric" aria-label="Quantidade" />
      <button type="button" class="btn" data-q="1" aria-label="Aumentar">＋</button>
    </div>
    <input id="cm-obs" placeholder="Observação (opcional)"
      style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
    <div style="display:flex;gap:10px;margin-top:12px">
      <button class="btn ghost" data-a="c">Cancelar</button>
      <button class="btn ok grande" data-a="ok" style="flex:1">Adicionar</button>
    </div>`);
  m.caixa.classList.add('modal-quantidade');
  const input = m.caixa.querySelector('#cm-qtd');
  m.caixa.querySelectorAll('[data-q]').forEach((b) => {
    b.onclick = () => {
      const delta = Number(b.dataset.q);
      let val = Math.min(999, Math.max(1, Number(input.value) + delta));
      input.value = val;
    };
  });
  m.caixa.querySelector('[data-a="c"]').onclick = m.fechar;
  m.caixa.querySelector('[data-a="ok"]').onclick = () => {
    const quantidade = Math.max(1, Math.min(999, Number(input.value) || 1));
    m.fechar();
    aoEscolher({
      produto_id: prod.id,
      quantidade,
      observacoes: m.caixa.querySelector('#cm-obs').value.trim() || null,
    });
  };
}