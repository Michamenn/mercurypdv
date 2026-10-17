// KDS de Cozinha: kanban em tempo real (WS), atraso calculado por horários do servidor (KDS-002)
// 1.3.1 — KDS Inteligente: cada card mostra o tempo estimado de preparo do pedido
// (maior tempo individual dos itens), cronômetro ao vivo, barra de progresso
// e alerta quando estoura a estimativa — em vez de um limite fixo de 15 min.
import { ic } from '../icons.js';
import { get, post, fmt } from '../api.js';
import { toast, escapar, modal } from '../ui.js';
import { aoEvento } from '../ws.js';
import { tocarNovoPedido, tocarPronto, tocarAtrasado, renderSoundConfig, carregarPreferenciasSom } from '../sound.js';

let cancelarEventos = null;
let tick = null;
let tickLocal = null;
let atrasadosJaAlertados = new Set();

carregarPreferenciasSom();

export async function render(conteudo, _sub, estadoApp) {
  cancelarEventos?.();
  clearInterval(tick);
  clearInterval(tickLocal);
  atrasadosJaAlertados = new Set();
  cancelarEventos = aoEvento((ev) => {
    if (ev.tipo === 'kds.enviado') tocarNovoPedido();
    if (ev.tipo === 'kds.status' && ev.payload?.para === 'pronto') tocarPronto();
    if (['kds.enviado', 'kds.status', 'pedido.atualizado', 'pedido.fechado'].includes(ev.tipo)) atualizar(conteudo, estadoApp);
  });
  tick = setInterval(() => atualizar(conteudo, estadoApp), 30000);
  // cronômetro local: atualiza os relógios dos cards a cada segundo sem refazer a fila
  tickLocal = setInterval(() => atualizarTimersLocais(conteudo), 1000);
  await atualizar(conteudo, estadoApp);
}

function dadosTimer(p) {
  const base = p.itens[0]?.enviado_cozinha_em ?? p.aberto_em;
  const estMin = p.tempo_estimado_min || 15;
  const decorridoMs = Date.now() - new Date(base).getTime();
  const estMs = estMin * 60000;
  const min = Math.floor(decorridoMs / 60000);
  const pct = Math.max(0, Math.min(100, Math.round((decorridoMs / estMs) * 100)));
  const atrasado = decorridoMs > estMs;
  const restanteMin = Math.ceil((estMs - decorridoMs) / 60000);
  return { base, estMin, decorridoMs, min, pct, atrasado, restanteMin };
}

function blocoTimer(p) {
  const t = dadosTimer(p);
  const rotulo = t.atrasado
    ? `⏱ ${t.min} min · ATRASADO ${-t.restanteMin} min`
    : `⏱ ${t.min} / ${t.estMin} min · ${t.pct}%`;
  return `
    <div class="kds-timer ${t.atrasado ? 'atrasado' : t.pct >= 80 ? 'perto' : 'ok'}" data-kds-timer data-enviado="${t.base}" data-est="${t.estMin}">
      <span class="kds-timer-rotulo">${rotulo}</span>
      <div class="kds-barra" role="progressbar" aria-valuenow="${t.pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Progresso do preparo">
        <div class="kds-barra-preenchimento" style="width:${t.pct}%"></div>
      </div>
    </div>`;
}

// Re-render leve por segundo: só os cronômetros mudam, sem novas requisições.
function atualizarTimersLocais(conteudo) {
  conteudo?.querySelectorAll('[data-kds-timer]').forEach((el) => {
    const base = el.dataset.enviado;
    const estMin = Number(el.dataset.est) || 15;
    if (!base) return;
    const decorridoMs = Date.now() - new Date(base).getTime();
    const estMs = estMin * 60000;
    const min = Math.floor(decorridoMs / 60000);
    const pct = Math.max(0, Math.min(100, Math.round((decorridoMs / estMs) * 100)));
    const atrasado = decorridoMs > estMs;
    const restanteMin = Math.ceil((estMs - decorridoMs) / 60000);
    const rotulo = atrasado
      ? `⏱ ${min} min · ATRASADO ${-restanteMin} min`
      : `⏱ ${min} / ${estMin} min · ${pct}%`;
    const rotuloEl = el.querySelector('.kds-timer-rotulo');
    if (rotuloEl) rotuloEl.textContent = rotulo;
    el.classList.toggle('atrasado', atrasado);
    el.classList.toggle('perto', !atrasado && pct >= 80);
    el.classList.toggle('ok', !atrasado && pct < 80);
    const barra = el.querySelector('.kds-barra-preenchimento');
    if (barra) barra.style.width = `${pct}%`;
    const pg = el.querySelector('.kds-barra');
    if (pg) pg.setAttribute('aria-valuenow', String(pct));
  });
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
  const cartao = (p) => {
    const t = dadosTimer(p);
    const tempos = [...new Set(p.itens.map((i) => i.tempo_preparo_min || 0))];
    return `
      <div class="cartao-kds ${visualDe(p)} ${t.atrasado ? 'atrasado' : ''}" data-pedido="${p.id}" role="button" tabindex="0">
        <strong>#${p.id}</strong> ${p.mesa_numero ? `· Mesa ${p.mesa_numero}` : '· Balcão'}
        ${blocoTimer(p)}
        ${p.itens.map((i) => `<div>${i.quantidade}× ${escapar(i.nome_produto)}${i.tempo_preparo_min ? `<small class="kds-item-tempo" title="Tempo de preparo estimado"> (${i.tempo_preparo_min} min)</small>` : ''}${i.adicionais ? `<br><small style="color:var(--texto-fraco)">+ ${escapar(i.adicionais)}</small>` : ''}${i.observacoes ? `<br><small style="color:var(--amarelo)">${ic('lapis')} ${escapar(i.observacoes)}</small>` : ''}</div>`).join('<hr style="border-color:var(--borda);border-style:dashed">')}
        ${tempos.length > 1 ? `<small style="color:var(--texto-fraco)">Estimativa: ${p.tempo_estimado_min} min (item mais demorado)</small>` : ''}
        <button class="btn primario" data-avancar="${p.id}" style="width:100%;margin-top:8px">${rotuloAvanco(visualDe(p))}</button>
        <button class="btn ghost" data-ticket="${p.id}" style="width:100%;margin-top:6px"> Ticket</button>
      </div>`;
  };
  const visualDe = (p) => p.kds_status === 'entregue' ? 'pronto' : p.kds_status;
  const rotuloAvanco = (v) => ({ pendente: '▶ Iniciar preparo', preparando: ic('check') + ' Marcar pronto', pronto: ic('pacote') + ' Entregar' }[v] ?? '—');

  conteudo.innerHTML = `
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <h2 style="margin:0;flex:1"> Cozinha — fila em tempo real</h2>
      <span class="badge" title="Cada pedido usa o tempo de preparo cadastrado nos produtos">${ic('relogio')} Estimativa por produto</span>
      <button class="btn ghost" id="btn-som-kds" aria-label="Som — configurar sons da cozinha"> Som</button>
    </div>
    <div id="som-kds-config"></div>
    <div class="kanban">
      <div class="coluna-kds"><h3>Pendentes (${colunas.pendente.length})</h3>${colunas.pendente.map(cartao).join('') || ''}</div>
      <div class="coluna-kds"><h3>Preparando (${colunas.preparando.length})</h3>${colunas.preparando.map(cartao).join('')}</div>
      <div class="coluna-kds"><h3>Prontos (${colunas.pronto.length})</h3>${colunas.pronto.map(cartao).join('')}</div>
      <div class="coluna-kds"><h3>Entregues (turno)</h3><div class="vazio" style="padding:10px">Entregues desaparecem do quadro.<br><small>Itens entregues: ${fila.pedidos.filter((p) => visualDe(p) === 'pronto' && p.itens.every((i) => i.kds_status === 'entregue')).length}</small></div></div>
    </div>`;

  const somBtn = conteudo.querySelector('#btn-som-kds');
  const somBox = conteudo.querySelector('#som-kds-config');
  let somAberto = false;
  somBtn.onclick = () => {
    somAberto = !somAberto;
    somBtn.setAttribute('aria-expanded', String(somAberto));
    somBox.innerHTML = somAberto ? '<div class="cartao" id="som-cfg" style="margin-bottom:12px"></div>' : '';
    if (somAberto) renderSoundConfig(somBox.querySelector('#som-cfg'));
  };

  // Alerta sonoro de atraso: dispara 1× por pedido quando estoura a estimativa
  const agoraAtrasados = new Set();
  for (const p of fila.pedidos) {
    const t = dadosTimer(p);
    if (t.atrasado && !atrasadosJaAlertados.has(p.id)) agoraAtrasados.add(p.id);
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
