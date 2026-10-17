// Caixa: abertura/fechamento de turno, sangria/suprimento, conferência e vendas abertas
import { ic } from '../icons.js';
import { get, post, fmt, reaisParaCentavos } from '../api.js';
import { toast, modal, confirmar, escapar, pedirAutorizacaoAdmin } from '../ui.js';
import { anunciar } from '../a11y.js';

export async function render(conteudo, _sub, estadoApp) {
  await atualizar(conteudo, estadoApp);
}

// Cache em memória da última leitura bem-sucedida. Permite que uma falha
// de rede não apague a tela do caixa — o operador vê os últimos números
// conhecidos com um aviso claro, em vez de uma tela branca.
let cacheTela = { atual: null, abertos: [], mesas: [] };

async function atualizar(conteudo, estadoApp) {
  let atual = null, abertos = [], mesas = [];
  let erroRede = null;
  try {
    const r = await Promise.all([
      get('/caixa/atual'),
      get('/pedidos/abertos'),
      get('/mesas')
    ]);
    [atual, abertos, mesas] = r;
    cacheTela = { atual, abertos, mesas };
  } catch (e) {
    erroRede = e;
    // Sem rede: reaproveita o último estado conhecido.
    ({ atual, abertos, mesas } = cacheTela);
  }

  // Mesas com comanda em andamento (inclui comandas individuais).
  const mesasOcupadas = mesas.filter((m) => m.status !== 'livre');

  if (erroRede && !cacheTela.mesas.length) {
    conteudo.innerHTML = `
      <h2>${ic('dinheiro')} Caixa</h2>
      <div class="cartao" style="max-width:480px;border-color:var(--alerta)">
        <strong>${ic('alerta')} Sem conexão com o servidor</strong>
        <p>Não foi possível falar com o sistema. Os números abaixo podem estar desatualizados.</p>
        <small style="color:var(--texto-fraco)">${escapar(erroRede.message ?? 'erro de rede')}</small>
        <button class="btn primario grande" id="btn-tentar" style="width:100%;margin-top:12px">Tentar novamente</button>
      </div>`;
    conteudo.querySelector('#btn-tentar').onclick = () => atualizar(conteudo, estadoApp);
    return;
  }

  if (!atual) {
    conteudo.innerHTML = `
      <h2>${ic('dinheiro')} Caixa</h2>
      ${erroRede ? `<div class="cartao" style="border-color:var(--alerta);margin-bottom:12px">${ic('alerta')} <strong>Sem conexão</strong> — exibindo o último estado conhecido. <small>${escapar(erroRede.message ?? '')}</small></div>` : ''}
      <div class="cartao" style="max-width:480px">
        <p>Não há caixa aberto. Informe o fundo de troco (saldo inicial):</p>
        <input id="saldo" inputmode="decimal" placeholder="Ex: 150,00" style="width:100%;padding:14px;font-size:1.2rem;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
        <button class="btn primario grande" id="btn-abrir" style="width:100%;margin-top:12px">Abrir caixa</button>
      </div>
      ${vendasAbertasHtml(abertos, estadoApp)}`;
    conteudo.querySelector('#btn-abrir').onclick = async () => {
      const valor = reaisParaCentavos(conteudo.querySelector('#saldo').value || '0');
      if (valor === null || valor < 0) { toast('Valor inválido', 'erro'); return; }
      try { await post('/caixa/abrir', { saldo_inicial_centavos: valor }); toast('Caixa aberto', 'ok'); atualizar(conteudo, estadoApp); }
      catch (e) { toast(e.message, 'erro'); }
    };
    ligarVendasAbertas(conteudo, estadoApp, atualizar);
    return;
  }

  const e = atual.esperado;
  conteudo.innerHTML = `
    <h2>${ic('dinheiro')} Caixa <span class="badge ok">CAIXA ABERTO</span></h2>
    <div class="cartao" style="margin-bottom:12px">
      <p>Aberto por <strong>${escapar(atual.sessao.usuario_abertura_nome)}</strong> em ${new Date(atual.sessao.aberto_em).toLocaleString('pt-BR')} · Fundo: <strong style="font-family:var(--mono)">${fmt(atual.sessao.saldo_inicial_centavos)}</strong></p>
      <p style="font-size:1.15rem;margin:10px 0 0">Em gaveta (dinheiro esperado): <strong class="mono" style="font-size:1.35rem;color:var(--ok)">${fmt(e['dinheiro'] ?? 0)}</strong></p>
      <table class="dados"><thead><tr><th scope="col">Forma</th><th scope="col">Esperado</th><th scope="col">Vendas fechadas</th><th scope="col">Em pedidos abertos</th></tr></thead>
      <tbody>${Object.keys(e).map((f) => `
        <tr><td>${escapar(f)}</td><td class="num"><strong>${fmt(e[f])}</strong></td><td class="num">${fmt(atual.vendas_fechadas[f] ?? 0)}</td><td class="num">${fmt(atual.recebido_pedidos_abertos[f] ?? 0)}</td></tr>`).join('')}
      </tbody></table>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button class="btn" id="btn-suprimento">＋ Suprimento</button>
        <button class="btn perigo" id="btn-sangria">－ Sangria</button>
        <button class="btn ok grande" id="btn-fechar-caixa" style="margin-left:auto">${ic('cadeado')} Fechar caixa</button>
      </div>
    </div>
    <div class="cartao" style="margin-bottom:12px">
      <h3 style="margin-top:0">${ic('prato')} Cobrar Mesas Ocupadas</h3>
      <label class="sr-only" for="busca-mesas">Buscar mesa por número</label>
      <input id="busca-mesas" type="search" inputmode="numeric" autocomplete="off"
        placeholder="Buscar mesa por número…" aria-describedby="busca-mesas-dica"
        style="width:100%;padding:12px;margin-bottom:10px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
      <small id="busca-mesas-dica" style="color:var(--texto-fraco)">${mesasOcupadas.length} mesa(s) em atendimento.</small>
      <div id="lista-mesas-caixa" class="abas" style="flex-wrap:wrap;margin-top:8px">
        ${renderizarBotoesMesas(mesasOcupadas, abertos)}
      </div>
    </div>
    <div class="cartao" style="margin-bottom:12px">
      <h3 style="margin-top:0">Movimentações do turno</h3>
      ${atual.movimentacoes.length ? `<table class="dados"><tbody>${atual.movimentacoes.map((mv) => `
        <tr><td>${new Date(mv.criado_em).toLocaleTimeString('pt-BR')}</td>
        <td><span class="badge ${mv.tipo === 'sangria' ? 'alerta' : 'ok'}">${mv.tipo}</span></td>
        <td class="num">${fmt(mv.valor_centavos)}</td><td>${escapar(mv.motivo)}</td><td>${escapar(mv.usuario_nome)}</td></tr>`).join('')}</tbody></table>`
        : '<div class="vazio">Sem movimentações</div>'}
    </div>
    ${vendasAbertasHtml(abertos, estadoApp)}`;

  const mov = (tipo) => async () => {
    let autorizacao = {};
    if (estadoApp.usuario.cargo !== 'admin' && estadoApp.usuario.cargo !== 'proprietario') {
      const a = await pedirAutorizacaoAdmin({ titulo: tipo === 'sangria' ? 'Sangria — autorização' : 'Suprimento — autorização' });
      if (!a) return;
      autorizacao = a;
    }
    abrirModalValor(tipo, async (valor, motivo) => {
      try {
        await post('/caixa/movimentar', { tipo, forma: 'dinheiro', valor_centavos: valor, motivo, ...autorizacao });
        toast(`${tipo === 'sangria' ? 'Sangria' : 'Suprimento'} registrado`, 'ok');
        atualizar(conteudo, estadoApp);
      } catch (e) { toast(e.message, 'erro'); }
    });
  };
  ligarCobrarMesas(conteudo, estadoApp, mesasOcupadas, abertos);

  // Busca de mesas (P-08): filtra por número em tempo real.
  const busca = conteudo.querySelector('#busca-mesas');
  const lista = conteudo.querySelector('#lista-mesas-caixa');
  const dica = conteudo.querySelector('#busca-mesas-dica');
  busca.oninput = () => {
    const termo = busca.value.trim().toLowerCase();
    const filtradas = termo
      ? mesasOcupadas.filter((m) => String(m.numero).includes(termo))
      : mesasOcupadas;
    lista.innerHTML = renderizarBotoesMesas(filtradas, abertos);
    dica.textContent = termo
      ? `${filtradas.length} de ${mesasOcupadas.length} mesa(s) encontrada(s).`
      : `${mesasOcupadas.length} mesa(s) em atendimento.`;
  };

  conteudo.querySelector('#btn-suprimento').onclick = mov('suprimento');
  conteudo.querySelector('#btn-sangria').onclick = mov('sangria');
  conteudo.querySelector('#btn-fechar-caixa').onclick = () => fecharCaixaModal(conteudo, estadoApp, atual);
  ligarVendasAbertas(conteudo, estadoApp, atualizar);
}

// Botões de cobrança. `mesas` pode ser a lista já filtrada pela busca.
function renderizarBotoesMesas(mesas, abertos) {
  return mesas.map((m) => {
    // Soma as comandas da mesa: pode haver comanda individual (mais de uma conta).
    const comandas = abertos.filter((p) => p.mesa_id === m.id);
    const saldo = comandas.reduce((s, p) => s + (p.totais?.saldo_centavos ?? 0), 0);
    const extra = comandas.length > 1 ? `, ${comandas.length} comandas` : '';
    return `<button class="btn ${comandas.length ? 'ativa' : ''}" data-cobrar-mesa="${m.id}"
      title="Cobrar Mesa ${m.numero}${extra}${comandas.length ? ` — saldo ${fmt(saldo)}` : ''}">
      Mesa ${m.numero}${saldo ? ` (${fmt(saldo)})` : ''}<span class="sr-only">${extra}</span></button>`;
  }).join('') || '<div class="vazio">Nenhuma mesa ocupada</div>';
}

// Delegação de eventos: continua funcionando após a busca redesenhar a lista.
function ligarCobrarMesas(conteudo, estadoApp, mesas, abertos) {
  const lista = conteudo.querySelector('#lista-mesas-caixa');
  if (!lista || lista.dataset.linked === '1') return;
  lista.dataset.linked = '1';
  lista.onclick = async (ev) => {
    const b = ev.target.closest('[data-cobrar-mesa]');
    if (!b) return;
    const mesaId = Number(b.dataset.cobrarMesa);
    const comandas = abertos.filter((p) => p.mesa_id === mesaId);
    if (!comandas.length) { toast('Nenhum pedido aberto para esta mesa', 'erro'); return; }
    const { telaPagamento } = await import('./pdv.js');
    for (const pedido of comandas) {
      const resultado = await telaPagamento(pedido, estadoApp);
      if (resultado?.saldo_zero) atualizar(conteudo, estadoApp);
    }
  };
}

function vendasAbertasHtml(abertos, estadoApp) {
  if (!estadoApp.permissoes.pode_dividir_pagar) return '';
  return `<div class="cartao">
    <h3 style="margin-top:0">Vendas/pedidos abertos com pagamento iniciado</h3>
    ${abertos.filter((p) => p.totais.pago_centavos > 0).map((p) => `
      <button class="btn" data-pedido="${p.id}" style="margin:4px">#${p.id} ${p.tipo === 'mesa' ? `Mesa ${p.mesa_numero}` : 'Balcão'} · pago ${fmt(p.totais.pago_centavos)} / total ${fmt(p.totais.total_centavos)}</button>`).join('') || '<div class="vazio">Nenhuma</div>'}
  </div>`;
}

function ligarVendasAbertas(conteudo, estadoApp, recarregar) {
  conteudo.querySelectorAll('[data-pedido]').forEach((b) => {
    b.onclick = async () => {
      const p = await get(`/pedidos/${b.dataset.pedido}`);
      const m = modal(`<h2>Pedido #${p.id}</h2>
        <div class="cartao" style="margin-bottom:10px" role="status">
          <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
            <span>Total<br><strong style="font-family:var(--mono)">${fmt(p.totais.total_centavos)}</strong></span>
            <span>Pago<br><strong style="font-family:var(--mono);color:var(--ok)">${fmt(p.totais.pago_centavos)}</strong></span>
            <span>Falta<br><strong style="font-family:var(--mono);color:var(--alerta)">${fmt(p.totais.saldo_centavos)}</strong></span>
          </div>
          ${p.totais.saldo_centavos === 0
            ? '<p style="font-weight:700;color:var(--ok)">QUITADA — pronta para fechar</p>'
            : `<p style="font-weight:700;color:var(--alerta)">FALTAM ${fmt(p.totais.saldo_centavos)} — a venda NÃO fecha. Registre o restante no PDV/mesa.</p>`}
        </div>
        <p>${p.itens.map((i) => `${i.quantidade}× ${escapar(i.nome_produto)}${i.status === 'cancelado' ? ' (cancelado)' : ''}`).join('<br>')}</p>
        ${p.totais.saldo_centavos === 0 ? '<button class="btn ok grande" id="fechar-agora" style="width:100%">Fechar pedido</button>' : '<button class="btn ok grande" id="fechar-agora" style="width:100%" disabled aria-disabled="true" title="Quite o saldo para fechar">Fechar pedido (bloqueado)</button>'}
        <button class="btn ghost" id="voltar" style="width:100%;margin-top:8px">Voltar</button>`);
      m.caixa.querySelector('#voltar').onclick = m.fechar;
      const f = m.caixa.querySelector('#fechar-agora');
      if (f) f.onclick = async () => {
        try { await post(`/pedidos/${p.id}/fechar`, {}); toast('Pedido fechado', 'ok'); m.fechar(); recarregar(conteudo, estadoApp); }
        catch (e) { toast(e.message, 'erro'); }
      };
    };
  });
}

function abrirModalValor(tipo, aoConfirmar) {
  const m = modal(`<h2>${tipo === 'sangria' ? 'Sangria (retirada de dinheiro)' : 'Suprimento (entrada de dinheiro)'}</h2>
    <input id="valor" inputmode="decimal" placeholder="Valor (ex: 200,00)" style="width:100%;padding:14px;font-size:1.1rem;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
    <input id="motivo" placeholder="Motivo (obrigatório)" style="width:100%;padding:12px;margin-top:8px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
    <div style="display:flex;gap:10px;margin-top:12px"><button class="btn ghost" data-a="c">Cancelar</button><button class="btn ${tipo === 'sangria' ? 'perigo' : 'primario'} grande" data-a="ok" style="flex:1">Registrar</button></div>`);
  m.caixa.querySelector('[data-a="c"]').onclick = m.fechar;
  m.caixa.querySelector('[data-a="ok"]').onclick = () => {
    const valor = reaisParaCentavos(m.caixa.querySelector('#valor').value);
    const motivo = m.caixa.querySelector('#motivo').value.trim();
    if (!valor || valor <= 0) { toast('Valor inválido', 'erro'); return; }
    if (motivo.length < 3) { toast('Motivo obrigatório', 'erro'); return; }
    m.fechar();
    aoConfirmar(valor, motivo);
  };
}

function fecharCaixaModal(conteudo, estadoApp, atual) {
  const formas = Object.keys(atual.esperado);
  const m = modal(`<h2>${ic('cadeado')} Fechamento do caixa</h2>
    <p>Informe o valor <strong>contado</strong> por forma. A divergência é calculada pelo servidor.</p>
    ${formas.map((f) => `<label class="linha-itens"><span>${escapar(f)} <small>(esperado ${fmt(atual.esperado[f])})</small></span>
      <input data-forma="${f}" inputmode="decimal" placeholder="contado" style="width:130px;padding:10px;background:var(--canvas);border-radius:8px;border:1px solid var(--borda);color:var(--texto)" /></label>`).join('')}
    <input id="obs" placeholder="Observações (opcional)" style="width:100%;padding:12px;margin-top:8px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
    <div style="display:flex;gap:10px;margin-top:14px">
      <button class="btn ghost" data-a="c">Cancelar</button>
      <button class="btn ok grande" data-a="ok" style="flex:1">Fechar caixa</button>
    </div>`);
  m.caixa.querySelector('[data-a="c"]').onclick = m.fechar;
  m.caixa.querySelector('[data-a="ok"]').onclick = async () => {
    const conferencia = {};
    for (const inp of m.caixa.querySelectorAll('[data-forma]')) {
      const v = inp.value.trim();
      if (v === '') continue;
      const c = reaisParaCentavos(v);
      if (c === null || c < 0) { toast(`Valor contado inválido para "${inp.dataset.forma}"`, 'erro'); return; }
      conferencia[inp.dataset.forma] = c;
    }
    if (conferencia.dinheiro === undefined) { toast('Conferência do dinheiro é obrigatória', 'erro'); return; }
    if (!await confirmar('Fechar caixa?', 'O turno será encerrado e a conferência registrada.', { perigo: true })) return;
    try {
      const r = await post('/caixa/fechar', { conferencia, observacoes: m.caixa.querySelector('#obs').value.trim() || null });
      m.fechar();
      const conf = JSON.parse(r.conferencia_json);
      toast(`Caixa fechado. Divergência dinheiro: ${fmt(r.divergencia_dinheiro_centavos)}`, r.divergencia_dinheiro_centavos === 0 ? 'ok' : 'erro');
      anunciar('Caixa fechado.', true);
      const res = modal(`<h2>Conferência do turno</h2>
        <table class="dados"><thead><tr><th scope="col">Forma</th><th scope="col">Esperado</th><th scope="col">Contado</th><th scope="col">Diferença</th></tr></thead><tbody>
        ${Object.entries(conf).map(([f, c]) => `<tr><td>${escapar(f)}</td><td class="num">${fmt(c.esperado)}</td><td class="num">${fmt(c.informado)}</td><td class="num" style="color:${c.diferenca === 0 ? 'var(--ok)' : 'var(--alerta)'}">${fmt(c.diferenca)}</td></tr>`).join('')}
        </tbody></table>
        <div style="display:flex;gap:10px;margin-top:12px">
          <button class="btn" data-a="pdf" style="flex:1">${ic('documento')} PDF do fechamento</button>
          <button class="btn primario" data-a="ok" style="flex:1">OK</button>
        </div>`);
      res.caixa.querySelector('[data-a="ok"]').onclick = () => res.fechar(); // usa fechar() para limpar listeners e devolver o foco
      res.caixa.querySelector('[data-a="pdf"]').onclick = async () => {
        try {
          const { exportarFechamentoPDF, baixarPDF } = await import('../pdfExport.js');
          const detalhe = await get(`/caixa/sessoes/${r.id}`);
          baixarPDF(await exportarFechamentoPDF(detalhe), `fechamento-caixa-${r.id}.pdf`);
          toast('PDF do fechamento gerado', 'ok');
        } catch (e) { toast(e.message, 'erro'); }
      };
      atualizar(conteudo, estadoApp);
    } catch (e) { toast(e.message, 'erro'); }
  };
}
