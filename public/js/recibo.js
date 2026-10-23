// Visualizador de recibo NÃO FISCAL + impressão 58/80mm (BR-002)
import { modal, escapar } from './ui.js';

export function rotuloForma(f) {
  return { dinheiro: 'Dinheiro', pix: 'PIX', cartao_debito: 'Cartão Débito', cartao_credito: 'Cartão Crédito', vale_refeicao: 'Vale Refeição' }[f] ?? f;
}

// ===== Padrão único de impressão do cupom (bobina térmica) =====
// Uma só fonte de verdade para a tela Conta, o recibo do caixa e o teste de
// impressora: @page dinâmico (largura da bobina, ALTURA AUTOMÁTICA — o papel
// para onde o conteúdo termina, sem ejetar folha A4), margens configuráveis
// e logo com filtro de imagem para térmica (mono/dithering/brilho/contraste).

// Opções de impressão extraídas da config (defaults seguros p/ recibos antigos).
export function opcoesImpressao(cfg = {}) {
  return {
    margem_sup_mm: Number(cfg.recibo_margem_sup_mm) || 0,
    margem_inf_mm: Number(cfg.recibo_margem_inf_mm) || 0,
    extensao_mm: Number(cfg.recibo_extensao_mm) || 0,
    logo_imprimir: String(cfg.recibo_logo_imprimir ?? '0'),
    logo_modo: cfg.recibo_logo_modo ?? 'mono',
    logo_brilho: Number(cfg.recibo_logo_brilho) || 0,
    logo_contraste: Number(cfg.recibo_logo_contraste) || 0,
    logo_bordas: String(cfg.recibo_logo_bordas ?? '0'),
  };
}

// Filtro CSS da logo: térmica imprime em preto — monocromático por padrão,
// "dithering" simulado (alto contraste + pixels duros) ou original (colorido).
function filtroLogo(imp) {
  const brilho = 1 + (Number(imp.logo_brilho) || 0) / 100;
  const contraste = Math.max(0, 1 + (Number(imp.logo_contraste) || 0) / 100);
  if (imp.logo_modo === 'original') return `brightness(${brilho.toFixed(2)}) contrast(${contraste.toFixed(2)})`;
  const c = imp.logo_modo === 'dither' ? contraste * 2 + 1.2 : contraste;
  return `grayscale(1) brightness(${brilho.toFixed(2)}) contrast(${c.toFixed(2)})`;
}

// Monta o cupom completo: container (largura + margens) + logo + texto + avanço
// de corte (extensão em mm após o conteúdo, para o corte cair depois do texto).
export function montarCupomHTML({ textoSeguro, larguraMm, impressao = {}, logoUrl = '' }) {
  const imp = { ...opcoesImpressao(), ...impressao };
  const borda = imp.logo_bordas === '1' ? 'border:1px solid #000;padding:1.5mm;' : '';
  const logo = imp.logo_imprimir === '1' && logoUrl
    ? `<div style="${borda}margin:0 0 2mm"><img src="${escapar(logoUrl)}" alt="" style="display:block;max-width:100%;max-height:18mm;margin:0 auto;filter:${filtroLogo(imp)};image-rendering:${imp.logo_modo === 'dither' ? 'pixelated' : 'auto'}" /></div>`
    : '';
  const avanco = imp.extensao_mm > 0 ? `<div style="height:${imp.extensao_mm}mm"></div>` : '';
  return `<div class="container-cupom" style="width:${Number(larguraMm)}mm;padding:${imp.margem_sup_mm}mm 2mm ${imp.margem_inf_mm}mm">` +
    `${logo}<pre class="recibo-preview" style="background:#fff;color:#000;border:none">${textoSeguro}</pre>${avanco}</div>`;
}

// @page dinâmico: largura da bobina e altura AUTOMÁTICA — corta o papel exatamente
// onde o conteúdo termina (antes o navegador assumia folha A4 e desperdiçava bobina).
export function aplicarPaginaBobina(larguraMm) {
  let estilo = document.getElementById('estilo-pagina-bobina');
  if (!estilo) {
    estilo = document.createElement('style');
    estilo.id = 'estilo-pagina-bobina';
    document.head.appendChild(estilo);
  }
  estilo.textContent = `@page { size: ${Number(larguraMm)}mm auto; margin: 0; }`;
}

export function textoRecibo(conteudo) {
  const larg = conteudo.largura_mm === 58 ? 30 : 40;
  const linha = '-'.repeat(larg);
  const t = conteudo.totais ?? {};
  const itens = conteudo.itens.map((i) =>
    `${i.quantidade}x ${i.nome}\n${' '.repeat(larg - 12)}${(i.total_centavos / 100).toFixed(2).padStart(12)}`).join('\n');
  const pags = conteudo.pagamentos.map((p) => `${rotuloForma(p.forma).padEnd(larg - 12)}${(p.valor_centavos / 100).toFixed(2).padStart(12)}`).join('\n');
  const taxa = t.taxa_servico_centavos ?? 0;
  const gorjeta = t.gorjeta_centavos ?? 0;
  const numero = t.numero ?? t.total ?? 0;
  const ehMesa = conteudo.nomenclatura !== 'comanda';
  return [
    conteudo.empresa.nome,
    conteudo.empresa.cnpj, conteudo.empresa.telefone, conteudo.empresa.endereco,
    ...(String(conteudo.cabecalho ?? '').trim() ? String(conteudo.cabecalho).trim().split('\n') : []),
    linha,
    conteudo.documento,
    `${ehMesa ? 'Mesa' : 'Comanda'}: ${numero}  ${new Date(conteudo.data_hora).toLocaleString('pt-BR')}`,
    conteudo.comanda_nome || null,
    linha,
    itens,
    linha,
    `SUBTOTAL${((t.bruto ?? 0) / 100).toFixed(2).padStart(larg - 8)}`,
    t.desconto ? `DESCONTO${(t.desconto / 100).toFixed(2).padStart(larg - 8)}` : null,
    taxa ? `TAXA SERV${(taxa / 100).toFixed(2).padStart(larg - 8)}` : null,
    `TOTAL${(numero / 100).toFixed(2).padStart(larg - 5)}`,
    pags,
    `TROCO${((t.troco ?? 0) / 100).toFixed(2).padStart(larg - 5)}`,
    gorjeta ? `GORJETA${(gorjeta / 100).toFixed(2).padStart(larg - 8)}` : null,
    linha,
    'Documento não fiscal — apenas conferência.',
    conteudo.rodape,
  ].filter(Boolean).join('\n');
}

export function mostrarRecibo(conteudo, { aoFechar } = {}) {
  const texto = textoRecibo(conteudo);
  const textoSeguro = escapar(texto); // nomes/obs podem conter < > & — nunca HTML cru
  const m = modal(`
    <h2>Recibo #${conteudo.numero} <span class="badge">não fiscal</span></h2>
    <div class="recibo-preview" style="max-width:${conteudo.largura_mm === 58 ? '240px' : '340px'};margin:0 auto">${textoSeguro}</div>
    <div class="no-print" style="display:flex;gap:10px;margin-top:14px">
      <button class="btn ghost" data-a="fechar">Fechar</button>
      <button class="btn primario grande" data-a="imprimir" style="flex:1"> Imprimir</button>
    </div>`, { aoFechar });
  m.caixa.querySelector('[data-a="fechar"]').onclick = m.fechar;
  m.caixa.querySelector('[data-a="imprimir"]').onclick = () => {
    let area = document.getElementById('area-impressao');
    if (!area) { area = document.createElement('div'); area.id = 'area-impressao'; document.body.appendChild(area); }
    aplicarPaginaBobina(conteudo.largura_mm);
    area.innerHTML = montarCupomHTML({
      textoSeguro,
      larguraMm: conteudo.largura_mm,
      impressao: conteudo.impressao,
      logoUrl: conteudo.logo_path ? `/${conteudo.logo_path}` : '',
    });
    window.print();
  };
  return m;
}
