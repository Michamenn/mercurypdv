// PDF Export Module using jsPDF (CDN)
// Gera PDFs profissionais para relatórios

// PDF Export Module — jsPDF servido LOCALMENTE (public/vendor/, offline-first, sem CDN)

let jsPDF = null;

function carregarScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-vendor="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.dataset.vendor = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
    document.head.appendChild(s);
  });
}

async function carregarJsPDF() {
  if (jsPDF) return { jsPDF, autoTable: null };
  try {
    await carregarScript('/vendor/jspdf.umd.min.js');
    await carregarScript('/vendor/jspdf.plugin.autotable.min.js');
    jsPDF = window.jspdf?.jsPDF ?? null;
    if (!jsPDF) throw new Error('jsPDF local não inicializou');
    return { jsPDF, autoTable: null };
  } catch (e) {
    console.error('Erro ao carregar jsPDF local:', e);
    throw new Error('Falha ao carregar gerador de PDF local.');
  }
}

// Formata data para PT-BR
function formatarData(dataISO) {
  return new Date(dataISO).toLocaleDateString('pt-BR');
}

function formatarDataHora(dataISO) {
  return new Date(dataISO).toLocaleString('pt-BR');
}

// Gera PDF do relatório de resumo
export async function exportarRelatorioPDF(dados, { de, ate, empresa_nome = 'Mercury PDV' } = {}) {
  const { jsPDF, autoTable } = await carregarJsPDF();
  
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  let y = margin;
  
  // Configuração de cores
  const corPrimaria = [249, 115, 22]; // laranja
  const corSucesso = [16, 185, 129];
  const corAlerta = [239, 68, 68];
  const corTexto = [30, 30, 30];
  const corTextoFraco = [100, 100, 100];
  
  // ====== CABEÇALHO ======
  // Logo/empresa
  doc.setFontSize(22);
  doc.setTextColor(...corPrimaria);
  doc.setFont('helvetica', 'bold');
  doc.text(empresa_nome, margin, y);
  y += 8;
  
  doc.setFontSize(10);
  doc.setTextColor(...corTextoFraco);
  doc.setFont('helvetica', 'normal');
  doc.text('Relatório Gerencial de Vendas', margin, y);
  y += 5;
  
  // Período
  doc.setFontSize(9);
  doc.setTextColor(...corTexto);
  doc.text(`Período: ${formatarData(de)} a ${formatarData(ate)}`, margin, y);
  y += 5;
  doc.text(`Emitido em: ${new Date().toLocaleString('pt-BR')}`, margin, y);
  y += 10;
  
  // Linha separadora
  doc.setDrawColor(...corPrimaria);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;
  
  // ====== RESUMO EXECUTIVO (CARDS) ======
  doc.setFontSize(12);
  doc.setTextColor(...corTexto);
  doc.setFont('helvetica', 'bold');
  doc.text('Resumo Executivo', margin, y);
  y += 8;
  
  const cards = [
    { label: 'Faturamento Bruto', valor: dados.bruto_centavos, cor: null },
    { label: 'Descontos', valor: -dados.descontos_centavos, cor: corAlerta },
    { label: 'Cancelamentos (fora do bruto)', valor: dados.cancelamentos_centavos, cor: corAlerta },
    { label: 'Líquido', valor: dados.liquido_centavos, cor: corSucesso },
    { label: 'Ticket Médio', valor: dados.ticket_medio_centavos, cor: null },
    { label: 'Margem ESTIMADA', valor: dados.margem_estimada_centavos, cor: dados.margem_estimada_centavos >= 0 ? corSucesso : corAlerta },
  ];
  
  const cardWidth = (pageWidth - 2 * margin - 10) / 3;
  const cardHeight = 22;
  
  cards.forEach((card, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = margin + col * (cardWidth + 5);
    const cardY = y + row * (cardHeight + 5);
    
    // Fundo do card
    doc.setFillColor(245, 245, 245);
    doc.roundedRect(x, cardY, cardWidth, cardHeight, 2, 2, 'F');
    
    // Label
    doc.setFontSize(7);
    doc.setTextColor(...corTextoFraco);
    doc.setFont('helvetica', 'normal');
    doc.text(card.label, x + 2, cardY + 5);
    
    // Valor
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    if (card.cor) doc.setTextColor(...card.cor);
    else doc.setTextColor(...corTexto);
    const valorStr = (card.valor / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    doc.text(`R$ ${valorStr}`, x + 2, cardY + 14);
    
    // Borda colorida para valores positivos/negativos
    if (card.cor) {
      doc.setDrawColor(...card.cor);
      doc.setLineWidth(0.3);
      doc.rect(x, cardY, cardWidth, cardHeight, 'S');
    }
  });
  
  y += 2 * (cardHeight + 5) + 10;
  
  // Pedidos fechados
  doc.setFontSize(9);
  doc.setTextColor(...corTextoFraco);
  doc.text(`Pedidos fechados no período: ${dados.pedidos_fechados}`, margin, y);
  y += 10;
  
  // ====== TABELA: POR FORMA DE PAGAMENTO ======
  if (dados.por_forma && Object.keys(dados.por_forma).length > 0) {
    y = adicionarTabela(doc, y, margin, pageWidth, 'Por Forma de Pagamento', 
      [['Forma', 'Valor']],
      Object.entries(dados.por_forma).map(([f, v]) => [f, `R$ ${(v/100).toLocaleString('pt-BR', {minimumFractionDigits: 2})}`]),
      corPrimaria
    );
    y += 5;
  }
  
  // ====== TABELA: TOP PRODUTOS ======
  if (dados.top_produtos && dados.top_produtos.length > 0) {
    y = adicionarTabela(doc, y, margin, pageWidth, 'Top Produtos',
      [['Produto', 'Qtd', 'Valor Total']],
      dados.top_produtos.slice(0, 15).map(p => [
        p.nome,
        `${p.quantidade}×`,
        `R$ ${(p.valor_centavos/100).toLocaleString('pt-BR', {minimumFractionDigits: 2})}`
      ]),
      corPrimaria
    );
    y += 5;
  }
  
  // ====== TABELA: POR HORA ======
  if (dados.por_hora && Object.keys(dados.por_hora).length > 0) {
    y = adicionarTabela(doc, y, margin, pageWidth, 'Vendas por Hora',
      [['Hora', 'Valor']],
      Object.entries(dados.por_hora).map(([h, v]) => [`${h}h`, `R$ ${(v/100).toLocaleString('pt-BR', {minimumFractionDigits: 2})}`]),
      corPrimaria
    );
    y += 5;
  }
  
  // ====== RODAPÉ ======
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(...corTextoFraco);
    doc.setFont('helvetica', 'normal');
    doc.text(
      `Relatório gerado automaticamente pelo ${empresa_nome} — Página ${i} de ${pageCount}`,
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 5,
      { align: 'center' }
    );
    doc.text(
      'Documento não fiscal — Sem valor contábil',
      pageWidth / 2,
      doc.internal.pageSize.getHeight() - 10,
      { align: 'center' }
    );
  }
  
  return doc;
}

// Função auxiliar para adicionar tabela com autoTable
function adicionarTabela(doc, y, margin, pageWidth, titulo, head, body, corPrimaria) {
  // Título da tabela
  doc.setFontSize(11);
  doc.setTextColor(30, 30, 30);
  doc.setFont('helvetica', 'bold');
  doc.text(titulo, margin, y);
  y += 6;
  
  // Usa autoTable se disponível
  if (doc.autoTable) {
    doc.autoTable({
      startY: y,
      head: [head],
      body: body,
      margin: { left: margin, right: margin },
      styles: {
        fontSize: 8,
        cellPadding: 2,
        font: 'helvetica',
      },
      headStyles: {
        fillColor: corPrimaria,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 8,
      },
      alternateRowStyles: {
        fillColor: [245, 245, 245],
      },
      columnStyles: {
        0: { cellWidth: 'auto' },
        1: { cellWidth: 'auto', halign: 'right' },
        2: { cellWidth: 'auto', halign: 'right' },
      },
      didDrawPage: (data) => {
        y = data.cursor.y + 5;
      },
    });
    return doc.lastAutoTable.finalY + 5;
  } else {
    // Fallback manual se autoTable não carregou
    return desenharTabelaManual(doc, y, margin, pageWidth, head, body, corPrimaria);
  }
}

// Fallback manual para tabela (sem autoTable)
function desenharTabelaManual(doc, y, margin, pageWidth, head, body, corPrimaria) {
  const colWidths = [pageWidth * 0.6, pageWidth * 0.2, pageWidth * 0.2];
  const rowHeight = 6;
  const tableWidth = colWidths.reduce((a, b) => a + b, 0);
  const startX = margin;
  
  // Cabeçalho
  doc.setFillColor(...corPrimaria);
  doc.rect(startX, y, tableWidth, rowHeight, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  let x = startX;
  head[0].forEach((h, i) => {
    doc.text(h, x + 2, y + 4);
    x += colWidths[i];
  });
  y += rowHeight;
  
  // Corpo
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  body.forEach((row, i) => {
    if (i % 2 === 0) {
      doc.setFillColor(245, 245, 245);
      doc.rect(startX, y, tableWidth, rowHeight, 'F');
    }
    doc.setTextColor(30, 30, 30);
    x = startX;
    row.forEach((cell, j) => {
      const align = j > 0 ? 'right' : 'left';
      doc.text(String(cell), x + 2, y + 4, { align });
      x += colWidths[j];
    });
    y += rowHeight;
    
    // Nova página se necessário
    if (y > doc.internal.pageSize.getHeight() - 20) {
      doc.addPage();
      y = 15;
    }
  });
  return y + 5;
}

// Exporta relatório de vendas (lista) para PDF
export async function exportarVendasPDF(vendas, { de, ate, empresa_nome = 'Mercury PDV' } = {}) {
  const { jsPDF, autoTable } = await carregarJsPDF();
  
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 10;
  let y = margin;
  
  // Cabeçalho
  doc.setFontSize(18);
  doc.setTextColor(249, 115, 22);
  doc.setFont('helvetica', 'bold');
  doc.text(empresa_nome, margin, y);
  y += 6;
  
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.setFont('helvetica', 'normal');
  doc.text(`Lista de Vendas — ${formatarData(de)} a ${formatarData(ate)}`, margin, y);
  y += 5;
  doc.text(`Emitido em: ${new Date().toLocaleString('pt-BR')}`, margin, y);
  y += 8;
  
  // Tabela de vendas
  const head = [['ID', 'Tipo', 'Mesa/Comanda', 'Data/Hora', 'Total', 'Desc.', 'Forma Pagto']];
  const body = vendas.map(v => [
    String(v.id),
    v.tipo === 'mesa' ? 'Mesa' : 'Balcão',
    v.mesa_numero ? `Mesa ${v.mesa_numero}` : (v.comanda_nome ?? '—'),
    formatarDataHora(v.fechado_em),
    `R$ ${(v.total_fechado_centavos/100).toLocaleString('pt-BR', {minimumFractionDigits: 2})}`,
    v.desconto_centavos > 0 ? `R$ ${(v.desconto_centavos/100).toLocaleString('pt-BR', {minimumFractionDigits: 2})}` : '—',
    v.forma_pagto ?? '—',
  ]);
  
  if (doc.autoTable) {
    doc.autoTable({
      startY: y,
      head: [head[0]],
      body: body,
      margin: { left: 10, right: 10 },
      styles: { fontSize: 7, cellPadding: 1.5 },
      headStyles: { fillColor: [249, 115, 22], fontSize: 7 },
      columnStyles: {
        0: { cellWidth: 12 },
        1: { cellWidth: 18 },
        2: { cellWidth: 25 },
        3: { cellWidth: 30 },
        4: { cellWidth: 25, halign: 'right' },
        5: { cellWidth: 25, halign: 'right' },
        6: { cellWidth: 'auto' },
      },
    });
  }
  
  return doc;
}

// Exporta o cardápio (por categoria) para PDF — impressão de cardápio/folder (A1 item 1.9)
export async function exportarCardapioPDF(catalogo, { empresa_nome = 'Mercury PDV' } = {}) {
  const { jsPDF } = await carregarJsPDF();

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  const larguraUtil = pageWidth - 2 * margin;
  let y = margin;

  const novaPaginaSeNecessario = (espaco) => {
    if (y + espaco > 287) { doc.addPage(); y = margin; }
  };

  doc.setFontSize(24);
  doc.setTextColor(249, 115, 22);
  doc.setFont('helvetica', 'bold');
  doc.text(empresa_nome, margin, y);
  y += 7;
  doc.setFontSize(11);
  doc.setTextColor(100, 100, 100);
  doc.setFont('helvetica', 'normal');
  doc.text('Cardápio', margin, y);
  y += 4;
  doc.setDrawColor(249, 115, 22);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  const rotuloTipo = { lanche: 'Lanche', prato: 'Prato', porcao: 'Porção', bebida: 'Bebida', sobremesa: 'Sobremesa', servico: 'Serviço', outro: 'Item' };
  for (const categoria of (catalogo.categorias ?? [])) {
    const produtos = (catalogo.produtos ?? []).filter((p) => p.categoria_id === categoria.id && p.ativo && p.disponivel !== 0);
    if (!produtos.length) continue;
    novaPaginaSeNecessario(20);
    doc.setFontSize(15);
    doc.setTextColor(30, 30, 30);
    doc.setFont('helvetica', 'bold');
    doc.text(String(categoria.nome).toUpperCase(), margin, y);
    y += 7;
    for (const p of produtos) {
      novaPaginaSeNecessario(14);
      doc.setFontSize(11);
      doc.setTextColor(30, 30, 30);
      doc.setFont('helvetica', 'bold');
      const nome = String(p.nome);
      doc.text(nome, margin, y);
      const preco = `R$ ${(p.preco_centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
      doc.setFont('helvetica', 'bold');
      const largPreco = doc.getTextWidth(preco);
      doc.text(preco, pageWidth - margin - largPreco, y);
      y += 5;
      const detalhes = [
        p.tipo_item && p.tipo_item !== 'lanche' ? rotuloTipo[p.tipo_item] ?? p.tipo_item : null,
        !p.disponivel ? `INDISPONÍVEL: ${p.indisponibilidade_motivo ?? ''}` : null,
      ].filter(Boolean).join(' · ');
      if (detalhes) {
        doc.setFontSize(8);
        doc.setTextColor(180, 40, 40);
        doc.setFont('helvetica', 'italic');
        doc.text(detalhes.slice(0, 90), margin, y);
        y += 4;
      }
      const vars = (p.variacoes ?? []).map((v) => `${v.nome}${v.delta_centavos ? ` (+R$ ${(v.delta_centavos / 100).toFixed(2)})` : ''}`).join(' | ');
      if (vars) {
        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        doc.setFont('helvetica', 'normal');
        doc.text(`Opções: ${vars}`.slice(0, 110), margin, y);
        y += 4;
      }
      y += 2;
    }
    y += 4;
  }

  const totalPaginas = doc.getNumberOfPages();
  for (let i = 1; i <= totalPaginas; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(`Página ${i}/${totalPaginas} — documento não fiscal, apenas cardápio`, margin, 292);
  }
  return doc;
}

// Exporta o fechamento de caixa (conferência do turno) para PDF (A3 item 3.13)
export async function exportarFechamentoPDF(detalhe) {
  const { jsPDF } = await carregarJsPDF();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  let y = margin;
  const s = detalhe.sessao;
  const conf = s.conferencia_json ? JSON.parse(s.conferencia_json) : {};

  doc.setFontSize(20);
  doc.setTextColor(249, 115, 22);
  doc.setFont('helvetica', 'bold');
  doc.text('Fechamento de Caixa', margin, y);
  y += 7;
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.setFont('helvetica', 'normal');
  doc.text(`Abertura: ${formatarDataHora(s.aberto_em)} por ${s.usuario_abertura_nome ?? '—'}`, margin, y);
  y += 5;
  doc.text(`Fechamento: ${s.fechado_em ? formatarDataHora(s.fechado_em) : '—'} por ${s.usuario_fechamento_nome ?? '—'}`, margin, y);
  y += 5;
  doc.text(`Fundo de troco: R$ ${(s.saldo_inicial_centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, margin, y);
  y += 8;

  doc.setFontSize(12);
  doc.setTextColor(30, 30, 30);
  doc.setFont('helvetica', 'bold');
  doc.text('Conferência por forma', margin, y);
  y += 6;
  const linhas = Object.entries(conf).map(([f, c]) => [
    f, `R$ ${(c.esperado / 100).toFixed(2)}`, `R$ ${(c.informado / 100).toFixed(2)}`,
    `R$ ${(c.diferenca / 100).toFixed(2)}`,
  ]);
  if (doc.autoTable) {
    doc.autoTable({
      startY: y, head: [['Forma', 'Esperado', 'Contado', 'Diferença']], body: linhas,
      margin: { left: margin, right: margin }, styles: { fontSize: 9 },
      headStyles: { fillColor: [249, 115, 22] },
    });
    y = doc.lastAutoTable.finalY + 8;
  }
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(`Vendas do turno (${detalhe.vendas.length})`, margin, y);
  y += 6;
  if (doc.autoTable) {
    doc.autoTable({
      startY: y,
      head: [['Pedido', 'Tipo', 'Total', 'Desconto', 'Fechado em']],
      body: detalhe.vendas.map((v) => [
        `#${v.id}${v.numero_dia ? ` (comanda ${v.numero_dia})` : ''}`,
        v.tipo === 'mesa' ? `Mesa ${v.mesa_numero ?? ''}` : v.canal === 'viagem' ? 'Viagem' : 'Balcão',
        `R$ ${(v.total_fechado_centavos / 100).toFixed(2)}`,
        `R$ ${(v.desconto_centavos / 100).toFixed(2)}`,
        formatarDataHora(v.fechado_em),
      ]),
      margin: { left: margin, right: margin }, styles: { fontSize: 8 },
      headStyles: { fillColor: [30, 30, 30] },
    });
    y = doc.lastAutoTable.finalY + 8;
  }
  if (detalhe.movimentacoes.length) {
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Sangrias / suprimentos', margin, y);
    y += 6;
    if (doc.autoTable) {
      doc.autoTable({
        startY: y, head: [['Hora', 'Tipo', 'Valor', 'Motivo', 'Por']],
        body: detalhe.movimentacoes.map((m) => [
          new Date(m.criado_em).toLocaleTimeString('pt-BR'), m.tipo,
          `R$ ${(m.valor_centavos / 100).toFixed(2)}`, String(m.motivo ?? '').slice(0, 40), m.usuario_nome ?? '—',
        ]),
        margin: { left: margin, right: margin }, styles: { fontSize: 8 },
        headStyles: { fillColor: [30, 30, 30] },
      });
    }
  }
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text('Documento não fiscal — conferência interna do turno.', margin, 292);
  return doc;
}

// Função auxiliar para download
export function baixarPDF(doc, nomeArquivo) {
  doc.save(nomeArquivo);
}