// Painel "Conta" — conferência do consumo em formato de cupom (nota fiscal simplificada).
// Usado pelo PDV Balcão, painel da Mesa, painel da Comanda e Venda rápida (celular).
// Somente LEITURA: nada é gravado no servidor. A impressão sai pelo mesmo caminho do
// recibo (área #area-impressao + window.print()), na largura configurada (58/80 mm).
import { modal, escapar } from './ui.js';
import { get } from './api.js';
import { rotuloForma } from './recibo.js';
import { ic } from './icons.js';

const COLUNAS = { 58: 30, 80: 40 };

function reais(centavos) {
  return (Number(centavos || 0) / 100).toFixed(2).replace('.', ',');
}

// "SUBTOTAL" + valor alinhado à direita na largura do cupom.
function comRotulo(rotulo, centavos, larg) {
  const valor = reais(centavos);
  return `${rotulo}${valor.padStart(Math.max(valor.length, larg - rotulo.length))}`;
}

/**
 * Monta o texto do cupom da conta.
 * itens: [{ quantidade, nome, detalhe?, cancelado?, unit_centavos?, total_centavos }]
 * totais: { bruto_centavos?, desconto_centavos?, taxa_servico_centavos?, total_centavos?,
 *           pago_centavos?, falta_centavos? } — só o que existir é impresso.
 * pagamentos: [{ rotulo, valor_centavos }]
 */
export function textoConta({
  empresa = {}, rodape = '', titulo = '', subtitulo = '',
  itens = [], totais = {}, pagamentos = [],
}, larguraMm) {
  const larg = COLUNAS[Number(larguraMm)] ?? 40;
  const linha = '-'.repeat(larg);
  const corpoItens = itens.map((i) => {
    // UMA linha por item: "QTD x DESCRIÇÃO" + valor à direita, na MESMA linha.
    // Se a descrição não couber, ela é cortada com "…" — o valor nunca desce de linha.
    const valor = i.cancelado ? '' : reais(i.total_centavos);
    const descricao = `${i.quantidade}x ${i.nome}${i.cancelado ? ' — CANCELADO' : ''}`;
    const disponivel = Math.max(0, larg - valor.length - 1);
    const cabeca = valor
      ? `${descricao.length > disponivel
        ? `${descricao.slice(0, Math.max(0, disponivel - 1))}…`
        : descricao.padEnd(disponivel)} ${valor}`
      : descricao;
    // Valor unitário e observações descem para a linha de detalhe (linha principal limpa).
    const detalhe = [
      i.unit_centavos !== undefined ? `${reais(i.unit_centavos)} un` : null,
      i.detalhe || null,
    ].filter(Boolean).join(' · ');
    return [cabeca, detalhe ? `  ${detalhe}` : null].filter(Boolean).join('\n');
  }).join('\n');
  const t = totais ?? {};
  const linhasTotais = [
    t.bruto_centavos !== undefined ? comRotulo('SUBTOTAL', t.bruto_centavos, larg) : null,
    t.desconto_centavos ? comRotulo('DESCONTO', -Math.abs(t.desconto_centavos), larg) : null,
    t.taxa_servico_centavos ? comRotulo('TAXA SERV', t.taxa_servico_centavos, larg) : null,
    t.total_centavos !== undefined ? comRotulo('TOTAL', t.total_centavos, larg) : null,
    t.pago_centavos ? comRotulo('PAGO', t.pago_centavos, larg) : null,
    t.falta_centavos ? comRotulo('FALTA', t.falta_centavos, larg) : null,
  ].filter(Boolean).join('\n');
  const linhasPagamentos = pagamentos.length
    ? pagamentos.map((p) => comRotulo(String(p.rotulo ?? ''), p.valor_centavos, larg)).join('\n')
    : null;
  return [
    empresa.nome || null,
    empresa.cnpj || null,
    [empresa.telefone, empresa.endereco].filter(Boolean).join(' · ') || null,
    linha,
    titulo ? `CONTA — ${titulo}` : 'CONTA',
    subtitulo || null,
    new Date().toLocaleString('pt-BR'),
    linha,
    corpoItens || 'Sem itens.',
    linha,
    linhasTotais || null,
    linhasPagamentos ? linha : null,
    linhasPagamentos,
    linha,
    'Documento não fiscal — apenas conferência.',
    rodape || null,
  ].filter(Boolean).join('\n');
}

// Impressão: mesmo mecanismo do recibo (BR-002) — o papel sai branco e legível,
// sem a grade quadriculada da tela.
function imprimirCupom(seguro, larguraMm) {
  let area = document.getElementById('area-impressao');
  if (!area) {
    area = document.createElement('div');
    area.id = 'area-impressao';
    document.body.appendChild(area);
  }
  area.innerHTML = `<pre class="recibo-preview" style="background:#fff;color:#000;border:none;width:${larguraMm}mm">${seguro}</pre>`;
  window.print();
}

/**
 * Abre o painel Conta.
 * @param {Object} opts
 *   titulo:string       – ex.: "Mesa 8", "Comanda #12", "Balcão"
 *   subtitulo?:string   – ex.: nome da comanda, "Para viagem"
 *   itens:Array         – [{ quantidade, nome, detalhe?, cancelado?, unit_centavos?, total_centavos }]
 *   totais:Object       – { bruto_centavos?, desconto_centavos?, taxa_servico_centavos?,
 *                           total_centavos?, pago_centavos?, falta_centavos? }
 *   pagamentos?:Array   – [{ rotulo, valor_centavos }]
 *   aoFechar?:Function
 */
export async function abrirConta({ titulo = '', subtitulo = '', itens = [], totais = {}, pagamentos = [], aoFechar } = {}) {
  let cfg = {};
  // /config é restrito por cargo (garçom/caixa recebem só o essencial) — o cupom
  // se adapta ao que vier; sem rede ele ainda abre com o que temos.
  try { cfg = (await get('/config')) ?? {}; } catch { cfg = {}; }
  const larguraMm = Number(cfg.recibo_largura_mm) === 58 ? 58 : 80;
  const seguro = escapar(textoConta({
    empresa: { nome: cfg.empresa_nome, cnpj: cfg.empresa_cnpj, telefone: cfg.empresa_telefone, endereco: cfg.empresa_endereco },
    rodape: cfg.recibo_rodape, titulo, subtitulo, itens, totais, pagamentos,
  }, larguraMm));
  const vazio = itens.length === 0;
  const isMobile = window.innerWidth <= 768;
  const m = modal(`
    <h2>${ic('recibo')} Conta <span class="badge">conferência</span></h2>
    ${vazio
      ? '<div class="vazio">Sem itens no consumo.</div>'
      : `<div class="conta-quadriculado" style="--cols:${COLUNAS[larguraMm] ?? 40}"><pre class="recibo-preview">${seguro}</pre></div>`}
    <div class="conta-acoes">
      <button class="btn ghost" data-a="voltar">Voltar</button>
      <button class="btn primario grande" data-a="imprimir"${vazio ? ' disabled' : ''}>${ic('impressora')} Imprimir</button>
    </div>`, { folha: isMobile, aoFechar });
  if (!isMobile) m.caixa.classList.add('conta-lateral');
  m.caixa.querySelector('[data-a="voltar"]').onclick = () => m.fechar();
  const btnImprimir = m.caixa.querySelector('[data-a="imprimir"]');
  if (!vazio) btnImprimir.onclick = () => imprimirCupom(seguro, larguraMm);
  return m;
}

/**
 * Atalho para um pedido já carregado do servidor (mesa/comanda/balcão).
 * @param {Object} pedido – objeto de GET /pedidos/:id (itens, totais, pagamentos…)
 */
export async function abrirContaDoPedido(pedido, { aoFechar } = {}) {
  const t = pedido?.totais ?? {};
  const numero = pedido?.numero_dia ?? pedido?.id ?? '';
  const titulo = pedido?.tipo === 'mesa'
    ? `Mesa ${pedido?.mesa_numero ?? ''}`.trim()
    : (pedido?.comanda_nome ? String(pedido.comanda_nome) : `Balcão #${numero}`);
  const subtitulo = [
    pedido?.tipo === 'mesa' ? pedido?.comanda_nome : null,
    pedido?.canal === 'viagem' ? 'Para viagem' : null,
  ].filter(Boolean).join(' · ');
  // preco_unit_centavos já traz o delta de variação (snapshot do servidor); os
  // adicionais somam à parte — sem isso as linhas não fechariam com o SUBTOTAL.
  const itens = (pedido?.itens ?? []).map((i) => {
    const unit = (i.preco_unit_centavos ?? 0) + (i.adicionais_centavos ?? 0);
    return {
      quantidade: i.quantidade,
      nome: i.nome_produto,
      detalhe: [i.variacao_nome, i.adicionais].filter(Boolean).join(' · '),
      cancelado: i.status === 'cancelado',
      unit_centavos: unit,
      total_centavos: unit * (i.quantidade ?? 0),
    };
  });
  const pagamentos = (pedido?.pagamentos ?? [])
    .filter((p) => !p.estornado)
    .map((p) => ({ rotulo: rotuloForma(p.forma), valor_centavos: p.valor_centavos }));
  return abrirConta({
    titulo,
    subtitulo,
    itens,
    pagamentos,
    totais: {
      bruto_centavos: t.bruto_centavos ?? t.subtotal_centavos,
      desconto_centavos: t.desconto_centavos ?? 0,
      taxa_servico_centavos: t.taxa_servico_centavos ?? 0,
      total_centavos: t.total_centavos,
      pago_centavos: t.pago_centavos ?? 0,
      falta_centavos: t.saldo_centavos ?? 0,
    },
    aoFechar,
  });
}
