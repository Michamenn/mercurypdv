// Painel administrativo: catálogo, usuários, config, relatórios, backups, auditoria, dev, tema, combos
import { ic } from '../icons.js';
import { get, post, put, del, fmt, reaisParaCentavos } from '../api.js';
import { toast, modal, confirmar, escapar } from '../ui.js';
import { opcoesImpressao, montarCupomHTML, aplicarPaginaBobina } from '../recibo.js';
// Nota: `renderThemeConfig` continua exportado por theme.js (não foi removido),
// mas a aba "Aparência" passou a usar a central unificada de personalização.
import { render as renderCombos } from './combos.js';
import { exportarRelatorioPDF, exportarVendasPDF, baixarPDF } from '../pdfExport.js';
import { qrcodeSVG } from '../qrcode.js';

// Categorias do painel administrativo (P-04).
// NENHUMA aba é removida: as 13 telas continuam existindo, apenas passam a
// ficar agrupadas. Os hashes (#admin/<id>) seguem idênticos, então links e
// marcadores antigos continuam abrindo a tela correta.
const CATEGORIAS_ADMIN = [
  {
    id: 'operacao', rotulo: 'Operação', icone: 'prato',
    abas: [
      ['produtos', 'lanche', 'Produtos', 'pode_gerenciar_produtos', 'Cadastrar itens, preços e ficha técnica'],
      ['combos', 'presente', 'Combos', 'pode_gerenciar_combos', 'Combos, promoções e brinde'],
      ['estoque', 'pacote', 'Estoque', 'pode_estoque_gerenciar', 'Insumos, lotes, inventário e barris'],
    ],
  },
  {
    id: 'financeiro', rotulo: 'Financeiro', icone: 'dinheiro',
    abas: [
      ['relatorios', 'grafico', 'Relatórios', 'pode_ver_relatorios', 'Faturamento, formas de pagamento e top produtos'],
      ['salao', 'casa', 'Fechamento de salão', 'pode_ver_relatorios', 'Comandas por garçom e assinatura'],
      ['comissoes', 'pessoas', 'Comissões', 'pode_ver_relatorios', 'Gorjeta e comissão de cada garçom'],
    ],
  },
  {
    id: 'pessoas', rotulo: 'Pessoas', icone: 'pessoas',
    abas: [
      ['usuarios', 'chave', 'Usuários', 'pode_gerenciar_usuarios', 'Contas, credenciais e desbloqueio'],
      ['sessoes', 'antena', 'Sessões ativas', 'pode_gerenciar_usuarios', 'Logados via web e celular, com IP e desconexão'],
      ['permissoes', 'cadeado', 'Permissões', 'pode_config_sistema', 'O que cada cargo pode fazer'],
    ],
  },
  {
    id: 'sistema', rotulo: 'Sistema', icone: 'engrenagem',
    abas: [
      ['config', 'engrenagem', 'Configurações', 'pode_config_sistema', 'Empresa, módulos, salão e taxa de serviço'],
      ['impressao', 'impressora', 'Impressão', 'pode_config_sistema', 'Impressoras térmicas 58/80mm com pré-visualização'],
      ['tema', 'paleta', 'Aparência', 'pode_config_sistema', 'Tema, cores, densidade e navegação'],
      ['backups', 'disquete', 'Backups', 'pode_backup', 'Cópias de segurança e restauração'],
      ['auditoria', 'lupa', 'Auditoria', 'pode_gerenciar_usuarios', 'Histórico de operações sensíveis'],
      ['dev', 'ferramentas', 'Suporte técnico', 'pode_painel_dev', 'Diagnóstico, dispositivos e Cloud AWS'],
    ],
  },
];

const TELAS_ADMIN = {
  relatorios: telaRelatorios,
  salao: telaFechamentoSalao,
  comissoes: telaComissoes,
  produtos: telaProdutos,
  combos: (painel, estadoApp) => renderCombos(painel, null, estadoApp),
  estoque: telaEstoque,
  usuarios: telaUsuarios,
  sessoes: telaSessoes,
  permissoes: telaPermissoes,
  config: telaConfig,
  impressao: telaImpressao,
  tema: telaTema,
  backups: telaBackups,
  auditoria: telaAuditoria,
  dev: telaDev,
};

export async function render(conteudo, sub, estadoApp) {
  // Só as abas cuja permissão o usuário possui aparecem.
  const categorias = CATEGORIAS_ADMIN
    .map((c) => ({ ...c, abas: c.abas.filter(([, , , perm]) => estadoApp.permissoes[perm]) }))
    .filter((c) => c.abas.length > 0);

  const todas = categorias.flatMap((c) => c.abas);
  const info = (id) => todas.find(([aid]) => aid === id);
  const guiaAtiva = sub && info(sub) ? sub : (todas[0]?.[0] ?? 'relatorios');
  const categoriaAtiva = categorias.find((c) => c.abas.some(([id]) => id === guiaAtiva));

  const opcoes = todas.map(([id, icone, rotulo, , desc]) => ({ id, icone, rotulo, desc }));

  conteudo.innerHTML = `
    <div class="admin-barra">
      <div class="admin-busca">
        <label class="sr-only" for="busca-admin">Buscar nas configurações</label>
        ${ic('lupa')}
        <input id="busca-admin" type="search" autocomplete="off" placeholder="Buscar uma tela… (ex.: taxa, backup, garçom)" />
      </div>
    </div>

    <div id="admin-nav"></div>

    <div id="painel-admin"></div>
    <p id="admin-rodape" class="sr-only" role="status" aria-live="polite"></p>`;

  const nav = conteudo.querySelector('#admin-nav');
  const painel = conteudo.querySelector('#painel-admin');
  const rodape = conteudo.querySelector('#admin-rodape');
  const busca = conteudo.querySelector('#busca-admin');

  // Desenha a navegação. Sem busca, mostra apenas as abas da categoria ativa
  // (antes as 13 telas ficavam sempre visíveis e ocupavam 71% da tela antes
  // de qualquer conteúdo). Com busca, mostra todas as que casarem.
  const desenharNav = (filtro = '') => {
    const termo = filtro.trim().toLowerCase();
    const casa = ([id, , rotulo, , desc], cat) =>
      !termo || `${rotulo} ${desc} ${id} ${cat.rotulo}`.toLowerCase().includes(termo);

    const grupos = categorias
      .map((c) => ({ ...c, abas: c.abas.filter((a) => casa(a, c)) }))
      .filter((c) => c.abas.length > 0);

    if (!grupos.length) {
      nav.innerHTML = `<div class="vazio">Nada encontrado para "${escapar(filtro)}".</div>`;
      return;
    }

    // Sem busca: só o grupo da categoria ativa. Com busca: todos os grupos.
    const visiveis = termo ? grupos : grupos.filter((c) => c.id === categoriaAtiva?.id);

    nav.innerHTML = `
      <div class="abas admin-cats" role="tablist" aria-label="Categorias">
        ${grupos.map((c) => {
          const ativa = categoriaAtiva && c.id === categoriaAtiva.id && !termo;
          return `<button class="btn ${ativa ? 'ativa' : ''}" data-cat="${c.id}" role="tab"
            aria-selected="${!!ativa}" title="${escapar(c.rotulo)}">
            ${ic(c.icone)} ${escapar(c.rotulo)} <small>${c.abas.length}</small></button>`;
        }).join('')}
      </div>
      <div class="admin-abas">
        ${visiveis.map((c) => `<div class="admin-aba-grupo">
          ${termo ? `<h4>${escapar(c.rotulo)}</h4>` : ''}
          ${c.abas.map(([id, icone, rotulo, , desc]) => `<button class="btn ${id === guiaAtiva ? 'ativa' : ''}"
            data-g="${id}" aria-current="${id === guiaAtiva ? 'page' : 'false'}"
            title="${escapar(desc)}">
            ${ic(icone)} <span class="admin-aba-txt"><span>${escapar(rotulo)}</span>${termo ? `<small>${escapar(desc)}</small>` : ''}</span></button>`).join('')}
        </div>`).join('')}
      </div>`;

    nav.querySelectorAll('[data-g]').forEach((b) => {
      b.onclick = () => { location.hash = `#admin/${b.dataset.g}`; };
    });
    nav.querySelectorAll('[data-cat]').forEach((b) => {
      b.onclick = () => {
        const c = grupos.find((g) => g.id === b.dataset.cat);
        if (c?.abas.length) location.hash = `#admin/${c.abas[0][0]}`;
      };
    });
  };

  busca.oninput = () => {
    desenharNav(busca.value);
    const n = nav.querySelectorAll('[data-g]').length;
    rodape.textContent = `${n} tela(s) encontrada(s).`;
  };

  desenharNav();
  await (TELAS_ADMIN[guiaAtiva] ?? telaRelatorios)(painel, estadoApp);
}

async function telaRelatorios(painel) {
  const hoje = new Date().toISOString().slice(0, 10);
  let ultimoRelatorio = null;
  // Nome real da empresa para o PDF. Antes estava fixo no código, então o
  // relatorio saia impresso com o nome antigo mesmo apos renomear a empresa.
  let nomeEmpresa = 'Mercury PDV';
  try { nomeEmpresa = (await get('/config')).empresa_nome || nomeEmpresa; } catch { /* segue com o padrao */ }
  painel.innerHTML = `
    <div class="cartao" style="max-width:520px;margin-bottom:12px">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input type="date" id="de" aria-label="Data inicial" value="${hoje}" style="flex:1;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
        <input type="date" id="ate" aria-label="Data final" value="${hoje}" style="flex:1;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
        <button class="btn primario" id="ver">${ic('lupa')} Ver Relatório</button>
        <button class="btn" id="exportar-pdf" disabled title="Gere o relatório primeiro">${ic('documento')} Exportar PDF</button>
        <button class="btn" id="exportar-vendas-pdf" disabled title="Gere o relatório primeiro">${ic('prancheta')} Lista Vendas PDF</button>
        <button class="btn" id="exportar-csv-vendas" title="Baixa CSV detalhado de cada venda (Excel pt-BR)">${ic('download')} Vendas CSV</button>
        <button class="btn" id="exportar-csv-resumo" title="Baixa CSV do resumo: faturamento, ticket médio e formas de pagamento">${ic('download')} Resumo CSV</button>
      </div>
    </div>
    <div id="resumo" class="vazio">Escolha o período</div>`;

  const baixarCsv = (caminho) => {
    const de = painel.querySelector('#de').value, ate = painel.querySelector('#ate').value;
    window.location.href = `/api/relatorios/${caminho}?de=${de}&ate=${ate}`;
    toast('Exportando CSV…', 'ok');
  };
  painel.querySelector('#exportar-csv-vendas').onclick = () => baixarCsv('vendas.csv');
  painel.querySelector('#exportar-csv-resumo').onclick = () => baixarCsv('resumo.csv');
  
  painel.querySelector('#ver').onclick = () => carregar();
  painel.querySelector('#exportar-pdf').onclick = async () => {
    if (!ultimoRelatorio) { toast('Gere o relatório primeiro', 'erro'); return; }
    try {
      painel.querySelector('#exportar-pdf').disabled = true;
      painel.querySelector('#exportar-pdf').textContent = '⏳ Gerando...';
      const doc = await exportarRelatorioPDF(ultimoRelatorio, { de: painel.querySelector('#de').value, ate: painel.querySelector('#ate').value, empresa_nome: nomeEmpresa });
      baixarPDF(doc, `relatorio-${painel.querySelector('#de').value}-a-${painel.querySelector('#ate').value}.pdf`);
      toast('PDF gerado com sucesso!', 'ok');
    } catch (e) {
      toast('Erro ao gerar PDF: ' + e.message, 'erro');
    } finally {
      painel.querySelector('#exportar-pdf').disabled = false;
      painel.querySelector('#exportar-pdf').textContent = ic('documento') + ' Exportar PDF';
    }
  };
  
  painel.querySelector('#exportar-vendas-pdf').onclick = async () => {
    if (!ultimoRelatorio) { toast('Gere o relatório primeiro', 'erro'); return; }
    try {
      painel.querySelector('#exportar-vendas-pdf').disabled = true;
      painel.querySelector('#exportar-vendas-pdf').textContent = '⏳ Gerando...';
      const de = painel.querySelector('#de').value;
      const ate = painel.querySelector('#ate').value;
      const vendas = await get(`/relatorios/vendas?de=${de}&ate=${ate}`);
      const doc = await exportarVendasPDF(vendas, { de, ate, empresa_nome: nomeEmpresa });
      baixarPDF(doc, `vendas-${de}-a-${ate}.pdf`);
      toast('PDF de vendas gerado!', 'ok');
    } catch (e) {
      toast('Erro ao gerar PDF de vendas: ' + e.message, 'erro');
    } finally {
      painel.querySelector('#exportar-vendas-pdf').disabled = false;
      painel.querySelector('#exportar-vendas-pdf').textContent = ic('prancheta') + ' Lista Vendas PDF';
    }
  };
  
  async function carregar() {
    const de = painel.querySelector('#de').value, ate = painel.querySelector('#ate').value;
    try {
      const r = await get(`/relatorios/resumo?de=${de}&ate=${ate}`);
      const x = r;
      ultimoRelatorio = x;
      painel.querySelector('#exportar-pdf').disabled = false;
      painel.querySelector('#exportar-vendas-pdf').disabled = false;
      painel.querySelector('#resumo').className = '';
      painel.querySelector('#resumo').innerHTML = `
        <div class="grid-produtos" style="margin-bottom:12px">
          ${[['Faturamento bruto', x.bruto_centavos], ['Descontos', -x.descontos_centavos], ['Cancelamentos (fora)', x.cancelamentos_centavos], ['Líquido', x.liquido_centavos], ['Ticket médio', x.ticket_medio_centavos], ['Margem ESTIMADA', x.margem_estimada_centavos]]
            .map(([rotulo, v]) => `<div class="cartao"><small style="color:var(--texto-fraco)">${rotulo}</small><div style="font-family:var(--mono);font-size:1.3rem;color:${v < 0 ? 'var(--alerta)' : 'var(--ok)'}">${fmt(v)}</div></div>`).join('')}
        </div>
        <p><small class="badge">Pedidos fechados: ${x.pedidos_fechados}</small></p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="cartao"><h3>Por forma de pagamento</h3>
            <table class="dados">${Object.entries(x.por_forma).map(([f, v]) => `<tr><td>${escapar(f)}</td><td class="num">${fmt(v)}</td></tr>`).join('') || '<tr><td class="vazio">—</td></tr>'}</table></div>
          <div class="cartao"><h3>Top produtos</h3>
            <table class="dados">${x.top_produtos.slice(0, 8).map((p) => `<tr><td>${escapar(p.nome)}</td><td class="num">${p.quantidade}×</td><td class="num">${fmt(p.valor_centavos)}</td></tr>`).join('') || '<tr><td class="vazio">—</td></tr>'}</table></div>
        </div>
        <p><small style="color:var(--texto-fraco)">Metodologia: ${escapar(x.metodologia.bruto)}; ${escapar(x.metodologia.liquido)}; margem = ${escapar(x.metodologia.margem)}</small></p>`;
    } catch (e) { toast(e.message, 'erro'); }
  }
  carregar();
}

async function telaFechamentoSalao(painel) {
  const hoje = new Date().toISOString().slice(0, 10);
  painel.innerHTML = `
    <div class="cartao" style="max-width:460px;margin-bottom:12px">
      <div style="display:flex;gap:8px">
        <input type="date" id="de" aria-label="Data inicial" value="${hoje}" style="flex:1;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
        <input type="date" id="ate" aria-label="Data final" value="${hoje}" style="flex:1;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
        <button class="btn primario" id="ver">Ver</button>
      </div>
    </div>
    <div id="salao-res"></div>`;
  painel.querySelector('#ver').onclick = () => carregar();
  async function carregar() {
    const de = painel.querySelector('#de').value, ate = painel.querySelector('#ate').value;
    try {
      const r = await get(`/relatorios/fechamento-salao?de=${de}&ate=${ate}`);
      const box = painel.querySelector('#salao-res');
      box.innerHTML = `
        <div class="cartao" style="margin-bottom:12px">
          <h3 style="margin-top:0">Por garçom (${de} a ${ate})</h3>
          <table class="dados"><thead><tr><th scope="col">Garçom</th><th scope="col">Comandas</th><th scope="col">Total</th><th scope="col">Itens entregues</th></tr></thead><tbody>
          ${r.por_garcom.map((g) => `<tr><td>${escapar(g.garcom_nome)}</td><td class="num">${g.comandas}</td><td class="num">${fmt(g.total_centavos)}</td><td class="num">${g.itens_entregues}</td></tr>`).join('') || '<tr><td colspan="4" class="vazio">Sem movimento</td></tr>'}
          </tbody></table>
          <button class="btn primario grande" id="assinar" style="width:100%;margin-top:12px">${ic('escrever')} Assinar fechamento</button>
        </div>
        ${r.assinados.length ? `<div class="cartao"><h3 style="margin-top:0">Fechamentos assinados</h3>
          ${r.assinados.map((f) => `<div class="linha-itens"><span>${escapar(f.periodo_de)} a ${escapar(f.periodo_ate)} · ${escapar(f.responsavel_nome)}</span><span class="badge ok">assinado</span></div>`).join('')}</div>` : ''}`;
      box.querySelector('#assinar').onclick = () => modalAssinatura(de, ate, carregar);
    } catch (e) { toast(e.message, 'erro'); }
  }
  carregar();
}

function modalAssinatura(de, ate, recarregar) {
  const m = modal(`<h2>${ic('escrever')} Assinar fechamento (${escapar(de)} a ${escapar(ate)})</h2>
    <p style="color:var(--texto-fraco)">Desenhe a assinatura abaixo (touch ou mouse).</p>
    <canvas id="pad" width="480" height="180" style="width:100%;background:#fff;border-radius:10px;touch-action:none"></canvas>
    <div style="display:flex;gap:10px;margin-top:12px">
      <button class="btn ghost" data-a="limpar">Limpar</button>
      <button class="btn ghost" data-a="c">Cancelar</button>
      <button class="btn primario" data-a="ok" style="flex:1">Assinar e salvar</button>
    </div>`);
  const canvas = m.caixa.querySelector('#pad');
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.strokeStyle = '#111';
  let desenhando = false, temTinta = false;
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e;
    return [(p.clientX - r.left) * (canvas.width / r.width), (p.clientY - r.top) * (canvas.height / r.height)];
  };
  const inicio = (e) => { desenhando = true; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); e.preventDefault(); };
  const mover = (e) => { if (!desenhando) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); temTinta = true; e.preventDefault(); };
  const fim = () => { desenhando = false; };
  canvas.addEventListener('pointerdown', inicio);
  canvas.addEventListener('pointermove', mover);
  canvas.addEventListener('pointerup', fim);
  m.caixa.querySelector('[data-a="limpar"]').onclick = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); temTinta = false; };
  m.caixa.querySelector('[data-a="c"]').onclick = m.fechar;
  m.caixa.querySelector('[data-a="ok"]').onclick = async () => {
    if (!temTinta) { toast('Desenhe a assinatura', 'erro'); return; }
    try {
      await post('/relatorios/fechamento-salao', { periodo_de: de, periodo_ate: ate, assinatura_png: canvas.toDataURL('image/png') });
      m.fechar(); toast('Fechamento assinado', 'ok'); recarregar();
    } catch (e) { toast(e.message, 'erro'); }
  };
}

async function telaProdutos(painel, estadoApp) {
  const [cat] = await Promise.all([get('/catalogo')]);
  painel.innerHTML = `
    <button class="btn primario" id="novo">+ Novo produto</button>
    <button class="btn ghost" id="novo-adicional">+ Adicional</button>
    <button class="btn ghost" id="nova-cat">+ Categoria</button>
    <button class="btn ghost" id="periodos">${ic('relogio')} Períodos</button>
    <button class="btn ghost" id="imprimir-cardapio">${ic('impressora')} Cardápio PDF</button>
    <button class="btn ghost" id="exp-cardapio" title="Baixa JSON com categorias, produtos, adicionais, variações, combos e fichas">${ic('download')} Exportar cardápio</button>
    <button class="btn ghost" id="imp-cardapio" title="Restaura cardápio de um JSON (faz backup antes)">${ic('upload')} Importar cardápio</button>
    <input type="file" id="arq-cardapio" aria-label="Selecionar arquivo de cardápio para importar" accept="application/json,.json" style="display:none" />
    <table class="dados" style="margin-top:10px"><thead><tr><th scope="col">Produto</th><th scope="col">Tipo</th><th scope="col">Categoria</th><th scope="col">Preço</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Ações</span></th></tr></thead>
    <tbody>${cat.produtos.map((p) => `<tr>
      <td>${escapar(p.nome)}${p.codigo_barras ? `<br><small style="color:var(--texto-fraco)">${ic('etiqueta')} ${escapar(p.codigo_barras)}</small>` : ''}${p.apelidos ? `<br><small style="color:var(--texto-fraco)">aka: ${escapar(p.apelidos)}</small>` : ''}</td>
      <td>${escapar(p.tipo_item ?? 'lanche')}</td>
      <td>${escapar(p.categoria_nome)}</td><td class="num">${fmt(p.preco_centavos)}</td>
      <td>${!p.ativo ? '<span class="badge alerta">inativo</span>' : !p.disponivel ? `<span class="badge alerta" title="${escapar(p.indisponibilidade_motivo ?? '')}">${ic('proibido')} suspenso</span>` : '<span class="badge ok">ok</span>'}</td>
      <td style="white-space:nowrap">
        <button class="btn ghost" data-edit="${p.id}" title="Editar">${ic('lapis')}</button>
        <button class="btn ghost" data-var="${p.id}" title="Variações">${ic('regua')}</button>
        <button class="btn ghost" data-ficha="${p.id}" title="Ficha técnica">${ic('prancheta')}</button>
        <button class="btn ghost" data-preco="${p.id}" title="Preço programado/histórico">${ic('cifrao')}</button>
        <button class="btn ghost" data-per="${p.id}" title="Períodos de venda">${ic('relogio')}</button>
      </td></tr>`).join('')}</tbody></table>`;
  painel.querySelector('#nova-cat').onclick = () => {
    const m = modal(`<h2>Nova categoria</h2><input id="nome" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" placeholder="Nome"/>
      <button class="btn primario" style="width:100%;margin-top:10px" data-a="ok">Criar</button>`);
    m.caixa.querySelector('[data-a="ok"]').onclick = async () => {
      try { await post('/categorias', { nome: m.caixa.querySelector('#nome').value.trim() }); m.fechar(); telaProdutos(painel, estadoApp); }
      catch (e) { toast(e.message, 'erro'); }
    };
  };
  painel.querySelector('#novo-adicional').onclick = () => {
    const m = modal(`<h2>Novo adicional</h2><input id="nome" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" placeholder="Nome"/>
      <input id="preco" inputmode="decimal" style="width:100%;padding:12px;margin-top:8px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" placeholder="Preço (ex: 5,00)"/>
      <button class="btn primario" style="width:100%;margin-top:10px" data-a="ok">Criar</button>`);
    m.caixa.querySelector('[data-a="ok"]').onclick = async () => {
      try { await post('/adicionais', { nome: m.caixa.querySelector('#nome').value.trim(), preco_centavos: reaisParaCentavos(m.caixa.querySelector('#preco').value) }); m.fechar(); telaProdutos(painel, estadoApp); }
      catch (e) { toast(e.message, 'erro'); }
    };
  };
  const TIPOS = [['lanche', 'Lanche'], ['prato', 'Prato'], ['porcao', 'Porção'], ['bebida', 'Bebida'], ['sobremesa', 'Sobremesa'], ['servico', 'Serviço'], ['outro', 'Outro']];
  const formProduto = (p = null) => {
    const m = modal(`<h2>${p ? 'Editar' : 'Novo'} produto</h2>
      <input id="nome" value="${escapar(p?.nome ?? '')}" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" placeholder="Nome"/>
      <div style="display:flex;gap:8px;margin-top:8px">
      <select id="cat" style="flex:2;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)">
        ${cat.categorias.map((c) => `<option value="${c.id}" ${p?.categoria_id === c.id ? 'selected' : ''}>${escapar(c.nome)}</option>`).join('')}
      </select>
      <select id="tipo" style="flex:1;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)">
        ${TIPOS.map(([v, r]) => `<option value="${v}" ${p?.tipo_item === v ? 'selected' : ''}>${r}</option>`).join('')}
      </select>
      </div>
      <input id="preco" inputmode="decimal" value="${p ? (p.preco_centavos / 100).toFixed(2).replace('.', ',') : ''}" style="width:100%;padding:12px;margin-top:8px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" placeholder="Preço de venda"/>
      <input id="custo" inputmode="decimal" value="${p?.custo_centavos ? (p.custo_centavos / 100).toFixed(2).replace('.', ',') : ''}" style="width:100%;padding:12px;margin-top:8px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" placeholder="Custo (opcional, p/ margem)"/>
      <div style="display:flex;gap:8px;margin-top:8px">
        <input id="rend" type="number" min="1" value="${p?.rendimento_porcoes ?? 1}" title="Rendimento (porções por receita)" style="flex:1;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" placeholder="Rendimento (porções)"/>
        <input id="tempo" type="number" min="0" max="600" value="${p?.tempo_preparo_min ?? 10}" title="Tempo estimado de preparo em minutos — alimenta os cronômetros da cozinha (KDS)" style="flex:1;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" placeholder="Preparo (min)" aria-label="Tempo de preparo estimado em minutos"/>
        ${p ? `<button type="button" class="btn" id="recalc" style="flex:2" title="Recalcula o custo pela ficha + perda e atualiza a margem">${ic('calculadora')} Recalcular custo da ficha</button>` : ''}
      </div>
      <p><small style="color:var(--texto-fraco)">${ic('relogio')} Tempo de preparo em minutos: usado pelo KDS para estimar quando o pedido fica pronto.</small></p>
      <div id="margem-info"></div>
      <input id="codbar" value="${escapar(p?.codigo_barras ?? '')}" style="width:100%;padding:12px;margin-top:8px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" placeholder="Código de barras (opcional, p/ bip)"/>
      <input id="apelidos" value="${escapar(p?.apelidos ?? '')}" style="width:100%;padding:12px;margin-top:8px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" placeholder="Apelidos p/ busca, separados por vírgula"/>
      <input id="indisp" value="${escapar(p?.indisponivel_motivo ?? '')}" style="width:100%;padding:12px;margin-top:8px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" placeholder="Motivo de indisponibilidade (vazio = disponível)"/>
      <select id="area" style="width:100%;padding:12px;margin-top:8px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)">
        <option value="cozinha" ${p?.area === 'cozinha' ? 'selected' : ''}>Cozinha</option>
        <option value="bar" ${p?.area === 'bar' ? 'selected' : ''}>Bar</option>
      </select>
      <label style="display:block;margin-top:10px"><input type="checkbox" id="ativo" ${p?.ativo === 0 ? '' : 'checked'} /> Ativo</label>
      <button class="btn primario grande" style="width:100%;margin-top:10px" data-a="ok">Salvar</button>`);
    m.caixa.querySelector('[data-a="ok"]').onclick = async () => {
      try {
        const corpo = {
          nome: m.caixa.querySelector('#nome').value.trim(),
          categoria_id: Number(m.caixa.querySelector('#cat').value),
          tipo_item: m.caixa.querySelector('#tipo').value,
          preco_centavos: reaisParaCentavos(m.caixa.querySelector('#preco').value),
          custo_centavos: reaisParaCentavos(m.caixa.querySelector('#custo').value || '0'),
          codigo_barras: m.caixa.querySelector('#codbar').value.trim() || null,
          apelidos: m.caixa.querySelector('#apelidos').value.trim() || null,
          indisponivel_motivo: m.caixa.querySelector('#indisp').value.trim() || null,
          rendimento_porcoes: Number(m.caixa.querySelector('#rend').value) || 1,
          tempo_preparo_min: Math.max(0, Number(m.caixa.querySelector('#tempo').value) || 0),
          area: m.caixa.querySelector('#area').value,
          ativo: m.caixa.querySelector('#ativo').checked ? 1 : 0,
        };
        if (p) await put(`/produtos/${p.id}`, corpo); else await post('/produtos', corpo);
        m.fechar(); telaProdutos(painel, estadoApp);
      } catch (e) { toast(e.message, 'erro'); }
    };
    const btnRecalc = m.caixa.querySelector('#recalc');
    if (btnRecalc && p) btnRecalc.onclick = async () => {
      try {
        const r = await post(`/produtos/${p.id}/recalcular-custo`, {});
        m.caixa.querySelector('#margem-info').innerHTML = `<p><span class="badge ok">Custo atualizado: ${fmt(r.custo_centavos)} · margem ${r.margem_pct ?? '?'}%</span>${r.sem_custo.length ? `<br><small style="color:var(--amarelo)">Sem custo: ${escapar(r.sem_custo.join(', '))}</small>` : ''}</p>`;
        toast('Custo recalculado pela ficha', 'ok');
      } catch (e) { toast(e.message, 'erro'); }
    };
  };
  painel.querySelector('#novo').onclick = () => formProduto();
  painel.querySelectorAll('[data-edit]').forEach((b) => {
    b.onclick = () => formProduto(cat.produtos.find((p) => p.id === Number(b.dataset.edit)));
  });
  painel.querySelectorAll('[data-var]').forEach((b) => {
    b.onclick = () => modalVariacoes(Number(b.dataset.var), cat.produtos.find((p) => p.id === Number(b.dataset.var)), painel, estadoApp);
  });
  painel.querySelectorAll('[data-ficha]').forEach((b) => {
    b.onclick = () => modalFicha(Number(b.dataset.ficha), cat.produtos.find((p) => p.id === Number(b.dataset.ficha)));
  });
  painel.querySelectorAll('[data-preco]').forEach((b) => {
    b.onclick = () => modalPreco(Number(b.dataset.preco), cat.produtos.find((p) => p.id === Number(b.dataset.preco)), painel, estadoApp);
  });
  painel.querySelectorAll('[data-per]').forEach((b) => {
    b.onclick = () => modalPeriodosProduto(Number(b.dataset.per), cat.produtos.find((p) => p.id === Number(b.dataset.per)));
  });
  painel.querySelector('#periodos').onclick = () => modalPeriodos(painel, estadoApp);
  painel.querySelector('#exp-cardapio').onclick = async () => {
    try {
      const dados = await get('/cardapio/exportar');
      const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `cardapio-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast(`Cardápio exportado (${dados.produtos.length} produtos)`, 'ok');
    } catch (e) { toast(e.message, 'erro'); }
  };
  painel.querySelector('#imp-cardapio').onclick = () => painel.querySelector('#arq-cardapio').click();
  painel.querySelector('#arq-cardapio').onchange = async () => {
    const arq = painel.querySelector('#arq-cardapio').files[0];
    if (!arq) return;
    let dados;
    try { dados = JSON.parse(await arq.text()); }
    catch { toast('Arquivo JSON inválido', 'erro'); return; }
    const n = (dados.produtos ?? []).length;
    if (!await confirmar('Importar cardápio?', `${n} produto(s) serão criados/atualizados. Um backup automático é feito antes. Continua?`)) return;
    try {
      const r = await post('/cardapio/importar', { cardapio: dados });
      toast(`Importado: ${r.produtos_criados} novos, ${r.produtos_atualizados} atualizados, ${r.combos} combos`, 'ok');
      telaProdutos(painel, estadoApp);
    } catch (e) { toast(e.message, 'erro'); }
  };
  painel.querySelector('#imprimir-cardapio').onclick = async () => {
    try {
      const { exportarCardapioPDF, baixarPDF } = await import('../pdfExport.js');
      const cfg = await get('/config');
      const doc = await exportarCardapioPDF(cat, { empresa_nome: cfg.empresa_nome ?? 'Mercury PDV' });
      baixarPDF(doc, 'cardapio.pdf');
      toast('Cardápio gerado!', 'ok');
    } catch (e) { toast(e.message, 'erro'); }
  };
}

async function modalVariacoes(produtoId, produto, painel, estadoApp) {
  const lista = await get(`/produtos/${produtoId}/variacoes`);
  const m = modal(`<h2>Variações — ${escapar(produto?.nome ?? '')}</h2>
    <div style="max-height:40vh;overflow:auto">
    ${lista.map((v) => `<div class="linha-itens"><span><strong>${escapar(v.grupo)}</strong>: ${escapar(v.nome)} <span class="preco">${v.delta_centavos ? (v.delta_centavos > 0 ? '+' : '') + fmt(v.delta_centavos) : 'base'}</span>${v.ativo ? '' : ' <span class="badge alerta">inativa</span>'}</span>
      <button class="btn ghost" data-edvar="${v.id}">${ic('lapis')}</button></div>`).join('') || '<div class="vazio">Sem variações</div>'}
    </div>
    <h3>Nova variação</h3>
    <input id="v-grupo" placeholder="Grupo (tamanho, ponto, sabor)" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
    <input id="v-nome" placeholder="Nome (G, Mal passado, Chocolate...)" style="width:100%;padding:12px;margin-top:8px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
    <input id="v-delta" inputmode="decimal" placeholder="Diferença de preço (ex: 5,00 — vazio = 0)" style="width:100%;padding:12px;margin-top:8px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
    <div style="display:flex;gap:10px;margin-top:12px"><button class="btn ghost" data-a="c">Fechar</button><button class="btn primario" data-a="ok" style="flex:1">Adicionar</button></div>`);
  m.caixa.querySelector('[data-a="c"]').onclick = m.fechar;
  m.caixa.querySelector('[data-a="ok"]').onclick = async () => {
    try {
      await post(`/produtos/${produtoId}/variacoes`, {
        grupo: m.caixa.querySelector('#v-grupo').value.trim() || 'opcao',
        nome: m.caixa.querySelector('#v-nome').value.trim(),
        delta_centavos: reaisParaCentavos(m.caixa.querySelector('#v-delta').value || '0'),
      });
      m.fechar(); modalVariacoes(produtoId, produto, painel, estadoApp);
    } catch (e) { toast(e.message, 'erro'); }
  };
  m.caixa.querySelectorAll('[data-edvar]').forEach((b) => {
    b.onclick = async () => {
      const v = lista.find((x) => x.id === Number(b.dataset.edvar));
      if (!await confirmar('Desativar variação?', `"${v.nome}" não poderá mais ser vendida.`, { perigo: true })) return;
      try { await put(`/variacoes/${v.id}`, { grupo: v.grupo, nome: v.nome, delta_centavos: v.delta_centavos, ativo: 0 }); m.fechar(); modalVariacoes(produtoId, produto, painel, estadoApp); }
      catch (e) { toast(e.message, 'erro'); }
    };
  });
}

async function modalFicha(produtoId, produto) {
  const ings = await get('/estoque');
  const m = modal(`<h2>${ic('prancheta')} Ficha técnica — ${escapar(produto?.nome ?? '')}</h2>
    <p style="color:var(--texto-fraco)">Perda % de preparo entra na baixa e no custo. Rendimento (porções) fica no cadastro do produto.</p>
    <div id="ficha-itens"></div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <select id="f-ing" style="flex:2;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)">
        ${ings.map((i) => `<option value="${i.id}">${escapar(i.nome)} (${escapar(i.unidade)})</option>`).join('')}
      </select>
      <input id="f-qtd" inputmode="decimal" placeholder="Qtd (g/ml/un)" style="flex:1;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
      <input id="f-perda" inputmode="decimal" placeholder="Perda %" style="flex:1;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
      <button class="btn" id="f-add">+</button>
    </div>
    <div style="display:flex;gap:10px;margin-top:12px"><button class="btn ghost" data-a="c">Fechar</button><button class="btn primario" data-a="ok" style="flex:1">Salvar ficha</button></div>`);
  let itens = [];
  const caixa = m.caixa.querySelector('#ficha-itens');
  const redesenhar = () => {
    caixa.innerHTML = itens.map((it, ix) => `<div class="linha-itens"><span>${escapar(it.nome)} — ${it.quantidade_mil} mil ${it.perda_pct ? `· perda ${it.perda_pct}%` : ''}</span><button class="btn ghost" data-rmf="${ix}">${ic('x')}</button></div>`).join('') || '<div class="vazio">Sem itens — a baixa automática usa esta ficha</div>';
    caixa.querySelectorAll('[data-rmf]').forEach((b) => { b.onclick = () => { itens.splice(Number(b.dataset.rmf), 1); redesenhar(); }; });
  };
  try {
    const atual = await get(`/produtos/${produtoId}/ficha`).catch(() => []);
    itens = (Array.isArray(atual) ? atual : []).map((i) => ({ ingrediente_id: i.ingrediente_id, nome: i.nome, quantidade_mil: i.quantidade_mil, perda_pct: i.perda_pct ?? 0 }));
  } catch { /* sem ficha ainda */ }
  redesenhar();
  m.caixa.querySelector('#f-add').onclick = () => {
    const id = Number(m.caixa.querySelector('#f-ing').value);
    const ing = ings.find((i) => i.id === id);
    const qtd = Math.round(Number(m.caixa.querySelector('#f-qtd').value.replace(',', '.')) * 1000);
    const perda = Number(m.caixa.querySelector('#f-perda').value.replace(',', '.')) || 0;
    if (!ing || !qtd || qtd <= 0 || perda < 0 || perda > 100) { toast('Informe ingrediente, quantidade e perda 0–100', 'erro'); return; }
    itens.push({ ingrediente_id: id, nome: ing.nome, quantidade_mil: qtd, perda_pct: perda });
    redesenhar();
  };
  m.caixa.querySelector('[data-a="c"]').onclick = m.fechar;
  m.caixa.querySelector('[data-a="ok"]').onclick = async () => {
    try {
      await put(`/produtos/${produtoId}/ficha`, { itens: itens.map((i) => ({ ingrediente_id: i.ingrediente_id, quantidade_mil: i.quantidade_mil, perda_pct: i.perda_pct })) });
      m.fechar(); toast('Ficha salva (com perda)', 'ok');
    } catch (e) { toast(e.message, 'erro'); }
  };
}

async function modalPreco(produtoId, produto, painel, estadoApp) {  const hist = await get(`/produtos/${produtoId}/precos`);
  const m = modal(`<h2>Preço — ${escapar(produto?.nome ?? '')} (atual ${fmt(produto?.preco_centavos ?? 0)})</h2>
    <div style="max-height:30vh;overflow:auto">
    <table class="dados"><thead><tr><th scope="col">Vigência</th><th scope="col">Preço</th><th scope="col">Aplicado</th><th scope="col">Por</th></tr></thead><tbody>
    ${hist.map((h) => `<tr><td>${new Date(h.valido_de).toLocaleString('pt-BR')}</td><td class="num">${fmt(h.preco_centavos)}</td><td>${h.aplicado ? ic('check') : '⏳ programado'}</td><td>${escapar(h.criado_por_nome ?? 'sistema')}</td></tr>`).join('') || '<tr><td colspan="4" class="vazio">—</td></tr>'}
    </tbody></table></div>
    <h3>Programar novo preço</h3>
    <input id="p-valor" inputmode="decimal" placeholder="Novo preço (ex: 27,90)" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
    <input id="p-quando" type="datetime-local" style="width:100%;padding:12px;margin-top:8px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
    <small style="color:var(--texto-fraco)">Vazio = aplica agora. Futuro = aplica automaticamente na vigência.</small>
    <div style="display:flex;gap:10px;margin-top:12px"><button class="btn ghost" data-a="c">Fechar</button><button class="btn primario" data-a="ok" style="flex:1">Programar</button></div>`);
  m.caixa.querySelector('[data-a="c"]').onclick = m.fechar;
  m.caixa.querySelector('[data-a="ok"]').onclick = async () => {
    try {
      const quando = m.caixa.querySelector('#p-quando').value;
      await post(`/produtos/${produtoId}/preco-programado`, {
        preco_centavos: reaisParaCentavos(m.caixa.querySelector('#p-valor').value),
        valido_de: quando ? new Date(quando).toISOString() : undefined,
      });
      m.fechar(); toast('Preço programado', 'ok'); telaProdutos(painel, estadoApp);
    } catch (e) { toast(e.message, 'erro'); }
  };
}

async function modalPeriodosProduto(produtoId, produto) {
  const periodos = await get('/periodos');
  const m = modal(`<h2>Períodos — ${escapar(produto?.nome ?? '')}</h2>
    <p style="color:var(--texto-fraco)">Sem seleção = vende sempre. Com seleção = vende só nos períodos marcados.</p>
    ${(periodos ?? []).map((p) => `<label class="linha-itens" style="cursor:pointer"><span><input type="checkbox" data-per="${p.id}" /> ${escapar(p.nome)} <small style="color:var(--texto-fraco)">dias ${escapar(p.dias)} ${escapar(p.hora_ini)}–${escapar(p.hora_fim)}</small></span></label>`).join('') || '<div class="vazio">Nenhum período cadastrado — use o botão Períodos.</div>'}
    <div style="display:flex;gap:10px;margin-top:12px"><button class="btn ghost" data-a="c">Cancelar</button><button class="btn primario" data-a="ok" style="flex:1">Salvar vínculos</button></div>`);
  m.caixa.querySelector('[data-a="c"]').onclick = m.fechar;
  m.caixa.querySelector('[data-a="ok"]').onclick = async () => {
    try {
      await put(`/produtos/${produtoId}/periodos`, { periodo_ids: [...m.caixa.querySelectorAll('[data-per]:checked')].map((c) => Number(c.dataset.per)) });
      m.fechar(); toast('Períodos vinculados', 'ok');
    } catch (e) { toast(e.message, 'erro'); }
  };
}

async function modalPeriodos(painel, estadoApp) {
  const lista = await get('/periodos');
  const m = modal(`<h2>Períodos de cardápio</h2>
    <div style="max-height:36vh;overflow:auto">
    ${(lista ?? []).map((p) => `<div class="linha-itens"><span><strong>${escapar(p.nome)}</strong> <small style="color:var(--texto-fraco)">dias ${escapar(p.dias)} · ${escapar(p.hora_ini)}–${escapar(p.hora_fim)}</small>${p.ativo ? '' : ' <span class="badge alerta">inativo</span>'}</span>
      <button class="btn ghost" data-delper="${p.id}" title="Excluir">${ic('lixeira')}</button></div>`).join('') || '<div class="vazio">Nenhum período</div>'}
    </div>
    <h3>Novo período</h3>
    <input id="per-nome" placeholder="Nome (Almoço, Happy Hour, Jantar)" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
    <input id="per-dias" placeholder="Dias 0=dom..6=sáb (ex: 1,2,3,4,5)" style="width:100%;padding:12px;margin-top:8px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
    <div style="display:flex;gap:8px;margin-top:8px">
      <input id="per-ini" type="time" value="11:00" style="flex:1;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
      <input id="per-fim" type="time" value="14:00" style="flex:1;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
    </div>
    <div style="display:flex;gap:10px;margin-top:12px"><button class="btn ghost" data-a="c">Fechar</button><button class="btn primario" data-a="ok" style="flex:1">Criar</button></div>`);
  m.caixa.querySelector('[data-a="c"]').onclick = m.fechar;
  m.caixa.querySelector('[data-a="ok"]').onclick = async () => {
    try {
      await post('/periodos', {
        nome: m.caixa.querySelector('#per-nome').value.trim(),
        dias: m.caixa.querySelector('#per-dias').value.trim() || '0,1,2,3,4,5,6',
        hora_ini: m.caixa.querySelector('#per-ini').value,
        hora_fim: m.caixa.querySelector('#per-fim').value,
      });
      m.fechar(); modalPeriodos(painel, estadoApp);
    } catch (e) { toast(e.message, 'erro'); }
  };
  m.caixa.querySelectorAll('[data-delper]').forEach((b) => {
    b.onclick = async () => {
      if (!await confirmar('Excluir período?', 'Os vínculos com produtos serão removidos.', { perigo: true })) return;
      try { await del(`/periodos/${b.dataset.delper}`); m.fechar(); modalPeriodos(painel, estadoApp); }
      catch (e) { toast(e.message, 'erro'); }
    };
  });
}

async function telaEstoque(painel, estadoApp) {
  const LOCAIS = [['deposito', 'Depósito'], ['camara_fria', 'Câmara fria'], ['bar', 'Bar'], ['salao', 'Salão']];
  const nomeLocal = (l) => (LOCAIS.find((x) => x[0] === l) ?? [l, l])[1];
  let dados = [];
  try { dados = await get('/estoque'); } catch (e) { painel.innerHTML = `<div class="vazio">Erro: ${escapar(e.message)}</div>`; return; }
  const vencidos = await get('/estoque/vencidos').catch(() => []);
  const sugestao = await get('/estoque/sugestao-compra').catch(() => []);
  painel.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <button class="btn primario" id="est-novo">+ Ingrediente</button>
      <button class="btn" id="est-entrada">${ic('download')} Entrada</button>
      <button class="btn" id="est-saida">${ic('upload')} Saída (perda/sobra/quebra)</button>
      <button class="btn" id="est-transf">${ic('troca')} Transferir</button>
      <button class="btn" id="est-inv">${ic('prancheta')} Inventário</button>
      <button class="btn" id="est-abc">${ic('grafico')} Curva ABC</button>
      <button class="btn" id="est-barris">${ic('cerveja')} Barris</button>
      ${vencidos.length ? `<button class="btn perigo" id="est-venc">${ic('alerta')} Baixar ${vencidos.length} vencido(s)</button>` : ''}
    </div>
    ${sugestao.length ? `<div class="cartao" style="margin-bottom:12px;border-color:var(--amarelo)"><strong>${ic('carrinho')} Sugestão de compra:</strong> ${sugestao.map((s) => `${escapar(s.nome)} (${((s.sugerido_mil) / 1000).toLocaleString('pt-BR')} ${escapar(s.unidade)})`).join(' · ')}</div>` : ''}
    <table class="dados"><thead><tr><th scope="col">Insumo</th><th scope="col">Saldo</th><th scope="col">Mínimo</th><th scope="col">Locais</th><th scope="col">Status</th></tr></thead>
    <tbody>${dados.map((i) => `<tr>
      <td>${escapar(i.nome)} <small style="color:var(--texto-fraco)">${escapar(i.unidade)}</small>${i.controla_validade ? ' <span class="badge" title="Controla validade">' + ic('calendario') + '</span>' : ''}${i.vencidos_mil > 0 ? ` <span class="badge alerta">vencido: ${((i.vencidos_mil) / 1000).toLocaleString('pt-BR')}</span>` : ''}</td>
      <td class="num">${((i.quantidade_mil) / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}</td>
      <td class="num">${((i.minimo_mil) / 1000).toLocaleString('pt-BR')}</td>
      <td><small>${(i.locais ?? []).map((l) => `${nomeLocal(l.local)}: ${((l.quantidade_mil) / 1000).toLocaleString('pt-BR')}`).join(' · ') || '—'}</small></td>
      <td>${i.em_alerta ? '<span class="badge alerta">abaixo do mínimo</span>' : '<span class="badge ok">ok</span>'}</td>
    </tr>`).join('')}</tbody></table>`;

  const recarregar = () => telaEstoque(painel, estadoApp);
  const opcoesIng = dados.map((i) => `<option value="${i.id}">${escapar(i.nome)} (${escapar(i.unidade)})</option>`).join('');
  const opcoesLocal = LOCAIS.map(([v, r]) => `<option value="${v}">${r}</option>`).join('');
  const campo = (id, ph, extra = '') => `<input id="${id}" placeholder="${ph}" ${extra} style="width:100%;padding:12px;margin-top:8px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />`;

  painel.querySelector('#est-novo').onclick = () => {
    const m = modal(`<h2>Novo ingrediente</h2>${campo('nome', 'Nome')}
      <div style="display:flex;gap:8px"><select id="un" style="flex:1;padding:12px;margin-top:8px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)"><option value="g">gramas (g)</option><option value="ml">ml</option><option value="un">unidades</option></select>
      <select id="loc" style="flex:1;padding:12px;margin-top:8px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)">${opcoesLocal}</select></div>
      ${campo('qtd', 'Saldo inicial (ex: 5000 = 5kg ou 5L)', 'inputmode="decimal"')}
      ${campo('min', 'Mínimo (mesma unidade)', 'inputmode="decimal"')}
      <div style="display:flex;gap:10px;margin-top:12px"><button class="btn ghost" data-a="c">Cancelar</button><button class="btn primario" data-a="ok" style="flex:1">Criar</button></div>`);
    m.caixa.querySelector('[data-a="c"]').onclick = m.fechar;
    m.caixa.querySelector('[data-a="ok"]').onclick = async () => {
      try {
        const f = (id) => m.caixa.querySelector('#' + id).value;
        await post('/estoque/ingredientes', { nome: f('nome').trim(), unidade: m.caixa.querySelector('#un').value, local: m.caixa.querySelector('#loc').value, quantidade_mil: Math.round(Number(f('qtd').replace(',', '.')) * 1000) || 0, minimo_mil: Math.round(Number(f('min').replace(',', '.')) * 1000) || 0 });
        m.fechar(); recarregar();
      } catch (e) { toast(e.message, 'erro'); }
    };
  };

  painel.querySelector('#est-entrada').onclick = () => {
    const m = modal(`<h2>${ic('download')} Entrada de insumo</h2>
      <select id="ing" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)">${opcoesIng}</select>
      ${campo('qtd', 'Quantidade (ex: 1000 = 1kg)', 'inputmode="decimal"')}
      <div style="display:flex;gap:8px">${campo('lote', 'Lote (opcional)')}${campo('val', 'Validade AAAA-MM-DD (opcional)')}</div>
      <div style="display:flex;gap:8px"><select id="loc" style="flex:1;padding:12px;margin-top:8px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)">${opcoesLocal}</select>${campo('custo', 'Custo total R$ (p/ custo médio)', 'inputmode="decimal" style="flex:1"')}</div>
      ${campo('obs', 'Observação/fornecedor')}
      <div style="display:flex;gap:10px;margin-top:12px"><button class="btn ghost" data-a="c">Cancelar</button><button class="btn primario" data-a="ok" style="flex:1">Registrar</button></div>`);
    m.caixa.querySelector('[data-a="c"]').onclick = m.fechar;
    m.caixa.querySelector('[data-a="ok"]').onclick = async () => {
      try {
        const f = (id) => m.caixa.querySelector('#' + id).value;
        await post(`/estoque/movimentar/${m.caixa.querySelector('#ing').value}`, {
          tipo: 'entrada', quantidade_mil: Math.round(Number(f('qtd').replace(',', '.')) * 1000),
          lote: f('lote').trim() || 'avulso', validade: f('val').trim() || null, local: m.caixa.querySelector('#loc').value,
          custo_total_centavos: f('custo').trim() ? reaisParaCentavos(f('custo')) : null, observacao: f('obs').trim(),
        });
        m.fechar(); toast('Entrada registrada (FIFO por validade)', 'ok'); recarregar();
      } catch (e) { toast(e.message, 'erro'); }
    };
  };

  painel.querySelector('#est-saida').onclick = () => {
    const m = modal(`<h2>${ic('upload')} Saída de insumo</h2>
      <select id="ing" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)">${opcoesIng}</select>
      <select id="tipo" style="width:100%;padding:12px;margin-top:8px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)">
        <option value="perda">Perda de preparo</option><option value="sobra">Sobra</option><option value="quebra">Quebra</option>
      </select>
      ${campo('qtd', 'Quantidade', 'inputmode="decimal"')}${campo('obs', 'Motivo (obrigatório p/ auditoria)')}
      <div style="display:flex;gap:10px;margin-top:12px"><button class="btn ghost" data-a="c">Cancelar</button><button class="btn perigo" data-a="ok" style="flex:1">Registrar saída</button></div>`);
    m.caixa.querySelector('[data-a="c"]').onclick = m.fechar;
    m.caixa.querySelector('[data-a="ok"]').onclick = async () => {
      try {
        const f = (id) => m.caixa.querySelector('#' + id).value;
        if (f('obs').trim().length < 3) { toast('Motivo obrigatório', 'erro'); return; }
        await post(`/estoque/movimentar/${m.caixa.querySelector('#ing').value}`, {
          tipo: m.caixa.querySelector('#tipo').value, quantidade_mil: Math.round(Number(f('qtd').replace(',', '.')) * 1000), observacao: f('obs').trim(),
        });
        m.fechar(); recarregar();
      } catch (e) { toast(e.message, 'erro'); }
    };
  };

  painel.querySelector('#est-transf').onclick = () => {
    const m = modal(`<h2>${ic('troca')} Transferir entre locais</h2>
      <select id="ing" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)">${opcoesIng}</select>
      <div style="display:flex;gap:8px;margin-top:8px"><select id="orig" style="flex:1;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)">${opcoesLocal}</select>
      <select id="dest" style="flex:1;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)">${opcoesLocal}</select></div>
      ${campo('qtd', 'Quantidade', 'inputmode="decimal"')}${campo('motivo', 'Motivo')}
      <div style="display:flex;gap:10px;margin-top:12px"><button class="btn ghost" data-a="c">Cancelar</button><button class="btn primario" data-a="ok" style="flex:1">Transferir</button></div>`);
    m.caixa.querySelector('[data-a="c"]').onclick = m.fechar;
    m.caixa.querySelector('[data-a="ok"]').onclick = async () => {
      try {
        const f = (id) => m.caixa.querySelector('#' + id).value;
        await post('/estoque/transferir', {
          ingrediente_id: Number(m.caixa.querySelector('#ing').value),
          origem: m.caixa.querySelector('#orig').value, destino: m.caixa.querySelector('#dest').value,
          quantidade_mil: Math.round(Number(f('qtd').replace(',', '.')) * 1000), motivo: f('motivo').trim(),
        });
        m.fechar(); toast('Transferência registrada', 'ok'); recarregar();
      } catch (e) { toast(e.message, 'erro'); }
    };
  };

  painel.querySelector('#est-inv').onclick = async () => {
    const lista = await get('/estoque/inventario?quantidade=10');
    const m = modal(`<h2>${ic('prancheta')} Inventário rotativo</h2><p style="color:var(--texto-fraco)">Conte e informe. Divergências ajustam o saldo com auditoria.</p>
      <div style="max-height:44vh;overflow:auto">
      ${lista.map((i) => `<div class="linha-itens"><span><strong>${escapar(i.nome)}</strong><br><small style="color:var(--texto-fraco)">sistema: ${((i.quantidade_mil) / 1000).toLocaleString('pt-BR')} ${escapar(i.unidade)}</small></span>
        <span style="display:flex;gap:6px"><input data-cont="${i.id}" inputmode="decimal" placeholder="contado" style="width:110px;padding:10px;background:var(--canvas);border-radius:8px;border:1px solid var(--borda);color:var(--texto)" />
        <button class="btn primario" data-ok="${i.id}">${ic('check')}</button></span></div>`).join('')}
      </div>
      <button class="btn ghost" style="width:100%;margin-top:10px" data-a="c">Fechar</button>`);
    m.caixa.querySelector('[data-a="c"]').onclick = m.fechar;
    m.caixa.querySelectorAll('[data-ok]').forEach((b) => {
      b.onclick = async () => {
        const inp = m.caixa.querySelector(`[data-cont="${b.dataset.ok}"]`);
        const val = Number(inp.value.replace(',', '.'));
        if (!Number.isFinite(val) || val < 0) { toast('Valor inválido', 'erro'); return; }
        try {
          const r = await post('/estoque/inventario', { ingrediente_id: Number(b.dataset.ok), contado_mil: Math.round(val * 1000), observacao: 'contagem cíclica' });
          toast(r.diferenca_mil === 0 ? 'Sem divergência' : `Divergência de ${((r.diferenca_mil) / 1000).toLocaleString('pt-BR')} ajustada`, r.diferenca_mil === 0 ? 'ok' : 'erro');
          m.fechar(); recarregar();
        } catch (e) { toast(e.message, 'erro'); }
      };
    });
  };

  painel.querySelector('#est-abc').onclick = async () => {
    const abc = await get('/estoque/curva-abc?dias=30');
    modal(`<h2>${ic('grafico')} Curva ABC (30 dias, por valor consumido)</h2>
      ${abc.sem_custo ? `<p><span class="badge alerta">${abc.sem_custo} insumo(s) sem custo — informe custo nas entradas</span></p>` : ''}
      <table class="dados"><thead><tr><th scope="col">Insumo</th><th scope="col">Consumo</th><th scope="col">Valor</th><th scope="col">Classe</th></tr></thead><tbody>
      ${abc.itens.map((i) => `<tr><td>${escapar(i.nome)}</td><td class="num">${((i.consumo_mil) / 1000).toLocaleString('pt-BR')} ${escapar(i.unidade)}</td><td class="num">${fmt(i.valor_centavos)}</td><td><span class="badge ${i.classe === 'A' ? 'alerta' : i.classe === 'B' ? '' : 'ok'}">${i.classe} ${i.participacao_pct}%</span></td></tr>`).join('') || '<tr><td colspan="4" class="vazio">Sem consumo no período</td></tr>'}
      </tbody></table>
      <button class="btn primario" style="width:100%;margin-top:12px" data-a="ok">Fechar</button>`)
      .caixa.querySelector('[data-a="ok"]').onclick = function () { this.closest('.modal-fundo').remove(); };
  };

  painel.querySelector('#est-barris').onclick = async () => {
    const barris = await get('/barris');
    const m = modal(`<h2>${ic('cerveja')} Barris de chopp</h2>
      <div style="max-height:36vh;overflow:auto">
      ${barris.map((b) => `<div class="linha-itens"><span><strong>${escapar(b.rotulo)}</strong> (${escapar(b.tipo_chopp)})<br>
        <small style="color:var(--texto-fraco)">~${b.copos_restantes} copos (473ml) ${b.esgotado_em ? '· <span class="badge">esgotado</span>' : b.ruptura ? '· <span class="badge alerta">RUPTURA</span>' : '· ativo'}</small></span>
        ${!b.esgotado_em ? `<button class="btn ghost" data-esg="${b.id}">Esgotar/trocar</button>` : ''}</div>`).join('') || '<div class="vazio">Nenhum barril</div>'}
      </div>
      <h3>Instalar barril</h3>
      ${campo('rotulo', 'Rótulo (ex: Torre 1)')}
      <div style="display:flex;gap:8px"><select id="bing" style="flex:2;padding:12px;margin-top:8px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)">${opcoesIng}</select>${campo('cap', 'Litros (ex: 50)', 'inputmode="decimal" style="flex:1"')}</div>
      <div style="display:flex;gap:10px;margin-top:12px"><button class="btn ghost" data-a="c">Fechar</button><button class="btn primario" data-a="ok" style="flex:1">Instalar</button></div>`);
    m.caixa.querySelector('[data-a="c"]').onclick = m.fechar;
    m.caixa.querySelector('[data-a="ok"]').onclick = async () => {
      try {
        await post('/barris', {
          rotulo: m.caixa.querySelector('#rotulo').value.trim(),
          ingrediente_id: Number(m.caixa.querySelector('#bing').value),
          capacidade_ml: Math.round(Number(m.caixa.querySelector('#cap').value.replace(',', '.')) * 1000),
        });
        m.fechar(); telaEstoque(painel, estadoApp);
      } catch (e) { toast(e.message, 'erro'); }
    };
    m.caixa.querySelectorAll('[data-esg]').forEach((b) => {
      b.onclick = async () => {
        if (!await confirmar('Esgotar barril?', 'Marca o barril como esgotado para troca.', { perigo: true })) return;
        try { await post(`/barris/${b.dataset.esg}/esgotar`, {}); m.fechar(); telaEstoque(painel, estadoApp); }
        catch (e) { toast(e.message, 'erro'); }
      };
    });
  };

  const btnVenc = painel.querySelector('#est-venc');
  if (btnVenc) btnVenc.onclick = async () => {
    if (!await confirmar('Baixar vencidos?', `${vencidos.length} lote(s) vencido(s) serão baixados com auditoria.`, { perigo: true })) return;
    try { const r = await post('/estoque/baixar-vencidos', {}); toast(`${r.lotes_baixados} lote(s) baixados`, 'ok'); recarregar(); }
    catch (e) { toast(e.message, 'erro'); }
  };
}

async function telaPermissoes(painel) {
  const CARGOS = [['admin','Administrador'],['caixa','Caixa'],['garcom','Garçom'],['cozinha','Cozinha'],['proprietario','Proprietário']];
  let dados;
  try { dados = await get('/permissoes'); }
  catch (e) { painel.innerHTML = `<div class="vazio">Erro: ${escapar(e.message)}</div>`; return; }
  const porCargo = {};
  for (const linha of dados.flags) porCargo[linha.cargo] = linha;
  painel.innerHTML = `
    <p style="color:var(--texto-fraco)">Marque as funções liberadas por cargo. O admin nunca perde Configurações nem Funcionários (trava anti-bloqueio). Alterações valem imediatamente e ficam na auditoria.</p>
    <div style="overflow-x:auto"><table class="dados"><thead><tr><th scope="col">Função</th>${CARGOS.map(([c, r]) => `<th scope="col">${r}</th>`).join('')}</tr></thead>
    <tbody>${Object.entries(dados.rotulos).map(([flag, rotulo]) => `<tr>
      <td>${escapar(rotulo)}</td>
      ${CARGOS.map(([c]) => {
        const travada = (c === 'admin' || c === 'proprietario') && (flag === 'pode_config_sistema' || flag === 'pode_gerenciar_usuarios' || flag === 'pode_painel_dev');
        const marcada = !!porCargo[c]?.[flag];
        return `<td style="text-align:center"><input type="checkbox" data-flag="${flag}" data-cargo="${c}" ${marcada ? 'checked' : ''} ${travada ? 'disabled title="Trava anti-bloqueio"' : ''} style="width:24px;height:24px" aria-label="${escapar(rotulo)} para ${c}" /></td>`;
      }).join('')}</tr>`).join('')}</tbody></table></div>
    <button class="btn primario grande" id="salvar-matriz" style="width:100%;margin-top:12px">${ic('disquete')} Salvar permissões</button>`;
  painel.querySelector('#salvar-matriz').onclick = async () => {
    if (!await confirmar('Salvar permissões?', 'As liberações passam a valer imediatamente para todos os cargos.')) return;
    const matriz = {};
    for (const [c] of CARGOS) {
      matriz[c] = {};
      painel.querySelectorAll(`[data-cargo="${c}"]:not(:disabled)`).forEach((chk) => { matriz[c][chk.dataset.flag] = chk.checked ? 1 : 0; });
    }
    try {
      await put('/permissoes', { matriz });
      toast('Permissões atualizadas', 'ok');
      telaPermissoes(painel);
    } catch (e) { toast(e.message, 'erro'); }
  };
}

async function telaUsuarios(painel, estadoApp) {
  const usuarios = await get('/usuarios');
  // Só um Administrador gerencia outra conta Administrador (o Proprietário não
  // pode escalar privilégio criando/resetando um admin e entrando no painel dev).
  const souAdmin = estadoApp?.usuario?.cargo === 'admin';
  const ROTULO_CARGO = { admin: 'Administrador', proprietario: 'Proprietário', caixa: 'Caixa', garcom: 'Garçom', cozinha: 'Cozinha' };
  painel.innerHTML = `
    <button class="btn primario" id="novo">+ Novo usuário</button>
    <table class="dados" style="margin-top:10px"><thead><tr><th scope="col">Nome</th><th scope="col">Cargo</th><th scope="col">Status</th><th scope="col">Último login</th><th scope="col"><span class="sr-only">Ações</span></th></tr></thead>
    <tbody>${usuarios.map((u) => `<tr>
      <td>${escapar(u.nome)}${u.falhas_login > 0 ? ` <span class="badge alerta" title="Tentativas falhas">${u.falhas_login} erro(s)</span>` : ''}${u.bloqueado_ate ? ' <span class="badge alerta">bloqueado</span>' : ''}</td><td>${escapar(ROTULO_CARGO[u.cargo] ?? u.cargo)}</td>
      <td>${u.ativo ? '<span class="badge ok">ativo</span>' : '<span class="badge alerta">inativo</span>'}</td>
      <td>${u.ultimo_login ? new Date(u.ultimo_login).toLocaleString('pt-BR') : '—'}</td>
      <td style="white-space:nowrap">${(!souAdmin && u.cargo === 'admin') ? '<span class="badge" title="Só um Administrador gerencia outro Administrador">conta protegida</span>' : `<button class="btn ghost" data-cred="${u.id}">${ic('chave')} Credenciais</button>
      ${(u.falhas_login > 0 || u.bloqueado_ate) ? `<button class="btn ghost" data-desbloq="${u.id}" title="Zerar erros e desbloqueio">${ic('cadeado-aberto')}</button>` : ''}`}</td></tr>`).join('')}</tbody></table>
    <p><small style="color:var(--texto-fraco)">Só usuários <strong>ativos</strong> aparecem aqui: quem é excluído (ou desativado em <em>Credenciais</em>) sai da lista. Para ver o histórico e reativar alguém, use <strong>Sistema → Suporte técnico → Usuários</strong>.</small></p>`;
  painel.querySelector('#novo').onclick = () => {
    const m = modal(`<h2>Novo usuário</h2>
      <input id="nome" placeholder="Nome" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)"/>
      <select id="cargo" style="width:100%;padding:12px;margin-top:8px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)">
        <option value="caixa">Caixa</option><option value="garcom">Garçom</option><option value="cozinha">Cozinha</option><option value="proprietario">Proprietário (todos os acessos, sem painel dev)</option>${souAdmin ? '<option value="admin">Administrador (exige senha)</option>' : ''}
      </select>
      <input id="pin" inputmode="numeric" maxlength="6" placeholder="PIN 4–6 dígitos" style="width:100%;padding:12px;margin-top:8px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)"/>
      <input id="senha" type="password" placeholder="Senha (obrigatória p/ admin; forte)" style="width:100%;padding:12px;margin-top:8px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)"/>
      <button class="btn primario" style="width:100%;margin-top:10px" data-a="ok">Criar</button>`);
    m.caixa.querySelector('[data-a="ok"]').onclick = async () => {
      try {
        await post('/usuarios', {
          nome: m.caixa.querySelector('#nome').value.trim(), cargo: m.caixa.querySelector('#cargo').value,
          pin: m.caixa.querySelector('#pin').value || undefined, senha: m.caixa.querySelector('#senha').value || undefined,
        });
        m.fechar(); telaUsuarios(painel, estadoApp);
      } catch (e) { toast(e.message, 'erro'); }
    };
  };
  painel.querySelectorAll('[data-desbloq]').forEach((b) => {
    b.onclick = async () => {
      if (!await confirmar('Desbloquear funcionário?', 'Zera as tentativas falhas e remove o bloqueio temporário.')) return;
      try { await post(`/usuarios/${b.dataset.desbloq}/desbloquear`, {}); toast('Funcionário desbloqueado', 'ok'); telaUsuarios(painel, estadoApp); }
      catch (e) { toast(e.message, 'erro'); }
    };
  });
  painel.querySelectorAll('[data-cred]').forEach((b) => {
    b.onclick = () => {
      const m = modal(`<h2>Alterar credenciais</h2>
        <input id="pin" inputmode="numeric" maxlength="6" placeholder="Novo PIN (vazio = manter)" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)"/>
        <input id="senha" type="password" placeholder="Nova senha (vazio = manter)" style="width:100%;padding:12px;margin-top:8px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)"/>
        <label style="display:block;margin-top:10px"><input type="checkbox" id="ativo" checked/> Ativo</label>
        <button class="btn primario" style="width:100%;margin-top:10px" data-a="ok">Salvar</button>`);
      m.caixa.querySelector('[data-a="ok"]').onclick = async () => {
        try {
          await post(`/usuarios/${b.dataset.cred}/credenciais`, {
            pin: m.caixa.querySelector('#pin').value || undefined,
            senha: m.caixa.querySelector('#senha').value || undefined,
            ativo: m.caixa.querySelector('#ativo').checked ? 1 : 0,
          });
          m.fechar(); telaUsuarios(painel, estadoApp);
        } catch (e) { toast(e.message, 'erro'); }
      };
    };
  });
}

async function telaConfig(painel) {
  const cfg = await get('/config');
  // Converte centavos persistidos em texto "R$" para edição confortável.
  const reaisComoTexto = (centavos) => (Number(centavos) / 100).toFixed(2).replace('.', ',');
  const campos = [['empresa_nome', 'Nome da empresa'], ['empresa_cnpj', 'CNPJ'], ['empresa_telefone', 'Telefone'], ['empresa_endereco', 'Endereço']];
  
  // Calcula a URL de acesso mobile a partir da origem em que o painel está
  // aberto — funciona em localhost e em qualquer IP da rede local.
  const urlMobile = `${window.location.origin}/#comandas`;
  // 1.3.1 — endereço ONLINE (AWS/EC2/ALB ou domínio próprio). Quando definido,
  // garçons conectam de qualquer lugar pelo link público; vazio = só rede local.
  const urlOnline = String(cfg.url_publica ?? '').trim() ? `${String(cfg.url_publica).replace(/\/+$/, '')}/#comandas` : '';

  // QR Codes gerados LOCALMENTE (P-03): nada sai da rede local. O serviço
  // externo usado antes também enviava o endereço da rede a terceiros.
  let qrSvg = '';
  let qrSvgOnline = '';
  try {
    qrSvg = qrcodeSVG(urlMobile, { tamanho: 200, margem: 3 });
  } catch (e) {
    qrSvg = `<div class="vazio">Não foi possível gerar o QR Code local.</div>`;
  }
  try {
    if (urlOnline) qrSvgOnline = qrcodeSVG(urlOnline, { tamanho: 200, margem: 3 });
  } catch { /* online opcional */ }

  // Cada seção tem um id para o menu de âncoras do topo. A ordem aqui é a
  // ordem em que aparecem na tela.
  const SECOES = [
    ['empresa', 'Empresa'],
    ['cupom', 'Cupom'],
    ['comportamento', 'Comportamento'],
    ['salao', 'Salão Pro'],
    ['taxa', 'Taxa de serviço'],
    ['logo', 'Logomarca'],
    ['celular', 'Celular'],
  ];

  painel.innerHTML = `
    <nav class="config-ancoras" aria-label="Seções das configurações">
      ${SECOES.map(([id, rotulo]) => `<a class="config-ancora" href="#cfg-${id}" data-alvo="cfg-${id}">${escapar(rotulo)}</a>`).join('')}
    </nav>

    <div class="cartao cartao-secao" id="cfg-empresa">
      <h3 class="cartao-titulo">${ic('casa')} Empresa</h3>
      <p><small style="color:var(--texto-fraco)">Dados que aparecem no recibo e nas impressões.</small></p>
      <div class="grade-config">
        ${campos.map(([k, r]) => `<label><span class="campo-titulo">${escapar(r)}</span>
          <input class="campo" data-cfg="${k}" value="${escapar(cfg[k] ?? '')}" /></label>`).join('')}
      </div>
    </div>

    <div class="cartao cartao-secao" id="cfg-cupom">
      <h3 class="cartao-titulo">${ic('impressora')} Cupom não fiscal — bobina</h3>
      <p><small style="color:var(--texto-fraco)">Largura do papel, cabeçalho e rodapé impressos no cupom (tela Conta e recibo do caixa).</small></p>
      <div class="grade-config">
        <label><span class="campo-titulo">Largura da bobina</span>
          <select class="campo" data-cfg="recibo_largura_mm">
            <option value="80" ${cfg.recibo_largura_mm !== '58' ? 'selected' : ''}>80 mm (térmica padrão)</option>
            <option value="58" ${cfg.recibo_largura_mm === '58' ? 'selected' : ''}>58 mm (portátil)</option>
          </select></label>
        <label><span class="campo-titulo">Margem superior (mm)</span>
          <input class="campo" type="number" min="0" max="50" data-cfg="recibo_margem_sup_mm" value="${escapar(cfg.recibo_margem_sup_mm ?? '0')}" /></label>
        <label><span class="campo-titulo">Margem inferior (mm)</span>
          <input class="campo" type="number" min="0" max="50" data-cfg="recibo_margem_inf_mm" value="${escapar(cfg.recibo_margem_inf_mm ?? '0')}" /></label>
        <label><span class="campo-titulo">Extensão após o conteúdo (mm) — espaço antes do corte</span>
          <input class="campo" type="number" min="0" max="100" data-cfg="recibo_extensao_mm" value="${escapar(cfg.recibo_extensao_mm ?? '0')}" /></label>
        <label class="pers-check"><input type="checkbox" data-flag="recibo_logo_imprimir" ${cfg.recibo_logo_imprimir === '1' ? 'checked' : ''}/> <span><strong>Imprimir logomarca no cupom</strong><br><small style="color:var(--texto-fraco)">Usa a logo enviada na seção Logomarca.</small></span></label>
        <label><span class="campo-titulo">Modo de cor da logo (térmica imprime em preto)</span>
          <select class="campo" data-cfg="recibo_logo_modo">
            <option value="mono" ${cfg.recibo_logo_modo !== 'dither' && cfg.recibo_logo_modo !== 'original' ? 'selected' : ''}>Monocromático (recomendado)</option>
            <option value="dither" ${cfg.recibo_logo_modo === 'dither' ? 'selected' : ''}>Preto e branco — dithering</option>
            <option value="original" ${cfg.recibo_logo_modo === 'original' ? 'selected' : ''}>Original (colorido)</option>
          </select></label>
        <label><span class="campo-titulo">Brilho da logo (−100 a 100)</span>
          <input class="campo" type="number" min="-100" max="100" step="5" data-cfg="recibo_logo_brilho" value="${escapar(cfg.recibo_logo_brilho ?? '0')}" /></label>
        <label><span class="campo-titulo">Contraste da logo (−100 a 100)</span>
          <input class="campo" type="number" min="-100" max="100" step="5" data-cfg="recibo_logo_contraste" value="${escapar(cfg.recibo_logo_contraste ?? '0')}" /></label>
        <label class="pers-check"><input type="checkbox" data-flag="recibo_logo_bordas" ${cfg.recibo_logo_bordas === '1' ? 'checked' : ''}/> <span><strong>Bordas no cabeçalho gráfico</strong><br><small style="color:var(--texto-fraco)">Moldura preta em volta da logo impressa.</small></span></label>
        <label><span class="campo-titulo">Cabeçalho — linhas no topo, abaixo dos dados da empresa</span>
          <textarea class="campo" rows="2" data-cfg="recibo_cabecalho" placeholder="Ex.: Consumo no local&#10;Não é documento fiscal">${escapar(cfg.recibo_cabecalho ?? '')}</textarea></label>
        <label><span class="campo-titulo">Rodapé — mensagem final do cupom</span>
          <textarea class="campo" rows="2" data-cfg="recibo_rodape" placeholder="Ex.: Obrigado pela preferência!">${escapar(cfg.recibo_rodape ?? '')}</textarea></label>
      </div>
    </div>

    <div class="cartao cartao-secao" id="cfg-comportamento">
      <h3 class="cartao-titulo">${ic('engrenagem')} Comportamento do sistema</h3>
      <p><small style="color:var(--texto-fraco)">Chaves que mudam como o PDV e o caixa funcionam no dia a dia.</small></p>
      <div class="grade-config">
        <label class="pers-check"><input type="checkbox" data-flag="bloquear_apos_venda" ${cfg.bloquear_apos_venda === '1' ? 'checked' : ''}/> <span><strong>Bloquear tela após cada venda</strong><br><small style="color:var(--texto-fraco)">Volta ao PDV limpo depois de fechar um pedido.</small></span></label>
        <label class="pers-check"><input type="checkbox" data-flag="desconto_caixa_permitido" ${cfg.desconto_caixa_permitido === '1' ? 'checked' : ''}/> <span><strong>Permitir desconto pelo caixa</strong><br><small style="color:var(--texto-fraco)">Libera o campo de desconto no fechamento.</small></span></label>
        <label class="pers-check"><input type="checkbox" data-flag="modulo_kds" ${cfg.modulo_kds === '1' ? 'checked' : ''}/> <span><strong>Módulo KDS (cozinha)</strong><br><small style="color:var(--texto-fraco)">Tela de pedidos da cozinha no balcão.</small></span></label>
        <label class="pers-check"><input type="checkbox" data-flag="modulo_comanda" ${cfg.modulo_comanda === '1' ? 'checked' : ''}/> <span><strong>Módulo comanda do garçom</strong><br><small style="color:var(--texto-fraco)">Permite abrir comandas pelo garçom.</small></span></label>
      </div>
    </div>

    <div class="cartao cartao-secao" id="cfg-salao">
      <h3 class="cartao-titulo">${ic('mesa')} Salão Pro — mesas e comandas</h3>
      <p><small style="color:var(--texto-fraco)">Como o sistema chama as contas, check-in de cliente, comissão e ociosidade.</small></p>
      <div class="grade-config">
        <label><span class="campo-titulo">Mesa ou comanda? (nomenclatura no PDV e impressões)</span>
          <select class="campo" data-cfg="nomenclatura_pedido">
            <option value="mesa" ${cfg.nomenclatura_pedido === 'mesa' ? 'selected' : ''}>Mesa</option>
            <option value="comanda" ${cfg.nomenclatura_pedido === 'comanda' ? 'selected' : ''}>Comanda</option>
          </select></label>
        <label><span class="campo-titulo">Mesa ociosa após (minutos)</span>
          <input class="campo" type="number" min="1" max="1440" data-cfg="mesa_ociosa_minutos" value="${escapar(cfg.mesa_ociosa_minutos ?? '45')}" /></label>
        <label><span class="campo-titulo">Comissão dos garçons (%)</span>
          <input class="campo" type="number" min="0" max="100" step="0.5" data-cfg="comissao_pct" value="${escapar(cfg.comissao_pct ?? '0')}" /></label>
        <label><span class="campo-titulo">Largura do mapa do salão (px)</span>
          <input class="campo" type="number" min="400" max="5000" data-cfg="layout_salao_largura" value="${escapar(cfg.layout_salao_largura ?? '1200')}" /></label>
        <label><span class="campo-titulo">Altura do mapa do salão (px)</span>
          <input class="campo" type="number" min="300" max="5000" data-cfg="layout_salao_altura" value="${escapar(cfg.layout_salao_altura ?? '800')}" /></label>
        <label class="pers-check"><input type="checkbox" data-flag="checkin_obrigatorio" ${cfg.checkin_obrigatorio === '1' ? 'checked' : ''}/> <span><strong>Check-in de cliente obrigatório</strong></span></label>
        <label class="pers-check"><input type="checkbox" data-flag="checkin_exige_cadastro" ${cfg.checkin_exige_cadastro === '1' ? 'checked' : ''}/> <span><strong>Exigir cliente cadastrado no check-in</strong></span></label>
      </div>
    </div>

    <div class="cartao cartao-secao" id="cfg-taxa">
      <h3 class="cartao-titulo">${ic('recibo')} Taxa de serviço</h3>
      <p><small style="color:var(--texto-fraco)">Percentual ou valor fixo por conta. Alterar aqui recalcula as comandas já abertas.</small></p>
      <div class="grade-config">
        <label><span class="campo-titulo">Modo</span>
          <select class="campo" data-cfg="taxa_servico_modo">
            <option value="desativada" ${cfg.taxa_servico_modo === 'desativada' ? 'selected' : ''}>Desativada</option>
            <option value="percentual" ${cfg.taxa_servico_modo === 'percentual' ? 'selected' : ''}>Percentual</option>
            <option value="fixa" ${cfg.taxa_servico_modo === 'fixa' ? 'selected' : ''}>Valor fixo</option>
          </select></label>
        <label><span class="campo-titulo">Percentual (%)</span>
          <input class="campo" type="number" min="0" max="100" step="0.5" data-cfg="taxa_servico_pct" value="${escapar(cfg.taxa_servico_pct ?? '10')}" /></label>
        <label><span class="campo-titulo">Valor fixo (R$)</span>
          <input class="campo" inputmode="decimal" data-cfg="taxa_servico_fixo_centavos" data-centavos value="${escapar(reaisComoTexto(cfg.taxa_servico_fixo_centavos ?? '0'))}" /></label>
        <label><span class="campo-titulo">Cobrar sobre</span>
          <select class="campo" data-cfg="taxa_servico_cobrar_por">
            <option value="subtotal" ${cfg.taxa_servico_cobrar_por === 'subtotal' ? 'selected' : ''}>Subtotal (após desconto)</option>
            <option value="bruto" ${cfg.taxa_servico_cobrar_por === 'bruto' ? 'selected' : ''}>Bruto (ignora desconto)</option>
          </select></label>
      </div>
    </div>

    <div class="cartao cartao-secao" id="cfg-logo">
      <h3 class="cartao-titulo">${ic('imagem')} Logomarca</h3>
      <div id="logo-atual">${cfg.logo_path ? `<img src="/${escapar(cfg.logo_path)}" alt="Logo atual" style="max-width:220px;max-height:120px;border-radius:8px;border:1px solid var(--borda)" />` : '<div class="vazio">Sem logo — usando emoji padrão</div>'}</div>
      <input type="file" id="logo-arq" accept="image/png,image/jpeg" style="margin-top:10px" aria-label="Arquivo da logomarca (PNG ou JPEG até 400 KB)" />
      <div id="logo-prev"></div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn primario" id="logo-enviar" style="flex:1">Enviar logo</button>
        ${cfg.logo_path ? '<button class="btn ghost perigo" id="logo-remover">Remover</button>' : ''}
      </div>
    </div>

    <div class="cartao cartao-secao" id="cfg-celular">
      <h3 class="cartao-titulo">${ic('celular')} Conexão via Celular — Rede Local e Online (AWS)</h3>
      <p><small style="color:var(--texto-fraco)">Escaneie com a câmera do celular. Os QR Codes são gerados aqui mesmo, sem enviar o endereço da sua rede a nenhum serviço externo.</small></p>
      <div style="display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap">
        <div style="flex:1;min-width:260px">
          <h4>${ic('antena')} Rede local (Wi-Fi)</h4>
          <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap">
            <div style="background:#fff;padding:8px;border-radius:10px;box-shadow:var(--shadow-2)">${qrSvg}</div>
            <div style="flex:1;min-width:200px">
              <label class="sr-only" for="url-mobile">Endereço de acesso local</label>
              <code id="url-mobile" style="display:block;padding:10px;background:var(--canvas);border-radius:8px;border:1px solid var(--borda);word-break:break-all;font-size:0.9rem">${escapar(urlMobile)}</code>
              <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
                <button class="btn ghost" id="copiar-url">${ic('check')} Copiar Link</button>
                <a class="btn ghost" href="${escapar(urlMobile)}" target="_blank" rel="noopener">${ic('celular')} Testar</a>
              </div>
              <p><small style="color:var(--texto-fraco)">O celular precisa estar na <strong>mesma rede Wi-Fi</strong> deste computador.</small></p>
            </div>
          </div>
        </div>
        <div style="flex:1;min-width:260px;border-left:1px solid var(--borda);padding-left:20px">
          <h4>${ic('globo')} Online — servidor na nuvem (AWS)</h4>
          <label><span class="campo-titulo">Endereço público (deixe vazio p/ só rede local)</span>
            <input class="campo" data-cfg="url_publica" value="${escapar(cfg.url_publica ?? '')}" placeholder="https://pdv.sualanchonete.com.br" /></label>
          ${urlOnline ? `
            <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap;margin-top:10px">
              <div style="background:#fff;padding:8px;border-radius:10px;box-shadow:var(--shadow-2)">${qrSvgOnline}</div>
              <div style="flex:1;min-width:200px">
                <code id="url-online" style="display:block;padding:10px;background:var(--canvas);border-radius:8px;border:1px solid var(--borda);word-break:break-all;font-size:0.9rem">${escapar(urlOnline)}</code>
                <p><small style="color:var(--texto-fraco)">Funciona de qualquer lugar com internet — sem Wi-Fi da loja. Salve o campo acima para gerar o QR.</small></p>
              </div>
            </div>` : `
            <p><small style="color:var(--texto-fraco)">Defina o endereço do seu servidor na nuvem (EC2, ECS Fargate ou Elastic Beanstalk) e salve. O guia completo está em <code>DEPLOY_AWS.md</code> e no painel do desenvolvedor.</small></p>`}
        </div>
      </div>
    </div>

    <div class="config-save">
      <span id="config-aviso" class="config-aviso" role="status" aria-live="polite"></span>
      <button class="btn primario grande" id="salvar">${ic('check')} Salvar configurações</button>
    </div>`;

  // Âncoras: rola até a seção sem mexer no hash, que é o que mantém esta aba
  // aberta quando a página é recarregada.
  painel.querySelectorAll('[data-alvo]').forEach((a) => {
    a.onclick = (ev) => {
      ev.preventDefault();
      const alvo = painel.querySelector(`#${a.dataset.alvo}`);
      if (alvo) alvo.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });

  // Marca a barra de salvar quando há alteração não gravada. Sem isso, dá para
  // mudar a taxa de serviço, rolar a página e não perceber que nada foi salvo.
  const aviso = painel.querySelector('#config-aviso');
  painel.querySelectorAll('[data-cfg],[data-flag]').forEach((el) => {
    const evento = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(evento, () => {
      painel.querySelector('.config-save').classList.add('sujo');
      aviso.textContent = 'Alterações não salvas';
    });
  });

  painel.querySelector('#copiar-url').onclick = async () => {
    try {
      await navigator.clipboard.writeText(urlMobile);
      toast('Link copiado!', 'ok');
    } catch {
      // clipboard pode ser bloqueado (http sem HTTPS): orienta a cópia manual.
      const el = painel.querySelector('#url-mobile');
      const sel = window.getSelection();
      sel.selectAllChildren(el);
      toast('Copie o endereço abaixo (Ctrl+C)', 'erro');
    }
  };

  painel.querySelector('#salvar').onclick = async () => {
    const corpo = {};
    painel.querySelectorAll('[data-cfg]').forEach((i) => { corpo[i.dataset.cfg] = i.value; });
    painel.querySelectorAll('[data-flag]').forEach((i) => { corpo[i.dataset.flag] = i.checked ? '1' : '0'; });
    // Campos marcados com data-centavos são digitados como R$ e gravados em centavos.
    painel.querySelectorAll('[data-centavos]').forEach((i) => {
      const v = reaisParaCentavos(i.value || '0');
      corpo[i.dataset.cfg] = v === null ? '0' : String(v);
    });
    try {
      const r = await put('/config', corpo);
      // Só agora a barra pode voltar ao estado normal.
      painel.querySelector('.config-save').classList.remove('sujo');
      const a = painel.querySelector('#config-aviso');
      if (a) a.textContent = 'Tudo salvo';
      toast(r.taxas_recalculadas
        ? `Configurações salvas · ${r.taxas_recalculadas} comanda(s) open(s) recalculada(s)`
        : 'Configurações salvas', 'ok');
    } catch (e) { toast(e.message, 'erro'); }
  };
  const inputLogo = painel.querySelector('#logo-arq');
  if (inputLogo) {
    inputLogo.onchange = () => {
      const arq = inputLogo.files[0];
      const prev = painel.querySelector('#logo-prev');
      if (!arq) { prev.innerHTML = ''; return; }
      if (arq.size > 400 * 1024) { toast('Arquivo maior que 400 KB', 'erro'); inputLogo.value = ''; prev.innerHTML = ''; return; }
      const url = URL.createObjectURL(arq);
      prev.innerHTML = `<img src="${url}" alt="Prévia da logo" style="max-width:220px;max-height:120px;margin-top:8px;border-radius:8px;border:1px solid var(--borda)" />`;
    };
    painel.querySelector('#logo-enviar').onclick = () => {
      const arq = inputLogo.files[0];
      if (!arq) { toast('Escolha um arquivo PNG ou JPEG', 'erro'); return; }
      const leitor = new FileReader();
      leitor.onload = async () => {
        try {
          await post('/config/logo', { imagem_data_url: String(leitor.result) });
          toast('Logomarca atualizada', 'ok');
          telaConfig(painel);
        } catch (e) { toast(e.message, 'erro'); }
      };
      leitor.onerror = () => toast('Falha ao ler o arquivo', 'erro');
      leitor.readAsDataURL(arq);
    };
    const btnRemover = painel.querySelector('#logo-remover');
    if (btnRemover) btnRemover.onclick = async () => {
      if (!await confirmar('Remover logo?', 'Volta ao emoji padrão.')) return;
      try { await del('/config/logo'); toast('Logo removida', 'ok'); telaConfig(painel); }
      catch (e) { toast(e.message, 'erro'); }
    };
  }
}

async function telaComissoes(painel) {
  const hoje = new Date().toISOString().slice(0, 10);
  // Mesmo caso do relatorio: o PDF precisa sair com o nome real da empresa.
  let nomeEmpresa = 'Mercury PDV';
  try { nomeEmpresa = (await get('/config')).empresa_nome || nomeEmpresa; } catch { /* segue com o padrao */ }
  painel.innerHTML = `
    <div class="cartao" style="max-width:520px;margin-bottom:12px">
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input type="date" id="de" aria-label="Data inicial" value="${hoje}" style="flex:1;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
        <input type="date" id="ate" aria-label="Data final" value="${hoje}" style="flex:1;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
        <button class="btn primario" id="ver">${ic('lupa')} Ver</button>
        <button class="btn" id="pdf" disabled>${ic('documento')} PDF</button>
      </div>
    </div>
    <div id="res"><div class="vazio">Escolha o período</div></div>`;

  let ultimo = null;
  painel.querySelector('#ver').onclick = async () => {
    const de = painel.querySelector('#de').value, ate = painel.querySelector('#ate').value;
    try {
      const r = await get(`/salao/comissoes?de=${de}&ate=${ate}`);
      ultimo = r;
      painel.querySelector('#pdf').disabled = false;
      const box = painel.querySelector('#res');
      box.className = '';
      box.innerHTML = `
        <div class="resumo-cards">
          <div class="cartao"><small>Gorjeta total</small><span class="v" style="color:var(--ok)">${fmt(r.total_gorjeta_centavos)}</span></div>
          <div class="cartao"><small>Comissão (${r.comissao_pct}%)</small><span class="v" style="color:var(--acao)">${fmt(r.total_comissao_centavos)}</span></div>
          <div class="cartao"><small>Vendido por garçons</small><span class="v">${fmt(r.total_vendido_centavos)}</span></div>
        </div>
        <p><small style="color:var(--texto-fraco)">Base da comissão: <strong>gorjeta</strong>. Registre a gorjeta no fechamento da conta (Caixa → pedido → Gorjeta) para que ela entre aqui.</small></p>
        <table class="dados"><thead><tr><th scope="col">Garçom</th><th scope="col">Comandas</th><th scope="col">Vendido</th><th scope="col">Ticket médio</th><th scope="col">Gorjeta</th><th scope="col">Comissão</th></tr></thead>
        <tbody>${r.por_garcom.map((g) => `<tr>
          <td><strong>${escapar(g.garcom_nome)}</strong></td>
          <td class="num">${g.comandas_fechadas}</td>
          <td class="num">${fmt(g.vendido_centavos)}</td>
          <td class="num">${fmt(g.ticket_medio_centavos)}</td>
          <td class="num" style="color:var(--ok)">${fmt(g.gorjeta_centavos)} <small style="color:var(--texto-fraco)">(${g.gorjeta_ocorrencias}×)</small></td>
          <td class="num"><strong>${fmt(g.comissao_centavos)}</strong></td>
        </tr>`).join('') || '<tr><td colspan="6" class="vazio">Sem movimento no período</td></tr>'}</tbody>
        <tfoot><tr><th scope="row">Total</th><th scope="col" class="num">${r.por_garcom.reduce((s, g) => s + g.comandas_fechadas, 0)}</th>
          <th scope="col" class="num">${fmt(r.total_vendido_centavos)}</th><th scope="col"></th>
          <th scope="col" class="num">${fmt(r.total_gorjeta_centavos)}</th><th scope="col" class="num">${fmt(r.total_comissao_centavos)}</th></tr></tfoot>
        </table>`;
    } catch (e) { toast(e.message, 'erro'); }
  };

  painel.querySelector('#pdf').onclick = async () => {
    if (!ultimo) { toast('Gere o relatório primeiro', 'erro'); return; }
    try {
      const { exportarRelatorioPDF, baixarPDF } = await import('../pdfExport.js');
      const doc = await exportarRelatorioPDF(
        { top_produtos: [], por_forma: {} },
        { de: painel.querySelector('#de').value, ate: painel.querySelector('#ate').value, empresa_nome: nomeEmpresa },
      );
      baixarPDF(doc, `comissoes-${ultimo.total_comissao_centavos}.pdf`);
      toast('PDF gerado', 'ok');
    } catch (e) { toast(`Erro ao gerar PDF: ${e.message}`, 'erro'); }
  };
}

async function telaBackups(painel) {
  const lista = await get('/backups');
  painel.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <button class="btn primario grande" id="fazer">${ic('disquete')} Fazer backup agora</button>
      <button class="btn" id="up-backup" title="Envia um .sqlite para a pasta de backups (validado)">${ic('upload')} Importar backup</button>
      <input type="file" id="arq-backup" aria-label="Selecionar arquivo de backup para restaurar" accept=".sqlite" style="display:none" />
    </div>
    <p><small style="color:var(--texto-fraco)">Destino: ${escapar(lista.destino)} · Retenção e intervalo no arquivo .env</small></p>
    <table class="dados"><thead><tr><th scope="col">Arquivo</th><th scope="col">Tamanho</th><th scope="col">Data</th><th scope="col"><span class="sr-only">Ações</span></th></tr></thead>
    <tbody>${lista.backups.map((b) => `<tr><td>${escapar(b.arquivo)}</td><td class="num">${(b.bytes / 1024).toFixed(1)} KB</td><td>${new Date(b.criado_em).toLocaleString('pt-BR')}</td>
      <td><button class="btn ghost" data-dl="${escapar(b.arquivo)}" title="Baixar arquivo">${ic('seta-baixo')}</button></td></tr>`).join('') || '<tr><td colspan="4" class="vazio">Nenhum backup</td></tr>'}</tbody></table>
    <h3>Últimas execuções</h3>
    <table class="dados"><tbody>${lista.historico.map((h) => `<tr><td>${new Date(h.criado_em).toLocaleString('pt-BR')}</td><td>${h.motivo}</td><td class="badge ${h.integrity === 'ok' ? 'ok' : 'alerta'}">${h.integrity}</td></tr>`).join('') || '<tr><td class="vazio">—</td></tr>'}</tbody></table>
    <div class="cartao" style="margin-top:12px">
      <h3 style="margin-top:0">${ic('reciclar')} Restaurar backup do sistema</h3>
      <p><small style="color:var(--texto-fraco)">Por segurança, a restauração <strong>não</strong> é feita com o servidor rodando (o arquivo do banco estaria travado e corromperia). Passos:</small></p>
      <ol class="lista-passos">
        <li>Baixe o backup desejado (${ic('seta-baixo')}) ou importe um arquivo (${ic('upload')}).</li>
        <li>Pare o servidor: <code>scripts\\parar_sistema.bat</code>.</li>
        <li>Execute no PowerShell: <code>.\\scripts\\restaurar_backup.ps1 -Arquivo "NOME-DO-ARQUIVO.sqlite"</code> (pede confirmação digitada e valida a integridade antes).</li>
        <li>Inicie de novo: <code>scripts\\iniciar_sistema.bat</code>.</li>
      </ol>
    </div>`;
  painel.querySelector('#fazer').onclick = async () => {
    try { const r = await post('/backups', {}); toast(`Backup OK (${r.bytes} bytes, integridade ${r.integrity})`, 'ok'); telaBackups(painel); }
    catch (e) { toast(e.message, 'erro'); }
  };
  painel.querySelectorAll('[data-dl]').forEach((b) => {
    b.onclick = () => { window.location.href = `/api/backups/download/${b.dataset.dl}`; };
  });
  painel.querySelector('#up-backup').onclick = () => painel.querySelector('#arq-backup').click();
  painel.querySelector('#arq-backup').onchange = async () => {
    const arq = painel.querySelector('#arq-backup').files[0];
    if (!arq) return;
    if (arq.size > 60 * 1024 * 1024) { toast('Arquivo maior que 60 MB', 'erro'); return; }
    const buf = await arq.arrayBuffer();
    let b64 = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 8192) {
      b64 += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    }
    try {
      const r = await post('/backups/upload', { nome: arq.name, conteudo_base64: btoa(b64) });
      toast(`Backup importado e validado (${r.bytes} bytes)`, 'ok');
      telaBackups(painel);
    } catch (e) { toast(e.message, 'erro'); }
  };
}

async function telaAuditoria(painel) {
  const eventos = await get('/auditoria?limite=120');
  painel.innerHTML = `
    <table class="dados"><thead><tr><th scope="col">Quando</th><th scope="col">Usuário</th><th scope="col">Ação</th><th scope="col">Detalhes</th></tr></thead>
    <tbody>${eventos.map((e) => `<tr>
      <td>${new Date(e.criado_em).toLocaleString('pt-BR')}</td>
      <td>${escapar(e.usuario_nome ?? '—')}</td>
      <td><span class="badge">${escapar(e.acao)}</span></td>
      <td><small style="color:var(--texto-fraco)">${escapar(e.detalhes ?? '')}</small></td></tr>`).join('')}</tbody></table>`;
}

async function telaDev(painel) {
  painel.innerHTML = `
    <div class="cartao" style="max-width:520px">
      <h3 style="margin-top:0">Painel do desenvolvedor</h3>
      <p><small>Acesso protegido por reautenticação de administrador (sem senha mestra universal).</small></p>
      <input id="usuario" placeholder="Usuário admin" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)"/>
      <input id="senha" type="password" placeholder="Senha do admin (a senha forte, não o PIN)" autocomplete="off" style="width:100%;padding:12px;margin-top:8px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)"/>
      <button class="btn primario" style="width:100%;margin-top:10px" id="entrar">Abrir painel</button>
      <div id="saida"></div>
    </div>`;
  painel.querySelector('#entrar').onclick = async () => {
    try {
      const r = await post('/admin/dev', { admin_usuario: painel.querySelector('#usuario').value.trim(), admin_senha: painel.querySelector('#senha').value });
      const d = r.diagnostico;
      const rotuloInd = {
        node: 'Node.js', uptime_s: 'Uptime (s)', ambiente: 'Ambiente', db_bytes: 'Banco (bytes)',
        seq_eventos: 'Seq de eventos', usuarios: 'Usuários', pedidos_abertos: 'Pedidos abertos',
        caixa_aberto: 'Caixa aberto', backups: 'Backups', mem_mb: 'Memória (MB)',
        dispositivos_conectados: 'Dispositivos conectados', url_publica: 'Endereço online', versao: 'Versão',
      };
      painel.querySelector('#saida').innerHTML = `
        <div class="abas" style="margin-top:14px" role="tablist" aria-label="Seções do painel dev">
          <button class="btn ativa" role="tab" aria-selected="true" data-dev="diag">Diagnóstico</button>
          <button class="btn" role="tab" aria-selected="false" data-dev="aws">${ic('globo')} Cloud AWS & DevOps</button>
          <button class="btn" role="tab" aria-selected="false" data-dev="disp">${ic('antena')} Dispositivos</button>
          <button class="btn" role="tab" aria-selected="false" data-dev="usu">${ic('pessoas')} Usuários</button>
        </div>
        <div id="dev-conteudo" class="cartao" style="margin-top:10px"></div>`;
      const area = painel.querySelector('#dev-conteudo');

      const telas = {
        diag: () => {
          area.innerHTML = `<table class="dados"><tbody>${Object.entries(d).map(([k, v]) => `<tr><td>${escapar(rotuloInd[k] ?? k)}</td><td class="num">${escapar(String(v))}</td></tr>`).join('')}</tbody></table>`;
        },
        aws: () => {
          const url = d.url_publica || '';
          let qr = '';
          try { if (url) qr = qrcodeSVG(`${url}/#comandas`, { tamanho: 150, margem: 3 }); } catch { /* opcional */ }
          area.innerHTML = `
            <h3 style="margin-top:0">${ic('globo')} Cloud AWS & DevOps (1.3.1)</h3>
            <p><small style="color:var(--texto-fraco)">Guia completo em <code>DEPLOY_AWS.md</code> na raiz do projeto. Arquivos prontos em <code>deploy/aws/</code>.</small></p>
            <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">
              <div style="flex:1;min-width:240px">
                <h4>${ic('celular')} Endereço de conexão online</h4>
                ${url ? `
                  <code style="display:block;padding:10px;background:var(--canvas);border-radius:8px;border:1px solid var(--borda);word-break:break-all">${escapar(url)}</code>
                  <p><small style="color:var(--texto-fraco)">Garçons conectam pelo celular em <strong>${escapar(url)}/#comandas</strong> — de qualquer lugar com internet.</small></p>` : `
                  <div class="vazio" style="padding:10px">Sem endereço configurado. Defina em <strong>Configurações → Celular → Online (AWS)</strong> ou via <code>LP_URL_PUBLICA</code> no <code>.env</code>.</div>`}
                ${qr ? `<div style="background:#fff;padding:8px;border-radius:10px;display:inline-block;margin-top:8px">${qr}</div>` : ''}
              </div>
              <div style="flex:1;min-width:260px">
                <h4>${ic('pacote')} Caminhos de implantação</h4>
                <table class="dados"><tbody>
                  <tr><td><strong>EC2 + Docker Compose</strong></td><td><code>deploy/aws/docker-compose.yml</code> — o mais simples e barato; dados em volume EBS</td></tr>
                  <tr><td><strong>ECS Fargate</strong></td><td><code>deploy/aws/ecs-task-definition.json</code> — sem servidor gerenciar; dados em EFS</td></tr>
                  <tr><td><strong>Elastic Beanstalk</strong></td><td><code>deploy/aws/Dockerrun.aws.json</code> — plataforma Docker gerenciada</td></tr>
                </tbody></table>
                <h4>Comandos rápidos</h4>
                <pre style="background:var(--canvas);padding:10px;border-radius:8px;border:1px solid var(--borda);overflow:auto;font-size:0.8rem"># build e push p/ ECR
aws ecr get-login-password | docker login ...
docker build -t mercury-pdv:1.3.1 -f deploy/aws/Dockerfile .
# EC2 (na instância)
docker compose -f deploy/aws/docker-compose.yml up -d --build</pre>
              </div>
            </div>`;
        },
        disp: async () => {
          let r = { total: 0, itens: [] };
          try { r = await get('/dispositivos'); } catch { /* segue */ }
          area.innerHTML = `
            <h3 style="margin-top:0">${ic('antena')} Dispositivos sincronizados (${r.total ?? 0})</h3>
            <table class="dados"><thead><tr><th scope="col">Operador</th><th scope="col">Cargo</th><th scope="col">Origem</th><th scope="col">IP</th><th scope="col">Conectado desde</th></tr></thead>
            <tbody>${(r.itens ?? []).map((c) => `<tr>
              <td>${escapar(c.usuario)}</td><td>${escapar(c.cargo)}</td>
              <td>${ic('celular')} ${escapar(c.dispositivo)}</td>
              <td><small>${escapar(c.ip ?? '—')}</small></td>
              <td><small>${new Date(c.desde).toLocaleString('pt-BR')}</small></td>
            </tr>`).join('') || '<tr><td colspan="5" class="vazio">Nenhum dispositivo conectado via WebSocket agora (PDV, garçom mobile, web)</td></tr>'}</tbody></table>
            <p><small style="color:var(--texto-fraco)">Sessões completas (IP, última atividade, desconexão) ficam na aba <strong>Pessoas → Sessões ativas</strong>.</small></p>`;
        },
        usu: async () => {
          // Lista TODOS (inclusive excluídos/desativados) e permite excluir, com
          // reautenticação de gestor usando as credenciais já digitadas acima.
          area.innerHTML = '<div class="vazio" style="padding:10px">Carregando…</div>';
          let lista = [];
          try { lista = (await get('/admin/dev/usuarios')).usuarios ?? []; }
          catch (e) { toast(e.message, 'erro'); }
          const rotuloCargo = { admin: 'Administrador', proprietario: 'Proprietário', caixa: 'Caixa', garcom: 'Garçom', cozinha: 'Cozinha' };
          area.innerHTML = `
            <h3 style="margin-top:0">${ic('pessoas')} Usuários cadastrados (${lista.length})</h3>
            <p><small style="color:var(--texto-fraco)">A exclusão é <strong>lógica</strong>: o acesso é cortado na hora (sessões derrubadas) e o nome volta a ficar livre para recadastro — o histórico de pedidos, caixa e auditoria é preservado.</small></p>
            <table class="dados"><thead><tr><th scope="col">Usuário</th><th scope="col">Cargo</th><th scope="col">Situação</th><th scope="col">Último acesso</th><th scope="col"><span class="sr-only">Ações</span></th></tr></thead>
            <tbody>${lista.map((u) => `<tr>
              <td>${escapar(u.nome)}</td>
              <td>${escapar(rotuloCargo[u.cargo] ?? u.cargo)}</td>
              <td>${u.ativo ? '<span class="badge ok">ativo</span>' : '<span class="badge alerta">excluído</span>'}</td>
              <td><small>${u.ultimo_login ? new Date(u.ultimo_login).toLocaleString('pt-BR') : '—'}</small></td>
              <td style="white-space:nowrap">${u.ativo
                ? `<button class="btn ghost" data-excluir="${u.id}" data-nome="${escapar(u.nome)}" data-cargo="${escapar(u.cargo)}">${ic('lixeira')} Excluir</button>`
                : `<button class="btn ghost" data-restaurar="${u.id}" data-nome="${escapar(u.nome)}">${ic('sincronizar')} Reativar</button>`}</td></tr>`).join('')
              || '<tr><td colspan="5" class="vazio">Nenhum usuário cadastrado.</td></tr>'}</tbody></table>`;
          // Step-up: reaproveita as credenciais de gestor digitadas no topo do painel.
          const credenciais = () => {
            const usuario = painel.querySelector('#usuario').value.trim();
            const senha = painel.querySelector('#senha').value;
            if (!usuario || !senha) {
              toast('Redigite usuário e senha do administrador no topo para autorizar.', 'erro');
              painel.querySelector('#senha').focus();
              return null;
            }
            return { admin_usuario: usuario, admin_senha: senha };
          };
          area.querySelectorAll('[data-restaurar]').forEach((b) => {
            b.onclick = async () => {
              const cred = credenciais();
              if (!cred) return;
              const nome = String(b.dataset.nome).replace(/\s*\(excluído \d+\)$/i, '');
              if (!await confirmar('Reativar usuário?',
                `"${escapar(nome)}" volta a acessar o sistema com o nome original${nome !== b.dataset.nome ? ` ("${escapar(b.dataset.nome)}" → "${escapar(nome)}")` : ''}.`)) return;
              try {
                const r = await post(`/admin/dev/usuarios/${b.dataset.restaurar}/restaurar`, cred);
                toast(`Usuário "${r.nome}" reativado`, 'ok');
                telas.usu();
              } catch (e) { toast(e.message, 'erro'); }
            };
          });
          area.querySelectorAll('[data-excluir]').forEach((b) => {
            b.onclick = async () => {
              const cred = credenciais();
              if (!cred) return;
              const nome = b.dataset.nome;
              if (!await confirmar('Excluir usuário?',
                `"${escapar(nome)}" perde o acesso imediatamente (as sessões abertas caem) e o nome fica livre para recadastro. O histórico é preservado.`,
                { perigo: true })) return;
              try {
                await post(`/admin/dev/usuarios/${b.dataset.excluir}/excluir`, cred);
                toast(`Usuário "${nome}" excluído`, 'ok');
                telas.usu();
              } catch (e) { toast(e.message, 'erro'); }
            };
          });
        },
      };
      painel.querySelectorAll('[data-dev]').forEach((b) => {
        b.onclick = () => {
          painel.querySelectorAll('[data-dev]').forEach((x) => { x.classList.remove('ativa'); x.setAttribute('aria-selected', 'false'); });
          b.classList.add('ativa'); b.setAttribute('aria-selected', 'true');
          telas[b.dataset.dev]();
        };
      });
      telas.diag();
    } catch (e) { toast(e.message, 'erro'); }
  };
}

// Aba "Aparência": agora é a CENTRAL DE PERSONALIZAÇÃO unificada (P-05).
// Reúne os controles de aparência, leitura e navegação num só lugar, sem
// remover nenhuma das funções originais de theme.js / a11y.js.
async function telaTema(painel, estadoApp) {
  const { renderPersonalizacao } = await import('../personalizacao.js');
  painel.innerHTML = `
    <div class="cartao" style="margin-bottom:12px;border-color:var(--acao)">
      <strong>${ic('paleta')} Central de Personalização</strong>
      <p style="margin:6px 0 0"><small style="color:var(--texto-fraco)">
        Tudo o que era ajustado em telas separadas agora está aqui: tema, cores, densidade,
        tamanho da fonte, alto contraste, animações, modo uma mão e posição do menu.
      </small></p>
    </div>
    <div id="pers-raiz"></div>`;
  renderPersonalizacao(painel.querySelector('#pers-raiz'), {
    podeConfigSistema: !!estadoApp?.permissoes?.pode_config_sistema,
  });
}

// ============================================================
// 1.3.1 — IMPRESSÃO TÉRMICA CUSTOMIZÁVEL
// Cadastro de impressoras USB / Bluetooth / Rede IP com bobina 58 ou 80mm,
// cabeçalho/rodapé personalizados e pré-visualização em tempo real.
// A impressão física continua via diálogo do sistema operacional (instale a
// impressora no Windows/celular); o Mercury formata o layout da bobina.
// ============================================================
const ROTULO_CONEXAO = { usb: 'USB', bluetooth: 'Bluetooth', rede: 'Rede (IP)' };

// Gera o texto da pré-visualização (igual ao servidor, sem rede).
function previaImpressao({ nome, conexao, endereco, largura, cabecalho, rodape, vias }, cfgEmpresa) {
  const larg = Number(largura) === 58 ? 30 : 40;
  const linha = '-'.repeat(larg);
  const cab = String(cabecalho ?? '').split(/\r?\n/).filter(Boolean);
  const rod = String(rodape ?? '').split(/\r?\n/).filter(Boolean);
  const itens = [
    { q: 2, nome: 'X-Burger (exemplo)', total: '50,00' },
    { q: 1, nome: 'Refrigerante (exemplo)', total: '6,00' },
  ];
  return [
    ...cab,
    cfgEmpresa?.empresa_nome ?? 'Mercury PDV',
    cfgEmpresa?.empresa_cnpj ?? '',
    cfgEmpresa?.empresa_telefone ?? '',
    cfgEmpresa?.empresa_endereco ?? '',
    linha,
    `TESTE — ${nome || 'Impressora'}`,
    `${ROTULO_CONEXAO[conexao] ?? conexao}${endereco ? ' · ' + endereco : ''} · Bobina ${largura}mm`,
    `Emitido em ${new Date().toLocaleString('pt-BR')}`,
    linha,
    ...itens.map((i) => `${i.q}x ${i.nome}\n${String(i.total).padStart(larg)}`),
    linha,
    `TOTAL${'56,00'.padStart(larg - 5)}`,
    linha,
    `VIAS: ${vias || 1}`,
    ...rod,
    'Documento nao fiscal - teste de configuracao',
  ].filter((l) => l !== '').join('\n');
}

async function telaImpressao(painel) {
  const [dados, cfg] = await Promise.all([
    get('/impressoras').catch(() => ({ impressoras: [] })),
    get('/config').catch(() => ({})),
  ]);
  const impressoras = dados.impressoras ?? [];
  const padraoId = cfg.impressora_padrao_id ?? '';

  painel.innerHTML = `
    <div class="cartao" style="margin-bottom:12px">
      <strong>${ic('impressora')} Impressoras térmicas</strong>
      <p style="margin:6px 0 0"><small style="color:var(--texto-fraco)">
        Cadastre impressoras <strong>USB</strong>, <strong>Bluetooth</strong> ou <strong>Rede (IP)</strong> com bobina 58mm ou 80mm.
        Personalize o cabeçalho e o rodapé e veja a pré-visualização em tempo real.
        A impressão usa o diálogo do sistema operacional — instale a impressora no Windows e escolha-a ao imprimir.
      </small></p>
    </div>
    <div class="cartao" style="margin-bottom:12px">
      <strong>${ic('engrenagem')} Modo Kiosque — impressão silenciosa</strong>
      <p style="margin:6px 0 8px"><small style="color:var(--texto-fraco)">
        Cria na Área de Trabalho o atalho <strong>Mercury PDV - Modo Kiosque</strong>, que abre o sistema no navegador com
        <code>--kiosk-printing</code>: o cupom vai direto para a impressora padrão, sem o diálogo de impressão.
      </small></p>
      <div id="kiosque-estado" class="vazio" style="padding:6px 0">Verificando…</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
        <button class="btn primario" id="kiosque-ativar">Ativar no Windows</button>
        <button class="btn ghost perigo" id="kiosque-remover">Remover atalho</button>
      </div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
      <button class="btn primario" id="imp-nova">+ Nova impressora</button>
      <label class="campo-inline" style="display:flex;gap:8px;align-items:center">
        <span style="color:var(--texto-fraco)">Impressora padrão:</span>
        <select id="imp-padrao" class="campo" style="width:auto;min-width:200px">
          <option value="">— nenhuma (usa bobina do recibo) —</option>
          ${impressoras.map((i) => `<option value="${i.id}" ${String(i.id) === String(padraoId) ? 'selected' : ''}>${escapar(i.nome)} (${ROTULO_CONEXAO[i.conexao] ?? i.conexao})</option>`).join('')}
        </select>
      </label>
    </div>
    <div id="imp-lista"></div>
    <div class="cartao" style="margin-top:12px">
      <h3 style="margin-top:0">${ic('documento')} Pré-visualização (impressora padrão)</h3>
      <div id="imp-previa-padrao"></div>
    </div>`;

  // Modo Kiosque: estado do atalho + criar/remover (a criação é registrada em auditoria).
  const kEstado = painel.querySelector('#kiosque-estado');
  async function refletirKiosque() {
    try {
      const st = await get('/sistema/atalho-kiosque');
      if (!st.suportado) { kEstado.textContent = 'Google Chrome/Edge não encontrado (ou servidor não-Windows) — instale o navegador e recarregue.'; return; }
      kEstado.innerHTML = st.existe
        ? `<span style="color:var(--ok)">● Atalho criado:</span> <code style="word-break:break-all">${escapar(st.atalho)}</code>`
        : 'Sem atalho — hoje a impressão abre o diálogo do navegador.';
    } catch { kEstado.textContent = 'Não foi possível verificar o atalho.'; }
  }
  refletirKiosque();
  painel.querySelector('#kiosque-ativar').onclick = async () => {
    try { const r = await post('/sistema/atalho-kiosque', { ativo: true }); toast(`Atalho criado: ${r.atalho}`, 'ok'); refletirKiosque(); }
    catch (e) { toast(e.message, 'erro'); }
  };
  painel.querySelector('#kiosque-remover').onclick = async () => {
    try { await post('/sistema/atalho-kiosque', { ativo: false }); toast('Atalho removido', 'ok'); refletirKiosque(); }
    catch (e) { toast(e.message, 'erro'); }
  };

  const previaPadrao = () => {
    const imp = impressoras.find((i) => String(i.id) === String(painel.querySelector('#imp-padrao')?.value)) ?? impressoras.find((i) => i.ativo);
    const alvo = painel.querySelector('#imp-previa-padrao');
    if (!alvo) return;
    alvo.innerHTML = imp
      ? `<pre class="recibo-preview impressao-previa" style="width:${imp.largura_mm === 58 ? '240px' : '340px'}">${escapar(previaImpressao(imp, cfg))}</pre>`
      : '<div class="vazio">Cadastre uma impressora para ver a pré-visualização</div>';
  };
  previaPadrao();
  painel.querySelector('#imp-padrao').onchange = async (e) => {
    try {
      await put('/config', { impressora_padrao_id: e.target.value });
      toast('Impressora padrão salva', 'ok');
      previaPadrao();
    } catch (err) { toast(err.message, 'erro'); }
  };

  const redesenharLista = () => {
    const lista = painel.querySelector('#imp-lista');
    lista.innerHTML = `
      <table class="dados"><thead><tr><th scope="col">Impressora</th><th scope="col">Conexão</th><th scope="col">Bobina</th><th scope="col">Vias</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Ações</span></th></tr></thead>
      <tbody>${impressoras.map((i) => `<tr>
        <td><strong>${escapar(i.nome)}</strong>${i.cabecalho ? `<br><small style="color:var(--texto-fraco)">cabecalho próprio</small>` : ''}${i.rodape ? `<br><small style="color:var(--texto-fraco)">rodapé próprio</small>` : ''}</td>
        <td>${ROTULO_CONEXAO[i.conexao] ?? i.conexao}${i.endereco ? `<br><small style="color:var(--texto-fraco)">${escapar(i.endereco)}</small>` : ''}</td>
        <td class="num">${i.largura_mm} mm</td>
        <td class="num">${i.vias}</td>
        <td>${i.ativo ? '<span class="badge ok">ativa</span>' : '<span class="badge alerta">inativa</span>'}</td>
        <td style="white-space:nowrap">
          <button class="btn ghost" data-edit="${i.id}" title="Editar">${ic('lapis')}</button>
          <button class="btn ghost" data-teste="${i.id}" title="Pré-visualizar / testar">${ic('documento')}</button>
          <button class="btn ghost" data-del="${i.id}" title="Excluir">${ic('lixeira')}</button>
        </td></tr>`).join('') || '<tr><td colspan="6" class="vazio">Nenhuma impressora cadastrada</td></tr>'}</tbody></table>`;
    lista.querySelectorAll('[data-edit]').forEach((b) => {
      b.onclick = () => formImpressora(impressoras.find((x) => x.id === Number(b.dataset.edit)));
    });
    lista.querySelectorAll('[data-teste]').forEach((b) => {
      b.onclick = async () => {
        try {
          const r = await post(`/impressoras/${b.dataset.teste}/teste`, {});
          const m = modal(`<h2>${ic('impressora')} Teste — ${escapar(r.impressora.nome)}</h2>
            <pre class="recibo-preview" style="max-width:${r.impressora.largura_mm === 58 ? '240px' : '340px'};margin:0 auto">${escapar(r.previa)}</pre>
            <div class="no-print" style="display:flex;gap:10px;margin-top:12px">
              <button class="btn ghost" data-a="c">Fechar</button>
              <button class="btn primario grande" data-a="imp" style="flex:1">Imprimir teste</button>
            </div>`);
          m.caixa.querySelector('[data-a="c"]').onclick = m.fechar;
          m.caixa.querySelector('[data-a="imp"]').onclick = () => {
            let area = document.getElementById('area-impressao');
            if (!area) { area = document.createElement('div'); area.id = 'area-impressao'; document.body.appendChild(area); }
            aplicarPaginaBobina(r.impressora.largura_mm);
            area.innerHTML = montarCupomHTML({
              textoSeguro: escapar(r.previa),
              larguraMm: r.impressora.largura_mm,
              impressao: opcoesImpressao(cfg),
              logoUrl: cfg.logo_path ? `/${cfg.logo_path}` : '',
            });
            window.print();
          };
        } catch (e) { toast(e.message, 'erro'); }
      };
    });
    lista.querySelectorAll('[data-del]').forEach((b) => {
      b.onclick = async () => {
        const alvo = impressoras.find((x) => x.id === Number(b.dataset.del));
        if (!await confirmar('Excluir impressora?', `"${alvo.nome}" será removida do cadastro.`, { perigo: true })) return;
        try { await del(`/impressoras/${b.dataset.del}`); toast('Impressora removida', 'ok'); telaImpressao(painel); }
        catch (e) { toast(e.message, 'erro'); }
      };
    });
  };
  redesenharLista();
  painel.querySelector('#imp-nova').onclick = () => formImpressora(null);

  function formImpressora(imp) {
    const m = modal(`<h2>${imp ? 'Editar' : 'Nova'} impressora térmica</h2>
      <input id="i-nome" value="${escapar(imp?.nome ?? '')}" placeholder="Nome (ex: Balcão, Cozinha, Chapa)" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)"/>
      <div style="display:flex;gap:8px;margin-top:8px">
        <select id="i-conexao" style="flex:1;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)">
          <option value="usb" ${imp?.conexao === 'usb' ? 'selected' : ''}>USB</option>
          <option value="bluetooth" ${imp?.conexao === 'bluetooth' ? 'selected' : ''}>Bluetooth</option>
          <option value="rede" ${imp?.conexao === 'rede' ? 'selected' : ''}>Rede (IP)</option>
        </select>
        <input id="i-endereco" value="${escapar(imp?.endereco ?? '')}" placeholder="192.168.0.50:9100" style="flex:1;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)"/>
      </div>
      <small style="color:var(--texto-fraco);display:block;margin-top:6px" id="i-dica-endereco"></small>
      <div style="display:flex;gap:8px;margin-top:10px;align-items:center">
        <span style="color:var(--texto-fraco)">Bobina:</span>
        <div class="abas" role="radiogroup" aria-label="Largura da bobina">
          <button type="button" class="btn ${(!imp || imp.largura_mm === 80) ? 'ativa' : ''}" role="radio" aria-checked="${!imp || imp.largura_mm === 80}" data-larg="80">80 mm</button>
          <button type="button" class="btn ${imp?.largura_mm === 58 ? 'ativa' : ''}" role="radio" aria-checked="${imp?.largura_mm === 58}" data-larg="58">58 mm</button>
        </div>
        <span style="color:var(--texto-fraco);margin-left:8px">Vias:</span>
        <select id="i-vias" style="width:auto;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)">
          <option value="1" ${(!imp || imp.vias === 1) ? 'selected' : ''}>1 via</option>
          <option value="2" ${imp?.vias === 2 ? 'selected' : ''}>2 vias</option>
        </select>
      </div>
      <label style="display:block;margin-top:10px"><input type="checkbox" id="i-ativo" ${!imp || imp.ativo ? 'checked' : ''} /> Ativa</label>
      <label style="display:block;margin-top:10px"><span class="campo-titulo">Cabeçalho personalizado (uma linha por vez, vazio = dados da empresa)</span>
        <textarea id="i-cabecalho" rows="3" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto);font-family:var(--mono)" placeholder="Ex:&#10;LANCHONETE DO ZÉ&#10;Promoção de terça!">${escapar(imp?.cabecalho ?? '')}</textarea></label>
      <label style="display:block;margin-top:8px"><span class="campo-titulo">Rodapé personalizado (uma linha por vez)</span>
        <textarea id="i-rodape" rows="3" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto);font-family:var(--mono)" placeholder="Ex:&#10;Siga @lanchonetedoze&#10;Volte sempre!">${escapar(imp?.rodape ?? '')}</textarea></label>
      <h3 style="margin:14px 0 4px">${ic('documento')} Pré-visualização em tempo real</h3>
      <div id="i-previa"></div>
      <button class="btn primario grande" style="width:100%;margin-top:10px" data-a="ok">${imp ? 'Salvar' : 'Criar'} impressora</button>`);

    let largura = imp?.largura_mm ?? 80;
    const dicas = {
      usb: 'USB: nome da impressora como instalada no Windows (ex: "POS-58 Thermal"). Deixe vazio para usar a padrão do sistema.',
      bluetooth: 'Bluetooth: MAC do dispositivo (ex: 00:11:22:33:44:55) ou nome emparelhado (ex: "POS-80BT").',
      rede: 'Rede: IP ou host da impressora, opcionalmente com porta (padrão térmico: 9100). Ex: 192.168.0.50:9100',
    };
    const placeholders = { usb: 'POS-58 Thermal', bluetooth: '00:11:22:33:44:55', rede: '192.168.0.50:9100' };
    const campo = (id) => m.caixa.querySelector('#' + id);

    const atualizarPrevia = () => {
      const dados = {
        nome: campo('i-nome').value.trim(),
        conexao: campo('i-conexao').value,
        endereco: campo('i-endereco').value.trim(),
        largura,
        cabecalho: campo('i-cabecalho').value,
        rodape: campo('i-rodape').value,
        vias: Number(campo('i-vias').value),
      };
      campo('i-previa').innerHTML = `<pre class="recibo-preview impressao-previa" style="margin:0 auto;width:${largura === 58 ? '240px' : '340px'}">${escapar(previaImpressao(dados, cfg))}</pre>`;
    };
    const atualizarDica = () => {
      campo('i-dica-endereco').textContent = dicas[campo('i-conexao').value];
      campo('i-endereco').placeholder = placeholders[campo('i-conexao').value];
    };
    m.caixa.querySelectorAll('[data-larg]').forEach((b) => {
      b.onclick = () => {
        largura = Number(b.dataset.larg);
        m.caixa.querySelectorAll('[data-larg]').forEach((x) => { x.classList.remove('ativa'); x.setAttribute('aria-checked', 'false'); });
        b.classList.add('ativa'); b.setAttribute('aria-checked', 'true');
        atualizarPrevia();
      };
    });
    ['i-nome', 'i-endereco', 'i-cabecalho', 'i-rodape'].forEach((id) => { campo(id).addEventListener('input', atualizarPrevia); });
    campo('i-conexao').addEventListener('change', () => { atualizarDica(); atualizarPrevia(); });
    campo('i-vias').addEventListener('change', atualizarPrevia);
    atualizarDica();
    atualizarPrevia();

    m.caixa.querySelector('[data-a="ok"]').onclick = async () => {
      try {
        const corpo = {
          nome: campo('i-nome').value.trim(),
          conexao: campo('i-conexao').value,
          endereco: campo('i-endereco').value.trim() || null,
          largura_mm: largura,
          vias: Number(campo('i-vias').value),
          cabecalho: campo('i-cabecalho').value.trim() || null,
          rodape: campo('i-rodape').value.trim() || null,
          ativo: campo('i-ativo').checked ? 1 : 0,
        };
        if (imp) await put(`/impressoras/${imp.id}`, corpo); else await post('/impressoras', corpo);
        m.fechar(); toast(imp ? 'Impressora atualizada' : 'Impressora criada', 'ok'); telaImpressao(painel);
      } catch (e) { toast(e.message, 'erro'); }
    };
  }
}

// ============================================================
// 1.3.1 — SESSÕES ATIVAS (controle de usuários logados)
// Quem está logado via Web, celular ou APK, de qual IP, última atividade,
// com desconexão imediata (revoga a sessão e derruba o WebSocket).
// ============================================================
async function telaSessoes(painel) {
  const rotuloCargo = { admin: 'Administrador', caixa: 'Caixa', garcom: 'Garçom', cozinha: 'Cozinha' };
  const iconeOrigem = { 'APK Mobile': 'celular', 'Celular (navegador)': 'celular', 'Web (computador)': 'prancheta', 'Desconhecido': 'lupa' };
  let dados;
  try { dados = await get('/sessoes'); }
  catch (e) { painel.innerHTML = `<div class="vazio">Erro: ${escapar(e.message)}</div>`; return; }
  const sessoes = dados.sessoes ?? [];

  painel.innerHTML = `
    <div class="cartao" style="margin-bottom:12px;display:flex;gap:14px;align-items:center;flex-wrap:wrap">
      <strong>${ic('antena')} Usuários logados agora: ${sessoes.length}</strong>
      <span class="badge ok">${ic('sincronizar')} ${dados.online_agora ?? 0} dispositivo(s) sincronizado(s) em tempo real</span>
      <button class="btn ghost" id="ses-atualizar">${ic('atualizar')} Atualizar</button>
    </div>
    <table class="dados"><thead><tr><th scope="col">Usuário</th><th scope="col">Origem</th><th scope="col">IP</th><th scope="col">Última atividade</th><th scope="col">Expira em</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Ações</span></th></tr></thead>
    <tbody>${sessoes.map((s) => `<tr>
      <td><strong>${escapar(s.nome)}</strong> <small style="color:var(--texto-fraco)">${rotuloCargo[s.cargo] ?? s.cargo}</small>${s.atual ? ' <span class="badge ok">você</span>' : ''}</td>
      <td>${ic(iconeOrigem[s.origem] ?? 'lupa')} ${escapar(s.origem)}</td>
      <td><small>${escapar(s.ip ?? '—')}</small></td>
      <td><small>${new Date(s.ultimo_uso).toLocaleString('pt-BR')}</small></td>
      <td><small>${new Date(s.expira_em).toLocaleString('pt-BR')}</small></td>
      <td>${s.online ? '<span class="badge ok">online agora</span>' : '<span class="badge">conectado</span>'}</td>
      <td>${s.atual ? '' : `<button class="btn ghost perigo" data-desconectar="${escapar(s.id)}" title="Desconectar sessão">${ic('x')} Desconectar</button>`}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="vazio">Nenhuma sessão ativa</td></tr>'}</tbody></table>
    <p><small style="color:var(--texto-fraco)">Sessões expiram sozinhas após 12 h ou 30 min sem uso. Desconectar encerra a sessão na hora, inclusive o WebSocket do dispositivo.</small></p>`;

  painel.querySelector('#ses-atualizar').onclick = () => telaSessoes(painel);
  painel.querySelectorAll('[data-desconectar]').forEach((b) => {
    b.onclick = async () => {
      const linha = sessoes.find((s) => s.id === b.dataset.desconectar);
      if (!await confirmar('Desconectar usuário?', `"${linha.nome}" será deslogado imediatamente deste dispositivo.`)) return;
      try {
        await post(`/sessoes/${b.dataset.desconectar}/desconectar`, {});
        toast(`${linha.nome} desconectado`, 'ok'); telaSessoes(painel);
      } catch (e) { toast(e.message, 'erro'); }
    };
  });
}
