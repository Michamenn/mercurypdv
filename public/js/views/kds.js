// KDS de Cozinha: kanban em tempo real (WS), atraso calculado por horários do servidor (KDS-002)
import { ic } from '../icons.js';
import { get, post, fmt } from '../api.js';
import { toast, escapar, modal } from '../ui.js';
import { aoEvento, aoEstado } from '../ws.js';
import { tocarNovoPedido, tocarPronto, tocarAtrasado, renderSoundConfig, carregarPreferenciasSom } from '../sound.js';

let cancelarEventos = null;
let tick = null;
let atrasadosJaAlertados = new Set();
let kdsWsOk = true; // espelho local do estado do WS p/ o selo do painel (visual)
let desouvirKdsEstado = null;

// Selo de conexão do painel (mesma derivação do app shell, sem tocar no ws.js):
// WS ok = Conectado; WS caiu com rede = Reconectando; sem rede = Sem conexão.
function refletirConexaoKds() {
  const el = document.getElementById('kds-conexao');
  if (!el) return;
  let txt = '● Painel KDS — Conectado', cls = 'on';
  if (!kdsWsOk) {
    if (navigator.onLine === false) { txt = '× Painel KDS — Sem conexão'; cls = 'off'; }
    else { txt = '◌ Painel KDS — Reconectando…'; cls = 'meio'; }
  }
  el.textContent = txt;
  el.className = `estado-conexao ${cls}`;
}

carregarPreferenciasSom();

export async function render(conteudo, _sub, estadoApp) {
  cancelarEventos?.();
  atrasadosJaAlertados = new Set();
  if (!desouvirKdsEstado) desouvirKdsEstado = aoEstado((online) => { kdsWsOk = online; refletirConexaoKds(); });
  cancelarEventos = aoEvento((ev) => {
    if (ev.tipo === 'kds.enviado') tocarNovoPedido();
    if (ev.tipo === 'kds.status' && ev.payload?.para === 'pronto') tocarPronto();
    if (['kds.enviado', 'kds.status', 'pedido.atualizado', 'pedido.fechado'].includes(ev.tipo)) atualizar(conteudo, estadoApp);
  });
  clearInterval(tick);
  tick = setInterval(() => atualizar(conteudo, estadoApp), 30000);
  await atualizar(conteudo, estadoApp);
}

async function atualizar(conteudo, estadoApp) {
  let fila;
  try { fila = await get('/kds'); }
  catch (e) { conteudo.innerHTML = `<div class="vazio">Sem conexão com o servidor: ${escapar(e.message)}</div>`; return; }

  const colunas = { pendente: [], preparando: [], pronto: [] };
  for (const p of fila.pedidos) {
    const visual = p.itens.every((i) => i.kds_status === 'entregue') ? 'entregue'
      : p.itens.some((i) => i.kds_status === 'pronto') ? 'pronto'
      : p.itens.some((i) => i.kds_status === 'preparando') ? 'preparando' : 'pendente';
    if (colunas[visual]) colunas[visual].push(p);
  }
  const agora = Date.now();
  const cartao = (p) => {
    const min = Math.floor((agora - new Date(p.itens[0]?.enviado_cozinha_em ?? p.aberto_em).getTime()) / 60000);
    const atrasado = min > 15;
    const origem = p.comanda_nome ? escapar(p.comanda_nome) : p.mesa_numero ? `Mesa ${p.mesa_numero}` : 'Balcão';
    return `
      <div class="cartao-kds ${visualDe(p)} ${atrasado ? 'atrasado' : ''}" data-pedido="${p.id}" role="button" tabindex="0"
        aria-label="Pedido ${p.id}, ${origem}, ${min} minuto(s)${atrasado ? ', atrasado' : ''}">
        <strong>Pedido #${p.id}</strong> <span class="badge">${origem}</span>
        <div class="kds-cabeca">
          <span class="kds-tempo-badge ${atrasado ? 'atrasado' : ''}">${ic('relogio')} ${min} min${atrasado ? ' · ATRASADO' : ''}</span>
        </div>
        ${p.itens.map((i) => `<div>${i.quantidade}× ${escapar(i.nome_produto)}${i.adicionais ? `<br><small style="color:var(--texto-fraco)">+ ${escapar(i.adicionais)}</small>` : ''}${i.observacoes ? `<br><small style="color:var(--amarelo)">${ic('lapis')} ${escapar(i.observacoes)}</small>` : ''}</div>`).join('<hr style="border-color:var(--borda);border-style:dashed">')}
        <button class="btn ${classeAvanco(visualDe(p))}" data-avancar="${p.id}" style="width:100%;margin-top:8px;min-height:48px"
          aria-label="${rotuloA11yAvanco(visualDe(p), p.id)}">${rotuloAvanco(visualDe(p))}</button>
        <button class="btn ghost" data-ticket="${p.id}" style="width:100%;margin-top:6px" aria-label="Ticket operacional do pedido ${p.id}">${ic('impressora')} Ticket</button>
      </div>`;
  };
  const visualDe = (p) => p.kds_status === 'entregue' ? 'pronto' : p.kds_status;
  // Botões de ação (spec KDS): PREPARANDO (amarelo) e PRONTO (verde).
  // A transição continua validada no servidor — pulo de estado dá 409 (KDS-001).
  const rotuloAvanco = (v) => ({ pendente: ic('panela') + ' PREPARANDO', preparando: ic('check') + ' PRONTO', pronto: ic('pacote') + ' ENTREGAR' }[v] ?? '—');
  const classeAvanco = (v) => ({ pendente: 'kds-preparar', preparando: 'ok', pronto: 'primario' }[v] ?? 'ghost');
  const rotuloA11yAvanco = (v, id) => ({ pendente: `Iniciar preparo do pedido ${id}`, preparando: `Marcar pedido ${id} como pronto`, pronto: `Entregar pedido ${id}` }[v] ?? `Avançar pedido ${id}`);

  conteudo.innerHTML = `
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <h2 style="margin:0;flex:1"> Cozinha — fila em tempo real</h2>
      <span id="kds-conexao" class="estado-conexao on">● Painel KDS — Conectado</span>
      <button class="btn ghost" id="btn-som-kds" aria-label="Som — configurar sons da cozinha">${ic('som')} Som</button>
    </div>
    <div id="som-kds-config"></div>
    <div class="kanban">
      <div class="coluna-kds"><h3>Pendentes (${colunas.pendente.length})</h3>${colunas.pendente.map(cartao).join('') || ''}</div>
      <div class="coluna-kds"><h3>Preparando (${colunas.preparando.length})</h3>${colunas.preparando.map(cartao).join('')}</div>
      <div class="coluna-kds"><h3>Prontos (${colunas.pronto.length})</h3>${colunas.pronto.map(cartao).join('')}</div>
      <div class="coluna-kds"><h3>Entregues (turno)</h3><div class="vazio" style="padding:10px">Entregues desaparecem do quadro.<br><small>Itens entregues: ${fila.pedidos.filter((p) => visualDe(p) === 'pronto' && p.itens.every((i) => i.kds_status === 'entregue')).length}</small></div></div>
    </div>`;

  refletirConexaoKds(); // selo honesto a cada montagem/atualização (não só em eventos)
  const somBtn = conteudo.querySelector('#btn-som-kds');
  const somBox = conteudo.querySelector('#som-kds-config');
  let somAberto = false;
  somBtn.onclick = () => {
    somAberto = !somAberto;
    somBtn.setAttribute('aria-expanded', String(somAberto));
    somBox.innerHTML = somAberto ? '<div class="cartao" id="som-cfg" style="margin-bottom:12px"></div>' : '';
    if (somAberto) renderSoundConfig(somBox.querySelector('#som-cfg'));
  };

  // Alerta sonoro de atraso: dispara 1× por pedido quando ele passa a atrasado
  const agoraAtrasados = new Set();
  for (const p of fila.pedidos) {
    const min = Math.floor((Date.now() - new Date(p.itens[0]?.enviado_cozinha_em ?? p.aberto_em).getTime()) / 60000);
    if (min > 15 && !atrasadosJaAlertados.has(p.id)) agoraAtrasados.add(p.id);
  }
  if (agoraAtrasados.size > 0) {
    tocarAtrasado();
    for (const id of agoraAtrasados) atrasadosJaAlertados.add(id);
  }

  conteudo.querySelectorAll('[data-avancar]').forEach((b) => {
    b.onclick = async () => {
      if (!estadoApp.permissoes.pode_avancar_kds) { toast('Somente a cozinha avança pedidos', 'erro'); return; }
      b.disabled = true; // trava duplo toque
      try {
        const r = await post(`/pedidos/${b.dataset.avancar}/kds-avancar`, {});
        toast(`Pedido → ${r.kds_status}`, 'ok');
        atualizar(conteudo, estadoApp);
      } catch (e) {
        if (e.status === 409) atualizar(conteudo, estadoApp); // estado já avançou (idempotência visual)
        else toast(e.message, 'erro');
      }
    };
  });
  conteudo.querySelectorAll('[data-ticket]').forEach((b) => {
    b.onclick = async () => {
      try {
        const r = await post(`/pedidos/${b.dataset.ticket}/ticket-cozinha`, {});
        const m = modal(`<h2>Ticket operacional</h2><pre class="recibo-preview">${JSON.stringify(r.conteudo.itens.map((i) => `${i.quantidade}x ${i.nome_produto}${i.adicionais ? ' +' + i.adicionais : ''}`).join('\n'))}</pre>
          <button class="btn primario" style="width:100%" onclick="window.print()">Imprimir</button>`);
      } catch (e) { toast(e.message, 'erro'); }
    };
  });
}
