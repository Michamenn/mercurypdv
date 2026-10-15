// Visualizador de recibo NÃO FISCAL + impressão 58/80mm (BR-002)
import { modal, escapar } from './ui.js';

export function rotuloForma(f) {
  return { dinheiro: 'Dinheiro', pix: 'PIX', cartao_debito: 'Cartão Débito', cartao_credito: 'Cartão Crédito', vale_refeicao: 'Vale Refeição' }[f] ?? f;
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
    <div style="display:flex;gap:10px;margin-top:14px">
      <button class="btn ghost" data-a="fechar">Fechar</button>
      <button class="btn primario grande" data-a="imprimir" style="flex:1"> Imprimir</button>
    </div>`, { aoFechar });
  m.caixa.querySelector('[data-a="fechar"]').onclick = m.fechar;
  m.caixa.querySelector('[data-a="imprimir"]').onclick = () => {
    let area = document.getElementById('area-impressao');
    if (!area) { area = document.createElement('div'); area.id = 'area-impressao'; document.body.appendChild(area); }
    area.innerHTML = `<pre class="recibo-preview" style="background:#fff;color:#000;border:none;width:${conteudo.largura_mm}mm">${textoSeguro}</pre>`;
    window.print();
  };
  return m;
}
