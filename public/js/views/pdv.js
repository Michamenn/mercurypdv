// PDV de Balcão: catálogo → carrinho → pagamento dividido → fechamento → recibo
import { ic } from '../icons.js';
import { get, post, fmt, reaisParaCentavos, novaIdempotencia } from '../api.js';
import { toast, modal, confirmar, escapar, pedirAutorizacaoAdmin, numpadConteudo } from '../ui.js';
import { abrirGorjeta } from '../gorjeta.js';
import { mostrarRecibo } from '../recibo.js';
import { seletorCombo } from './combos.js';
import { abrirConta } from '../conta.js';
import { anunciar } from '../a11y.js';

import { guardarCatalogo, lerCatalogo } from '../offdb.js';

let catalogo = { categorias: [], produtos: [], adicionais: [] };
let carrinho = []; // {produto_id, nome, preco_centavos, quantidade, adicionais:[...], observacoes, variacao_id, variacao_nome, variacao_delta}
let categoriaAtiva = null;
let buscaPDV = '';
let viagemPDV = false;

let caixaAbertoPDV = false;
let vendaEmAndamento = false; // trava contra duplo clique/F2 repetido (venda duplicada)


function rotuloTipo(t) {
  return { lanche: 'Lanche', prato: 'Prato', porcao: 'Porção', bebida: 'Bebida', sobremesa: 'Sobremesa', servico: 'Serviço', outro: 'Item' }[t] ?? t;
}

// Total do carrinho em centavos — fonte única (usada no desenho e nos anúncios).
function totalCarrinhoCentavos() {
  return carrinho.reduce((s, i) => s + (i.preco_centavos + (i.variacao_delta ?? 0) + i.adicionais.reduce((a, ad) => a + ad.preco_centavos * ad.quantidade, 0)) * i.quantidade, 0);
}

// Adição rápida de 1 unidade (mais vendidos / bip de código de barras)
function adicionarRapido(produtoId, conteudo, estadoApp) {
  const p = catalogo.produtos.find((x) => x.id === produtoId);
  if (!p) return;
  if (!p.disponivel) { toast(`"${p.nome}" indisponível: ${p.indisponibilidade_motivo}`, 'erro'); return; }
  carrinho.push({ produto_id: p.id, nome: p.nome, preco_centavos: p.preco_centavos, quantidade: 1, adicionais: [], observacoes: null, variacao_id: null, variacao_nome: null, variacao_delta: 0 });
  anunciar(`${p.nome} adicionado. Total ${fmt(totalCarrinhoCentavos())}`);
  desenhar(conteudo, estadoApp);
}

export async function render(conteudo, _sub, estadoApp) {
  carrinho = [];
  buscaPDV = '';
  viagemPDV = false;
  conteudo.onkeydown = (e) => {
    if (e.repeat) return; // tecla segurada (auto-repeat) não dispara atalhos múltiplas vezes
    if (e.target.matches('input, select, textarea')) return;
    if (e.key === 'F2') { e.preventDefault(); if (carrinho.length) fluxoVenda(conteudo, estadoApp); }
    if (e.key === 'F4') { e.preventDefault(); conteudo.querySelector('#btn-limpar')?.click(); }
    if (e.key === 'F8') { e.preventDefault(); conteudo.querySelector('#busca-pdv')?.focus(); }
  };
  conteudo.innerHTML = '<div class="vazio">Carregando catálogo…</div>';
  try {
    catalogo = await get('/catalogo');
    guardarCatalogo(catalogo).catch(() => {});
  } catch {
    const cache = await lerCatalogo();
    if (cache) { catalogo = cache; toast('Catálogo em cache (sem conexão)', 'erro'); }
    else { conteudo.innerHTML = '<div class="vazio">Sem conexão e sem cache do catálogo.</div>'; return; }
  }
  categoriaAtiva = catalogo.categorias[0]?.id ?? null;
  // fetch caixa status; ignore network errors (backend authority)
  try {
    const caixaAtual = await get('/caixa/atual');
    caixaAbertoPDV = !!caixaAtual?.sessao;
  } catch {
    /* ignore */
  }
  desenhar(conteudo, estadoApp);
}

function desenhar(conteudo, estadoApp) {
  const termo = (buscaPDV ?? '').toLowerCase().trim();
  let produtos = catalogo.produtos.filter((p) => p.categoria_id === categoriaAtiva);
  if (termo) {
    produtos = catalogo.produtos.filter((p) =>
      p.nome.toLowerCase().includes(termo) ||
      (p.apelidos ?? '').toLowerCase().includes(termo) ||
      (p.codigo_barras ?? '') === termo);
  }
  const totalCarrinho = totalCarrinhoCentavos();
  // Fluxo de bip: se o operador estava na busca, o foco volta lá depois
  // do re-render — sem F8 entre uma leitura e outra.
  const focavaBusca = document.activeElement?.id === 'busca-pdv';
  const podeAbrirCaixa = !!estadoApp.permissoes.pode_abrir_fechar_caixa;
  const aviso = !caixaAbertoPDV
    ? `<div class="cartao" style="border-color:var(--alerta)">${ic('alerta')} <strong>Caixa fechado</strong> — ${podeAbrirCaixa ? 'abra o caixa para vender e receber.' : 'peça a quem opera o caixa para abrir o caixa.'}${podeAbrirCaixa ? ` <button class="btn primario" id="btn-abrir-caixa">Abrir caixa</button>` : ''}</div>`
    : '';
  conteudo.innerHTML = `
${aviso}
    <div class="pdv-topo">
      <input id="busca-pdv" class="campo pdv-busca" placeholder="Buscar por nome, apelido ou código de barras (Enter = bip)" value="${escapar(buscaPDV ?? '')}" aria-label="Buscar produto" />
    </div>
    <div class="abas" role="tablist" aria-label="Categorias">
      ${catalogo.categorias.map((c) => `<button class="btn ${c.id === categoriaAtiva ? 'ativa' : ''}" role="tab" aria-selected="${c.id === categoriaAtiva}" aria-controls="grade-pdv" data-cat="${c.id}">${escapar(c.nome)}</button>`).join('')}
    </div>
    <div class="pdv-corpo">
      <div class="pdv-area">
        <div class="grid-produtos" id="grade-pdv" role="tabpanel" aria-label="Produtos da categoria">
          ${produtos.map((p) => {
            const indisp = !p.disponivel;
            const emPromo = !indisp && p.promocao_ativa && (p.preco_vigente_centavos ?? p.preco_centavos) < p.preco_centavos;
            return `
            <button class="btn produto-btn" data-prod="${p.id}" ${indisp ? 'disabled' : ''} ${indisp ? `aria-disabled="true" title="${escapar(p.indisponibilidade_motivo ?? 'Indisponível')}"` : ''}>
              <span>${escapar(p.nome)}${emPromo ? ' <span class="badge ok">PROMO</span>' : ''}</span>
              <span class="preco">${emPromo ? `<s>${fmt(p.preco_centavos)}</s> ` : ''}${fmt(emPromo ? p.preco_vigente_centavos : p.preco_centavos)}</span>
              <small class="pdv-meta">${indisp ? `${ic('proibido')} ${escapar((p.indisponibilidade_motivo ?? 'indisponível').slice(0, 28))}` : `${emPromo ? escapar(p.promocao_ativa.nome) + ' · ' : ''}${p.tipo_item !== 'lanche' ? rotuloTipo(p.tipo_item) + ' · ' : ''}${p.area === 'bar' ? ic('cerveja') + ' bar' : ic('panela') + ' ' + p.tempo_preparo_min + ' min'}`}</small>
            </button>`;
          }).join('') || '<div class="vazio">Nenhum produto encontrado.</div>'}
        </div>
      </div>
      <aside class="cartao pdv-aside painel-comanda">
        <div class="painel-comanda-topo">
          <h3>${ic('recibo')} Comanda rápida</h3>
          <label class="pdv-check" for="viagem">
            <input type="checkbox" id="viagem" ${viagemPDV ? 'checked' : ''} /> ${ic('marmita')} Para viagem
          </label>
        </div>
        <div id="itens-carrinho" class="painel-comanda-itens">
          ${carrinho.map((i, idx) => `
            <div class="linha-itens">
              <span>${i.quantidade}× ${escapar(i.nome)}${i.variacao_nome ? `<br><small>${escapar(i.variacao_nome)}</small>` : ''}${i.adicionais.length ? `<br><small>+ ${escapar(i.adicionais.map((a) => a.nome).join(', '))}</small>` : ''}${i.observacoes ? `<br><small class="obs">${ic('lapis')} ${escapar(i.observacoes)}</small>` : ''}</span>
              <span class="pdv-item-acoes">
                <strong>${fmt((i.preco_centavos + (i.variacao_delta ?? 0) + i.adicionais.reduce((a, ad) => a + ad.preco_centavos * ad.quantidade, 0)) * i.quantidade)}</strong>
                <button class="btn ghost" data-rm="${idx}" title="Remover" aria-label="Remover ${escapar(i.nome)}">${ic('x')}</button>
              </span>
            </div>`).join('') || '<div class="vazio">Toque nos produtos para adicionar</div>'}
        </div>
        <div class="painel-comanda-rodape">
          <div class="cm-totais">
            <div><span>Subtotal</span><span class="mono">${fmt(totalCarrinho)}</span></div>
            <div class="cm-total"><span>Total</span><span class="mono">${fmt(totalCarrinho)}</span></div>
            <div class="cm-falta"><span>Falta</span><span class="mono">${fmt(totalCarrinho)}</span></div>
          </div>
        </div>
        <div class="painel-comanda-acoes">
          <button class="btn" id="btn-combos">${ic('presente')} Combos</button>
          <button class="btn ghost" id="btn-limpar" title="Atalho: F4">Limpar</button>
          <button class="btn" id="btn-conta"${carrinho.length ? '' : ' disabled'}>${ic('recibo')} Conta</button>
          <button class="btn ok larga" id="btn-vender" title="${caixaAbertoPDV ? 'Atalho: F2' : 'Abra o caixa para vender'}" aria-label="Finalizar venda" ${carrinho.length && caixaAbertoPDV ? '' : 'disabled'}>${ic('check')} Finalizar</button>
        </div>
        <p class="pdv-atalhos"><small>Atalhos: F2 finalizar · F4 limpar · F8 buscar</small></p>
      </aside>
    </div>`;

  const inputBusca = conteudo.querySelector('#busca-pdv');
  if (focavaBusca) {
    // foco + cursor no fim: a próxima leitura entra limpa
    inputBusca.focus();
    try { inputBusca.setSelectionRange(inputBusca.value.length, inputBusca.value.length); } catch { /* input sem seleção */ }
  }
  inputBusca.oninput = () => { buscaPDV = inputBusca.value; };
  inputBusca.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const t = inputBusca.value.trim().toLowerCase();
      if (!t) return;
      // bip de código de barras ou busca exata: adiciona direto 1 unidade
      const exato = catalogo.produtos.find((p) => (p.codigo_barras ?? '').toLowerCase() === t)
        ?? catalogo.produtos.find((p) => p.nome.toLowerCase() === t);
      if (exato) {
        if (!exato.disponivel) { toast(`"${exato.nome}" indisponível: ${exato.indisponibilidade_motivo}`, 'erro'); return; }
        buscaPDV = ''; // bip consumido: campo limpo para a próxima leitura
        adicionarRapido(exato.id, conteudo, estadoApp);
      } else {
        buscaPDV = inputBusca.value;
        desenhar(conteudo, estadoApp);
        toast('Nenhum código/exato — filtrando a grade', 'info');
      }
    }
    if (e.key === 'Escape') { buscaPDV = ''; desenhar(conteudo, estadoApp); }
  };

  conteudo.querySelectorAll('[data-cat]').forEach((b) => {
    b.onclick = () => { categoriaAtiva = Number(b.dataset.cat); desenhar(conteudo, estadoApp); };
  });
  conteudo.querySelectorAll('[data-prod]').forEach((b) => {
    b.onclick = () => abrirItemModal(Number(b.dataset.prod), conteudo, estadoApp);
  });
  conteudo.querySelectorAll('[data-rm]').forEach((b) => {
    b.onclick = () => { carrinho.splice(Number(b.dataset.rm), 1); desenhar(conteudo, estadoApp); };
  });
  conteudo.querySelector('#btn-limpar').onclick = async () => {
    if (!carrinho.length || await confirmar('Limpar comanda?', 'Remover todos os itens do carrinho atual?', { perigo: true })) {
      carrinho = []; desenhar(conteudo, estadoApp);
    }
  };
  conteudo.querySelector('#btn-combos').onclick = () => abrirCombosModal(conteudo, estadoApp);
  conteudo.querySelector('#btn-vender').onclick = () => fluxoVenda(conteudo, estadoApp);
  // Conta: conferência do carrinho em formato de cupom (nada é gravado).
  const btnConta = conteudo.querySelector('#btn-conta');
  if (btnConta) btnConta.onclick = () => abrirConta({
    titulo: 'Balcão',
    subtitulo: viagemPDV ? 'Para viagem' : '',
    itens: carrinho.map((i) => {
      // Valor unitário efetivo (preço + variação + adicionais) — a linha fecha com o total.
      const unit = i.preco_centavos + (i.variacao_delta ?? 0) + i.adicionais.reduce((a, ad) => a + ad.preco_centavos * ad.quantidade, 0);
      return {
        quantidade: i.quantidade,
        nome: i.nome,
        detalhe: [i.variacao_nome,
          i.adicionais.length ? `+ ${i.adicionais.map((a) => a.nome).join(', ')}` : null,
          i.observacoes].filter(Boolean).join(' · '),
        unit_centavos: unit,
        total_centavos: unit * i.quantidade,
      };
    }),
    totais: { total_centavos: totalCarrinhoCentavos() },
  });
  const chkViagem = conteudo.querySelector('#viagem');
  if (chkViagem) chkViagem.onchange = () => { viagemPDV = chkViagem.checked; };
  // abrir caixa modal when button present
  const btnAbrirCaixa = conteudo.querySelector('#btn-abrir-caixa');
  if (btnAbrirCaixa) {
    btnAbrirCaixa.onclick = async () => {
      const m = modal(`
        <h2>${ic('dinheiro')} Abrir caixa</h2>
        <p>Informe o fundo de troco (saldo inicial):</p>
        <input id="saldo" inputmode="decimal" placeholder="Ex: 150,00" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
        <div style="display:flex;gap:10px;margin-top:14px">
          <button class="btn primario" id="btn-confirmar-abrir">Abrir caixa</button>
        </div>`);
      const btnConf = m.caixa.querySelector('#btn-confirmar-abrir');
      btnConf.onclick = async () => {
        const valor = reaisParaCentavos(m.caixa.querySelector('#saldo').value || '0');
        if (valor === null || valor < 0) { toast('Valor inválido', 'erro'); return; }
        try {
          await post('/caixa/abrir', { saldo_inicial_centavos: valor });
          toast('Caixa aberto', 'ok');
          m.fechar();
          caixaAbertoPDV = true;
          desenhar(conteudo, estadoApp); // só redesenha: preserva o carrinho já lançado
        } catch (e) { toast(e.message, 'erro'); }
      };
    };
  }
}

function abrirItemModal(produtoId, conteudo, estadoApp) {
  const p = catalogo.produtos.find((x) => x.id === produtoId);
  if (!p) return;
  const gruposVar = {};
  for (const v of (p.variacoes ?? [])) { (gruposVar[v.grupo] ??= []).push(v); }
  const nomesGrupo = Object.keys(gruposVar);
  const m = modal(`
    <h2>${escapar(p.nome)} <span style="color:var(--ok);font-family:var(--mono)">${fmt(p.preco_centavos)}</span></h2>
    
    <p>Quantidade</p>
    <div class="qtd-stepper">
      <button type="button" class="btn" data-q="-1" aria-label="Diminuir">−</button>
      <input id="qtd" type="number" min="1" max="999" value="1" inputmode="numeric" aria-label="Quantidade" />
      <button type="button" class="btn" data-q="1" aria-label="Aumentar">＋</button>
    </div>
    ${nomesGrupo.length ? nomesGrupo.map((g) => `
      <p style="margin-bottom:4px">${escapar(g[0].toUpperCase() + g.slice(1))}</p>
      <div class="abas" role="radiogroup" aria-label="${escapar(g)}">
        <button class="btn ativa" role="radio" aria-checked="true" data-var-grupo="${escapar(g)}" data-var-id="" data-var-delta="0">Padrão</button>
        ${gruposVar[g].map((v) => `<button class="btn" role="radio" aria-checked="false" data-var-grupo="${escapar(g)}" data-var-id="${v.id}" data-var-delta="${v.delta_centavos}" title="${v.delta_centavos ? (v.delta_centavos > 0 ? '+' : '') + fmt(v.delta_centavos).replace('R$', 'R$ ') : ''}">${escapar(v.nome)}${v.delta_centavos ? ` (+${fmt(v.delta_centavos)})` : ''}</button>`).join('')}
      </div>`).join('') : ''}
    ${p.adicionais?.length ? `
      <p style="margin-bottom:4px">Adicionais</p>
      ${p.adicionais.map((a) => `
        <label class="linha-itens" style="cursor:pointer">
          <span><input type="checkbox" data-ad="${a.adicional_id}" data-preco="${a.preco_centavos}" data-nome="${escapar(a.nome)}" /> ${escapar(a.nome)}</span>
          <span class="preco">${fmt(a.preco_centavos)}</span>
        </label>`).join('')}` : ''}
    <p style="margin-bottom:4px">Observação de preparo</p>
    <input id="obs" placeholder="Ex.: sem cebola, ponto da carne…" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
    <div style="display:flex;gap:10px;margin-top:14px">
      <button class="btn ghost" data-a="cancelar">Cancelar</button>
      <button class="btn primario grande" data-a="ok" style="flex:1">Adicionar</button>
    </div>`);
  m.caixa.classList.add('modal-quantidade');
  let qtd = 1;
  const inputQtd = m.caixa.querySelector('#qtd');
  m.caixa.querySelectorAll('[data-q]').forEach((b) => {
    b.onclick = () => {
      const delta = Number(b.dataset.q);
      let newVal = qtd + delta;
      newVal = Math.max(1, Math.min(999, newVal));
      qtd = newVal;
      if (inputQtd) inputQtd.value = qtd;
    };
  });
  if (inputQtd) {
    inputQtd.addEventListener('input', () => {
      const v = Math.floor(Number(inputQtd.value));
      qtd = Number.isFinite(v) ? Math.max(1, Math.min(999, v)) : 1;
    });
    inputQtd.addEventListener('change', () => { inputQtd.value = String(qtd); });
  }
  m.caixa.querySelectorAll('[data-var-grupo]').forEach((b) => {
    b.onclick = () => {
      m.caixa.querySelectorAll(`[data-var-grupo="${b.dataset.varGrupo}"]`).forEach((x) => {
        x.classList.remove('ativa'); x.setAttribute('aria-checked', 'false');
      });
      b.classList.add('ativa'); b.setAttribute('aria-checked', 'true');
    };
  });
  m.caixa.querySelector('[data-a="cancelar"]').onclick = m.fechar;
  m.caixa.querySelector('[data-a="ok"]').onclick = () => {
    const adicionais = [...m.caixa.querySelectorAll('[data-ad]:checked')].map((c) => ({
      adicional_id: Number(c.dataset.ad), nome: c.dataset.nome, preco_centavos: Number(c.dataset.preco), quantidade: 1,
    }));
    const variacoes = [...m.caixa.querySelectorAll('[data-var-grupo].ativa')].filter((b) => b.dataset.varId).map((b) => ({ variacao_id: Number(b.dataset.varId) }));
    const variacaoDelta = [...m.caixa.querySelectorAll('[data-var-grupo].ativa')].reduce((s, b) => s + Number(b.dataset.varDelta || 0), 0);
    const nomesVar = [...m.caixa.querySelectorAll('[data-var-grupo].ativa')].filter((b) => b.dataset.varId).map((b) => b.textContent.trim()).join(' + ') || null;
    carrinho.push({ produto_id: p.id, nome: p.nome, preco_centavos: p.preco_centavos, quantidade: qtd, adicionais, observacoes: m.caixa.querySelector('#obs').value.trim() || null, variacoes, variacao_nome: nomesVar, variacao_delta: variacaoDelta });
    anunciar(`${qtd}× ${p.nome} adicionado. Total ${fmt(totalCarrinhoCentavos())}`);
    m.fechar();
    desenhar(conteudo, estadoApp);
  };
}

// Modal de Combos/Promoções: escolhe combo (+ opcionais com limite por grupo),
// cria a venda a partir do carrinho atual (ou dos itens do combo, se vazio),
// aplica o combo no servidor e segue para o pagamento.
async function abrirCombosModal(conteudo, estadoApp) {
  let combos = [];
  try {
    const resp = await get('/combos/vigentes');
    combos = resp.combos ?? [];
  } catch (e) {
    toast('Erro ao carregar combos: ' + e.message, 'erro');
    return;
  }
  if (!combos.length) {
    toast('Nenhum combo vigente no momento', 'erro');
    return;
  }

  const m = modal(`
    <h2>${ic('presente')} Combos & Promoções</h2>
    <p style="color:var(--texto-fraco);margin-bottom:12px">Selecione um combo. Os itens entram na venda e o desconto é calculado no servidor.</p>
    <div style="max-height:44vh;overflow:auto">
      ${combos.map(c => `
        <div class="cartao" style="margin-bottom:10px;cursor:pointer" data-combo="${c.id}" role="button" tabindex="0">
          <strong>${escapar(c.nome)}</strong> ${c.descricao ? `<br><small style="color:var(--texto-fraco)">${escapar(c.descricao)}</small>` : ''}
          <div style="margin-top:6px;display:flex;gap:12px;flex-wrap:wrap">
            <span class="badge">${labelTipoCombo(c.tipo)}</span>
            <span style="font-family:var(--mono);color:var(--ok)">${formatValorComboPDV(c)}</span>
            ${c.itens?.length ? `<span style="color:var(--texto-fraco)">${c.itens.length} item(s)</span>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
    <div id="combo-escolhas"></div>
    <div style="display:flex;gap:10px;margin-top:12px">
      <button class="btn ghost" data-a="voltar">Voltar</button>
      <button class="btn primario grande" data-a="criar" style="flex:1" disabled>Criar venda com combo</button>
    </div>
  `);

  let selecionado = null;
  const escolhasBox = m.caixa.querySelector('#combo-escolhas');
  const btnCriar = m.caixa.querySelector('[data-a="criar"]');
  m.caixa.querySelector('[data-a="voltar"]').onclick = m.fechar;
  m.caixa.querySelectorAll('[data-combo]').forEach(el => {
    const escolher = () => {
      selecionado = combos.find(x => x.id === Number(el.dataset.combo));
      if (!selecionado) return;
      m.caixa.querySelectorAll('[data-combo]').forEach(x => x.classList.remove('selecionado'));
      el.classList.add('selecionado');
      const opcionais = (selecionado.itens ?? []).filter(i => !i.obrigatorio);
      const grupos = [...new Set(opcionais.map(i => i.grupo_escolha))];
      escolhasBox.innerHTML = grupos.map(g => {
        const itensG = opcionais.filter(i => i.grupo_escolha === g);
        const max = itensG[0]?.max_escolhas ?? itensG.length;
        return `<p style="margin-bottom:4px">Escolha (grupo ${g}, máx ${max})</p>` + itensG.map(i => `
          <label class="linha-itens" style="cursor:pointer">
            <span><input type="checkbox" data-op="${i.produto_id}" data-grupo="${g}" /> ${escapar(i.produto_nome)}</span>
            <span class="preco">${fmt(i.produto_preco)}</span>
          </label>`).join('');
      }).join('') || '<p style="color:var(--texto-fraco)">Sem opcionais.</p>';
      btnCriar.disabled = false;
      escolhasBox.querySelectorAll('[data-op]').forEach(c => {
        c.onchange = () => {
          const marcados = escolhasBox.querySelectorAll(`[data-grupo="${c.dataset.grupo}"]:checked`);
          const max = Number((selecionado.itens ?? []).find(i => String(i.grupo_escolha) === String(c.dataset.grupo))?.max_escolhas ?? 99);
          if (marcados.length > max) { c.checked = false; toast(`Máximo de ${max} neste grupo`, 'erro'); }
        };
      });
    };
    el.onclick = escolher;
    el.onkeydown = (e) => { if (e.key === 'Enter') escolher(); };
  });

  btnCriar.onclick = async () => {
    if (!selecionado) return;
    btnCriar.disabled = true;
    try {
      const escolhas = [...escolhasBox.querySelectorAll('[data-op]:checked')].map(c => ({ produto_id: Number(c.dataset.op), quantidade: 1 }));
      const obrigatorios = (selecionado.itens ?? []).filter(i => i.obrigatorio);
      // Base da venda: carrinho atual; se vazio, usa os itens obrigatórios do combo
      const base = carrinho.length ? carrinho.map(i => ({
        produto_id: i.produto_id, quantidade: i.quantidade, observacoes: i.observacoes,
        adicionais: i.adicionais.map(a => ({ adicional_id: a.adicional_id, quantidade: a.quantidade })),
        variacoes: (i.variacoes ?? []).map(v => ({ variacao_id: v.variacao_id })),
      })) : obrigatorios.map(i => ({ produto_id: i.produto_id, quantidade: i.quantidade, observacoes: `Combo: ${selecionado.nome}` }));
      const somenteDesconto = carrinho.length === 0;
      const pedido = await post('/pedidos/balcao', { itens: base }, { idem: novaIdempotencia('venda') });
      const aplicado = await post(`/pedidos/${pedido.id}/aplicar-combo`,
        { combo_id: selecionado.id, escolhas, somente_desconto: somenteDesconto }, { idem: novaIdempotencia('combo') });
      m.fechar();
      carrinho = [];
      toast(`Combo "${selecionado.nome}" aplicado — desconto ${fmt(aplicado.desconto_centavos)}`, 'ok');
      anunciar(`Combo ${selecionado.nome} aplicado. Total ${fmt(aplicado.total_centavos)}`, true);
      const atualizado = await get(`/pedidos/${pedido.id}`);
      const resultado = await telaPagamento(atualizado, estadoApp);
      if (resultado?.saldo_zero) { /* venda concluída */ }
      await render(conteudo, null, estadoApp);
    } catch (e) {
      toast(e.message, 'erro');
      btnCriar.disabled = false;
    }
  };
}

function labelTipoCombo(tipo) {
  return {
    preco_fixo: ic('dinheiro') + ' Preço Fixo',
    desconto_percentual: ic('queda') + ' % Desconto',
    leve_pague: ic('numeros') + ' Leve X Pague Y',
    brinde: ic('presente') + ' Brinde'
  }[tipo] ?? tipo;
}

function formatValorComboPDV(c) {
  switch (c.tipo) {
    case 'preco_fixo': return fmt(c.preco_fixo_centavos);
    case 'desconto_percentual': return `${c.desconto_percentual}% OFF`;
    case 'leve_pague': return `Leve ${c.leve_quantidade} Pague ${c.pague_quantidade}`;
    case 'brinde': return 'Brinde';
    default: return '—';
  }
}

async function fluxoVenda(conteudo, estadoApp) {
  if (vendaEmAndamento) return; // segunda chamada durante a mesma venda é ignorada
  vendaEmAndamento = true;
  // Feedback imediato: o botão mostra que a venda está sendo registrada
  // (antes, a trava era silenciosa — rede lenta parecia botão morto).
  const btnVender = conteudo.querySelector('#btn-vender');
  if (btnVender) {
    btnVender.disabled = true;
    btnVender.setAttribute('aria-busy', 'true');
    btnVender.innerHTML = `${ic('relogio')} Registrando…`;
  }
  try {
    // 1) cria a venda no servidor (com idempotência)
    const idemPedido = novaIdempotencia('venda');
    let pedido;
    try {
      pedido = await post('/pedidos/balcao', {
        canal: viagemPDV ? 'viagem' : 'salao',
        itens: carrinho.map((i) => ({
          produto_id: i.produto_id, quantidade: i.quantidade, observacoes: i.observacoes,
          adicionais: i.adicionais.map((a) => ({ adicional_id: a.adicional_id, quantidade: a.quantidade })),
          variacoes: (i.variacoes ?? []).map((v) => ({ variacao_id: v.variacao_id })),
        })),
      }, { idem: idemPedido });
    } catch (e) { toast(e.message, 'erro'); if (/caixa/i.test(e.message)) { caixaAbertoPDV = false; desenhar(conteudo, estadoApp); } return; }
    carrinho = [];

    // 2) tela de pagamento dividido em loop até saldo = 0
    let ultimoPedido = pedido;
    while (true) {
      const resultado = await telaPagamento(ultimoPedido, estadoApp);
      if (resultado === 'cancelar') { toast('Venda ficou aberta no caixa. Conclua em "Caixa → Vendas abertas".'); break; }
      if (resultado?.saldo_zero) { break; }
      if (resultado?.pedido) ultimoPedido = resultado.pedido;
      else break;
    }
    await render(conteudo, null, estadoApp);
  } finally {
    vendaEmAndamento = false;
    // Nas saídas de sucesso o render() já reconstruiu a tela; se a venda
    // falhou antes disso, o botão volta ao estado normal.
    const btn = conteudo.querySelector('#btn-vender');
    if (btn && btn.getAttribute('aria-busy') === 'true') {
      btn.removeAttribute('aria-busy');
      btn.disabled = !carrinho.length;
      btn.innerHTML = `${ic('check')} Finalizar`;
    }
  }
}

export function telaPagamento(pedido, estadoApp) {
  // Gorjeta: extra sobre a conta (não entra no total nem no saldo). A
  // implementação compartilhada fica em public/js/gorjeta.js.
  async function abrirModalGorjeta() {
    await abrirGorjeta({
      pedidoId: pedido.id,
      nomePadrao: pedido.atendente_nome || pedido.garcom_nome || '',
    });
  }
  return new Promise((resolve) => {
    const t = pedido.totais;
    let pendente = t.saldo_centavos;
    const m = modal(`
      <h2>Pagamento — Venda #${pedido.id}</h2>
      <div class="cartao" style="margin-bottom:10px" role="status" aria-live="polite">
        <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
          <span>Total<br><strong style="font-family:var(--mono);font-size:1.2rem">${fmt(t.total_centavos)}</strong></span>
          <span>Pago<br><strong id="res-pago" style="font-family:var(--mono);font-size:1.2rem;color:var(--ok)">${fmt(t.pago_centavos)}</strong></span>
          <span>Falta<br><strong id="res-falta" style="font-family:var(--mono);font-size:1.2rem;color:var(--alerta)">${fmt(t.saldo_centavos)}</strong></span>
        </div>
        <div id="res-barra" style="height:8px;border-radius:99px;background:var(--canvas);margin-top:8px;overflow:hidden">
          <div id="res-barra-cheia" style="height:100%;width:${t.total_centavos ? Math.round((t.pago_centavos / t.total_centavos) * 100) : 0}%;background:var(--ok)"></div>
        </div>
        <p id="res-estado" style="margin:8px 0 0;font-weight:700">${t.saldo_centavos === 0 ? 'QUITADA — pronta para fechar' : `FALTAM ${fmt(t.saldo_centavos)} — a venda NÃO fecha`}</p>
      </div>
      <div id="res-formas" style="margin-bottom:8px"></div>
      <div class="abas" id="formas">
        ${['dinheiro','pix','cartao_debito','cartao_credito','vale_refeicao'].map((f) =>
          `<button class="btn" data-f="${f}">${rotuloFormaHTML(f)}</button>`).join('')}
      </div>
      <p id="msg-forma" style="color:var(--texto-fraco)">Escolha a forma e informe o valor.</p>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap">
        <button class="btn" data-a="exato">Valor exato (${fmt(t.saldo_centavos)})</button>
        <button class="btn" data-a="dividir">Dividir por pessoas</button>
        ${estadoApp.permissoes.pode_dividir_pagar ? `<button class="btn" data-a="gorjeta">Gorjeta</button>` : ''}
        <button class="btn" data-a="combo">${ic('presente')} Aplicar combo</button>
        <button class="btn" data-a="guardar">Guardar</button>
        <button class="btn ghost" data-a="deixar">Deixar aberta</button>
      </div>`);
    let forma = null;
    m.caixa.querySelectorAll('[data-f]').forEach((b) => {
      b.onclick = () => {
        forma = b.dataset.f;
        m.caixa.querySelectorAll('[data-f]').forEach((x) => x.classList.remove('ativa'));
        b.classList.add('ativa');
      };
    });
    m.caixa.querySelector('[data-a="deixar"]').onclick = () => { m.fechar(); resolve('cancelar'); };
    m.caixa.querySelector('[data-a="dividir"]').onclick = () => modalDividirPessoas();
    m.caixa.querySelector('[data-a="gorjeta"]').onclick = async () => { await abrirModalGorjeta(); };
    m.caixa.querySelector('[data-a="guardar"]').onclick = async () => {
      try {
        await post(`/pedidos/${pedido.id}/guardar`, { guardado: true });
        m.fechar(); toast('Venda guardada — retome em Caixa → abertas', 'ok'); resolve('cancelar');
      } catch (e) { toast(e.message, 'erro'); }
    };
    m.caixa.querySelector('[data-a="combo"]').onclick = async () => {
      const r = await seletorCombo(pedido.id);
      if (r) { m.fechar(); resolve({ pedido: r }); }
    };
    m.caixa.querySelector('[data-a="exato"]').onclick = async () => {
      if (!forma) { toast('Escolha a forma de pagamento', 'erro'); return; }
      await registrarPagamentoExato();
    };

    async function registrarPagamentoExato() {
      const valor = pendente;
      await lancarPagamento(forma, valor);
    }

    // Resumo Total/Pago/Falta — única fonte visual do estado da quitação.
    // O servidor recalcula tudo; aqui só exibimos o que ele respondeu.
    const totalFixo = t.total_centavos;
    async function refletirResumo() {
      let pago = totalFixo - pendente;
      let porForma = [];
      try {
        const v = await get(`/pedidos/${pedido.id}`);
        pendente = v.totais.saldo_centavos;
        pago = v.totais.pago_centavos;
        const mapa = {};
        for (const pg of (v.pagamentos ?? []).filter((p) => !p.estornado)) {
          mapa[pg.forma] = (mapa[pg.forma] ?? 0) + pg.valor_centavos;
        }
        porForma = Object.entries(mapa);
      } catch { /* mantém valores locais */ }
      const set = (id, txt) => { const el = m.caixa.querySelector('#' + id); if (el) el.textContent = txt; };
      set('res-pago', fmt(pago));
      set('res-falta', fmt(pendente));
      const barra = m.caixa.querySelector('#res-barra-cheia');
      if (barra) barra.style.width = `${totalFixo ? Math.min(100, Math.round((pago / totalFixo) * 100)) : 0}%`;
      const estado = m.caixa.querySelector('#res-estado');
      if (estado) {
        estado.innerHTML = pendente === 0
          ? 'QUITADA — pronta para fechar'
          : `FALTAM ${fmt(pendente)} — a venda NÃO fecha`;
        estado.style.color = pendente === 0 ? 'var(--ok)' : 'var(--alerta)';
      }
      const box = m.caixa.querySelector('#res-formas');
      if (box) {
        box.innerHTML = porForma.length
          ? `<small style="color:var(--texto-fraco)">Pago em: ${porForma.map(([f, v]) => `${rotuloForma(f)} ${fmt(v)}`).join(' · ')}</small>`
          : '';
      }
      const btnExato = m.caixa.querySelector('[data-a="exato"]');
      if (btnExato) btnExato.textContent = `Valor exato (${fmt(pendente)})`;
    }

    // Lançador único de pagamento (valor aplicado em centavos, validado no servidor).
    // entregueDinheiro: quando o fluxo de troco seguro já sabe quanto o cliente entregou.
    async function lancarPagamento(formaPag, valor, entregueDinheiro) {
      let recebido = null;
      if (formaPag === 'dinheiro') {
        recebido = entregueDinheiro ?? await pedirRecebido(valor);
        if (recebido === null) return false;
      }
      try {
        const corpo = formaPag === 'dinheiro'
          ? { forma: formaPag, valor_centavos: valor, recebido_centavos: recebido }
          : { forma: formaPag, valor_centavos: valor };
        const r = await post(`/pedidos/${pedido.id}/pagamentos`, corpo, { idem: novaIdempotencia('pag') });
        pendente = r.saldo_centavos;
        await refletirResumo();
        toast(`Pagamento ${rotuloForma(formaPag)} registrado. Troco: ${fmt(r.pagamento.troco_centavos)}`, 'ok');
        anunciar(`Pagamento registrado. ${r.saldo_centavos === 0 ? 'Conta quitada.' : `Restam ${fmt(r.saldo_centavos)}.`}`, true);
        if (r.saldo_centavos === 0) {
          m.fechar();
          await finalizar(pedido.id, estadoApp);
          resolve({ saldo_zero: true });
          return true;
        }
        return true;
      } catch (e) { toast(e.message, 'erro'); return false; }
    }

    async function pedirValor() {
      if (forma === 'dinheiro') return pedirDinheiroEntregue(); // troco seguro: pergunta o entregue
      const { numpadConteudo } = await import('../ui.js');
      numpadConteudo({
        monetario: true,
        rotulo: 'Registrar pagamento',
        aoConfirmar: async (reaisTexto) => {
          const valor = reaisParaCentavos(reaisTexto);
          if (valor === null || valor <= 0) { toast('Valor inválido', 'erro'); return; }
          if (valor > pendente) { toast(`Valor excede o pendente (${fmt(pendente)})`, 'erro'); return; }
          await lancarPagamento(forma, valor);
        },
      });
    }

    // TROCO SEGURO (dinheiro): pergunta quanto o cliente ENTREGOU (C).
    // Aplicado à venda = min(C, saldo pendente); o excedente é troco (devolução,
    // nunca receita). Nada é lançado sem confirmação do operador.
    function pedirDinheiroEntregue() {
      import('../ui.js').then(({ numpadConteudo }) => {
        numpadConteudo({
          monetario: true,
          rotulo: 'Dinheiro entregue pelo cliente',
          acaoExtra: { rotulo: `Valor exato (${fmt(pendente)}) — sem troco`, aoClicar: () => confirmarDinheiro(pendente, pendente) },
          aoConfirmar: async (texto) => {
            const entregue = reaisParaCentavos(texto);
            if (entregue === null || entregue <= 0) { toast('Valor inválido', 'erro'); return; }
            await confirmarDinheiro(entregue, Math.min(entregue, pendente));
          },
        });
      });
    }

    async function confirmarDinheiro(entregue, aplicado) {
      const troco = entregue - aplicado;
      const resto = pendente - aplicado;
      const resumo = troco > 0
        ? `Entregue: ${fmt(entregue)} · Aplicado à venda: ${fmt(aplicado)} · Troco devido: ${fmt(troco)}`
        : `Aplicado à venda: ${fmt(aplicado)} · Sem troco${resto > 0 ? ` · Restarão ${fmt(resto)}` : ''}`;
      const ok = await confirmar(
        troco > 0 ? 'Confirmar recebimento em dinheiro' : 'Confirmar pagamento em dinheiro',
        resumo,
      );
      if (!ok) return; // cancelado: nenhum pagamento é lançado
      await lancarPagamento('dinheiro', aplicado, entregue);
    }
    m.caixa.querySelectorAll('[data-f]').forEach((b) => { const antigo = b.onclick; b.onclick = async () => { antigo(); await pedirValor(); }; });

    // Divisão do saldo pendente em N partes exatas (soma = pendente, centavo a centavo).
    function modalDividirPessoas() {
      const total = pendente;
      if (total <= 0) { toast('Nada pendente para dividir', 'erro'); return; }
      const d = modal(`<h2>Dividir ${fmt(total)} por pessoas</h2>
        <p style="color:var(--texto-fraco)">Quantas pessoas vão pagar?</p>
        <div class="numpad" style="grid-template-columns:repeat(6,1fr)">
          ${[2, 3, 4, 5, 6, 7, 8].map((n) => `<button class="btn" data-n="${n}">${n}</button>`).join('')}
        </div>
        <div id="partes" style="margin-top:10px"></div>
        <button class="btn ghost" style="width:100%;margin-top:10px" data-a="voltar">Voltar</button>`);
      d.caixa.querySelector('[data-a="voltar"]').onclick = d.fechar;
      d.caixa.querySelectorAll('[data-n]').forEach((b) => {
        b.onclick = () => mostrarPartes(Number(b.dataset.n));
      });
      async function mostrarPartes(n) {
        const base = Math.floor(total / n);
        const resto = total % n;
        const partes = Array.from({ length: n }, (_, i) => ({
          indice: i + 1, valor: base + (i < resto ? 1 : 0), paga: false,
        }));
        const box = d.caixa.querySelector('#partes');
        async function redesenhar() {
          const v = await get(`/pedidos/${pedido.id}`).catch(() => null);
          if (v) pendente = v.totais.saldo_centavos;
          await refletirResumo();
          box.innerHTML = partes.map((p) => `
            <div class="linha-itens"><span><strong>Pessoa ${p.indice}</strong> — <span style="font-family:var(--mono)">${fmt(p.valor)}</span>
              ${p.paga ? '<span class="badge ok">paga</span>' : ''}</span>
              ${p.paga ? '' : `<span style="display:flex;gap:4px;flex-wrap:wrap">${['dinheiro', 'pix', 'cartao_debito', 'cartao_credito', 'vale_refeicao'].map((f) =>
                `<button class="btn ghost" data-pagar="${p.indice}" data-forma="${f}" style="min-height:40px;padding:4px 8px" title="${f}">${f === 'dinheiro' ? 'Din' : f === 'pix' ? 'PIX' : f === 'cartao_debito' ? 'Déb' : f === 'cartao_credito' ? 'Cré' : 'Vale'}</button>`).join('')}</span>`}
            </div>`).join('');
          box.querySelectorAll('[data-pagar]').forEach((btn) => {
            btn.onclick = async () => {
              const parte = partes.find((x) => x.indice === Number(btn.dataset.pagar));
              if (!parte || parte.paga) return;
              btn.disabled = true;
              const ok = await lancarPagamento(btn.dataset.forma, parte.valor);
              if (ok !== false) {
                parte.paga = true;
                if (pendente === 0) { d.fechar(); return; }
                redesenhar();
              } else { btn.disabled = false; }
            };
          });
        }
        redesenhar();
      }
    }
  });
}

function pedirRecebido(valor) {
  return new Promise((resolve) => {
    import('../ui.js').then(({ numpadConteudo }) => {
      const perguntar = () => numpadConteudo({
        monetario: true,
        rotulo: `Recebido em dinheiro (mín. ${fmt(valor)})`,
        acaoExtra: { rotulo: `Troco exato (${fmt(valor)}, sem troco)`, aoClicar: () => resolve(valor) },
        aoCancelar: () => resolve(null), // fechou sem confirmar: cancela o lançamento
        aoConfirmar: (texto) => {
          const r = reaisParaCentavos(texto);
          if (r === null || r < valor) {
            toast(`Recebido menor que o valor (${fmt(valor)}) — informe novamente ou cancele`, 'erro');
            perguntar(); // pergunta de novo; NÃO registra recebido incorreto
            return;
          }
          resolve(r);
        },
      });
      perguntar();
    });
  });
}

const NOMES_FORMA = { dinheiro: 'Dinheiro', pix: 'PIX', cartao_debito: 'Débito', cartao_credito: 'Crédito', vale_refeicao: 'Vale' };

function rotuloForma(f) {
  return NOMES_FORMA[f] ?? f;
}

function rotuloFormaHTML(f) {
  const icone = { dinheiro: 'cedula', pix: 'raio', cartao_debito: 'cartao', cartao_credito: 'cartao', vale_refeicao: 'ticket' }[f] ?? 'ponto';
  return ic(icone) + ' ' + (NOMES_FORMA[f] ?? f);
}

async function finalizar(pedidoId, estadoApp) {
  try {
    // Conferência final antes de fechar: o servidor é a palavra final.
    const previo = await get(`/pedidos/${pedidoId}/validacao`).catch(() => null);
    if (previo && previo.problemas?.length) {
      toast('Fechamento bloqueado: ' + previo.problemas.join('; '), 'erro');
      return;
    }
    await post(`/pedidos/${pedidoId}/fechar`, {});
  } catch (e) { toast('Erro ao fechar venda: ' + e.message, 'erro'); return; }

  anunciar(`Venda ${pedidoId} fechada e quitada.`, true);
  const bloquear = !!estadoApp.configPublica?.bloquear_apos_venda;
  const bloquearTela = async () => {
    // bloqueio automático configurável (doc A) — só depois de o recibo ser fechado
    const { desconectarWS } = await import('../ws.js');
    const { post: postLogout } = await import('../api.js');
    try { await postLogout('/auth/logout', {}); } catch { /* noop */ }
    desconectarWS();
    location.reload();
  };
  // recibo não fiscal de conferência (falha aqui não desfaz a venda fechada)
  let rec = null;
  try { rec = await post(`/pedidos/${pedidoId}/recibo`, { largura_mm: 80 }); }
  catch { toast('Venda fechada, mas o recibo indisponível — reimprima pelo histórico', 'erro'); }
  if (rec) mostrarRecibo(rec.conteudo, { aoFechar: bloquear ? bloquearTela : null });
  else if (bloquear) await bloquearTela();
}
