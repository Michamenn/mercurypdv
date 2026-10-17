// Venda rápida mobile: lançamento de pedidos otimizado para celular (garçom/caixa em movimento).
// Cria comandas e vendas de balcão/viagem; pagamento segue no PDV/Caixa (permissões).
import { ic } from '../icons.js';
import { get, post, fmt, novaIdempotencia } from '../api.js';
import { toast, modal, confirmar, escapar } from '../ui.js';
import { guardarCatalogo, lerCatalogo } from '../offdb.js';
import { abrirConta } from '../conta.js';
import { aoEstado } from '../ws.js';

import { anunciar } from '../a11y.js';

let catalogo = { categorias: [], produtos: [] };
let carrinho = []; // {produto_id, nome, preco, quantidade, observacoes}
let modalidade = 'balcao'; // balcao | viagem | mesa
let mesaAlvo = null;
let categoriaAtiva = null;
let termoBusca = ''; // preserva a busca entre re-renderizações (foco/scroll não se perdem)
let wsOnline = true; // indicador do WS (visual); o servidor continua sendo a autoridade
let desouvirWs = null;

// Busca sem acento: "pao" encontra "Pão" (filtro local — instantâneo, sem debounce).
const semAcento = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Última linha do produto no carrinho: toques no card alteram essa linha.
function linhaDoProduto(pid) {
  for (let i = carrinho.length - 1; i >= 0; i--) if (carrinho[i].produto_id === pid) return i;
  return -1;
}
function qtdDoProduto(pid) {
  return carrinho.reduce((s, i) => (i.produto_id === pid ? s + i.quantidade : s), 0);
}

const ICONE_TIPO = { lanche: 'lanche', prato: 'prato', porcao: 'fritas', bebida: 'copo', sobremesa: 'sorvete', servico: 'recibo', outro: 'pacote' };

export async function render(conteudo, _sub, estadoApp) {
  carrinho = [];
  // Indicador WS (visual): desabilita "Enviar" quando não há conexão.
  // O servidor continua sendo a autoridade — venda NUNCA acontece sem ele.
  if (!desouvirWs) desouvirWs = aoEstado((online) => { wsOnline = online; refletirConexao(); });
  conteudo.innerHTML = '<div class="skeleton" style="height:120px"></div>';
  try {
    catalogo = await get('/catalogo');
    guardarCatalogo(catalogo).catch(() => {});
  } catch {
    const cache = await lerCatalogo();
    if (cache) { catalogo = cache; toast('Catálogo em cache (sem conexão)', 'erro'); }
    else { conteudo.innerHTML = '<div class="empty-state"><span class="emoji">' + ic('antena') + '</span>Sem conexão e sem cache.</div>'; return; }
  }
  categoriaAtiva = catalogo.categorias[0]?.id ?? null;
  desenhar(conteudo, estadoApp);
}

function total() {
  return carrinho.reduce((s, i) => s + i.preco * i.quantidade, 0);
}

function desenhar(conteudo, estadoApp) {
  const podeBalcao = !!estadoApp.permissoes.pode_vender_balcao;
  const podeMesa = !!estadoApp.permissoes.pode_lancar_comanda;
  if (modalidade === 'balcao' && !podeBalcao) modalidade = podeMesa ? 'mesa' : 'viagem';
  if (modalidade === 'mesa' && !podeMesa) modalidade = 'balcao';
  const qtdItens = carrinho.reduce((s, i) => s + i.quantidade, 0);

  conteudo.innerHTML = `
    <div class="m-view">
    <div class="m-topo" id="m-topo">
      <strong class="m-topo-valor">${fmt(total())}</strong>
      <small class="m-topo-sub">${qtdItens} item(ns)${mesaAlvo ? ` · Mesa ${escapar(String(mesaAlvo.numero))}` : ''}</small>
    </div>
    <div class="m-header-sticky" id="m-header">
      <input id="m-busca" class="m-busca" type="search" inputmode="search" enterkeyhint="search"
        autocomplete="off" autocapitalize="none" spellcheck="false"
        placeholder="Buscar produto ou código…" aria-label="Buscar produto ou código" value="${escapar(termoBusca)}" />
      <div class="abas m-cats" aria-label="Categorias">
        ${catalogo.categorias.map((c) => `<button class="btn ${c.id === categoriaAtiva ? 'ativa' : ''}" data-cat="${c.id}">${escapar(c.nome)}</button>`).join('')}
      </div>
    </div>
    <div class="m-corpo">
      <div id="m-grid" class="m-grid"></div>
      <div id="mesa-box"></div>
    </div>

    <nav class="m-tabbar" aria-label="Ações do pedido">
      ${podeBalcao ? `<button class="btn m-tab ${modalidade === 'balcao' ? 'ativa' : ''}" data-mod="balcao" title="Balcão" aria-label="Venda balcão">${ic('recibo')}</button>` : ''}
      ${podeBalcao ? `<button class="btn m-tab ${modalidade === 'viagem' ? 'ativa' : ''}" data-mod="viagem" title="Viagem" aria-label="Viagem">${ic('marmita')}</button>` : ''}
      ${podeMesa ? `<button class="btn m-tab ${modalidade === 'mesa' ? 'ativa' : ''}" data-mod="mesa" title="Mesa" aria-label="Lançar em mesa">${ic('mesa')}</button>` : ''}
      <span class="m-tab-sep" aria-hidden="true"></span>
      <button class="btn m-tab m-tab-ver" id="m-ver" title="Ver carrinho" aria-label="Ver carrinho" ${carrinho.length ? '' : 'disabled'}>
        ${ic('carrinho')}<span class="m-tab-ver-total" data-papel="tab-total">${fmt(total())}</span>${qtdItens ? `<span class="m-badge" data-papel="tab-badge" aria-hidden="true">${qtdItens}</span>` : ''}
      </button>
      <button class="btn m-tab m-tab-enviar" id="m-enviar" data-papel="enviar" title="Enviar pedido" aria-label="Enviar pedido" ${carrinho.length ? '' : 'disabled'}>${ic('check')}</button>
    </nav>
    </div>`;

  conteudo.querySelectorAll('[data-mod]').forEach((b) => {
    b.onclick = () => {
      const antes = modalidade;
      modalidade = b.dataset.mod; mesaAlvo = null; desenhar(conteudo, estadoApp);
      if (antes !== 'mesa' && modalidade === 'mesa') {
        // leva o operador até a seleção de mesas (fica abaixo dos produtos)
        setTimeout(() => conteudo.querySelector('#mesa-box')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 350);
      }
    };
  });
  conteudo.querySelectorAll('[data-cat]').forEach((b) => {
    b.onclick = () => { categoriaAtiva = Number(b.dataset.cat); desenhar(conteudo, estadoApp); };
  });
  const busca = conteudo.querySelector('#m-busca');
  busca.oninput = () => { termoBusca = busca.value; grade(conteudo.querySelector('#m-grid'), termoBusca, conteudo, estadoApp); };
  grade(conteudo.querySelector('#m-grid'), termoBusca, conteudo, estadoApp);
  const boxMesa = conteudo.querySelector('#mesa-box');
  if (modalidade === 'mesa') seletorMesa(boxMesa, conteudo, estadoApp); else boxMesa.innerHTML = '';
  conteudo.querySelector('#m-ver').onclick = () => verCarrinho(conteudo, estadoApp);
  conteudo.querySelector('#m-enviar').onclick = () => enviar(conteudo, estadoApp);
  refletirConexao();
}

// Atualiza só o que depende do carrinho (total, badge, rodapés dos cards,
// Enviar) — sem re-renderizar a tela: a busca mantém o foco e o scroll.
function refletirCarrinho(conteudo) {
  const qtdItens = carrinho.reduce((s, i) => s + i.quantidade, 0);
  const t = total();
  const topo = conteudo.querySelector('#m-topo');
  if (topo) {
    topo.querySelector('.m-topo-valor').textContent = fmt(t);
    topo.querySelector('.m-topo-sub').textContent = `${qtdItens} item(ns)${mesaAlvo ? ` · Mesa ${escapar(String(mesaAlvo.numero))}` : ''}`;
  }
  const ver = conteudo.querySelector('#m-ver');
  if (ver) {
    ver.disabled = !carrinho.length;
    const tot = ver.querySelector('[data-papel="tab-total"]');
    if (tot) tot.textContent = fmt(t);
    let badge = ver.querySelector('[data-papel="tab-badge"]');
    if (qtdItens) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'm-badge';
        badge.dataset.papel = 'tab-badge';
        badge.setAttribute('aria-hidden', 'true');
        ver.appendChild(badge);
      }
      badge.textContent = qtdItens;
    } else if (badge) badge.remove();
  }
  conteudo.querySelectorAll('[data-card]').forEach((card) => {
    const rodape = card.querySelector('.m-prod-rodape');
    rodape.innerHTML = htmlRodapeCard(Number(card.dataset.card));
    ligarRodape(rodape, conteudo);
  });
  refletirConexao();
}

// Liga o stepper do rodapé do card (−/+, observação) — usado na grade e nas
// atualizações parciais do refletirCarrinho (innerHTML novo exige rebind).
function ligarRodape(el, conteudo) {
  el.querySelectorAll('.btn').forEach((b) => {
    b.onclick = (ev) => {
      ev.stopPropagation();
      if (b.dataset.inc !== undefined) adicionarRapido(Number(b.dataset.inc), conteudo);
      else if (b.dataset.dec !== undefined) diminuirProduto(Number(b.dataset.dec), conteudo);
      else if (b.dataset.obs !== undefined) folhaProduto(Number(b.dataset.obs), conteudo);
    };
  });
}

// Botões "Enviar" refletem o estado do WS: desabilitados (mas visíveis)
// quando não há conexão — o servidor permanece a única autoridade da venda.
function refletirConexao() {
  document.querySelectorAll('[data-papel="enviar"]').forEach((btn) => {
    btn.disabled = !carrinho.length || !wsOnline;
    const rotulo = wsOnline ? 'Enviar pedido' : 'Enviar pedido (sem conexão — aguardando servidor)';
    btn.title = rotulo;
    btn.setAttribute('aria-label', rotulo);
  });
}

// Rodapé do card: stepper −/+ e observação — só existe com o produto no carrinho.
function htmlRodapeCard(pid) {
  const q = qtdDoProduto(pid);
  if (!q) return '';
  return `
    <button class="btn" data-dec="${pid}" aria-label="Diminuir quantidade">−</button>
    <span class="m-prod-qtd" aria-label="Quantidade no carrinho: ${q}">${q}</span>
    <button class="btn" data-inc="${pid}" aria-label="Aumentar quantidade">＋</button>
    <button class="btn" data-obs="${pid}" aria-label="Observação ou acréscimo">${ic('lapis')}</button>`;
}

function grade(el, termo, conteudo, estadoApp) {
  const t = semAcento(termo.trim());
  const lista = catalogo.produtos.filter((p) =>
    (!categoriaAtiva || p.categoria_id === categoriaAtiva) &&
    (!t || semAcento(p.nome).includes(t) || semAcento(p.apelidos).includes(t)));
  
  el.innerHTML = lista.map((p) => `
    <div class="m-prod-card" data-card="${p.id}">
      <button class="btn m-prod" data-p="${p.id}" ${p.disponivel ? '' : 'disabled'} aria-label="${escapar(p.nome)}, ${fmt(p.preco_centavos)}${p.disponivel ? '. Toque para adicionar' : '. Indisponível'}">
        <span class="thumb" aria-hidden="true">${ic(ICONE_TIPO[p.tipo_item] ?? 'prato')}</span>
        <span class="info">
          <span class="nome">${escapar(p.nome)}</span>
          <span class="preco">${fmt(p.preco_centavos)}</span>
          ${p.disponivel ? '' : `<span class="indisponivel">${ic('proibido')} ${escapar((p.indisponibilidade_motivo ?? 'indisponível').slice(0, 20))}</span>`}
        </span>
        <span class="add-sign" aria-hidden="true">＋</span>
      </button>
      <div class="m-prod-rodape">${htmlRodapeCard(p.id)}</div>
    </div>`).join('') || '<div class="empty-state"><span class="emoji">' + ic('lupa') + '</span>Nenhum produto encontrado.</div>';
  el.querySelectorAll('.m-prod').forEach((b) => {
    b.onclick = () => adicionarRapido(Number(b.dataset.p), conteudo);
  });
  ligarRodape(el, conteudo);
}

// Toque no card = +1 (última linha do produto ou linha nova). Sem modal.
// A idempotência real é no envio (Idempotency-Key) — aqui é só estado visual.
function adicionarRapido(pid, conteudo) {
  const p = catalogo.produtos.find((x) => x.id === pid);
  if (!p || !p.disponivel) return;
  const ix = linhaDoProduto(pid);
  if (ix >= 0) { if (carrinho[ix].quantidade < 99) carrinho[ix].quantidade++; }
  else carrinho.push({ produto_id: p.id, nome: p.nome, preco: p.preco_centavos, quantidade: 1, observacoes: null });
  refletirCarrinho(conteudo);
  pulsarBadge(conteudo);
  anunciar(`${p.nome}: ${qtdDoProduto(pid)} no carrinho. Total ${fmt(total())}`);
}

function diminuirProduto(pid, conteudo) {
  const ix = linhaDoProduto(pid);
  if (ix < 0) return;
  if (carrinho[ix].quantidade > 1) carrinho[ix].quantidade--;
  else carrinho.splice(ix, 1);
  refletirCarrinho(conteudo);
  anunciar(`Total ${fmt(total())}`);
}

// Pulso no badge do carrinho: feedback imediato de "entrou no pedido".
function pulsarBadge(conteudo) {
  const badge = conteudo.querySelector('[data-papel="tab-badge"]');
  if (!badge) return;
  badge.classList.remove('pulsa');
  void badge.offsetWidth; // reinicia a animação
  badge.classList.add('pulsa');
}

// Bottom-sheet do item: quantidade e observação/acréscimo (sem prompt()).
// Edita a linha indicada, a última do produto, ou cria uma nova.
function folhaProduto(pid, conteudo, linhaAlvo = -1, aoMudar = null) {
  const p = catalogo.produtos.find((x) => x.id === pid);
  if (!p || !p.disponivel) return;
  const ix = linhaAlvo >= 0 ? linhaAlvo : linhaDoProduto(pid);
  const linha = ix >= 0 ? carrinho[ix] : null;
  let qtd = linha ? linha.quantidade : 1;
  const m = modal(`<h2>${escapar(p.nome)}</h2>
    <p style="font-family:var(--mono);font-size:1.3rem;color:var(--ok);margin:0">${fmt(p.preco_centavos)}</p>
    <div class="m-carrinho-acoes" style="justify-content:center;margin-top:var(--space-3)">
      <button class="btn" data-q="-1" aria-label="Diminuir quantidade">−</button>
      <strong data-papel="qtd" style="font-size:1.4rem;min-width:48px;text-align:center" aria-live="polite">${qtd}</strong>
      <button class="btn" data-q="1" aria-label="Aumentar quantidade">＋</button>
    </div>
    <label class="campo-titulo" for="m-obs" style="margin-top:var(--space-3)">Observação / acréscimo (opcional)</label>
    <input id="m-obs" class="campo" maxlength="200" autocomplete="off" placeholder="Ex.: sem cebola, bem passado…" value="${escapar(linha?.observacoes ?? '')}" />
    <button class="btn primario grande btn-full-lg" data-a="ok">${linha ? 'Salvar' : 'Adicionar'}</button>
    <button class="btn ghost btn-full" data-a="voltar">Voltar</button>`, { folha: true });
  m.caixa.querySelectorAll('[data-q]').forEach((b) => {
    b.onclick = () => {
      qtd = Math.min(99, Math.max(1, qtd + Number(b.dataset.q)));
      m.caixa.querySelector('[data-papel="qtd"]').textContent = qtd;
    };
  });
  m.caixa.querySelector('[data-a="voltar"]').onclick = m.fechar;
  m.caixa.querySelector('[data-a="ok"]').onclick = () => {
    const obs = m.caixa.querySelector('#m-obs').value.trim() || null;
    if (linha) { linha.quantidade = qtd; linha.observacoes = obs; }
    else carrinho.push({ produto_id: p.id, nome: p.nome, preco: p.preco_centavos, quantidade: qtd, observacoes: obs });
    m.fechar();
    refletirCarrinho(conteudo);
    pulsarBadge(conteudo);
    aoMudar?.();
  };
}

async function seletorMesa(box, conteudo, estadoApp) {
  try {
    const mesas = await get('/mesas');
    const livres = mesas.filter((m) => m.status === 'livre' && !m.bloqueada);
    const ocupadas = mesas.filter((m) => m.status !== 'livre');
    box.innerHTML = `
      <div class="m-mesas-wrap">
        <span class="badge">Mesas</span>
        <div class="m-mesas">
          ${livres.map((m) => `<button class="btn m-mesa ${mesaAlvo?.id === m.id ? 'selecionada' : ''}" data-ml="${m.id}" aria-label="Mesa ${m.numero} livre">${ic('mesa')}<span>${m.numero}</span></button>`).join('')}
          ${ocupadas.map((m) => `<button class="btn m-mesa ocupada ${mesaAlvo?.id === m.id ? 'selecionada' : ''}" data-mo="${m.id}" aria-label="Mesa ${m.numero} ocupada">${ic('mesa')}<span>${m.numero}</span><span class="m-mesa-dot" aria-hidden="true"></span></button>`).join('')}
        </div>
      </div>`;
    box.querySelectorAll('[data-ml]').forEach((b) => {
      b.onclick = () => {
        const numero = b.getAttribute('aria-label').match(/Mesa (\d+)/)?.[1] ?? '';
        const dlg = modal(`<h2>Mesa ${escapar(numero)}</h2>
          <label class="campo-titulo" for="m-cliente">Nome do cliente (opcional)</label>
          <input id="m-cliente" class="campo" placeholder="Nome do cliente" maxlength="60" autocomplete="off" />
          <div class="modal-acoes">
            <button class="btn ghost" data-a="pular">Pular</button>
            <button class="btn primario" data-a="ok">Abrir mesa</button>
          </div>`);
        const abrir = (nome) => {
          post(`/mesas/${b.dataset.ml}/comanda`, { cliente: nome.trim() })
            .then(async (p) => {
              const lista = await get('/mesas');
              mesaAlvo = { id: Number(b.dataset.ml), numero: lista.find((x) => x.id === Number(b.dataset.ml))?.numero, pedido_id: p.id, nova: true };
              dlg.fechar(); desenhar(conteudo, estadoApp);
            })
            .catch((e) => toast(e.message, 'erro'));
        };
        dlg.caixa.querySelector('[data-a="ok"]').onclick = () => abrir(dlg.caixa.querySelector('#m-cliente').value);
        dlg.caixa.querySelector('[data-a="pular"]').onclick = () => abrir('');
        dlg.caixa.querySelector('#m-cliente').onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); abrir(ev.target.value); } };
        dlg.caixa.querySelector('#m-cliente').focus();
      };
    });
    box.querySelectorAll('[data-mo]').forEach((b) => {
      b.onclick = async () => {
        try {
          const abertos = await get('/pedidos/abertos');
          const ped = abertos.find((x) => x.mesa_id === Number(b.dataset.mo));
          if (!ped) { toast('Comanda não encontrada', 'erro'); return; }
          const lista = await get('/mesas');
          mesaAlvo = { id: Number(b.dataset.mo), numero: lista.find((x) => x.id === Number(b.dataset.mo))?.numero, pedido_id: ped.id };
          desenhar(conteudo, estadoApp);
        } catch (e) { toast(e.message, 'erro'); }
      };
    });
  } catch { box.innerHTML = ''; }
}

// Swipe-left para remover (atalho tátil). Só captura quando o gesto é
// claramente horizontal — o scroll vertical segue nativo. O botão da
// lixeira continua sendo o caminho acessível (o gesto nunca é único).
function ligarSwipe(inner, aoRemover) {
  let x0 = null, y0 = null, dx = 0, travado = false, suprimir = false;
  inner.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return; // desktop/teclado usam o botão
    x0 = e.clientX; y0 = e.clientY; dx = 0; travado = false;
    inner.classList.remove('rolando'); inner.style.transform = '';
  });
  inner.addEventListener('pointermove', (e) => {
    if (x0 === null) return;
    const ddx = e.clientX - x0, ddy = e.clientY - y0;
    if (!travado) {
      if (Math.abs(ddx) > 12 && Math.abs(ddx) > Math.abs(ddy) * 1.2) {
        travado = true;
        try { inner.setPointerCapture(e.pointerId); } catch { /* captura opcional */ }
      } else if (Math.abs(ddy) > 12) { x0 = null; return; } // scroll vertical: entrega ao navegador
    }
    if (travado) { dx = Math.min(0, ddx); inner.style.transform = `translateX(${dx}px)`; }
  });
  const soltar = () => {
    if (x0 === null) return;
    inner.classList.add('rolando');
    if (Math.abs(dx) > 12) suprimir = true; // o gesto não vira clique em botão
    if (dx <= -96) aoRemover();
    else inner.style.transform = '';
    x0 = null; dx = 0; travado = false;
  };
  inner.addEventListener('pointerup', soltar);
  inner.addEventListener('pointercancel', () => { inner.classList.add('rolando'); inner.style.transform = ''; x0 = null; dx = 0; travado = false; });
  inner.addEventListener('click', (e) => { if (suprimir) { suprimir = false; e.stopPropagation(); e.preventDefault(); } }, true);
}

// Carrinho em bottom-sheet: steppers por linha, observação, botão remover
// (acessível) + swipe como atalho. "Enviar" fecha a folha e chama o fluxo
// existente — idempotente e validado no servidor (fonte de verdade).
function verCarrinho(conteudo, estadoApp) {
  const m = modal(`<h2>${ic('carrinho')} Carrinho</h2>
    <div class="m-carrinho-lista" id="folha-lista"></div>
    <p style="text-align:right;font-size:1.3rem;margin-bottom:0">Total: <strong data-papel="folha-total" style="font-family:var(--mono);color:var(--ok)">${fmt(total())}</strong></p>
    <button class="btn primario grande btn-full-lg" data-papel="enviar" data-a="enviar" ${carrinho.length ? '' : 'disabled'}>Enviar pedido</button>
    <button class="btn btn-full" data-a="conta" ${carrinho.length ? '' : 'disabled'}>${ic('recibo')} Conta</button>
    <button class="btn ghost btn-full" data-a="voltar">Continuar vendendo</button>`, { folha: true });
  const listaEl = m.caixa.querySelector('#folha-lista');

  function renderLista() {
    if (!carrinho.length) {
      listaEl.innerHTML = '<div class="empty-state"><span class="emoji">' + ic('carrinho') + '</span>Carrinho vazio — toque nos produtos para adicionar.</div>';
      return;
    }
    listaEl.innerHTML = carrinho.map((i, ix) => `
      <div class="m-carrinho-linha" data-linha="${ix}">
        <div class="m-carrinho-inner">
          <span class="m-carrinho-info">
            <span class="m-carrinho-nome">${escapar(i.nome)}</span>
            ${i.observacoes ? `<span class="m-carrinho-obs">${ic('lapis')} ${escapar(i.observacoes)}</span>` : ''}
            <strong class="m-carrinho-valor">${fmt(i.preco * i.quantidade)}</strong>
          </span>
          <span class="m-carrinho-acoes">
            <button class="btn" data-cdec="${ix}" aria-label="Diminuir ${escapar(i.nome)}">−</button>
            <span class="m-qtd" aria-label="Quantidade: ${i.quantidade}">${i.quantidade}</span>
            <button class="btn" data-cinc="${ix}" aria-label="Aumentar ${escapar(i.nome)}">＋</button>
            <button class="btn" data-cobs="${ix}" aria-label="Observação de ${escapar(i.nome)}">${ic('lapis')}</button>
            <button class="btn" data-crm="${ix}" aria-label="Remover ${escapar(i.nome)} do carrinho">${ic('lixeira')}</button>
          </span>
        </div>
      </div>`).join('') + `<p class="m-carrinho-dica">${ic('troca')} Deslize um item para a esquerda para remover — ou use a lixeira.</p>`;
    listaEl.querySelectorAll('.m-carrinho-inner').forEach((inner) => {
      ligarSwipe(inner, () => {
        carrinho.splice(Number(inner.closest('[data-linha]').dataset.linha), 1);
        aposMudanca();
        anunciar('Item removido do carrinho');
      });
    });
    listaEl.querySelectorAll('[data-cinc]').forEach((b) => {
      b.onclick = () => { const ix = Number(b.dataset.cinc); if (carrinho[ix].quantidade < 99) carrinho[ix].quantidade++; aposMudanca(); };
    });
    listaEl.querySelectorAll('[data-cdec]').forEach((b) => {
      b.onclick = () => {
        const ix = Number(b.dataset.cdec);
        if (carrinho[ix].quantidade > 1) carrinho[ix].quantidade--;
        else carrinho.splice(ix, 1);
        aposMudanca();
      };
    });
    listaEl.querySelectorAll('[data-cobs]').forEach((b) => {
      b.onclick = () => {
        const ix = Number(b.dataset.cobs);
        folhaProduto(carrinho[ix].produto_id, conteudo, ix, aposMudanca);
      };
    });
    listaEl.querySelectorAll('[data-crm]').forEach((b) => {
      b.onclick = () => { carrinho.splice(Number(b.dataset.crm), 1); aposMudanca(); anunciar('Item removido do carrinho'); };
    });
  }

  function aposMudanca() {
    renderLista();
    m.caixa.querySelector('[data-papel="folha-total"]').textContent = fmt(total());
    refletirCarrinho(conteudo);
  }

  renderLista();
  m.caixa.querySelector('[data-a="voltar"]').onclick = m.fechar;
  m.caixa.querySelector('[data-a="enviar"]').onclick = () => { m.fechar(); enviar(conteudo, estadoApp); };
  const btnConta = m.caixa.querySelector('[data-a="conta"]');
  if (btnConta) btnConta.onclick = () => abrirConta({
    titulo: 'Venda rápida',
    subtitulo: modalidade === 'viagem' ? 'Para viagem' : '',
    itens: carrinho.map((i) => ({ quantidade: i.quantidade, nome: i.nome, detalhe: i.observacoes || '', unit_centavos: i.preco, total_centavos: i.preco * i.quantidade })),
    totais: { total_centavos: total() },
  });
  refletirConexao(); // o Enviar da folha também reflete o estado do WS
}

async function enviar(conteudo, estadoApp) {
  if (!carrinho.length) return;
  if (!wsOnline) { toast('Sem conexão com o servidor — a venda é registrada somente online.', 'erro'); refletirConexao(); return; }
  const itens = carrinho.map((i) => ({ produto_id: i.produto_id, quantidade: i.quantidade, observacoes: i.observacoes }));
  try {
    if (modalidade === 'mesa') {
      if (!mesaAlvo?.pedido_id) { toast('Escolha a mesa primeiro', 'erro'); return; }
      for (const it of itens) {
        await post(`/pedidos/${mesaAlvo.pedido_id}/itens`, it, { idem: novaIdempotencia('mob') });
      }
      await post(`/pedidos/${mesaAlvo.pedido_id}/encaminhar`, {});
      toast(`Enviado à cozinha — Mesa ${mesaAlvo.numero}`, 'ok');
    } else {
      const pedido = await post('/pedidos/balcao', { itens, canal: modalidade === 'viagem' ? 'viagem' : 'salao' }, { idem: novaIdempotencia('mobv') });
      await post(`/pedidos/${pedido.id}/encaminhar`, {}).catch(() => {});
      const ok = await confirmar('Pedido enviado!', `Comanda #${pedido.numero_dia ?? pedido.id} · Total ${fmt(pedido.totais.total_centavos)}. Pagamento no caixa/PDV. Novo pedido?`);
      void ok;
    }
    carrinho = [];
    desenhar(conteudo, estadoApp);
  } catch (e) { toast(e.message, 'erro'); }
}
