// Mesas & Comandas (garçom): mapa visual do salão, comandas individuais,
// check-in, movimentação de mesas e fechamento.
import { ic } from '../icons.js';
import { get, post, put, fmt } from '../api.js';
import { toast, modal, confirmar, escapar } from '../ui.js';
import { seletorCombo } from './combos.js';
import { anunciar } from '../a11y.js';
import { tocarNovoPedido } from '../sound.js';
import { aoEvento } from '../ws.js';

let cancelarEventos = null;
let modoLayout = false;        // arraste/redimensionamento das mesas
let juntarAtivo = false;       // modo de seleção múltipla para junção
let selecaoJuntar = new Set(); // ids marcados para junção

export async function render(conteudo, _sub, estadoApp) {
  cancelarEventos?.();
  cancelarEventos = aoEvento((ev) => {
    if (['mesa.atualizada', 'pedido.atualizado', 'pedido.criado', 'pedido.fechado', 'kds.enviado', 'garcom.chamado', 'garcom.atendido'].includes(ev.tipo)) {
      if (ev.tipo === 'garcom.chamado') {
        toast(`${ev.payload?.mesa_numero ? `Mesa ${ev.payload.mesa_numero}` : 'Salão'} chama garçom`, 'info');
        anunciar(`Mesa ${ev.payload?.mesa_numero ?? '?'} chama garçom.`, true);
        try { tocarNovoPedido(); } catch { /* sem áudio */ }
      }
      atualizar(conteudo, estadoApp);
    }
  });
  await atualizar(conteudo, estadoApp);
}

async function atualizar(conteudo, estadoApp) {
  let mapa = null, chamados = [];
  try {
    [mapa, chamados] = await Promise.all([get('/salao/mapa'), get('/chamados').catch(() => [])]);
  } catch (e) {
    conteudo.innerHTML = `<div class="vazio">Sem conexão com o servidor: ${escapar(e.message)}</div>`;
    return;
  }
  if (!mapa?.mesas) { conteudo.innerHTML = '<div class="vazio">Não foi possível carregar o salão.</div>'; return; }

  const mesas = mapa.mesas;
  const rotulo = mapa.nomenclatura === 'comanda' ? 'Comanda' : 'Mesa';
  const podeGerenciar = !!estadoApp.permissoes.pode_gerenciar_mesas;
  const podeLancar = !!estadoApp.permissoes.pode_lancar_comanda;

  const ocupadas = mesas.filter((m) => m.status !== 'livre').length;
  const ociosas = mesas.filter((m) => m.ociosa).length;
  const totalAberto = mesas.reduce((s, m) => s + (m.total_aberto_centavos || 0), 0);

  conteudo.innerHTML = `
    ${chamados.length ? `<div class="cartao" style="margin-bottom:12px;border-color:var(--amarelo)">
      <strong>${ic('sino')} Chamados pendentes (${chamados.length}):</strong>
      ${chamados.map((c) => `<span class="badge" style="margin:4px">${escapar(rotulo)} ${c.mesa_numero} · ${c.tipo === 'conta' ? 'pede a conta' : c.tipo === 'apoio' ? 'pede apoio' : 'chama garçom'} <button class="btn ghost" data-atender="${c.id}" style="min-height:32px;padding:0 8px">Atender</button></span>`).join('')}
    </div>` : ''}

    <div class="resumo-cards">
      <div class="cartao"><small>Mesas ocupadas</small><span class="v">${ocupadas}/${mesas.length}</span></div>
      <div class="cartao"><small>Mesas ociosas</small><span class="v" style="color:${ociosas ? 'var(--alerta)' : 'var(--ok)'}">${ociosas}</span></div>
      <div class="cartao"><small>Em aberto no salão</small><span class="v" style="color:var(--amarelo)">${fmt(totalAberto)}</span></div>
      <div class="cartao"><small>Nomenclatura</small><span class="v" style="font-size:1rem">${escapar(rotulo)}</span></div>
    </div>

    <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
      <h2 style="margin:0;flex:1">${ic('prato')} Mapa do salão</h2>
      ${podeGerenciar ? `<button class="btn ghost" id="btn-layout" aria-pressed="${modoLayout}">${ic('marmita')} ${modoLayout ? 'Concluir layout' : 'Editar layout'}</button>` : ''}
      ${podeGerenciar ? `<button class="btn ghost ${juntarAtivo ? 'ok' : ''}" id="btn-juntar">${ic('pessoas')} ${juntarAtivo ? 'Cancelar junção' : 'Juntar mesas'}</button>` : ''}
      ${podeGerenciar ? `<button class="btn ghost" id="btn-transferir">${ic('troca')} Transferir</button>` : ''}
      ${podeLancar ? '<button class="btn primario" id="btn-nova-mesa">+ Nova mesa</button>' : ''}
    </div>

    <div class="mapa-legenda">
      <span class="chip c-livre">Livre</span>
      <span class="chip c-ocupada">Ocupada</span>
      <span class="chip c-ociosa">Ociosa</span>
      <small>Ociosa = livre há mais de ${mapa.limite_ociosa_min} min.</small>
      ${modoLayout ? '<small style="color:var(--acao);font-weight:700">Modo layout: arraste as mesas. Use "Propriedades" para tamanho/formato.</small>' : ''}
    </div>

    <div class="salao-mapa ${modoLayout ? 'editando' : ''}" id="mapa"
         style="width:${mapa.largura}px;height:${mapa.altura}px"
         role="group" aria-label="Mapa do salão com ${mesas.length} mesas">
      ${mesas.length ? mesas.map((m) => cartaoMesa(m, selecaoJuntar.has(m.id))).join('')
        : '<div class="mapa-vazio">Nenhuma mesa cadastrada. Crie a primeira para montar o salão.</div>'}
    </div>

    ${juntarAtivo ? `<div class="cartao" style="margin-top:12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <strong style="flex:1">${ic('pessoas')} <span id="juntar-cont">${selecaoJuntar.size}</span> mesa(s) selecionada(s)</strong>
      <button class="btn ghost" id="juntar-limpar">Limpar</button>
      <button class="btn ok" id="juntar-confirmar" ${selecaoJuntar.size < 2 ? 'disabled' : ''}>Juntar mesas…</button>
    </div>` : ''}`;

  // Chamados
  conteudo.querySelectorAll('[data-atender]').forEach((b) => {
    b.onclick = async () => {
      try { await post(`/chamados/${b.dataset.atender}/atender`, {}); toast('Chamado atendido', 'ok'); atualizar(conteudo, estadoApp); }
      catch (err) { toast(err.message, 'erro'); }
    };
  });

  const card = conteudo.querySelector('#mapa');

  conteudo.querySelectorAll('[data-mesa]').forEach((el) => {
    const mesaId = Number(el.dataset.mesa);
    const mesa = mesas.find((x) => x.id === mesaId);
    if (!mesa) return;

    el.onclick = (ev) => {
      if (juntarAtivo) {
        ev.stopPropagation();
        if (selecaoJuntar.has(mesaId)) selecaoJuntar.delete(mesaId);
        else selecaoJuntar.add(mesaId);
        atualizar(conteudo, estadoApp);
        return;
      }
      if (modoLayout) { abrirPropriedades(mesa, conteudo, estadoApp); return; }
      abrirDetalheMesa(mesa, conteudo, estadoApp, rotulo);
    };
    if (modoLayout && podeGerenciar) arrastarMesa(el, card);
  });

  const layoutBtn = conteudo.querySelector('#btn-layout');
  if (layoutBtn) layoutBtn.onclick = async () => {
    modoLayout = !modoLayout;
    if (modoLayout) {
      toast('Arraste as mesas para posicionar. Clique numa mesa para editar tamanho e formato.', 'info');
    } else {
      await salvarLayout(conteudo);
    }
    atualizar(conteudo, estadoApp);
  };

  const juntarBtn = conteudo.querySelector('#btn-juntar');
  if (juntarBtn) juntarBtn.onclick = () => {
    juntarAtivo = !juntarAtivo;
    if (!juntarAtivo) selecaoJuntar.clear();
    atualizar(conteudo, estadoApp);
  };
  const limpar = conteudo.querySelector('#juntar-limpar');
  if (limpar) limpar.onclick = () => { selecaoJuntar.clear(); atualizar(conteudo, estadoApp); };
  const juntarOk = conteudo.querySelector('#juntar-confirmar');
  if (juntarOk) juntarOk.onclick = () => modalJuntar(conteudo, mesas, [...selecaoJuntar]);

  const transfBtn = conteudo.querySelector('#btn-transferir');
  if (transfBtn) transfBtn.onclick = () => modalTransferir(conteudo, mesas);

  const novaBtn = conteudo.querySelector('#btn-nova-mesa');
  if (novaBtn) novaBtn.onclick = () => modalNovaMesa(conteudo, estadoApp);
}

function cartaoMesa(m, marcada) {
  const classes = ['mesa-salao', m.status];
  if (m.formato === 'redonda') classes.push('redonda');
  if (m.ociosa) classes.push('ociosa');
  if (m.bloqueada) classes.push('bloqueada');
  if (marcada) classes.push('selecionada');
  const tempo = m.minutos_parada === null || m.minutos_parada === undefined ? '' : `${m.minutos_parada} min`;
  const sub = m.bloqueada ? ic('cadeado')
    : m.comandas_abertas > 0 ? `${m.comandas_abertas} conta(s) · ${tempo}`
    : tempo || 'livre';
  return `<button class="${classes.join(' ')}" data-mesa="${m.id}"
    style="left:${m.pos_x}px;top:${m.pos_y}px;width:${m.largura}px;height:${m.altura}px"
    aria-label="${escapar(m.rotulo)}, ${escapar(m.status)}${m.ociosa ? ', ociosa' : ''}${m.comandas_abertas ? `, ${m.comandas_abertas} comanda aberta, ${fmt(m.total_aberto_centavos)}` : ''}">
    ${m.comandas_abertas > 1 ? `<span class="m-cont">${m.comandas_abertas}</span>` : ''}
    <span class="m-num">${m.numero}</span>
    <span class="m-info">${sub}</span>
    ${m.comandas_abertas > 0 ? `<span class="m-valor">${fmt(m.total_aberto_centavos)}</span>` : ''}
  </button>`;
}

// Arraste das mesas no modo layout (mouse + toque).
function arrastarMesa(el, card) {
  let arrastando = false, offX = 0, offY = 0;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    arrastando = true;
    el.classList.add('arrastando');
    const r = el.getBoundingClientRect();
    offX = e.clientX - r.left;
    offY = e.clientY - r.top;
  });
  el.addEventListener('pointermove', (e) => {
    if (!arrastando || !card) return;
    const cr = card.getBoundingClientRect();
    const maxX = card.clientWidth - el.offsetWidth;
    const maxY = card.clientHeight - el.offsetHeight;
    el.style.left = `${Math.max(0, Math.min(maxX, e.clientX - cr.left - offX))}px`;
    el.style.top = `${Math.max(0, Math.min(maxY, e.clientY - cr.top - offY))}px`;
  });
  const fim = () => { arrastando = false; el.classList.remove('arrastando'); };
  el.addEventListener('pointerup', fim);
  el.addEventListener('pointercancel', fim);
  el.addEventListener('pointerleave', fim);
  window.addEventListener('pointerup', fim);
}

async function salvarLayout(conteudo) {
  const card = conteudo.querySelector('#mapa');
  if (!card) return;
  const mesas = [...card.querySelectorAll('[data-mesa]')].map((el) => ({
    id: Number(el.dataset.mesa),
    pos_x: parseInt(el.style.left, 10) || 0,
    pos_y: parseInt(el.style.top, 10) || 0,
  }));
  try {
    const r = await put('/salao/layout', { mesas });
    toast(`Layout salvo (${r.salvas} mesas)`, 'ok');
  } catch (e) { toast(e.message, 'erro'); }
}

function abrirPropriedades(mesa, conteudo, estadoApp) {
  const podeGerenciar = !!estadoApp.permissoes.pode_gerenciar_mesas;
  const m = modal(`<h2>${ic('mesa')} ${escapar(mesa.rotulo)}</h2>
    ${podeGerenciar ? `
    <div class="grade-config">
      <label><small>Número</small><input id="numero" type="number" min="1" max="9999" value="${mesa.numero}" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" /></label>
      <label><small>Setor</small><input id="setor" value="${escapar(mesa.setor)}" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" /></label>
      <label><small>Largura (px)</small><input id="largura" type="number" min="60" max="600" value="${mesa.largura}" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" /></label>
      <label><small>Altura (px)</small><input id="altura" type="number" min="60" max="600" value="${mesa.altura}" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" /></label>
      <label><small>Formato</small><select id="formato" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)">
        <option value="retangular" ${mesa.formato === 'retangular' ? 'selected' : ''}>Retangular</option>
        <option value="redonda" ${mesa.formato === 'redonda' ? 'selected' : ''}>Redonda</option></select></label>
      <label><small>Assentos</small><input id="assentos" type="number" min="1" max="40" value="${mesa.assentos}" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" /></label>
    </div>
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      <button class="btn primario" data-a="salvar" style="flex:1">${ic('check')} Salvar</button>
      <button class="btn ${mesa.bloqueada ? 'ok' : 'perigo'}" data-a="bloquear" style="flex:1">${mesa.bloqueada ? 'Desbloquear' : 'Bloquear'}</button>
      <button class="btn ghost perigo" data-a="excluir">${ic('lixeira')} Excluir</button>
    </div>`
    : '<p style="color:var(--texto-fraco)">Sem permissão para editar esta mesa.</p>'}
    <button class="btn ghost" style="width:100%;margin-top:10px" data-a="c">Fechar</button>`);

  m.caixa.querySelector('[data-a="c"]').onclick = m.fechar;
  const salvar = m.caixa.querySelector('[data-a="salvar"]');
  if (salvar) salvar.onclick = async () => {
    const largura = Number(m.caixa.querySelector('#largura').value);
    const altura = Number(m.caixa.querySelector('#altura').value);
    const assentos = Number(m.caixa.querySelector('#assentos').value);
    try {
      // Tamanho/formato/assentos via layout; número/setor via CRUD de mesas.
      await put('/salao/layout', { mesas: [{
        id: mesa.id,
        pos_x: mesa.pos_x, pos_y: mesa.pos_y,
        largura, altura,
        formato: m.caixa.querySelector('#formato').value,
        assentos,
      }] });
      if (mesa.status === 'livre') {
        await put(`/mesas/${mesa.id}`, {
          numero: Number(m.caixa.querySelector('#numero').value),
          setor: m.caixa.querySelector('#setor').value.trim() || 'salao',
        });
      }
      m.fechar();
      toast('Mesa atualizada', 'ok');
      atualizar(conteudo, estadoApp);
    } catch (e) { toast(e.message, 'erro'); }
  };
  const bloq = m.caixa.querySelector('[data-a="bloquear"]');
  if (bloq) bloq.onclick = async () => {
    const ligando = !mesa.bloqueada;
    let motivo = null;
    if (ligando) {
      motivo = prompt('Motivo do bloqueio (ex: reserva 20h):');
      if (!motivo || motivo.trim().length < 3) return;
    }
    try {
      await post(`/mesas/${mesa.id}/bloqueio`, { bloqueada: ligando, motivo: motivo?.trim() });
      m.fechar();
      toast(ligando ? 'Mesa bloqueada' : 'Mesa desbloqueada', 'ok');
      atualizar(conteudo, estadoApp);
    } catch (e) { toast(e.message, 'erro'); }
  };
  const excl = m.caixa.querySelector('[data-a="excluir"]');
  if (excl) excl.onclick = async () => {
    if (!await confirmar('Excluir mesa?', `Remover ${mesa.rotulo} do mapa? Só é possível se estiver livre e sem histórico.`, { perigo: true })) return;
    try {
      await del(`/mesas/${mesa.id}`);
      m.fechar();
      toast('Mesa excluída', 'ok');
      atualizar(conteudo, estadoApp);
    } catch (e) { toast(e.message, 'erro'); }
  };
}

async function abrirDetalheMesa(mesa, conteudo, estadoApp, rotulo) {
  let d;
  try { d = await get(`/salao/mesas/${mesa.id}`); }
  catch (e) { toast(e.message, 'erro'); return; }

  const podeLancar = !!estadoApp.permissoes.pode_lancar_comanda;
  const m = modal(`<div id="mesa-body"></div>`, { aoFechar: () => atualizar(conteudo, estadoApp) });
  const corpo = m.caixa.querySelector('#mesa-body');
  const comandas = d.comandas ?? [];

  corpo.innerHTML = `
    <h2>${ic('prato')} ${escapar(rotulo)} ${mesa.numero} ${mesa.bloqueada ? ic('cadeado') : ''}</h2>
    <p style="color:var(--texto-fraco)">
      ${mesa.bloqueada ? `Bloqueada · ${escapar(mesa.bloqueio_motivo ?? '')}`
        : mesa.status === 'livre' ? 'Livre' : `${comandas.length} conta(s) aberta(s)`}
      ${mesa.assentos ? ` · ${mesa.assentos} lugares` : ''}
    </p>

    ${mesa.bloqueada ? `<div class="cartao" style="border-color:var(--alerta);margin-bottom:10px">${ic('cadeado')} Bloqueada: ${escapar(mesa.bloqueio_motivo ?? 'sem motivo')}</div>` : ''}

    ${comandas.length ? `<div class="lista-comanda-mesa">
      ${comandas.map((c) => `<div class="item-comanda-mesa">
        <span class="ic-main">
          <span class="ic-nome">${escapar(c.comanda_nome || `${rotulo} ${mesa.numero}`)} ${c.individual ? '<span class="badge">individual</span>' : ''}</span>
          <span class="ic-sub">${c.cliente_nome ? `${ic('pessoas')} ${escapar(c.cliente_nome)} · ` : ''}${escapar(c.garcom_nome ?? '')}${c.atendente_nome && c.atendente_nome !== c.garcom_nome ? ` · atendente ${escapar(c.atendente_nome)}` : ''} · ${new Date(c.aberto_em).toLocaleTimeString('pt-BR')}</span>
        </span>
        <span style="text-align:right">
          <strong style="font-family:var(--mono)">${fmt(c.totais.total_centavos)}</strong><br>
          ${c.totais.saldo_centavos === 0 ? '<span class="badge ok">quitada</span>'
            : `<small style="color:var(--amarelo)">falta ${fmt(c.totais.saldo_centavos)}</small>`}
        </span>
        <button class="btn" data-abrir="${c.id}">Abrir</button>
      </div>`).join('')}
    </div>` : '<div class="vazio">Nenhuma comanda aberta nesta mesa.</div>'}

    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
      ${podeLancar && !mesa.bloqueada ? `<button class="btn ok" data-nova="${comandas.length ? 'individual' : 'normal'}">
        ${ic('presente')} ${comandas.length ? 'Nova comanda individual' : 'Abrir comanda'}</button>` : ''}
      <button class="btn ghost" data-a="fechar">Fechar</button>
    </div>`;

  corpo.querySelector('[data-a="fechar"]').onclick = m.fechar;
  const nova = corpo.querySelector('[data-nova]');
  if (nova) nova.onclick = () => {
    m.fechar();
    abrirNovaComanda(mesa.id, mesa.numero, conteudo, estadoApp, nova.dataset.nova === 'individual');
  };
  corpo.querySelectorAll('[data-abrir]').forEach((b) => {
    b.onclick = async () => {
      try {
        const p = await get(`/pedidos/${b.dataset.abrir}`);
        m.fechar();
        abrirComandaModal(p, conteudo, estadoApp);
      } catch (e) { toast(e.message, 'erro'); }
    };
  });
}

function modalTransferir(conteudo, mesas) {
  const origem = mesas.filter((m) => m.status !== 'livre');
  const destino = mesas.filter((m) => m.id !== origem[0]?.id);
  if (!origem.length) { toast('Nenhuma mesa ocupada para transferir', 'erro'); return; }
  if (!destino.length) { toast('Cadastre outra mesa para ser o destino', 'erro'); return; }

  const m = modal(`<h2>${ic('troca')} Transferir mesa</h2>
    <p style="color:var(--texto-fraco)">Move as comandas abertas da origem para o destino. A origem fica livre.</p>
    <label style="display:block;margin-bottom:8px"><small style="color:var(--texto-fraco)">Origem (comanda aberta)</small>
      <select id="origem" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)">
        ${origem.map((x) => `<option value="${x.id}">${escapar(x.rotulo)} · ${x.comandas_abertas} conta(s) · ${fmt(x.total_aberto_centavos)}</option>`).join('')}
      </select></label>
    <label style="display:block"><small style="color:var(--texto-fraco)">Destino</small>
      <select id="destino" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)">
        ${destino.map((x) => `<option value="${x.id}">${escapar(x.rotulo)} · ${escapar(x.status)}</option>`).join('')}
      </select></label>
    <input id="motivo" placeholder="Motivo (opcional)" style="width:100%;padding:12px;margin-top:8px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
    <div style="display:flex;gap:10px;margin-top:12px"><button class="btn ghost" data-a="c">Cancelar</button><button class="btn primario" data-a="ok" style="flex:1">Transferir</button></div>`);
  m.caixa.querySelector('[data-a="c"]').onclick = m.fechar;
  m.caixa.querySelector('[data-a="ok"]').onclick = async () => {
    const o = Number(m.caixa.querySelector('#origem').value);
    const d = Number(m.caixa.querySelector('#destino').value);
    if (o === d) { toast('Origem e destino devem ser diferentes', 'erro'); return; }
    try {
      const r = await post('/salao/transferir', { origem_id: o, destino_id: d, motivo: m.caixa.querySelector('#motivo').value.trim() });
      m.fechar();
      toast(`Transferido — ${r.comandas_movidas} comanda(s)`, 'ok');
      atualizar(conteudo, estadoApp);
    } catch (e) { toast(e.message, 'erro'); }
  };
}

function modalJuntar(conteudo, mesas, ids) {
  const detalhe = mesas.filter((x) => ids.includes(x.id));
  const destinoSugerido = detalhe.find((x) => x.status !== 'livre') ?? detalhe[0];
  const totalComandas = detalhe.reduce((s, x) => s + x.comandas_abertas, 0);
  const m = modal(`<h2>${ic('pessoas')} Juntar mesas</h2>
    <p style="color:var(--texto-fraco)">As comandas são <strong>preservadas</strong>: cada cliente continua com a sua conta, apenas passam a pertencer à mesa escolhida.</p>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">
      ${detalhe.map((x) => `<span class="badge ${x.status !== 'livre' ? 'ok' : ''}">${escapar(x.rotulo)} · ${x.comandas_abertas} conta(s)</span>`).join('')}
    </div>
    <p><small class="badge">${totalComandas} comanda(s) serão consolidadas</small></p>
    <label style="display:block"><small style="color:var(--texto-fraco)">Mesa que receberá todas as comandas</small>
      <select id="destino" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)">
        ${detalhe.map((x) => `<option value="${x.id}" ${x.id === destinoSugerido?.id ? 'selected' : ''}>${escapar(x.rotulo)} · ${escapar(x.status)}</option>`).join('')}
      </select></label>
    <input id="motivo" placeholder="Motivo (opcional)" style="width:100%;padding:12px;margin-top:8px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
    <div style="display:flex;gap:10px;margin-top:12px"><button class="btn ghost" data-a="c">Cancelar</button><button class="btn ok" data-a="ok" style="flex:1">Juntar mesas</button></div>`);
  m.caixa.querySelector('[data-a="c"]').onclick = m.fechar;
  m.caixa.querySelector('[data-a="ok"]').onclick = async () => {
    const destino = Number(m.caixa.querySelector('#destino').value);
    try {
      const r = await post('/salao/juntar', { mesa_ids: ids, destino_id: destino, motivo: m.caixa.querySelector('#motivo').value.trim() });
      m.fechar();
      selecaoJuntar.clear();
      juntarAtivo = false;
      toast(`Mesas juntas — ${r.comandas_movidas} comanda(s)`, 'ok');
      atualizar(conteudo, estadoApp);
    } catch (e) { toast(e.message, 'erro'); }
  };
}

function modalNovaMesa(conteudo, estadoApp) {
  const m = modal(`<h2>Nova mesa</h2>
    <label style="display:block"><small style="color:var(--texto-fraco)">Número</small>
      <input id="numero" type="number" min="1" placeholder="Número" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" /></label>
    <label style="display:block;margin-top:8px"><small style="color:var(--texto-fraco)">Setor</small>
      <input id="setor" placeholder="salao, varanda…" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" /></label>
    <label style="display:block;margin-top:8px"><small style="color:var(--texto-fraco)">Assentos</small>
      <input id="assentos" type="number" min="1" max="40" value="4" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" /></label>
    <div style="display:flex;gap:10px;margin-top:12px"><button class="btn ghost" data-a="c">Cancelar</button><button class="btn primario" data-a="ok" style="flex:1">Criar</button></div>`);
  m.caixa.querySelector('[data-a="c"]').onclick = m.fechar;
  m.caixa.querySelector('[data-a="ok"]').onclick = async () => {
    try {
      await post('/mesas', {
        numero: Number(m.caixa.querySelector('#numero').value),
        setor: m.caixa.querySelector('#setor').value.trim() || 'salao',
        assentos: Number(m.caixa.querySelector('#assentos').value) || 4,
      });
      m.fechar();
      toast('Mesa criada', 'ok');
      atualizar(conteudo, estadoApp);
    } catch (e) { toast(e.message, 'erro'); }
  };
}