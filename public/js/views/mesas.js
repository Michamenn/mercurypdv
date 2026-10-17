// Mesas & Comandas (garçom): mapa visual do salão, comandas individuais,
// check-in, movimentação de mesas e fechamento.
import { ic } from '../icons.js';
import { get, post, put, del, fmt, reaisParaCentavos, novaIdempotencia } from '../api.js';
import { toast, modal, confirmar, escapar, pedirAutorizacaoAdmin } from '../ui.js';
import { mostrarRecibo } from '../recibo.js';
import { seletorCombo } from './combos.js';
import { anunciar } from '../a11y.js';
import { tocarNovoPedido } from '../sound.js';
import { aoEvento } from '../ws.js';

let cancelarEventos = null;
let modoLayout = false;        // arraste/redimensionamento das mesas
let juntarAtivo = false;       // modo de seleção múltipla para junção
let selecaoJuntar = new Set(); // ids marcados para junção
let cfgSalao = {};             // configuração operacional (nomenclatura, check-in...)

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
  // Config operacional (nomenclatura, check-in) — vem do servidor, não de cache local.
  cfgSalao = await get('/config').catch(() => ({}));

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
      <h2 style="margin:0;flex:1 0 auto;white-space:nowrap">${ic('prato')} Mapa do salão</h2>
      ${podeGerenciar ? `<button class="btn ghost" id="btn-layout" aria-pressed="${modoLayout}">${ic('marmita')} ${modoLayout ? 'Concluir layout' : 'Editar layout'}</button>` : ''}
      ${podeGerenciar ? `<button class="btn ghost ${juntarAtivo ? 'ok' : ''}" id="btn-juntar">${ic('pessoas')} ${juntarAtivo ? 'Cancelar junção' : 'Juntar mesas'}</button>` : ''}
      ${podeGerenciar ? `<button class="btn ghost" id="btn-transferir">${ic('troca')} Transferir</button>` : ''}
      ${podeGerenciar ? '<button class="btn primario" id="btn-nova-mesa">+ Nova mesa</button>' : ''}
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
  // WCAG 2.5.3 (Label in Name): o nome acessível precisa CONTER o texto
  // visível, senão quem navega por voz ("clique em Mesa 1") não acha o botão.
  // Por isso o rótulo visível vem primeiro e o detalhe fica depois.
  const rotulo = `Mesa ${m.numero}`;
  const nome = `${rotulo} — ${sub}${m.comandas_abertas > 0 ? ` — ${fmt(m.total_aberto_centavos)}` : ''}`;
  const status = [escapar(m.status), m.ociosa ? 'ociosa' : '', m.bloqueada ? 'bloqueada' : '']
    .filter(Boolean).join(', ');
  return `<button class="${classes.join(' ')}" data-mesa="${m.id}"
    style="left:${m.pos_x}px;top:${m.pos_y}px;width:${m.largura}px;height:${m.altura}px"
    aria-label="${escapar(nome)}"
    aria-describedby="mesa-status-${m.id}"
    title="${escapar(rotulo)} — ${escapar(status)}${m.comandas_abertas > 0 ? ` — ${fmt(m.total_aberto_centavos)}` : ''}">
    ${m.comandas_abertas > 1 ? `<span class="m-cont" aria-hidden="true">${m.comandas_abertas}</span>` : ''}
    <span class="m-num">${rotulo}</span>
    <span class="m-info">${sub}</span>
    ${m.comandas_abertas > 0 ? `<span class="m-valor">${fmt(m.total_aberto_centavos)}</span>` : ''}
    <span id="mesa-status-${m.id}" class="sr-only">${escapar(status)}</span>
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
      <button class="btn primario" data-renumerar="${mesa.id}" data-a="salvar" style="flex:1">${ic('check')} Salvar</button>
      <button class="btn ${mesa.bloqueada ? 'ok' : 'perigo'}" data-bloq="${mesa.id}" data-a="bloquear" style="flex:1">${mesa.bloqueada ? 'Desbloquear' : 'Bloquear'}</button>
      <button class="btn ghost perigo" data-excluir-mesa="${mesa.id}" data-a="excluir">${ic('lixeira')} Excluir</button>
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
    if (!ligando) {
      // Desbloquear não exige motivo — segue direto (comportamento anterior).
      try {
        await post(`/mesas/${mesa.id}/bloqueio`, { bloqueada: false, motivo: null });
        m.fechar();
        toast('Mesa desbloqueada', 'ok');
        atualizar(conteudo, estadoApp);
      } catch (e) { toast(e.message, 'erro'); }
      return;
    }
    // Nunca prompt() nativo: bottom-sheet com motivo obrigatório.
    const dlg = modal(`<h2>Bloquear ${escapar(mesa.rotulo ?? 'mesa')}</h2>
      <label class="campo-titulo" for="blq-motivo">Motivo do bloqueio</label>
      <input id="blq-motivo" class="campo" maxlength="200" autocomplete="off"
        placeholder="Ex.: reserva às 20h" />
      <div class="modal-acoes">
        <button class="btn ghost" data-a="voltar">Voltar</button>
        <button class="btn primario" data-a="ok">Bloquear</button>
      </div>`, { folha: true });
    dlg.caixa.querySelector('[data-a="voltar"]').onclick = dlg.fechar;
    dlg.caixa.querySelector('[data-a="ok"]').onclick = async () => {
      const motivo = dlg.caixa.querySelector('#blq-motivo').value.trim();
      if (motivo.length < 3) { toast('Informe um motivo (mínimo 3 caracteres)', 'erro'); return; }
      try {
        await post(`/mesas/${mesa.id}/bloqueio`, { bloqueada: true, motivo });
        dlg.fechar(); m.fechar();
        toast('Mesa bloqueada', 'ok');
        atualizar(conteudo, estadoApp);
      } catch (e) { toast(e.message, 'erro'); }
    };
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
    <label style="display:block"><small style="color:var(--texto-fraco)">Quantidade (cria várias de uma vez)</small>
      <input id="quantidade" type="number" min="1" max="50" value="1" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" /></label>
    <label style="display:block;margin-top:8px"><small style="color:var(--texto-fraco)">Número inicial (vazio = continua do último)</small>
      <input id="numero" type="number" min="1" placeholder="Ex: 1, 10, 25…" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" /></label>
    <label style="display:block;margin-top:8px"><small style="color:var(--texto-fraco)">Setor</small>
      <input id="setor" placeholder="salao, varanda…" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" /></label>
    <label style="display:block;margin-top:8px"><small style="color:var(--texto-fraco)">Assentos por mesa</small>
      <input id="assentos" type="number" min="1" max="40" value="4" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" /></label>
    <p><small style="color:var(--texto-fraco)">${ic('mesa')} As mesas são criadas <strong>lado a lado</strong> no mapa do salão, em fileiras, sem ficar umas sobre as outras. Depois arraste pelo "Editar layout" se quiser.</small></p>
    <div style="display:flex;gap:10px;margin-top:12px"><button class="btn ghost" data-a="c">Cancelar</button><button class="btn primario" data-a="ok" style="flex:1">Criar</button></div>`);
  m.caixa.querySelector('[data-a="c"]').onclick = m.fechar;
  m.caixa.querySelector('[data-a="ok"]').onclick = async () => {
    try {
      const qtd = Math.max(1, Math.min(50, Number(m.caixa.querySelector('#quantidade').value) || 1));
      const numeroTxt = m.caixa.querySelector('#numero').value.trim();
      const r = await post('/mesas', {
        quantidade: qtd,
        numero: numeroTxt === '' ? undefined : Number(numeroTxt),
        setor: m.caixa.querySelector('#setor').value.trim() || 'salao',
        assentos: Number(m.caixa.querySelector('#assentos').value) || 4,
      });
      m.fechar();
      const numeros = (r?.mesas ?? []).map((x) => x.numero);
      toast(r?.criadas > 1
        ? `${r.criadas} mesas criadas (nº ${numeros[0]}–${numeros[numeros.length - 1]}), lado a lado no mapa`
        : 'Mesa criada', 'ok');
      atualizar(conteudo, estadoApp);
    } catch (e) { toast(e.message, 'erro'); }
  };
}

function abrirNovaComanda(mesaId, numero, conteudo, estadoApp, individual = false) {
  const cfg = cfgSalao ?? {};
  const checkinObrigatorio = cfg.checkin_obrigatorio === '1';
  const exigeCadastro = cfg.checkin_exige_cadastro === '1';
  const rotulo = cfg.nomenclatura_pedido === 'comanda' ? 'Comanda' : 'Mesa';
  const podeCheckin = !!estadoApp.permissoes.pode_fazer_checkin;

  const m = modal(`<h2>${individual ? `${ic('pessoas')} Comanda individual` : ic('recibo')} ${rotulo} ${numero}</h2>
    ${individual ? `<p style="color:var(--texto-fraco)">Esta conta convive com as outras desta mesa. Cada cliente paga e sai separadamente.</p>` : ''}
    <label style="display:block"><small style="color:var(--texto-fraco)">${checkinObrigatorio ? 'Cliente *' : 'Cliente (opcional)'}</small>
      <input id="cliente" placeholder="Nome do cliente" autocomplete="off"
        style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" /></label>

    ${podeCheckin ? `
    <label style="display:block;margin-top:8px"><small style="color:var(--texto-fraco)">${exigeCadastro ? 'Cadastro do cliente *' : 'Vincular a um cliente cadastrado'}</small>
      <input id="busca-cli" placeholder="Buscar por nome, documento ou telefone…" autocomplete="off"
        style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
      <div id="cli-result" style="margin-top:6px"></div>
    </label>
    <button class="btn ghost" id="cli-novo" type="button" style="width:100%;margin-top:6px">${ic('presente')} Cadastrar novo cliente</button>` : ''}

    <label style="display:block;margin-top:8px"><small style="color:var(--texto-fraco)">Observação (opcional)</small>
      <input id="obs" placeholder="Observação da comanda" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" /></label>

    <div style="display:flex;gap:10px;margin-top:12px">
      <button class="btn ghost" data-a="c">Cancelar</button>
      <button class="btn primario grande" data-a="ok" style="flex:1">${individual ? 'Abrir comanda individual' : 'Abrir comanda'}</button>
    </div>`);

  let clienteSelecionado = null;

  // Check-in: busca de cliente cadastrado.
  const busca = m.caixa.querySelector('#busca-cli');
  if (busca) {
    let timer = null;
    busca.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const box = m.caixa.querySelector('#cli-result');
        const q = busca.value.trim();
        if (!q) { box.innerHTML = ''; clienteSelecionado = null; return; }
        try {
          const lista = await get(`/clientes?q=${encodeURIComponent(q)}`);
          if (!lista.length) {
            box.innerHTML = '<small style="color:var(--texto-fraco)">Nenhum cliente encontrado.</small>';
            return;
          }
          box.innerHTML = lista.slice(0, 6).map((c) =>
            `<button type="button" class="btn ghost" data-cli="${c.id}" style="width:100%;text-align:left;margin-bottom:4px">
              <strong>${escapar(c.nome)}</strong> ${c.documento ? `<small style="color:var(--texto-fraco)">${escapar(c.documento)}</small>` : ''}
            </button>`).join('');
          box.querySelectorAll('[data-cli]').forEach((b) => {
            b.onclick = () => {
              clienteSelecionado = Number(b.dataset.cli);
              box.querySelectorAll('[data-cli]').forEach((x) => x.classList.remove('ok'));
              b.classList.add('ok');
              if (!m.caixa.querySelector('#cliente').value.trim()) {
                const achado = lista.find((c) => c.id === clienteSelecionado);
                if (achado) m.caixa.querySelector('#cliente').value = achado.nome;
              }
            };
          });
        } catch (e) { box.innerHTML = `<small style="color:var(--alerta)">${escapar(e.message)}</small>`; }
      }, 250);
    };
  }
  const btnNovoCli = m.caixa.querySelector('#cli-novo');
  if (btnNovoCli) btnNovoCli.onclick = () => {
    // Nunca prompt() nativo: um único bottom-sheet com os dois campos.
    const dlg = modal(`<h2>Novo cliente</h2>
      <label class="campo-titulo" for="cli-nome">Nome do cliente</label>
      <input id="cli-nome" class="campo" maxlength="80" autocomplete="off" placeholder="Nome completo" />
      <label class="campo-titulo" for="cli-doc" style="margin-top:var(--space-2)">Documento (CPF/CNPJ) — opcional</label>
      <input id="cli-doc" class="campo" maxlength="20" autocomplete="off" placeholder="Somente se quiser vincular" />
      <div class="modal-acoes">
        <button class="btn ghost" data-a="v">Cancelar</button>
        <button class="btn primario" data-a="ok">Cadastrar</button>
      </div>`, { folha: true });
    dlg.caixa.querySelector('[data-a="v"]').onclick = dlg.fechar;
    dlg.caixa.querySelector('[data-a="ok"]').onclick = () => {
      const nome = dlg.caixa.querySelector('#cli-nome').value.trim();
      if (nome.length < 2) { toast('Informe o nome (mínimo 2 caracteres)', 'erro'); return; }
      const doc = dlg.caixa.querySelector('#cli-doc').value.trim() || null;
      dlg.fechar();
      post('/clientes', { nome, documento: doc })
        .then((r) => {
          clienteSelecionado = r.corpo.id;
          m.caixa.querySelector('#cliente').value = r.corpo.nome;
          toast('Cliente cadastrado', 'ok');
        })
        .catch((e) => toast(e.message, 'erro'));
    };
  };

  m.caixa.querySelector('[data-a="c"]').onclick = m.fechar;
  m.caixa.querySelector('[data-a="ok"]').onclick = async () => {
    const nome = m.caixa.querySelector('#cliente').value.trim();
    if (checkinObrigatorio && !nome) { toast('Check-in obrigatório: informe o cliente', 'erro'); return; }
    if (exigeCadastro && !clienteSelecionado) { toast('Vincule um cliente cadastrado', 'erro'); return; }
    try {
      const p = await post(`/mesas/${mesaId}/comanda`, {
        cliente: nome,
        observacao: m.caixa.querySelector('#obs').value.trim() || null,
        individual: individual ? true : false,
        cliente_id: clienteSelecionado ?? undefined,
      });
      m.fechar();
      toast(`Comanda #${p.numero_dia ?? p.id} aberta`, 'ok');
      abrirComandaModal(await get(`/pedidos/${p.id}`), conteudo, estadoApp);
    } catch (e) { toast(e.message, 'erro'); }
  };
}

function abrirComandaModal(pedido, conteudo, estadoApp) {
  let catalogoCache = null;
  const m = modal(`<div id="comanda-body">Carregando…</div>`, { aoFechar: () => atualizar(conteudo, estadoApp) });
  const corpo = m.caixa.querySelector('#comanda-body');
  get('/catalogo').then((cat) => { catalogoCache = cat; desenhar(); });

  async function redesenhar() { const p = await get(`/pedidos/${pedido.id}`); pedido = p; desenhar(); }

  function desenhar() {
    const t = pedido.totais;
    corpo.innerHTML = `
      <h2>Comanda #${pedido.numero_dia ?? pedido.id} ${pedido.mesa_numero ? `· Mesa ${pedido.mesa_numero}` : ''} ${pedido.canal === 'viagem' ? '<span class="badge">' + ic('marmita') + ' viagem</span>' : ''} ${pedido.guardado ? '<span class="badge">⏸ guardada</span>' : ''}</h2>
      <p style="color:var(--texto-fraco)">${escapar(pedido.comanda_nome ?? '')} · aberta ${new Date(pedido.aberto_em).toLocaleTimeString('pt-BR')}${pedido.observacao ? `<br>${ic('nota')} ${escapar(pedido.observacao)}` : ''}</p>
      <div style="max-height:34vh;overflow:auto">
        ${pedido.itens.map((i) => `
          <div class="linha-itens" style="${i.status === 'cancelado' ? 'opacity:.45;text-decoration:line-through' : ''}">
            <span>${i.quantidade}× ${escapar(i.nome_produto)}
              ${i.variacao_nome ? `<br><small style="color:var(--texto-fraco)">${escapar(i.variacao_nome)}</small>` : ''}
              ${i.adicionais ? `<br><small style="color:var(--texto-fraco)">+ ${escapar(i.adicionais)}</small>` : ''}
              ${i.observacoes ? `<br><small style="color:var(--amarelo)">${ic('lapis')} ${escapar(i.observacoes)}</small>` : ''}
              ${i.enviado_cozinha_em ? '<br><small class="badge">enviada à cozinha</small>' : '<br><small class="badge ok">local</small>'}
            </span>
            <span style="display:flex;gap:6px;align-items:center">
              <strong style="font-family:var(--mono)">${fmt((i.preco_unit_centavos) * i.quantidade)}</strong>
              ${i.status === 'ativo' ? `<button class="btn ghost" data-cancel="${i.id}" title="Cancelar item">${ic('x')}</button>` : ''}
            </span>
          </div>`).join('') || '<div class="vazio">Comanda vazia</div>'}
      </div>
      <p style="text-align:right;font-size:1.15rem">Total: <strong style="font-family:var(--mono);color:var(--ok)">${fmt(t.total_centavos)}</strong>
        ${t.taxa_servico_centavos ? `· Taxa ${fmt(t.taxa_servico_centavos)}` : ''}
        ${t.taxa_servico_centavos ? `<br><small style="color:var(--texto-fraco)">Subtotal ${fmt(t.subtotal_centavos ?? t.bruto_centavos)} + taxa ${fmt(t.taxa_servico_centavos)}</small>` : ''}
        ${t.gorjeta_centavos ? `<br><small style="color:var(--amarelo)">${ic('presente')} Gorjeta ${fmt(t.gorjeta_centavos)} (não entra no total)</small>` : ''}
        ${t.saldo_centavos > 0 ? `· Pendente: <span style="color:var(--acao)">${fmt(t.saldo_centavos)}</span>` : '· <span class="badge ok">QUITADA</span>'}</p>
      <div id="divisao-box"></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" data-a="add">+ Item</button>
        <button class="btn" data-a="combo">${ic('presente')} Combo</button>
        <button class="btn" data-a="cortesia">${ic('laco')} Cortesia</button>
        <button class="btn primario" data-a="enviar">${ic('upload')} Encaminhar à cozinha</button>
        ${estadoApp.permissoes.pode_dividir_pagar ? `<button class="btn ok" data-a="pagar">${ic('dinheiro')} Receber / Fechar</button>
        <button class="btn" data-a="gorjeta">${ic('presente')} Gorjeta</button>` : ''}
        <button class="btn" data-a="dividir">${ic('pessoas')} Dividir</button>
        <button class="btn" data-a="conta">${ic('recibo')} Conta</button>
        <button class="btn" data-a="guardar">${pedido.guardado ? '▶ Retomar' : '⏸ Guardar'}</button>
        ${pedido.mesa_id ? '<button class="btn ghost" data-a="chamar">' + ic('sino') + ' Chamar</button>' : ''}
        <button class="btn ghost" data-a="fechar">Fechar</button>
      </div>`;
    corpo.querySelector('[data-a="fechar"]').onclick = m.fechar;
    corpo.querySelector('[data-a="add"]').onclick = () => seletorProduto();
    corpo.querySelector('[data-a="combo"]').onclick = async () => {
      const atualizado = await seletorCombo(pedido.id);
      if (atualizado) { pedido = atualizado; desenhar(); }
    };
    corpo.querySelector('[data-a="cortesia"]').onclick = () => modalCortesia();
    corpo.querySelector('[data-a="dividir"]').onclick = () => modalDivisao();
    corpo.querySelector('[data-a="conta"]').onclick = () => mostrarConta();
    corpo.querySelector('[data-a="guardar"]').onclick = async () => {
      try {
        const r = await post(`/pedidos/${pedido.id}/guardar`, { guardado: !pedido.guardado });
        toast(r.guardado ? 'Comanda guardada — retome quando quiser' : 'Comanda retomada', 'ok');
        await redesenhar();
      } catch (e) { toast(e.message, 'erro'); }
    };
    corpo.querySelector('[data-a="chamar"]').onclick = async () => {
      try {
        await post(`/mesas/${pedido.mesa_id}/chamar`, { tipo: 'chamar' });
        toast('Garçom chamado ', 'ok');
      } catch (e) { toast(e.message, 'erro'); }
    };
    carregarDivisao();

  async function carregarDivisao() {
    const box = corpo.querySelector('#divisao-box');
    if (!box) return;
    try {
      const d = await get(`/pedidos/${pedido.id}/divisao`);
      if (!d.grupos.length && d.sem_grupo_centavos === d.total_centavos) { box.innerHTML = ''; return; }
      box.innerHTML = `<div class="cartao" style="margin:10px 0;padding:10px">
        <strong>${ic('pessoas')} Divisão:</strong> ${d.grupos.map((g) => `${escapar(g.nome)}: <span style="font-family:var(--mono)">${fmt(g.subtotal_centavos)}</span>`).join(' · ')}
        ${d.sem_grupo_centavos > 0 ? `· <span style="color:var(--texto-fraco)">sem grupo: ${fmt(d.sem_grupo_centavos)}</span>` : ''}</div>`;
    } catch { box.innerHTML = ''; }
  }

  // Gorjeta: extra pago pelo cliente sobre a conta. NÃO altera o total da
  // venda — entra apenas no cálculo da comissão do garçom.
  function modalGorjeta() {
    const rotulos = { dinheiro: 'Dinheiro', pix: 'PIX', cartao_debito: 'Débito', cartao_credito: 'Crédito', vale_refeicao: 'Vale' };
    const padrao = pedido.atendente_nome || pedido.garcom_nome || '';
    const m = modal(`<h2>${ic('presente')} Gorjeta</h2>
      <p style="color:var(--texto-fraco)">Valor extra deixado pelo cliente <strong>sobre a conta</strong>. Não aumenta o total da venda — serve para a comissão do atendente.</p>
      <label style="display:block"><small style="color:var(--texto-fraco)">Valor (ex: 10,00)</small>
        <input id="valor" inputmode="decimal" placeholder="Valor" style="width:100%;padding:14px;font-size:1.2rem;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" /></label>
      <div class="abas" style="margin-top:8px">
        ${Object.entries(rotulos).map(([f, r]) => `<button class="btn ${f === 'dinheiro' ? 'ativa' : ''}" data-f="${f}">${r}</button>`).join('')}
      </div>
      <label style="display:block;margin-top:8px"><small style="color:var(--texto-fraco)">Atendente que recebeu</small>
        <input id="garcom" value="${escapar(padrao)}" placeholder="Nome do garçom" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" /></label>
      <input id="obs" placeholder="Observação (opcional)" style="width:100%;padding:12px;margin-top:8px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
      <div style="display:flex;gap:10px;margin-top:12px"><button class="btn ghost" data-a="c">Cancelar</button><button class="btn ok grande" data-a="ok" style="flex:1">Registrar gorjeta</button></div>`);
    m.caixa.querySelector('[data-a="c"]').onclick = m.fechar;
    let forma = 'dinheiro';
    m.caixa.querySelectorAll('[data-f]').forEach((b) => {
      b.onclick = () => {
        forma = b.dataset.f;
        m.caixa.querySelectorAll('[data-f]').forEach((x) => x.classList.remove('ativa'));
        b.classList.add('ativa');
      };
    });
    m.caixa.querySelector('[data-a="ok"]').onclick = async () => {
      const centavos = reaisParaCentavos(m.caixa.querySelector('#valor').value);
      if (!centavos || centavos <= 0) { toast('Valor inválido', 'erro'); return; }
      const nome = m.caixa.querySelector('#garcom').value.trim();
      // Resolve o garçom pelo nome; sem isso, o servidor usa o atendente da comanda.
      try {
        const garcom = nome ? db_garcomPorNome(nome) : null;
        const r = await post(`/pedidos/${pedido.id}/gorjeta`, {
          valor_centavos: centavos,
          forma,
          observacao: m.caixa.querySelector('#obs').value.trim() || null,
          garcom_id: garcom?.id ?? null,
        });
        m.fechar();
        toast(`Gorjeta de ${fmt(centavos)} registrada`, 'ok');
        await redesenhar();
      } catch (e) { toast(e.message, 'erro'); }
    };
  }

  // Busca o garçom pelo nome via /auth/operadores (lista pública de operadores).
  async function db_garcomPorNome(nome) {
    try {
      const ops = await get('/auth/operadores');
      const achado = (ops?.operadores ?? ops ?? []).find((o) => String(o.nome).toLowerCase() === nome.toLowerCase());
      return achado ? { id: achado.id } : null;
    } catch { return null; }
  }

  function modalCortesia() {
    if (!catalogoCache) { toast('Catálogo carregando…', 'erro'); return; }
    const m = modal(`<h2>${ic('laco')} Cortesia (preço zero, auditada)</h2>
      <select id="prod" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)">
        ${catalogoCache.produtos.filter((p) => p.disponivel).map((p) => `<option value="${p.id}">${escapar(p.nome)} (${fmt(p.preco_centavos)})</option>`).join('')}
      </select>
      <input id="motivo" placeholder="Motivo (obrigatório)" style="width:100%;padding:12px;margin-top:8px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
      <div style="display:flex;gap:10px;margin-top:12px"><button class="btn ghost" data-a="c">Cancelar</button><button class="btn primario" data-a="ok" style="flex:1">Aplicar cortesia</button></div>`);
    m.caixa.querySelector('[data-a="c"]').onclick = m.fechar;
    m.caixa.querySelector('[data-a="ok"]').onclick = async () => {
      try {
        await post(`/pedidos/${pedido.id}/cortesia`, {
          produto_id: Number(m.caixa.querySelector('#prod').value),
          motivo: m.caixa.querySelector('#motivo').value.trim(),
        });
        m.fechar(); toast('Cortesia aplicada', 'ok'); await redesenhar();
      } catch (e) { toast(e.message, 'erro'); }
    };
  }

  function modalDivisao() {
    const ativos = pedido.itens.filter((i) => i.status === 'ativo');
    const m = modal(`<h2>${ic('pessoas')} Dividir conta por pessoa</h2>
      <p style="color:var(--texto-fraco)">Crie grupos e marque quantidades. Os totais saem no servidor; cada grupo paga separado.</p>
      <div style="display:flex;gap:8px"><input id="g-nome" placeholder="Nome (Pessoa A...)" style="flex:1;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
      <button class="btn" id="g-criar">+ Grupo</button></div>
      <div id="g-lista" style="margin-top:10px">Carregando…</div>
      <button class="btn ghost" style="width:100%;margin-top:10px" data-a="c">Fechar</button>`);
    m.caixa.querySelector('[data-a="c"]').onclick = m.fechar;
    async function recarregar() {
      const d = await get(`/pedidos/${pedido.id}/divisao`);
      m.caixa.querySelector('#g-lista').innerHTML = d.grupos.map((g) => `
        <div class="cartao" style="margin-bottom:8px">
          <strong>${escapar(g.nome)}</strong> — <span style="font-family:var(--mono);color:var(--ok)">${fmt(g.subtotal_centavos)}</span>
          ${ativos.map((i) => `<label class="linha-itens" style="cursor:pointer"><span>${escapar(i.nome_produto)} (máx ${i.quantidade})</span>
            <input type="number" min="0" max="${i.quantidade}" value="0" data-g="${g.id}" data-item="${i.id}" style="width:80px;padding:8px;background:var(--canvas);border-radius:8px;border:1px solid var(--borda);color:var(--texto)" /></label>`).join('')}
          <div style="display:flex;gap:8px;margin-top:6px">
            <button class="btn primario" data-salvar="${g.id}" style="flex:1">Salvar ${escapar(g.nome)}</button>
            <button class="btn ghost perigo" data-delg="${g.id}">${ic('lixeira')}</button>
          </div>
        </div>`).join('') || '<div class="vazio">Nenhum grupo — crie o primeiro acima</div>';
      m.caixa.querySelectorAll('[data-salvar]').forEach((b) => {
        b.onclick = async () => {
          const gid = Number(b.dataset.salvar);
          const itens = [...m.caixa.querySelectorAll(`[data-g="${gid}"]`)].map((inp) => ({ item_id: Number(inp.dataset.item), quantidade: Number(inp.value) || 0 })).filter((x) => x.quantidade > 0);
          try {
            await put(`/pedidos/${pedido.id}/grupos/${gid}`, { itens });
            toast('Divisão salva', 'ok'); recarregar(); carregarDivisao();
          } catch (e) { toast(e.message, 'erro'); }
        };
      });
      m.caixa.querySelectorAll('[data-delg]').forEach((b) => {
        b.onclick = async () => {
          try { await del(`/pedidos/${pedido.id}/grupos/${b.dataset.delg}`); recarregar(); carregarDivisao(); }
          catch (e) { toast(e.message, 'erro'); }
        };
      });
    }
    m.caixa.querySelector('#g-criar').onclick = async () => {
      const nome = m.caixa.querySelector('#g-nome').value.trim();
      if (!nome) return;
      try { await post(`/pedidos/${pedido.id}/grupos`, { nome }); m.caixa.querySelector('#g-nome').value = ''; recarregar(); }
      catch (e) { toast(e.message, 'erro'); }
    };
    recarregar();
  }

  function mostrarConta() {
    const t = pedido.totais;
    const linhas = pedido.itens.map((i) => i.status === 'cancelado'
      ? `${i.quantidade}x ${i.nome_produto} — CANCELADO`
      : `${i.quantidade}x ${i.nome_produto}${i.variacao_nome ? ` (${i.variacao_nome})` : ''} — ${fmt(i.preco_unit_centavos * i.quantidade)}`).join('\n');
    const pags = (pedido.pagamentos ?? []).filter((p) => !p.estornado).map((p) => `${p.forma}: ${fmt(p.valor_centavos)}`).join('\n') || '—';
    const texto = `CONTA — Comanda #${pedido.numero_dia ?? pedido.id}${pedido.mesa_numero ? ` · Mesa ${pedido.mesa_numero}` : ''}\n${pedido.comanda_nome ?? ''}\n----------------------------------------\n${linhas}\n----------------------------------------\nSUBTOTAL  ${fmt(t.bruto_centavos)}\nDESCONTO  ${fmt(t.desconto_centavos)}\nTOTAL     ${fmt(t.total_centavos)}\nPAGO      ${fmt(t.pago_centavos)}\nPENDENTE  ${fmt(t.saldo_centavos)}\n----------------------------------------\n${pags}\nDocumento não fiscal — conferência. Sem taxa de serviço.`;
    const m = modal(`<h2>${ic('recibo')} Conta consolidada</h2>
      <pre class="recibo-preview">${escapar(texto)}</pre>
      <div style="display:flex;gap:10px;margin-top:12px">
        <button class="btn ghost" data-a="c">Fechar</button>
        <button class="btn primario grande" data-a="p" style="flex:1">${ic('impressora')} Imprimir</button>
      </div>`);
    m.caixa.querySelector('[data-a="c"]').onclick = m.fechar;
    m.caixa.querySelector('[data-a="p"]').onclick = () => {
      let area = document.getElementById('area-impressao');
      if (!area) { area = document.createElement('div'); area.id = 'area-impressao'; document.body.appendChild(area); }
      area.innerHTML = `<pre class="recibo-preview" style="background:#fff;color:#000;border:none;width:80mm">${escapar(texto)}</pre>`;
      window.print();
    };
  }
    corpo.querySelector('[data-a="enviar"]').onclick = async () => {
      try { await post(`/pedidos/${pedido.id}/encaminhar`, {}); toast('Enviado à cozinha', 'ok'); anunciar(`Pedido ${pedido.id} encaminhado à cozinha.`, true); await redesenhar(); }
      catch (e) { toast(e.message, 'erro'); }
    };
    const pagarBtn = corpo.querySelector('[data-a="pagar"]');
    if (pagarBtn) pagarBtn.onclick = () => fluxoPagamentoComanda();
    const gorjetaBtn = corpo.querySelector('[data-a="gorjeta"]');
    if (gorjetaBtn) gorjetaBtn.onclick = () => modalGorjeta();
    corpo.querySelectorAll('[data-cancel]').forEach((b) => {
      b.onclick = async () => {
        const item = pedido.itens.find((i) => i.id === Number(b.dataset.cancel));
        // Nunca prompt() nativo: modal com motivo (o botão perigo é a confirmação).
        const dlg = modal(`<h2>Cancelar item</h2>
          <p>"${escapar(item.nome_produto)}" sairá da comanda.</p>
          <label class="campo-titulo" for="cnc-motivo">Motivo do cancelamento</label>
          <input id="cnc-motivo" class="campo" maxlength="200" autocomplete="off"
            placeholder="Motivo (mínimo 3 caracteres)" />
          <div class="modal-acoes">
            <button class="btn ghost" data-a="manter">Manter item</button>
            <button class="btn perigo" data-a="cancelar">Cancelar item</button>
          </div>`);
        dlg.caixa.querySelector('[data-a="manter"]').onclick = dlg.fechar;
        dlg.caixa.querySelector('[data-a="cancelar"]').onclick = async () => {
          const motivo = dlg.caixa.querySelector('#cnc-motivo').value.trim();
          if (motivo.length < 3) { toast('Informe um motivo (mínimo 3 caracteres)', 'erro'); return; }
          dlg.fechar();
          let autorizacao = {};
          if (item.enviado_cozinha_em && estadoApp.usuario.cargo !== 'admin') {
            const a = await pedirAutorizacaoAdmin({ titulo: 'Cancelar item já enviado' });
            if (!a) return;
            autorizacao = a;
          }
          try {
            await post(`/pedidos/${pedido.id}/itens/${item.id}/cancelar`, { motivo, ...autorizacao });
            toast('Item cancelado (registrado na auditoria)', 'ok');
            await redesenhar();
          } catch (e) { toast(e.message, 'erro'); }
        };
      };
    });
  }

  function seletorProduto() {
    if (!catalogoCache) return;
    const sub = modal(`<h2>Adicionar item</h2>
      <div class="abas">${catalogoCache.categorias.map((c, ix) => `<button class="btn ${ix === 0 ? 'ativa' : ''}" data-c="${c.id}">${escapar(c.nome)}</button>`).join('')}</div>
      <div class="grid-produtos" id="prods"></div>
      <div style="margin-top:12px;text-align:right"><button class="btn ghost" data-a="v">Voltar</button></div>`);
    const prods = sub.caixa.querySelector('#prods');
    function mostrar(catId) {
      prods.innerHTML = catalogoCache.produtos.filter((p) => p.categoria_id === catId).map((p) =>
        `<button class="btn produto-btn" data-p="${p.id}"><span>${escapar(p.nome)}</span><span class="preco">${fmt(p.preco_centavos)}</span></button>`).join('');
      prods.querySelectorAll('[data-p]').forEach((b) => {
        b.onclick = async () => {
          const prod = catalogoCache.produtos.find((x) => x.id === Number(b.dataset.p));
          sub.fechar();
          try {
            await post(`/pedidos/${pedido.id}/itens`, { produto_id: prod.id, quantidade: 1 }, { idem: novaIdempotencia('item') });
            toast('Item adicionado', 'ok');
            await redesenhar();
          } catch (e) { toast(e.message, 'erro'); }
        };
      });
    }
    mostrar(catalogoCache.categorias[0]?.id);
    sub.caixa.querySelectorAll('[data-c]').forEach((b) => { b.onclick = () => mostrar(Number(b.dataset.c)); });
    sub.caixa.querySelector('[data-a="v"]').onclick = sub.fechar;
  }

  async function fluxoPagamentoComanda() {
    const t = pedido.totais;
    if (t.saldo_centavos <= 0) { await fecharConta(); return; }
    const rotulos = { dinheiro: 'Dinheiro', pix: 'PIX', cartao_debito: 'Débito', cartao_credito: 'Crédito', vale_refeicao: 'Vale' };
    const sub = modal(`<h2>Recebimento — saldo ${fmt(t.saldo_centavos)}</h2>
      <div class="abas">${['dinheiro','pix','cartao_debito','cartao_credito','vale_refeicao'].map((f) => `<button class="btn" data-f="${f}">${rotulos[f]}</button>`).join('')}</div>
      <input id="valor" inputmode="decimal" placeholder="Valor (ex: 25,50)" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
      <div style="display:flex;gap:10px;margin-top:12px"><button class="btn ghost" data-a="c">Voltar</button><button class="btn ok grande" data-a="ok">Registrar</button></div>`);
    let forma = null;
    const inputValor = sub.caixa.querySelector('#valor');
    sub.caixa.querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => {
      forma = b.dataset.f;
      sub.caixa.querySelectorAll('[data-f]').forEach((x) => x.classList.remove('ativa'));
      b.classList.add('ativa');
      inputValor.placeholder = forma === 'dinheiro' ? 'Dinheiro entregue (ex: 200,00)' : 'Valor (ex: 25,50)';
    }; });
    sub.caixa.querySelector('[data-a="c"]').onclick = sub.fechar;
    sub.caixa.querySelector('[data-a="ok"]').onclick = async () => {
      if (!forma) { toast('Escolha a forma', 'erro'); return; }
      const digitado = reaisParaCentavos(inputValor.value);
      if (!digitado || digitado <= 0) { toast('Valor inválido', 'erro'); return; }
      let valor = digitado, recebido = null;
      if (forma === 'dinheiro') {
        // TROCO SEGURO: o campo é o ENTREGUE pelo cliente; o aplicado à venda
        // é limitado ao saldo pendente e o excedente vira troco (não é receita).
        recebido = digitado;
        valor = Math.min(digitado, t.saldo_centavos);
        const troco = recebido - valor;
        const resto = t.saldo_centavos - valor;
        const ok = await confirmar(
          troco > 0 ? 'Confirmar recebimento em dinheiro' : 'Confirmar pagamento em dinheiro',
          troco > 0
            ? `Entregue: ${fmt(recebido)} · Aplicado à venda: ${fmt(valor)} · Troco devido: ${fmt(troco)}`
            : `Aplicado à venda: ${fmt(valor)} · Sem troco${resto > 0 ? ` · Restarão ${fmt(resto)}` : ''}`,
        );
        if (!ok) return; // cancelado: nenhum pagamento é lançado
      } else if (digitado > t.saldo_centavos) {
        toast(`Valor entre 0,01 e ${fmt(t.saldo_centavos)}`, 'erro'); // formas eletrônicas não geram troco
        return;
      }
      try {
        const corpo = forma === 'dinheiro'
          ? { forma, valor_centavos: valor, recebido_centavos: recebido }
          : { forma, valor_centavos: valor };
        const r = await post(`/pedidos/${pedido.id}/pagamentos`, corpo, { idem: novaIdempotencia('pag') });
        sub.fechar();
        toast(`Pagamento registrado${forma === 'dinheiro' ? ` — troco ${fmt(r.pagamento?.troco_centavos ?? 0)}` : ''}`, 'ok');
        if (r.saldo_centavos === 0) await fecharConta();
        else await redesenhar();
      } catch (e) { toast(e.message, 'erro'); }
    };
  }

  async function fecharConta() {
    if (!await confirmar('Fechar conta?', 'A conta será fechada com o total pago. Confirma?')) return;
    try {
      await post(`/pedidos/${pedido.id}/fechar`, {});
    } catch (e) { toast(e.message, 'erro'); return; }
    m.fechar();
    toast('Conta fechada', 'ok');
    try {
      const rec = await post(`/pedidos/${pedido.id}/recibo`, { largura_mm: 80 });
      mostrarRecibo(rec.conteudo);
    } catch { toast('Recibo indisponível — reimprima depois', 'erro'); }
  }
}
