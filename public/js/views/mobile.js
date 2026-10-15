// Venda rápida mobile: lançamento de pedidos otimizado para celular (garçom/caixa em movimento).
// Cria comandas e vendas de balcão/viagem; pagamento segue no PDV/Caixa (permissões).
import { ic } from '../icons.js';
import { get, post, fmt, novaIdempotencia } from '../api.js';
import { toast, modal, confirmar, escapar } from '../ui.js';
import { guardarCatalogo, lerCatalogo } from '../offdb.js';

let catalogo = { categorias: [], produtos: [] };
let carrinho = []; // {produto_id, nome, preco, quantidade, observacoes}
let modalidade = 'balcao'; // balcao | viagem | mesa
let mesaAlvo = null;
let categoriaAtiva = null;

const ICONE_TIPO = { lanche: 'lanche', prato: 'prato', porcao: 'fritas', bebida: 'copo', sobremesa: 'sorvete', servico: 'recibo', outro: 'pacote' };

export async function render(conteudo, _sub, estadoApp) {
  carrinho = [];
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
    <div class="m-topo" id="m-topo">
      <strong class="m-topo-valor">${fmt(total())}</strong>
      <small class="m-topo-sub">${qtdItens} item(ns)${mesaAlvo ? ` · Mesa ${escapar(String(mesaAlvo.numero))}` : ''}</small>
    </div>
    <div class="m-header-sticky" id="m-header">
      <input id="m-busca" class="m-busca" placeholder="Buscar produto…" aria-label="Buscar produto" />
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
      <button class="btn m-tab" id="m-ver" title="Ver carrinho" aria-label="Ver carrinho" ${carrinho.length ? '' : 'disabled'}>
        ${ic('carrinho')}${qtdItens ? `<span class="m-badge" aria-hidden="true">${qtdItens}</span>` : ''}
      </button>
      <button class="btn m-tab m-tab-enviar" id="m-enviar" title="Enviar pedido" aria-label="Enviar pedido" ${carrinho.length ? '' : 'disabled'}>${ic('check')}</button>
    </nav>`;

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
  busca.oninput = () => grade(conteudo.querySelector('#m-grid'), busca.value.trim().toLowerCase(), conteudo, estadoApp);
  grade(conteudo.querySelector('#m-grid'), '', conteudo, estadoApp);
  const boxMesa = conteudo.querySelector('#mesa-box');
  if (modalidade === 'mesa') seletorMesa(boxMesa, conteudo, estadoApp); else boxMesa.innerHTML = '';
  conteudo.querySelector('#m-ver').onclick = () => verCarrinho(conteudo, estadoApp);
  conteudo.querySelector('#m-enviar').onclick = () => enviar(conteudo, estadoApp);
}

function grade(el, termo, conteudo, estadoApp) {
  const lista = catalogo.produtos.filter((p) =>
    (!categoriaAtiva || p.categoria_id === categoriaAtiva) &&
    (!termo || p.nome.toLowerCase().includes(termo) || (p.apelidos ?? '').toLowerCase().includes(termo)));
  
  el.innerHTML = lista.map((p) => `
    <button class="btn m-prod" data-p="${p.id}" ${p.disponivel ? '' : 'disabled'}>
      <span class="thumb" aria-hidden="true">${ic(ICONE_TIPO[p.tipo_item] ?? 'prato')}</span>
      <span class="info">
        <span class="nome">${escapar(p.nome)}</span>
        <span class="preco">${fmt(p.preco_centavos)}</span>
        ${p.disponivel ? '' : `<span class="indisponivel">${ic('proibido')} ${escapar((p.indisponibilidade_motivo ?? 'indisponível').slice(0, 20))}</span>`}
      </span>
      <span class="add-sign" aria-hidden="true">＋</span>
    </button>`).join('') || '<div class="empty-state"><span class="emoji">' + ic('lupa') + '</span>Nenhum produto encontrado.</div>';
  el.querySelectorAll('[data-p]').forEach((b) => {
    b.onclick = () => abrirQtd(Number(b.dataset.p), conteudo, estadoApp);
  });
}

function abrirQtd(produtoId, conteudo, estadoApp) {
  const p = catalogo.produtos.find((x) => x.id === produtoId);
  if (!p || !p.disponivel) return;
  let qtd = 1;
  const m = modal(`<h2>${escapar(p.nome)}</h2>
    <p style="font-family:var(--mono);font-size:1.3rem;color:var(--ok);margin:0">${fmt(p.preco_centavos)}</p>
    <div class="card-produto"><div class="qtd" style="width:100%;justify-content:center">
      <button class="btn" data-q="-1" aria-label="Diminuir">−</button>
      <strong id="qtd" style="font-size:1.4rem;min-width:48px;text-align:center">1</strong>
      <button class="btn" data-q="1" aria-label="Aumentar">＋</button>
    </div></div>
    <input id="obs" class="campo campo-mt" placeholder="Observação (opcional)" />
    <button class="btn primario grande btn-full-lg" data-a="ok">Adicionar</button>`);
  m.caixa.querySelectorAll('[data-q]').forEach((b) => {
    b.onclick = () => {
      qtd = Math.min(99, Math.max(1, qtd + Number(b.dataset.q)));
      m.caixa.querySelector('#qtd').textContent = qtd;
    };
  });
  m.caixa.querySelector('[data-a="ok"]').onclick = () => {
    carrinho.push({ produto_id: p.id, nome: p.nome, preco: p.preco_centavos, quantidade: qtd, observacoes: m.caixa.querySelector('#obs').value.trim() || null });
    m.fechar(); desenhar(conteudo, estadoApp);
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

function verCarrinho(conteudo, estadoApp) {
  const m = modal(`<h2>${ic('recibo')} Carrinho (${carrinho.reduce((s, i) => s + i.quantidade, 0)})</h2>
    <div style="max-height:44vh;overflow:auto">
    ${carrinho.map((i, ix) => `<div class="linha-itens"><span>${i.quantidade}× ${escapar(i.nome)}${i.observacoes ? `<br><small style="color:var(--amarelo)">${ic('lapis')} ${escapar(i.observacoes)}</small>` : ''}</span>
      <span style="display:flex;gap:6px;align-items:center"><strong style="font-family:var(--mono)">${fmt(i.preco * i.quantidade)}</strong>
      <button class="btn ghost" data-rm="${ix}" aria-label="Remover">${ic('x')}</button></span></div>`).join('')}
    </div>
    <p style="text-align:right;font-size:1.3rem">Total: <strong style="font-family:var(--mono);color:var(--ok)">${fmt(total())}</strong></p>
    <button class="btn ghost" style="width:100%" data-a="c">Voltar</button>`);
  m.caixa.querySelector('[data-a="c"]').onclick = m.fechar;
  m.caixa.querySelectorAll('[data-rm]').forEach((b) => {
    b.onclick = () => { carrinho.splice(Number(b.dataset.rm), 1); m.fechar(); desenhar(conteudo, estadoApp); };
  });
}

async function enviar(conteudo, estadoApp) {
  if (!carrinho.length) return;
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
