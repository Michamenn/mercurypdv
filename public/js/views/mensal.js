// Compra Mensal — conta corrente de clientes da casa.
// Cadastrar/buscar cliente (nome obrigatório; telefone, e-mail, endereço e
// limite opcionais), lançar débitos de consumo com assinatura digital colhida
// no celular (canvas), quitar (pagar), parcelar, bloquear e excluir.
import { get, post, put, del, fmt, reaisParaCentavos } from '../api.js';
import { toast, modal, confirmar, escapar } from '../ui.js';
import { ic } from '../icons.js';
import { rotuloForma } from '../recibo.js';

let clienteAberto = null; // id do cliente cuja conta está aberta (null = lista)
let ultimaBusca = '';

const FORMAS = ['dinheiro', 'pix', 'cartao_debito', 'cartao_credito', 'vale_refeicao'];
const reais = (centavos) => (Number(centavos || 0) / 100).toFixed(2).replace('.', ',');
const dataLocal = (d) => new Date(d).toLocaleDateString('sv-SE'); // AAAA-MM-DD
const horaAgora = () => new Date().toTimeString().slice(0, 5);
const quando = (s) => { try { return new Date(s).toLocaleString('pt-BR'); } catch { return s; } };

export async function render(conteudo, _sub, estadoApp) {
  if (clienteAberto) await renderConta(conteudo);
  else await renderLista(conteudo, estadoApp);
}

// ===================== LISTA DE CLIENTES =====================

async function renderLista(painel, estadoApp) {
  painel.innerHTML = `<div class="vazio">Carregando…</div>`;
  const dados = await get(`/mensal/clientes${ultimaBusca ? `?busca=${encodeURIComponent(ultimaBusca)}` : ''}`);
  const clientes = dados?.clientes ?? [];
  const totalDevedor = clientes.reduce((s, c) => s + (c.saldo_centavos || 0), 0);

  painel.innerHTML = `
    <div class="cartao" style="margin-bottom:12px">
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <strong style="flex:1">${ic('pessoa')} Compra Mensal</strong>
        <input id="mensal-busca" class="campo" style="flex:2;min-width:220px" placeholder="Buscar por nome, telefone ou código…" value="${escapar(ultimaBusca)}" aria-label="Buscar cliente" />
        <button class="btn primario" id="mensal-novo">+ Novo cliente</button>
      </div>
      <p style="margin:8px 0 0"><small style="color:var(--texto-fraco)">
        Conta da casa: anote o consumo do cliente no local, colha a assinatura dele no celular
        e quite depois (pagar ou parcelar). Dívida aberta de todos: <strong>${fmt(totalDevedor)}</strong>.
      </small></p>
    </div>
    <div id="mensal-lista">
      ${clientes.length === 0
        ? `<div class="vazio">Nenhum cliente cadastrado ainda${ultimaBusca ? ' com essa busca' : ''}.</div>`
        : clientes.map((c) => `
      <div class="cartao mensal-linha" data-id="${c.id}" role="button" tabindex="0" aria-label="Abrir conta de ${escapar(c.nome)}">
        <div style="flex:1;min-width:0">
          <strong>${escapar(c.nome)}</strong>
          ${c.bloqueado ? ' <span class="badge alerta">BLOQUEADO</span>' : ''}
          ${c.telefone ? ` <small style="color:var(--texto-fraco)">${escapar(c.telefone)}</small>` : ''}
          <br><small style="color:var(--texto-fraco)">${escapar(c.codigo)}${c.limite_centavos !== null && c.limite_centavos !== undefined ? ` · limite ${fmt(c.limite_centavos)}` : ''}${c.a_receber_centavos ? ` · a receber ${fmt(c.a_receber_centavos)}` : ''}</small>
        </div>
        <div style="text-align:right">
          <div class="mensal-saldo" style="color:${c.saldo_centavos > 0 ? 'var(--alerta)' : 'var(--ok)'}">${fmt(c.saldo_centavos)}</div>
          <small style="color:var(--texto-fraco)">${c.saldo_centavos > 0 ? 'em débito' : 'em dia'}</small>
        </div>
      </div>`).join('')}
    </div>`;

  const busca = painel.querySelector('#mensal-busca');
  let timer = null;
  busca.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      ultimaBusca = busca.value.trim();
      renderLista(painel, estadoApp);
      painel.querySelector('#mensal-busca')?.focus();
    }, 300);
  };
  painel.querySelector('#mensal-novo').onclick = () => modalCliente(null, () => renderLista(painel, estadoApp));
  painel.querySelectorAll('.mensal-linha').forEach((el) => {
    const abrir = () => { clienteAberto = Number(el.dataset.id); renderConta(painel); };
    el.onclick = abrir;
    el.onkeydown = (e) => { if (e.key === 'Enter') abrir(); };
  });
}

// ===================== CONTA DO CLIENTE =====================

async function renderConta(painel) {
  painel.innerHTML = `<div class="vazio">Carregando conta…</div>`;
  let dados;
  try {
    dados = await get(`/mensal/clientes/${clienteAberto}`);
  } catch (e) {
    toast(e.message, 'erro');
    clienteAberto = null;
    return render(painel);
  }
  const { cliente: c, lancamentos, pagamentos } = dados;
  const pendentes = pagamentos.filter((p) => p.status === 'pendente');

  painel.innerHTML = `
    <div class="cartao" style="margin-bottom:12px">
      <div style="display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap">
        <button class="btn ghost" id="mensal-voltar">← Voltar</button>
        <div style="flex:1;min-width:220px">
          <strong style="font-size:1.1rem">${escapar(c.nome)}</strong>
          ${c.bloqueado ? ' <span class="badge alerta">BLOQUEADO</span>' : ' <span class="badge ok">ATIVO</span>'}
          <br><small style="color:var(--texto-fraco)">${escapar(c.codigo)}${c.telefone ? ` · ${escapar(c.telefone)}` : ''}${c.email ? ` · ${escapar(c.email)}` : ''}${c.endereco ? ` · ${escapar(c.endereco)}` : ''}</small>
          ${c.limite_centavos !== null && c.limite_centavos !== undefined ? `<br><small style="color:var(--texto-fraco)">Limite: <strong>${fmt(c.limite_centavos)}</strong> · usado ${fmt(Math.max(0, c.saldo_centavos))}</small>` : ''}
        </div>
        <div style="text-align:right">
          <div class="mensal-saldo" style="color:${c.saldo_centavos > 0 ? 'var(--alerta)' : 'var(--ok)'}">${fmt(c.saldo_centavos)}</div>
          <small style="color:var(--texto-fraco)">${c.saldo_centavos > 0 ? 'SALDO DEVEDOR' : 'sem dívida'}${pendentes.length ? ` · a receber ${fmt(c.a_receber_centavos)}` : ''}</small>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button class="btn primario" id="mensal-lancar">${ic('recibo')} Lançar débito</button>
        <button class="btn primario" id="mensal-pagar" ${c.saldo_centavos <= 0 ? 'disabled' : ''}>${ic('dinheiro')} Pagar</button>
        <button class="btn primario" id="mensal-parcelar" ${c.saldo_centavos <= 0 ? 'disabled' : ''}>Parcelar</button>
        <button class="btn ghost" id="mensal-editar">${ic('lapis')} Editar</button>
        <button class="btn ghost" id="mensal-bloquear">${c.bloqueado ? ic('check') + ' Desbloquear' : ic('cadeado') + ' Bloquear'}</button>
        <button class="btn ghost perigo" id="mensal-excluir">${ic('lixeira')} Excluir</button>
      </div>
    </div>

    <div class="cartao" style="margin-bottom:12px">
      <h3 style="margin-top:0">${ic('recibo')} Débitos (${lancamentos.length})</h3>
      ${lancamentos.length === 0 ? '<div class="vazio">Sem lançamentos.</div>' : lancamentos.map((l) => `
        <div class="mensal-item">
          <div style="flex:1;min-width:0">
            <strong>${l.quantidade}× ${escapar(l.consumo)}</strong>
            <br><small style="color:var(--texto-fraco)">${quando(l.data_hora)}</small>
          </div>
          <div style="display:flex;gap:10px;align-items:center">
            ${l.assinatura_path ? `<img src="/${escapar(l.assinatura_path)}" alt="Assinatura do lançamento" class="mensal-assinatura-mini" data-ver="${escapar(l.assinatura_path)}" style="height:34px;background:#fff;border-radius:6px;border:1px solid var(--borda);cursor:pointer" />` : '<small style="color:var(--texto-fraco)">sem assinatura</small>'}
            <strong style="min-width:80px;text-align:right">${fmt(l.valor_centavos)}</strong>
          </div>
        </div>`).join('')}
    </div>

    <div class="cartao">
      <h3 style="margin-top:0">${ic('dinheiro')} Pagamentos e parcelas (${pagamentos.length})</h3>
      ${pagamentos.length === 0 ? '<div class="vazio">Nada pago nem parcelado ainda.</div>' : pagamentos.map((p) => `
        <div class="mensal-item">
          <div style="flex:1;min-width:0">
            ${p.parcela_de ? `<strong>Parcela do acordo</strong>` : `<strong>${rotuloForma(p.forma)}</strong>`}
            <br><small style="color:var(--texto-fraco)">${p.status === 'pago' ? `pago ${quando(p.pago_em)}` : `vence ${new Date(p.vencimento + 'T12:00:00').toLocaleDateString('pt-BR')}`}</small>
          </div>
          <div style="display:flex;gap:10px;align-items:center">
            ${p.status === 'pendente' ? '<button class="btn primario" data-baixa="' + p.id + '">Dar baixa</button>' : '<span class="badge ok">pago</span>'}
            <strong style="min-width:80px;text-align:right">${fmt(p.valor_centavos)}</strong>
          </div>
        </div>`).join('')}
    </div>`;

  painel.querySelector('#mensal-voltar').onclick = () => { clienteAberto = null; ultimaBusca = ''; render(painel); };
  painel.querySelector('#mensal-lancar').onclick = () => modalLancamento(c, () => renderConta(painel));
  painel.querySelector('#mensal-pagar').onclick = () => modalPagamento(c, () => renderConta(painel));
  painel.querySelector('#mensal-parcelar').onclick = () => modalParcelar(c, () => renderConta(painel));
  painel.querySelector('#mensal-editar').onclick = () => modalCliente(c, () => renderConta(painel));
  painel.querySelector('#mensal-bloquear').onclick = async () => {
    if (c.bloqueado) {
      try { await post(`/mensal/clientes/${c.id}/bloquear`, { bloquear: false }); toast('Cliente desbloqueado', 'ok'); renderConta(painel); }
      catch (e) { toast(e.message, 'erro'); }
    } else if (await confirmar('Bloquear cliente?', `${c.nome} deixa de aceitar novos débitos até ser desbloqueado.`)) {
      try { await post(`/mensal/clientes/${c.id}/bloquear`, { bloquear: true }); toast('Cliente bloqueado', 'ok'); renderConta(painel); }
      catch (e) { toast(e.message, 'erro'); }
    }
  };
  painel.querySelector('#mensal-excluir').onclick = async () => {
    if (!await confirmar('Excluir cliente?', `${c.nome} (${c.codigo}) e TODO o histórico (${lancamentos.length} lançamentos, ${pagamentos.length} pagamentos) serão apagados. Não dá para desfazer.`, { perigo: true })) return;
    try {
      await del(`/mensal/clientes/${c.id}`);
      toast('Cliente excluído', 'ok');
      clienteAberto = null;
      render(painel);
    } catch (e) { toast(e.message, 'erro'); }
  };
  painel.querySelectorAll('[data-baixa]').forEach((b) => {
    b.onclick = async () => {
      try { await post(`/mensal/pagamentos/${b.dataset.baixa}/confirmar`, {}); toast('Parcela quitada', 'ok'); renderConta(painel); }
      catch (e) { toast(e.message, 'erro'); }
    };
  });
  painel.querySelectorAll('[data-ver]').forEach((img) => {
    img.onclick = () => modal(`<h2>Assinatura</h2><img src="/${escapar(img.dataset.ver)}" alt="Assinatura" style="width:100%;background:#fff;border-radius:8px;border:1px solid var(--borda)" />`);
  });
}

// ===================== MODAIS =====================

function modalCliente(c, aoSalvar) {
  const editando = Boolean(c);
  const m = modal(`
    <h2>${editando ? 'Editar' : 'Novo'} cliente</h2>
    <label><span class="campo-titulo">Nome *</span>
      <input class="campo" id="cl-nome" value="${escapar(c?.nome ?? '')}" maxlength="120" required /></label>
    <label><span class="campo-titulo">Telefone</span>
      <input class="campo" id="cl-tel" inputmode="tel" value="${escapar(c?.telefone ?? '')}" placeholder="opcional" /></label>
    <label><span class="campo-titulo">E-mail</span>
      <input class="campo" id="cl-email" inputmode="email" value="${escapar(c?.email ?? '')}" placeholder="opcional" /></label>
    <label><span class="campo-titulo">Endereço</span>
      <input class="campo" id="cl-end" value="${escapar(c?.endereco ?? '')}" placeholder="opcional" /></label>
    <label><span class="campo-titulo">Limite de crédito (R$) — vazio = sem limite</span>
      <input class="campo" id="cl-limite" inputmode="decimal" value="${c?.limite_centavos ? reais(c.limite_centavos) : ''}" placeholder="ex.: 200,00" /></label>
    <div style="display:flex;gap:10px;margin-top:14px">
      <button class="btn ghost" data-a="c">Cancelar</button>
      <button class="btn primario grande" data-a="ok" style="flex:1">Salvar</button>
    </div>`);
  m.caixa.querySelector('[data-a="c"]').onclick = m.fechar;
  m.caixa.querySelector('[data-a="ok"]').onclick = async () => {
    const nome = m.caixa.querySelector('#cl-nome').value.trim();
    if (!nome) { toast('Informe ao menos o nome', 'erro'); return; }
    const limiteTexto = m.caixa.querySelector('#cl-limite').value.trim();
    const corpo = {
      nome,
      telefone: m.caixa.querySelector('#cl-tel').value.trim(),
      email: m.caixa.querySelector('#cl-email').value.trim(),
      endereco: m.caixa.querySelector('#cl-end').value.trim(),
      limite_centavos: limiteTexto === '' ? null : reaisParaCentavos(limiteTexto),
    };
    if (corpo.limite_centavos === null && limiteTexto !== '') { toast('Limite inválido', 'erro'); return; }
    try {
      if (editando) await put(`/mensal/clientes/${c.id}`, corpo);
      else await post('/mensal/clientes', corpo);
      m.fechar();
      toast(editando ? 'Cliente atualizado' : 'Cliente cadastrado', 'ok');
      aoSalvar?.();
    } catch (e) { toast(e.message, 'erro'); }
  };
}

// Assinatura digital: canvas estilo "paint" — funciona no dedo (celular) e no mouse.
// Resolve com o PNG em data URL, ou null quando fechado sem assinar.
function colherAssinatura() {
  return new Promise((resolve) => {
    let resolvido = false;
    const m = modal(`
      <h2>${ic('documento')} Assinatura do cliente</h2>
      <p><small style="color:var(--texto-fraco)">Peça para o cliente assinar com o dedo (celular) ou com o mouse.</small></p>
      <canvas id="assin-canvas" class="assinatura-canvas" width="500" height="200" aria-label="Área de assinatura"></canvas>
      <div style="display:flex;gap:10px;margin-top:12px">
        <button class="btn ghost" data-a="limpar">Limpar</button>
        <button class="btn primario grande" data-a="ok" style="flex:1">Confirmar assinatura</button>
      </div>`, { aoFechar: () => { if (!resolvido) resolve(null); } });
    const cv = m.caixa.querySelector('#assin-canvas');
    const ctx = cv.getContext('2d');
    const limpar = () => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.strokeStyle = '#c8c8c8';
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(20, cv.height - 28);
      ctx.lineTo(cv.width - 20, cv.height - 28);
      ctx.stroke();
      ctx.setLineDash([]);
    };
    limpar();
    let desenhando = false;
    let temTrazos = false;
    const pos = (ev) => {
      const r = cv.getBoundingClientRect();
      return { x: (ev.clientX - r.left) * (cv.width / r.width), y: (ev.clientY - r.top) * (cv.height / r.height) };
    };
    cv.onpointerdown = (ev) => {
      cv.setPointerCapture(ev.pointerId);
      desenhando = true;
      temTrazos = true;
      const p = pos(ev);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    };
    cv.onpointermove = (ev) => {
      if (!desenhando) return;
      const p = pos(ev);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    };
    cv.onpointerup = cv.onpointercancel = () => { desenhando = false; };
    m.caixa.querySelector('[data-a="limpar"]').onclick = () => { limpar(); temTrazos = false; };
    m.caixa.querySelector('[data-a="ok"]').onclick = () => {
      if (!temTrazos) { toast('Nada assinado ainda', 'erro'); return; }
      resolvido = true;
      m.fechar();
      resolve(cv.toDataURL('image/png'));
    };
  });
}

function modalLancamento(c, aoSalvar) {
  const agora = new Date();
  let assinaturaDataUrl = null;
  let catalogo = [];
  let itens = []; // [{ produto, quantidade }]
  const m = modal(`
    <h2>Lançar débito — ${escapar(c.nome)}</h2>
    ${c.bloqueado ? '<p style="color:var(--alerta)">Cliente BLOQUEADO: lance só após desbloquear.</p>' : ''}
    <label><span class="campo-titulo">Buscar produto do cardápio</span>
      <input class="campo" id="lc-busca" placeholder="nome do produto…" autocomplete="off" aria-label="Buscar produto do cardápio" /></label>
    <div id="lc-resultados"></div>
    <div id="lc-itens"></div>
    <div id="lc-manual">
      <div class="grade-config">
        <label><span class="campo-titulo">Quantidade</span>
          <input class="campo" id="lc-qtd" type="number" min="1" max="999" value="1" /></label>
        <label><span class="campo-titulo">Consumo *</span>
          <input class="campo" id="lc-consumo" placeholder="ex.: Almoço — prato feito" maxlength="200" /></label>
        <label><span class="campo-titulo">Valor total (R$) *</span>
          <input class="campo" id="lc-valor" inputmode="decimal" placeholder="0,00" /></label>
      </div>
      <p style="margin:6px 0 0"><small style="color:var(--texto-fraco)">Ou lance do cardápio: busque acima e adicione produtos — o valor sai do preço cadastrado.</small></p>
    </div>
    <div class="grade-config" style="margin-top:10px">
      <label><span class="campo-titulo">Data</span>
        <input class="campo" id="lc-data" type="date" value="${dataLocal(agora)}" /></label>
      <label><span class="campo-titulo">Hora</span>
        <input class="campo" id="lc-hora" type="time" value="${horaAgora()}" /></label>
    </div>
    <div style="display:flex;gap:10px;align-items:center;margin-top:12px;flex-wrap:wrap">
      <button class="btn ghost" id="lc-assinatura">${ic('documento')} Colher assinatura</button>
      <span id="lc-assinatura-ok" class="badge ok" hidden>assinatura colhida</span>
    </div>
    <div style="display:flex;gap:10px;margin-top:14px">
      <button class="btn ghost" data-a="c">Cancelar</button>
      <button class="btn primario grande" data-a="ok" style="flex:1">Lançar</button>
    </div>`);
  const caixa = m.caixa;
  const totalItens = () => itens.reduce((s, i) => s + i.produto.preco_centavos * i.quantidade, 0);

  // Catálogo enxuto (produtos ativos) — carregado uma vez ao abrir o modal.
  get('/mensal/produtos')
    .then((r) => { catalogo = r?.produtos ?? []; refletirBusca(); })
    .catch(() => { catalogo = []; });

  function refletirBusca() {
    const termo = caixa.querySelector('#lc-busca').value.trim().toLowerCase();
    const alvo = caixa.querySelector('#lc-resultados');
    if (!termo) { alvo.innerHTML = ''; return; }
    const achados = catalogo.filter((p) => p.nome.toLowerCase().includes(termo)).slice(0, 8);
    alvo.innerHTML = achados.length
      ? achados.map((p) => `<button class="btn ghost" data-add="${p.id}" style="width:100%;display:flex;justify-content:space-between;margin-bottom:6px"><span>${escapar(p.nome)}</span><strong>${fmt(p.preco_centavos)}</strong></button>`).join('')
      : '<small style="color:var(--texto-fraco)">nenhum produto encontrado</small>';
    alvo.querySelectorAll('[data-add]').forEach((b) => {
      b.onclick = () => {
        const p = catalogo.find((x) => x.id === Number(b.dataset.add));
        if (!p) return;
        const jaTem = itens.find((i) => i.produto.id === p.id);
        if (jaTem) jaTem.quantidade = Math.min(999, jaTem.quantidade + 1);
        else itens.push({ produto: p, quantidade: 1 });
        refletirItens();
      };
    });
  }
  caixa.querySelector('#lc-busca').oninput = refletirBusca;

  function refletirItens() {
    const box = caixa.querySelector('#lc-itens');
    const manual = caixa.querySelector('#lc-manual');
    if (!itens.length) { box.innerHTML = ''; manual.style.display = ''; return; }
    manual.style.display = 'none'; // com itens do cardápio o valor é o do catálogo
    box.innerHTML = itens.map((i, idx) => `
      <div class="mensal-item">
        <div style="flex:1;min-width:0"><strong>${escapar(i.produto.nome)}</strong>
          <br><small style="color:var(--texto-fraco)">${fmt(i.produto.preco_centavos)} cada</small></div>
        <div style="display:flex;gap:6px;align-items:center">
          <button class="btn ghost" data-menos="${idx}" aria-label="Diminuir quantidade">-</button>
          <strong>${i.quantidade}</strong>
          <button class="btn ghost" data-mais="${idx}" aria-label="Aumentar quantidade">+</button>
          <button class="btn ghost perigo" data-rem="${idx}" aria-label="Remover item">${ic('x')}</button>
          <strong style="min-width:80px;text-align:right">${fmt(i.produto.preco_centavos * i.quantidade)}</strong>
        </div>
      </div>`).join('')
      + `<div class="mensal-item" style="border-bottom:none"><strong style="flex:1">Total do lançamento</strong><strong style="min-width:80px;text-align:right">${fmt(totalItens())}</strong></div>`;
    box.querySelectorAll('[data-menos]').forEach((b) => { b.onclick = () => { const i = itens[Number(b.dataset.menos)]; i.quantidade = Math.max(1, i.quantidade - 1); refletirItens(); }; });
    box.querySelectorAll('[data-mais]').forEach((b) => { b.onclick = () => { const i = itens[Number(b.dataset.mais)]; i.quantidade = Math.min(999, i.quantidade + 1); refletirItens(); }; });
    box.querySelectorAll('[data-rem]').forEach((b) => { b.onclick = () => { itens.splice(Number(b.dataset.rem), 1); refletirItens(); }; });
  }

  caixa.querySelector('[data-a="c"]').onclick = m.fechar;
  caixa.querySelector('#lc-assinatura').onclick = async () => {
    const dataUrl = await colherAssinatura();
    if (dataUrl) {
      assinaturaDataUrl = dataUrl;
      caixa.querySelector('#lc-assinatura-ok').hidden = false;
    }
  };
  caixa.querySelector('[data-a="ok"]').onclick = async () => {
    const data = caixa.querySelector('#lc-data').value;
    const hora = caixa.querySelector('#lc-hora').value || '12:00';
    if (!data) { toast('Informe a data', 'erro'); return; }
    let corpo;
    if (itens.length) {
      corpo = {
        itens: itens.map((i) => ({ produto_id: i.produto.id, quantidade: i.quantidade })),
        data_hora: `${data}T${hora}`,
      };
    } else {
      const consumo = caixa.querySelector('#lc-consumo').value.trim();
      const valorTexto = caixa.querySelector('#lc-valor').value.trim();
      if (!consumo) { toast('Descreva o consumo ou adicione produtos do cardápio', 'erro'); return; }
      const valor = reaisParaCentavos(valorTexto || '0');
      if (!valor || valor <= 0) { toast('Valor inválido', 'erro'); return; }
      corpo = {
        quantidade: Number(caixa.querySelector('#lc-qtd').value || '1'),
        consumo, valor_centavos: valor,
        data_hora: `${data}T${hora}`,
      };
    }
    if (assinaturaDataUrl) corpo.assinatura_data_url = assinaturaDataUrl;
    try {
      await post(`/mensal/clientes/${c.id}/lancamentos`, corpo);
      m.fechar();
      toast(itens.length ? 'Débito lançado do cardápio' : (assinaturaDataUrl ? 'Débito lançado com assinatura' : 'Débito lançado'), 'ok');
      aoSalvar?.();
    } catch (e) { toast(e.message, 'erro'); }
  };
}

function modalPagamento(c, aoSalvar) {
  const m = modal(`
    <h2>Receber pagamento — ${escapar(c.nome)}</h2>
    <p><small style="color:var(--texto-fraco)">Saldo devedor: <strong>${fmt(c.saldo_centavos)}</strong>. Deixe o valor para quitar tudo.</small></p>
    <label><span class="campo-titulo">Valor (R$)</span>
      <input class="campo" id="pg-valor" inputmode="decimal" value="${reais(c.saldo_centavos)}" /></label>
    <label><span class="campo-titulo">Forma</span>
      <select class="campo" id="pg-forma">
        ${FORMAS.map((f) => `<option value="${f}">${rotuloForma(f)}</option>`).join('')}
      </select></label>
    <div style="display:flex;gap:10px;margin-top:14px">
      <button class="btn ghost" data-a="c">Cancelar</button>
      <button class="btn primario grande" data-a="ok" style="flex:1">Receber</button>
    </div>`);
  m.caixa.querySelector('[data-a="c"]').onclick = m.fechar;
  m.caixa.querySelector('[data-a="ok"]').onclick = async () => {
    const valor = reaisParaCentavos(m.caixa.querySelector('#pg-valor').value.trim() || '0');
    if (!valor || valor <= 0) { toast('Valor inválido', 'erro'); return; }
    try {
      await post(`/mensal/clientes/${c.id}/pagamentos`, { valor_centavos: valor, forma: m.caixa.querySelector('#pg-forma').value });
      m.fechar();
      toast('Pagamento registrado', 'ok');
      aoSalvar?.();
    } catch (e) { toast(e.message, 'erro'); }
  };
}

function modalParcelar(c, aoSalvar) {
  const padrao = new Date(Date.now() + 30 * 24 * 3600_000).toLocaleDateString('sv-SE');
  const m = modal(`
    <h2>Parcelar dívida — ${escapar(c.nome)}</h2>
    <p><small style="color:var(--texto-fraco)">Saldo devedor: <strong>${fmt(c.saldo_centavos)}</strong>. As parcelas ficam programadas; dê baixa em cada uma quando receber.</small></p>
    <div class="grade-config">
      <label><span class="campo-titulo">Número de parcelas (2–24)</span>
        <input class="campo" id="pc-n" type="number" min="2" max="24" value="2" /></label>
      <label><span class="campo-titulo">Primeiro vencimento</span>
        <input class="campo" id="pc-venc" type="date" value="${padrao}" /></label>
    </div>
    <p id="pc-previa"><small style="color:var(--texto-fraco)">Prévia: 2 parcelas de ${fmt(Math.floor(c.saldo_centavos / 2))} (vencimentos a cada 30 dias).</small></p>
    <div style="display:flex;gap:10px;margin-top:14px">
      <button class="btn ghost" data-a="c">Cancelar</button>
      <button class="btn primario grande" data-a="ok" style="flex:1">Criar parcelas</button>
    </div>`);
  const n = m.caixa.querySelector('#pc-n');
  const previa = m.caixa.querySelector('#pc-previa');
  const refletir = () => {
    const q = Math.min(24, Math.max(2, Number(n.value || 2)));
    previa.innerHTML = `<small style="color:var(--texto-fraco)">Prévia: ${q} parcelas de ${fmt(Math.floor(c.saldo_centavos / q))} (vencimentos a cada 30 dias).</small>`;
  };
  n.oninput = refletir;
  refletir();
  m.caixa.querySelector('[data-a="c"]').onclick = m.fechar;
  m.caixa.querySelector('[data-a="ok"]').onclick = async () => {
    try {
      await post(`/mensal/clientes/${c.id}/parcelar`, {
        n: Math.min(24, Math.max(2, Number(n.value || 2))),
        primeira_vencimento: m.caixa.querySelector('#pc-venc').value,
      });
      m.fechar();
      toast('Parcelamento criado', 'ok');
      aoSalvar?.();
    } catch (e) { toast(e.message, 'erro'); }
  };
}
