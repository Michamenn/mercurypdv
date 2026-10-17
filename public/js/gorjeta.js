// Gorjeta: valor extra deixado pelo cliente SOBRE a conta. Não entra no
// total_centavos nem no saldo_centavos da venda — serve apenas para a
// comissão do atendente/garçom (relatório de Comissões).
import { toast, modal, escapar } from './ui.js';
import { get, post, fmt, reaisParaCentavos } from './api.js';

const ROTULOS = {
  dinheiro: 'Dinheiro', pix: 'PIX', cartao_debito: 'Débito',
  cartao_credito: 'Crédito', vale_refeicao: 'Vale',
};

// Resolve o garçom pelo nome via /auth/operadores (lista pública de operadores).
async function garcomPorNome(nome) {
  try {
    const ops = await get('/auth/operadores');
    const achado = (ops?.operadores ?? ops ?? []).find((o) => String(o.nome).toLowerCase() === nome.toLowerCase());
    return achado ? { id: achado.id } : null;
  } catch { return null; }
}

// Abre o modal de gorjeta. Opções:
//   pedidoId   — id da venda/comanda
//   nomePadrao — atendente sugerido no campo
//   aoRegistrar— callback opcional após registrar com sucesso
export function abrirGorjeta({ pedidoId, nomePadrao = '', aoRegistrar = null } = {}) {
  const m = modal(`<h2>Gorjeta</h2>
    <p style="color:var(--texto-fraco)">Valor extra deixado pelo cliente <strong>sobre a conta</strong>. Não aumenta o total da venda — serve para a comissão do atendente.</p>
    <label style="display:block"><small style="color:var(--texto-fraco)">Valor (ex: 10,00)</small>
      <input id="g-valor" inputmode="decimal" placeholder="Valor" style="width:100%;padding:14px;font-size:1.2rem;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" /></label>
    <div class="abas" style="margin-top:8px">
      ${Object.entries(ROTULOS).map(([f, r]) => `<button class="btn ${f === 'dinheiro' ? 'ativa' : ''}" data-f="${f}">${r}</button>`).join('')}
    </div>
    <label style="display:block;margin-top:8px"><small style="color:var(--texto-fraco)">Atendente que recebeu</small>
      <input id="g-garcom" value="${escapar(nomePadrao)}" placeholder="Nome do garçom" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" /></label>
    <input id="g-obs" placeholder="Observação (opcional)" style="width:100%;padding:12px;margin-top:8px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
    <div style="display:flex;gap:10px;margin-top:12px"><button class="btn ghost" data-a="c">Cancelar</button><button class="btn ok grande" data-a="ok" style="flex:1">Registrar gorjeta</button></div>`);
  m.caixa.querySelector('[data-a="c"]').onclick = m.fechar;
  let forma = 'dinheiro';
  m.caixa.querySelectorAll('[data-f]').forEach((b) => {
    b.onclick = () => {
      forma = b.dataset.f;
      m.caixa.querySelectorAll('[data-f]').forEach((x) => x.classList.remove('ativa'));
      b.classList.add('ativa');
    };
  });
  m.caixa.querySelector('[data-a="ok"]').onclick = async () => {
    const centavos = reaisParaCentavos(m.caixa.querySelector('#g-valor').value);
    if (!centavos || centavos <= 0) { toast('Valor inválido', 'erro'); return; }
    const nome = m.caixa.querySelector('#g-garcom').value.trim();
    try {
      // Sem garçom resolvido o servidor usa o atendente da comanda.
      const garcom = nome ? await garcomPorNome(nome) : null;
      await post(`/pedidos/${pedidoId}/gorjeta`, {
        valor_centavos: centavos,
        forma,
        observacao: m.caixa.querySelector('#g-obs').value.trim() || null,
        garcom_id: garcom?.id ?? null,
      });
      m.fechar();
      toast(`Gorjeta de ${fmt(centavos)} registrada`, 'ok');
      if (aoRegistrar) await aoRegistrar();
    } catch (e) { toast(e.message, 'erro'); }
  };
}
