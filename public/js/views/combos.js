// Admin view for Combos/Promoções
import { ic } from '../icons.js';
import { get, post, put, del, fmt, reaisParaCentavos } from '../api.js';
import { toast, modal, confirmar, escapar } from '../ui.js';

export async function render(conteudo, _sub, estadoApp) {
  if (!estadoApp.permissoes.pode_gerenciar_combos) {
    conteudo.innerHTML = '<div class="vazio">Sem permissão para gerenciar combos.</div>';
    return;
  }
  await atualizar(conteudo, estadoApp);
}

async function atualizar(conteudo, estadoApp) {
  let combos = [];
  try {
    const resp = await get('/combos');
    combos = resp.combos ?? resp;
  } catch (e) {
    combos = [];
    toast('Erro ao carregar combos: ' + e.message, 'erro');
  }

  conteudo.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h2>${ic('presente')} Combos & Promoções</h2>
      <button class="btn primario" id="novo-combo">+ Novo Combo</button>
    </div>
    <div class="cartao" style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h3 style="margin:0">Promoções por produto (valor + dia)</h3>
        <button class="btn" id="nova-promo">+ Nova promoção</button>
      </div>
      <div id="promo-lista" style="margin-top:8px">Carregando…</div>
    </div>
    <table class="dados"><thead><tr><th scope="col">Nome</th><th scope="col">Tipo</th><th scope="col">Valor/Regra</th><th scope="col">Validade</th><th scope="col">Itens</th><th scope="col">Status</th><th scope="col"><span class="sr-only">Ações</span></th></tr></thead>
    <tbody>${combos.map(c => `
      <tr>
        <td>${escapar(c.nome)}${c.descricao ? `<br><small style="color:var(--texto-fraco)">${escapar(c.descricao)}</small>` : ''}</td>
        <td><span class="badge">${labelTipo(c.tipo)}</span></td>
        <td class="num">${formatValorCombo(c)}</td>
        <td>${formatValidade(c)}</td>
        <td>${c.itens?.length ?? 0} item(s)</td>
        <td>${c.ativo ? '<span class="badge ok">Ativo</span>' : '<span class="badge alerta">Inativo</span>'}</td>
        <td>
          <button class="btn ghost" data-edit="${c.id}" title="Editar"></button>
          <button class="btn ghost" data-toggle="${c.id}" title="${c.ativo ? 'Desativar' : 'Ativar'}">${c.ativo ? '⏸' : '▶'}</button>
          <button class="btn ghost perigo" data-del="${c.id}" title="Excluir"></button>
        </td>
      </tr>`).join('') || '<tr><td colspan="7" class="vazio">Nenhum combo cadastrado</td></tr>'}</tbody></table>
  `;

  conteudo.querySelector('#novo-combo').onclick = () => formCombo();
  carregarPromos(conteudo);
  conteudo.querySelector('#nova-promo').onclick = () => formPromo(null, conteudo);
  conteudo.querySelectorAll('[data-edit]').forEach(b => {
    b.onclick = () => formCombo(combos.find(c => c.id === Number(b.dataset.edit)));
  });
  conteudo.querySelectorAll('[data-toggle]').forEach(b => {
    b.onclick = async () => {
      try {
        const resp = await post(`/combos/${b.dataset.toggle}/toggle`, {});
        toast(resp.ativo ? 'Combo ativado' : 'Combo desativado', 'ok');
        atualizar(conteudo, estadoApp);
      } catch (e) { toast(e.message, 'erro'); }
    };
  });
  conteudo.querySelectorAll('[data-del]').forEach(b => {
    b.onclick = async () => {
      if (!await confirmar('Excluir combo?', 'O combo será desativado (soft delete).', { perigo: true })) return;
      try {
        await post(`/combos/${b.dataset.del}`, {}, { metodo: 'DELETE' });
        toast('Combo removido', 'ok');
        atualizar(conteudo, estadoApp);
      } catch (e) { toast(e.message, 'erro'); }
    };
  });
}

async function carregarPromos(conteudo) {
  const box = conteudo.querySelector('#promo-lista');
  if (!box) return;
  let promos = [];
  try { promos = await get('/promocoes-produto'); }
  catch (e) { box.innerHTML = `<div class="vazio">Erro: ${escapar(e.message)}</div>`; return; }
  const nomesDias = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
  box.innerHTML = promos.map((p) => {
    const valor = p.tipo === 'percentual' ? `${p.desconto_percentual}% OFF` : fmt(p.preco_fixo_centavos);
    const dias = String(p.dias_semana ?? '0,1,2,3,4,5,6');
    const janela = dias === '0,1,2,3,4,5,6' ? 'todo dia' : 'dias ' + dias.split(',').map((d) => nomesDias[Number(d)] ?? d).join('');
    return `<div class="linha-itens"><span><strong>${escapar(p.produto_nome)}</strong> — ${escapar(p.nome)}<br>
      <small style="color:var(--texto-fraco)">${valor} · ${janela}${p.hora_ini ? ` · ${p.hora_ini}–${p.hora_fim}` : ''}${p.limite_usos ? ` · usos ${p.usos}/${p.limite_usos}` : ''}</small>
      ${p.ativo ? '' : ' <span class="badge alerta">inativa</span>'}</span>
      <span style="display:flex;gap:6px"><button class="btn ghost" data-edpromo="${p.id}" aria-label="Editar promoção">Editar</button>
      <button class="btn ghost perigo" data-delpromo="${p.id}" aria-label="Remover promoção">Remover</button></span></div>`;
  }).join('') || '<div class="vazio">Nenhuma promoção por produto</div>';
  box.querySelectorAll('[data-edpromo]').forEach((b) => {
    b.onclick = () => formPromo(promos.find((x) => x.id === Number(b.dataset.edpromo)), conteudo);
  });
  box.querySelectorAll('[data-delpromo]').forEach((b) => {
    b.onclick = async () => {
      if (!await confirmar('Remover promoção?', 'Ela será desativada.', { perigo: true })) return;
      try { await del(`/promocoes-produto/${b.dataset.delpromo}`); toast('Promoção removida', 'ok'); carregarPromos(conteudo); }
      catch (e) { toast(e.message, 'erro'); }
    };
  });
}

async function formPromo(promo, conteudo) {
  const cat = await get('/catalogo');
  const dias = String(promo?.dias_semana ?? '0,1,2,3,4,5,6').split(',');
  const nomes = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const m = modal(`<h2>${promo ? 'Editar' : 'Nova'} promoção por produto</h2>
    <select id="pr-prod" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)">
      ${cat.produtos.map((p) => `<option value="${p.id}" ${promo?.produto_id === p.id ? 'selected' : ''}>${escapar(p.nome)} (${fmt(p.preco_centavos)})</option>`).join('')}
    </select>
    <input id="pr-nome" value="${escapar(promo?.nome ?? '')}" placeholder="Nome (ex: Happy hour Refri)" style="width:100%;padding:12px;margin-top:8px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
    <div style="display:flex;gap:8px;margin-top:8px">
      <select id="pr-tipo" style="flex:1;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)">
        <option value="percentual" ${promo?.tipo === 'percentual' ? 'selected' : ''}>% de desconto</option>
        <option value="preco_fixo" ${promo?.tipo === 'preco_fixo' ? 'selected' : ''}>Preço fixo</option>
      </select>
      <input id="pr-valor" inputmode="decimal" value="${promo ? (promo.tipo === 'percentual' ? promo.desconto_percentual : (promo.preco_fixo_centavos / 100).toFixed(2).replace('.', ',')) : ''}" placeholder="% ou R$" style="flex:1;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
    </div>
    <p style="margin:10px 0 4px">Dias da promoção</p>
    <div style="display:flex;gap:6px;flex-wrap:wrap">${['0', '1', '2', '3', '4', '5', '6'].map((d) => `
      <label style="cursor:pointer"><input type="checkbox" data-dia="${d}" ${dias.includes(d) ? 'checked' : ''} style="width:20px;height:20px" aria-label="${nomes[Number(d)]}" /> ${nomes[Number(d)]}</label>`).join('')}</div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <input id="pr-ini" type="time" value="${promo?.hora_ini ?? ''}" style="flex:1;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" title="Início (vazio = o dia todo)" />
      <input id="pr-fim" type="time" value="${promo?.hora_fim ?? ''}" style="flex:1;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" title="Fim" />
      <input id="pr-lim" type="number" min="1" value="${promo?.limite_usos ?? ''}" placeholder="Limite usos" style="flex:1;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
    </div>
    <label style="display:block;margin-top:8px"><input type="checkbox" id="pr-ativo" ${promo?.ativo === 0 ? '' : 'checked'} /> Ativa</label>
    <div style="display:flex;gap:10px;margin-top:12px"><button class="btn ghost" data-a="c">Cancelar</button><button class="btn primario" data-a="ok" style="flex:1">Salvar</button></div>`);
  m.caixa.querySelector('[data-a="c"]').onclick = m.fechar;
  m.caixa.querySelector('[data-a="ok"]').onclick = async () => {
    try {
      const tipo = m.caixa.querySelector('#pr-tipo').value;
      const valorRaw = m.caixa.querySelector('#pr-valor').value;
      const corpo = {
        produto_id: Number(m.caixa.querySelector('#pr-prod').value),
        nome: m.caixa.querySelector('#pr-nome').value.trim(),
        tipo,
        dias_semana: [...m.caixa.querySelectorAll('[data-dia]:checked')].map((c) => c.dataset.dia).join(','),
        hora_ini: m.caixa.querySelector('#pr-ini').value || null,
        hora_fim: m.caixa.querySelector('#pr-fim').value || null,
        limite_usos: m.caixa.querySelector('#pr-lim').value ? Number(m.caixa.querySelector('#pr-lim').value) : null,
        ativo: m.caixa.querySelector('#pr-ativo').checked ? 1 : 0,
      };
      if (tipo === 'percentual') corpo.desconto_percentual = Number(valorRaw);
      else corpo.preco_fixo_centavos = reaisParaCentavos(valorRaw);
      if (promo) await put(`/promocoes-produto/${promo.id}`, corpo);
      else await post('/promocoes-produto', corpo);
      m.fechar(); toast('Promoção salva', 'ok'); carregarPromos(conteudo);
    } catch (e) { toast(e.message, 'erro'); }
  };
}

function labelTipo(tipo) {  return {
    preco_fixo: ic('dinheiro') + ' Preço Fixo',
    desconto_percentual: ic('queda') + ' % Desconto',
    leve_pague: ic('numeros') + ' Leve X Pague Y',
    brinde: ic('presente') + ' Brinde'
  }[tipo] ?? tipo;
}

function formatValorCombo(c) {
  switch (c.tipo) {
    case 'preco_fixo': return fmt(c.preco_fixo_centavos);
    case 'desconto_percentual': return `${c.desconto_percentual}% OFF`;
    case 'leve_pague': return `Leve ${c.leve_quantidade} Pague ${c.pague_quantidade}`;
    case 'brinde': return 'Produto brinde';
    default: return '—';
  }
}

  function formatValidade(c) {
  const partes = [];
  if (!c.valido_de && !c.valido_ate) partes.push('Sempre');
  else {
    const ini = c.valido_de ? new Date(c.valido_de).toLocaleDateString('pt-BR') : 'Início';
    const fim = c.valido_ate ? new Date(c.valido_ate).toLocaleDateString('pt-BR') : 'Sem fim';
    partes.push(`${ini} → ${fim}`);
  }
  const dias = String(c.dias_semana ?? '0,1,2,3,4,5,6');
  if (dias !== '0,1,2,3,4,5,6') {
    const nomes = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
    partes.push(dias.split(',').map((d) => nomes[Number(d)] ?? d).join(''));
  }
  if (c.hora_ini && c.hora_fim) partes.push(`${c.hora_ini}–${c.hora_fim}`);
  if (c.limite_usos) partes.push(`usos ${c.usos ?? 0}/${c.limite_usos}`);
  return partes.join('<br>');
}

function formCombo(c = null) {
  const tipos = [
    { value: 'preco_fixo', label: ic('dinheiro') + ' Preço Fixo (ex: X+Bebida+Batata = R$ 29,90)' },
    { value: 'desconto_percentual', label: ic('queda') + ' % Desconto (ex: 20% off no combo)' },
    { value: 'leve_pague', label: ic('numeros') + ' Leve X Pague Y (ex: Leve 3 Pague 2)' },
    { value: 'brinde', label: ic('presente') + ' Brinde (compra X ganha Y)' }
  ];

  const m = modal(`
    <h2>${c ? 'Editar' : 'Novo'} Combo</h2>
    <div style="display:flex;flex-direction:column;gap:12px">
      <input id="nome" value="${escapar(c?.nome ?? '')}" placeholder="Nome do combo" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" required />
      <textarea id="descricao" placeholder="Descrição (opcional)" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto);min-height:60px">${escapar(c?.descricao ?? '')}</textarea>
      <select id="tipo" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)">
        ${tipos.map(t => `<option value="${t.value}" ${c?.tipo === t.value ? 'selected' : ''}>${t.label}</option>`).join('')}
      </select>
      <div id="campos-tipo"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <input type="date" id="valido_de" value="${c?.valido_de ? c.valido_de.slice(0,10) : ''}" style="padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
        <input type="date" id="valido_ate" value="${c?.valido_ate ? c.valido_ate.slice(0,10) : ''}" style="padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
      </div>
      <label style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="ativo" ${c?.ativo ? 'checked' : ''} /> Ativo</label>
      <label style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="exige_estoque" ${c?.exige_estoque !== 0 ? 'checked' : ''} /> Validar estoque antes de aplicar</label>
      <h4 style="margin:16px 0 8px">Janela semanal (happy hour)</h4>
      <div style="display:flex;gap:4px;flex-wrap:wrap" role="group" aria-label="Dias da semana">
        ${[['0', 'D'], ['1', 'S'], ['2', 'T'], ['3', 'Q'], ['4', 'Q'], ['5', 'S'], ['6', 'S']].map(([v, r], ix) => {
          const dias = String(c?.dias_semana ?? '0,1,2,3,4,5,6').split(',');
          const nomes = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
          return `<label style="cursor:pointer" title="${nomes[ix]}"><input type="checkbox" data-dia="${v}" ${dias.includes(v) ? 'checked' : ''} style="width:20px;height:20px" aria-label="${nomes[ix]}" /> ${r}</label>`;
        }).join('')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:8px">
        <input type="time" id="hora_ini" value="${c?.hora_ini ?? ''}" style="padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" title="Início (vazio = o dia todo)" />
        <input type="time" id="hora_fim" value="${c?.hora_fim ?? ''}" style="padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" title="Fim" />
        <input type="number" id="limite_usos" min="1" placeholder="Limite usos (vazio = ∞)" value="${c?.limite_usos ?? ''}" style="padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" />
      </div>
      ${c?.limite_usos ? `<small style="color:var(--texto-fraco)">Usado ${c.usos ?? 0}/${c.limite_usos} vezes</small>` : ''}
      <h4 style="margin:16px 0 8px">Itens do Combo</h4>
      <div id="itens-lista"></div>
      <button class="btn ghost" id="add-item" style="width:100%">+ Adicionar Item</button>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
        <button class="btn ghost" data-a="cancelar">Cancelar</button>
        <button class="btn primario grande" data-a="salvar" style="flex:1">${c ? 'Salvar' : 'Criar'}</button>
      </div>
    </div>
  `);

  const camposTipo = m.caixa.querySelector('#campos-tipo');
  const itensLista = m.caixa.querySelector('#itens-lista');
  let itens = c?.itens?.map(it => ({
    produto_id: it.produto_id,
    quantidade: it.quantidade,
    obrigatorio: it.obrigatorio ?? 1,
    grupo_escolha: it.grupo_escolha ?? null,
    max_escolhas: it.max_escolhas ?? null,
    produto_nome: it.produto_nome,
    produto_preco: it.produto_preco
  })) || [];

  function renderCamposTipo() {
    const tipo = m.caixa.querySelector('#tipo').value;
    let html = '';
    if (tipo === 'preco_fixo') {
      html = `<input type="text" id="preco_fixo" inputmode="decimal" placeholder="Preço do combo (ex: 29,90)" value="${c?.preco_fixo_centavos ? (c.preco_fixo_centavos/100).toFixed(2).replace('.', ',') : ''}" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" required />`;
    } else if (tipo === 'desconto_percentual') {
      html = `<input type="number" id="desconto_percentual" min="1" max="100" placeholder="% de desconto (ex: 20)" value="${c?.desconto_percentual ?? ''}" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" required />`;
    } else if (tipo === 'leve_pague') {
      html = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <input type="number" id="leve_quantidade" min="2" placeholder="Leve (ex: 3)" value="${c?.leve_quantidade ?? ''}" style="padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" required />
        <input type="number" id="pague_quantidade" min="1" placeholder="Pague (ex: 2)" value="${c?.pague_quantidade ?? ''}" style="padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" required />
      </div>`;
    } else if (tipo === 'brinde') {
      html = `<select id="brinde_produto_id" style="width:100%;padding:12px;background:var(--canvas);border-radius:10px;border:1px solid var(--borda);color:var(--texto)" required><option value="">Selecione o produto brinde</option></select>`;
    }
    camposTipo.innerHTML = html;
    if (tipo === 'brinde') carregarProdutosParaBrinde();
  }

  async function carregarProdutosParaBrinde() {
    try {
      const resp = await get('/catalogo');
      const select = m.caixa.querySelector('#brinde_produto_id');
      select.innerHTML = '<option value="">Selecione o produto brinde</option>' + resp.produtos.filter(p => p.ativo).map(p => `<option value="${p.id}" ${c?.brinde_produto_id === p.id ? 'selected' : ''}>${escapar(p.nome)} (${fmt(p.preco_centavos)})</option>`).join('');
    } catch (e) { toast('Erro ao carregar produtos', 'erro'); }
  }

  function renderItens() {
    itensLista.innerHTML = itens.length ? itens.map((it, idx) => `
      <div class="cartao" style="display:flex;flex-direction:column;gap:8px;padding:12px">
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <select data-idx="${idx}" class="item-produto" style="flex:1;min-width:200px;padding:10px;background:var(--canvas);border-radius:8px;border:1px solid var(--borda);color:var(--texto)">
            <option value="">Selecione produto</option>
          </select>
          <input type="number" data-idx="${idx}" class="item-qtd" min="1" max="999" value="${it.quantidade}" placeholder="Qtd" style="width:80px;padding:10px;background:var(--canvas);border-radius:8px;border:1px solid var(--borda);color:var(--texto)" />
          <label style="display:flex;align-items:center;gap:6px;font-size:.9rem">
            <input type="checkbox" data-idx="${idx}" class="item-obrigatorio" ${it.obrigatorio ? 'checked' : ''} /> Obrigatório
          </label>
          <span class="item-grupo" style="${it.grupo_escolha ? '' : 'display:none'}">
            Grupo: <input type="number" data-idx="${idx}" class="item-grupo-id" min="1" value="${it.grupo_escolha ?? ''}" placeholder="Grupo" style="width:60px;padding:8px;background:var(--canvas);border-radius:8px;border:1px solid var(--borda);color:var(--texto)" />
            Máx: <input type="number" data-idx="${idx}" class="item-max" min="1" value="${it.max_escolhas ?? ''}" placeholder="Máx" style="width:60px;padding:8px;background:var(--canvas);border-radius:8px;border:1px solid var(--borda);color:var(--texto)" />
          </span>
          <button class="btn ghost perigo" data-rm="${idx}" style="padding:8px 12px" title="Remover">${ic('lixeira')}</button>
        </div>
        <small style="color:var(--texto-fraco)">${it.produto_nome ? `${ic('dinheiro')} ${fmt(it.produto_preco)} × ${it.quantidade} = ${fmt(it.produto_preco * it.quantidade)}` : 'Selecione um produto'}</small>
      </div>
    `).join('') : '<div class="vazio">Nenhum item. Clique em + Adicionar Item.</div>';

    itensLista.innerHTML = html;

    // Carregar produtos nos selects
    get('/catalogo').then(resp => {
      m.caixa.querySelectorAll('.item-produto').forEach(sel => {
        const idx = Number(sel.dataset.idx);
        const atual = itens[idx]?.produto_id;
        sel.innerHTML = '<option value="">Selecione produto</option>' + resp.produtos.filter(p => p.ativo).map(p => `<option value="${p.id}" ${atual === p.id ? 'selected' : ''}>${escapar(p.nome)} (${fmt(p.preco_centavos)})</option>`).join('');
      });
    });

    // Event listeners para itens
    itensLista.querySelectorAll('[data-rm]').forEach(b => {
      b.onclick = () => { itens.splice(Number(b.dataset.rm), 1); renderItens(); };
    });
    itensLista.querySelectorAll('.item-produto').forEach(sel => {
      sel.onchange = () => { itens[Number(sel.dataset.idx)].produto_id = Number(sel.value); renderItens(); };
    });
    itensLista.querySelectorAll('.item-qtd').forEach(inp => {
      inp.onchange = () => { itens[Number(inp.dataset.idx)].quantidade = Number(inp.value) || 1; renderItens(); };
    });
    itensLista.querySelectorAll('.item-obrigatorio').forEach(chk => {
      chk.onchange = () => {
        const idx = Number(chk.dataset.idx);
        itens[idx].obrigatorio = chk.checked ? 1 : 0;
        if (!chk.checked) { itens[idx].grupo_escolha = null; itens[idx].max_escolhas = null; }
        renderItens();
      };
    });
    itensLista.querySelectorAll('.item-grupo-id').forEach(inp => {
      inp.onchange = () => { itens[Number(inp.dataset.idx)].grupo_escolha = Number(inp.value) || null; renderItens(); };
    });
    itensLista.querySelectorAll('.item-max').forEach(inp => {
      inp.onchange = () => { itens[Number(inp.dataset.idx)].max_escolhas = Number(inp.value) || null; renderItens(); };
    });
  }

  // Tipo change
  m.caixa.querySelector('#tipo').onchange = () => {
    renderCamposTipo();
    // Reset itens groups when tipo changes to non-leve_pague/brinde
    const tipo = m.caixa.querySelector('#tipo').value;
    if (tipo !== 'leve_pague' && tipo !== 'brinde') {
      itens.forEach(it => { it.grupo_escolha = null; it.max_escolhas = null; });
    }
    renderItens();
  };

  // Add item
  m.caixa.querySelector('#add-item').onclick = async () => {
    try {
      const resp = await get('/catalogo');
      const primeiro = resp.produtos.find(p => p.ativo);
      if (!primeiro) { toast('Nenhum produto ativo', 'erro'); return; }
      itens.push({ produto_id: primeiro.id, quantidade: 1, obrigatorio: 1, grupo_escolha: null, max_escolhas: null, produto_nome: primeiro.nome, produto_preco: primeiro.preco_centavos });
      renderItens();
    } catch (e) { toast('Erro ao carregar produtos', 'erro'); }
  };

  // Initial render
  renderCamposTipo();
  renderItens();

  m.caixa.querySelector('[data-a="cancelar"]').onclick = m.fechar;
  m.caixa.querySelector('[data-a="salvar"]').onclick = async () => {
    const tipo = m.caixa.querySelector('#tipo').value;
    let corpo = {
      nome: m.caixa.querySelector('#nome').value.trim(),
      descricao: m.caixa.querySelector('#descricao').value.trim() || null,
      tipo,
      valido_de: m.caixa.querySelector('#valido_de').value || null,
      valido_ate: m.caixa.querySelector('#valido_ate').value || null,
      ativo: m.caixa.querySelector('#ativo').checked ? 1 : 0,
      exige_estoque: m.caixa.querySelector('#exige_estoque').checked ? 1 : 0,
      dias_semana: [...m.caixa.querySelectorAll('[data-dia]:checked')].map((c) => c.dataset.dia).join(','),
      hora_ini: m.caixa.querySelector('#hora_ini').value || null,
      hora_fim: m.caixa.querySelector('#hora_fim').value || null,
      limite_usos: m.caixa.querySelector('#limite_usos').value ? Number(m.caixa.querySelector('#limite_usos').value) : null,
      itens: itens.map(it => ({
        produto_id: it.produto_id,
        quantidade: it.quantidade,
        obrigatorio: it.obrigatorio,
        grupo_escolha: it.grupo_escolha,
        max_escolhas: it.max_escolhas
      }))
    };

    if (tipo === 'preco_fixo') {
      corpo.preco_fixo_centavos = reaisParaCentavos(m.caixa.querySelector('#preco_fixo').value);
    } else if (tipo === 'desconto_percentual') {
      corpo.desconto_percentual = Number(m.caixa.querySelector('#desconto_percentual').value);
    } else if (tipo === 'leve_pague') {
      corpo.leve_quantidade = Number(m.caixa.querySelector('#leve_quantidade').value);
      corpo.pague_quantidade = Number(m.caixa.querySelector('#pague_quantidade').value);
    } else if (tipo === 'brinde') {
      corpo.brinde_produto_id = Number(m.caixa.querySelector('#brinde_produto_id').value);
    }

    if (!corpo.nome) { toast('Nome obrigatório', 'erro'); return; }
    if (corpo.itens.length === 0) { toast('Adicione pelo menos 1 item', 'erro'); return; }
    if (tipo === 'preco_fixo' && !corpo.preco_fixo_centavos) { toast('Preço do combo obrigatório', 'erro'); return; }
    if (tipo === 'desconto_percentual' && !corpo.desconto_percentual) { toast('% desconto obrigatório', 'erro'); return; }
    if (tipo === 'leve_pague' && (!corpo.leve_quantidade || !corpo.pague_quantidade)) { toast('Leve/Pague obrigatórios', 'erro'); return; }
    if (tipo === 'brinde' && !corpo.brinde_produto_id) { toast('Produto brinde obrigatório', 'erro'); return; }

    try {
      if (c) await put(`/combos/${c.id}`, corpo);
      else await post('/combos', corpo);
      m.fechar();
      toast(c ? 'Combo atualizado' : 'Combo criado', 'ok');
      // Refresh will be triggered by hashchange or manual call
      window.dispatchEvent(new Event('hashchange'));
    } catch (e) { toast(e.message, 'erro'); }
  };
}
export async function seletorCombo(pedidoId) {
  let vigentes = [];
  try {
    const r = await get(`/combos/vigentes`);
    vigentes = r.combos ?? [];
  } catch (e) { toast(e.message, `erro`); return null; }
  if (!vigentes.length) { toast(`Nenhum combo vigente no momento`, `erro`); return null; }
  return new Promise((resolve) => {
    const m = modal(`
      <h2> Aplicar combo ao pedido #${pedidoId}</h2>
      <div class="lista-usuarios" style="max-height:46vh">
        ${vigentes.map((c) => `
          <button class="btn usuario-btn" data-combo="${c.id}">
            <span><strong>${escapar(c.nome)}</strong> <span class="badge">${labelTipo(c.tipo)}</span><br>
            <small>${escapar((c.itens ?? []).filter((i) => i.obrigatorio).map((i) => `${i.quantidade}x ${i.produto_nome}`).join(` + `) || `ver itens`)}</small><br>
            <small style="color:var(--ok);font-family:var(--mono)">${escapar(formatValorCombo(c))}</small></span>
          </button>`).join(``)}
      </div>
      <div id="combo-escolhas"></div>
      <div style="display:flex;gap:10px;margin-top:12px">
        <button class="btn ghost" data-a="voltar">Voltar</button>
        <button class="btn primario grande" data-a="aplicar" style="flex:1" disabled>Aplicar</button>
      </div>`);
    let selecionado = null;
    const escolhasBox = m.caixa.querySelector(`#combo-escolhas`);
    const btnAplicar = m.caixa.querySelector(`[data-a="aplicar"]`);
    m.caixa.querySelector(`[data-a="voltar"]`).onclick = () => { m.fechar(); resolve(null); };
    m.caixa.querySelectorAll(`[data-combo]`).forEach((b) => {
      b.onclick = () => {
        selecionado = vigentes.find((c) => c.id === Number(b.dataset.combo));
        m.caixa.querySelectorAll(`[data-combo]`).forEach((x) => x.classList.remove(`selecionado`));
        b.classList.add(`selecionado`);
        const opcionais = (selecionado.itens ?? []).filter((i) => !i.obrigatorio);
        const grupos = [...new Set(opcionais.map((i) => i.grupo_escolha))];
        escolhasBox.innerHTML = grupos.map((g) => {
          const itensG = opcionais.filter((i) => i.grupo_escolha === g);
          const max = itensG[0]?.max_escolhas ?? itensG.length;
          return `<p style="margin-bottom:4px">Escolha (grupo ${g}, max ${max})</p>` + itensG.map((i) => `
            <label class="linha-itens" style="cursor:pointer">
              <span><input type="checkbox" data-op="${i.produto_id}" data-grupo="${g}" /> ${escapar(i.produto_nome)}</span>
              <span class="preco">${fmt(i.produto_preco)}</span>
            </label>`).join(``);
        }).join(``) || `<p style="color:var(--texto-fraco)">Sem opcionais — aplica direto.</p>`;
        btnAplicar.disabled = false;
        escolhasBox.querySelectorAll(`[data-op]`).forEach((c) => {
          c.onchange = () => {
            const marcados = escolhasBox.querySelectorAll(`[data-grupo="${c.dataset.grupo}"]:checked`);
            const max = Number((selecionado.itens ?? []).find((i) => String(i.grupo_escolha) === String(c.dataset.grupo))?.max_escolhas ?? 99);
            if (marcados.length > max) { c.checked = false; toast(`Máximo de ${max} neste grupo`, `erro`); }
          };
        });
      };
    });
    btnAplicar.onclick = async () => {
      if (!selecionado) return;
      const escolhas = [...escolhasBox.querySelectorAll(`[data-op]:checked`)].map((c) => ({ produto_id: Number(c.dataset.op), quantidade: 1 }));
      try {
        const { novaIdempotencia } = await import(`../api.js`);
        const r = await post(`/pedidos/${pedidoId}/aplicar-combo`, { combo_id: selecionado.id, escolhas }, { idem: novaIdempotencia(`combo`) });
        m.fechar();
        toast(`Combo "${selecionado.nome}" aplicado${r.desconto_centavos ? ` — desconto ${fmt(r.desconto_centavos)}` : ``}`, `ok`);
        resolve(await get(`/pedidos/${pedidoId}`));
      } catch (e) { toast(e.message, `erro`); }
    };
  });
}
