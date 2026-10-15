// ============================================================
// Central de Personalização (P-05) — ponto único de entrada.
// NÃO substitui nada: apenas agrupa os controles que já existiam
// espalhados entre `a11y.js` (leitura), `theme.js` (aparência) e
// `app.js` (navegação). Todas as funções originais continuam intactas
// e continuam exportadas dos seus módulos.
// ============================================================
import { ic } from './icons.js';
import { toast, confirmar, modal } from './ui.js';
import {
  A11yState, definirTamanhoFonte, toggleAltoContraste,
  toggleReduzirMotion, toggleModoUmaMao,
} from './a11y.js';
import {
  ThemeState, setTema, setCorPersonalizada, resetarCorPersonalizada,
  setDensity, usarTemaGlobal,
} from './theme.js';
import { anunciar } from './a11y.js';

const CHAVE_A11Y = 'lp-a11y-prefs';
const CHAVE_TEMA = 'lp-theme-prefs'; // mesma chave usada por theme.js
const CHAVE_NAV = 'lp-nav';          // mesma chave usada por app.js

const ROTULO_FONTE = ['Pequeno (14px)', 'Médio (16px)', 'Grande (20px)', 'Extra grande (24px)'];
// Chaves reais de ThemeState.cores (ver theme.js) e seus valores padrão.
const CORES = [
  ['acao', 'Ação (botões)', '#F97316'],
  ['ok', 'Sucesso', '#10B981'],
  ['alerta', 'Alerta', '#EF4444'],
];
const TEMAS = [
  ['escuro', 'Escuro'], ['claro', 'Claro'],
  ['alto-contraste', 'Alto contraste'], ['premium', 'Premium'],
];

function grupo(titulo, descricao, conteudo) {
  return `<section class="cartao pers-grupo">
    <h3 style="margin-top:0">${titulo}</h3>
    ${descricao ? `<p style="color:var(--texto-fraco);margin-top:0">${descricao}</p>` : ''}
    ${conteudo}
  </section>`;
}

/**
 * Renderiza a central de personalização.
 * @param {HTMLElement} container
 * @param {{podeConfigSistema?: boolean}} opcoes  define se mostra a seção
 *        "Padrões do estabelecimento" (somente admin).
 */
export function renderPersonalizacao(container, { podeConfigSistema = false } = {}) {
  container.innerHTML = `
    <div class="pers-topo">
      <p style="color:var(--texto-fraco);margin:0">
        ${ic('paleta')} Ajuste a aparência e a leitura do sistema. As escolhas ficam salvas
        <strong>neste aparelho</strong> e valem no próximo acesso.
      </p>
      <button class="btn perigo" id="pers-resetar">${ic('reciclar')} Restaurar padrões</button>
    </div>

    ${grupo(`${ic('paleta')} Aparência`, 'Cor, contraste e densidade dos elementos.',
      `<div class="pers-grade">
        <fieldset class="pers-campo">
          <legend>Tema</legend>
          <div class="pers-opcoes" role="radiogroup" aria-label="Tema">
            ${TEMAS.map(([v, r]) => `<button class="btn ${ThemeState.tema === v ? 'ativa' : ''}" data-tema="${v}" role="radio" aria-checked="${ThemeState.tema === v}">${r}</button>`).join('')}
          </div>
        </fieldset>

        <fieldset class="pers-campo">
          <legend>Densidade</legend>
          <div class="pers-opcoes" role="radiogroup" aria-label="Densidade">
            ${[['normal', 'Normal'], ['compacto', 'Compacto']].map(([v, r]) =>
              `<button class="btn ${ThemeState.density === v ? 'ativa' : ''}" data-densidade="${v}" role="radio" aria-checked="${ThemeState.density === v}">${r}</button>`).join('')}
          </div>
          <small style="color:var(--texto-fraco)">Compacto deixa os botões menores — útil em telas pequenas.</small>
        </fieldset>

        <fieldset class="pers-campo pers-largo">
          <legend>Cores de destaque</legend>
          <div class="pers-cores">
            ${CORES.map(([chave, rotulo, padrao]) => `<label class="pers-cor">
              <input type="color" data-cor="${chave}" value="${ThemeState.cores?.[chave] ?? padrao}"
                aria-label="Cor: ${rotulo}" />
              <span>${rotulo}</span>
              <button type="button" class="btn ghost" data-cor-reset="${chave}"
                title="Voltar ao padrão">${ic('reciclar')}<span class="sr-only"> restaurar ${rotulo}</span></button>
            </label>`).join('')}
          </div>
          <small style="color:var(--texto-fraco)">Personalizar cores não se aplica ao tema de alto contraste.</small>
        </fieldset>
      </div>`)}

    ${grupo(`${ic('documento')} Leitura e acessibilidade`, 'Conforto visual e navegação por teclado.',
      `<div class="pers-grade">
        <fieldset class="pers-campo">
          <legend>Tamanho da fonte</legend>
          <div class="pers-opcoes">
            <button class="btn" id="pers-fonte-menos" aria-label="Diminuir a fonte">A−</button>
            <output id="pers-fonte-valor" class="pers-valor" aria-live="polite">${ROTULO_FONTE[A11yState.tamanhoFonte]}</output>
            <button class="btn" id="pers-fonte-mais" aria-label="Aumentar a fonte">A+</button>
          </div>
        </fieldset>

        <fieldset class="pers-campo">
          <legend>Conforto</legend>
          ${[
            ['pers-alto-contraste', A11yState.altoContraste, 'Alto contraste (WCAG AAA)'],
            ['pers-reduzir-motion', A11yState.reduzirMotion, 'Reduzir animações'],
            ['pers-uma-mao', A11yState.modoUmaMao, 'Modo uma mão (celular)'],
          ].map(([id, marcado, rotulo]) => `<label class="pers-check">
            <input type="checkbox" id="${id}" ${marcado ? 'checked' : ''} />
            <span>${rotulo}</span></label>`).join('')}
        </fieldset>
      </div>`)}

    ${grupo(`${ic('engrenagem')} Navegação`, 'Onde fica o menu principal do sistema.',
      `<div class="pers-grade">
        <fieldset class="pers-campo">
          <legend>Posição do menu</legend>
          <div class="pers-opcoes" role="radiogroup" aria-label="Posição do menu">
            ${[['lateral', 'Lateral'], ['superior', 'Superior']].map(([v, r]) =>
              `<button class="btn ${lerNavPrefs().posicao === v ? 'ativa' : ''}" data-nav-pos="${v}" role="radio" aria-checked="${lerNavPrefs().posicao === v}">${r}</button>`).join('')}
          </div>
          <small style="color:var(--texto-fraco)">No celular o menu vai para a base da tela automaticamente.</small>
        </fieldset>
        <fieldset class="pers-campo">
          <legend>Economizar espaço</legend>
          ${[['nav-compacta', lerNavPrefs().compacta, 'Ícones sem rótulos'],
             ['nav-auto', lerNavPrefs().autoOcultar, 'Menu lateral recolhido (desktop)']].map(([id, marcado, rotulo]) =>
            `<label class="pers-check"><input type="checkbox" id="${id}" ${marcado ? 'checked' : ''} /><span>${rotulo}</span></label>`).join('')}
        </fieldset>
      </div>`)}

    ${podeConfigSistema ? grupo(`${ic('casa')} Padrões do estabelecimento`,
      'Define o que novos usuários recebem neste aparelho.',
      `<div class="pers-grade">
        <fieldset class="pers-campo">
          <legend>Aplicar a todos</legend>
          ${[['pers-tema-global', ThemeState.usandoGlobal === true, 'Usar o tema definido pelo estabelecimento']].map(([id, marcado, rotulo]) =>
            `<label class="pers-check"><input type="checkbox" id="${id}" ${marcado ? 'checked' : ''} /><span>${rotulo}</span></label>`).join('')}
          <small style="color:var(--texto-fraco)">Só administradores alteram os padrões. Cada operador ainda pode ajustar no próprio aparelho.</small>
        </fieldset>
      </div>`) : ''}

    <p class="pers-nota" role="status" aria-live="polite" id="pers-status"></p>`;

  ligarEventos(container, { podeConfigSistema });
}

function lerNavPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(CHAVE_NAV) ?? '{}');
    return {
      posicao: ['lateral', 'superior'].includes(p.posicao) ? p.posicao : 'lateral',
      compacta: p.compacta === true,
      autoOcultar: p.autoOcultar === true,
    };
  } catch { return { posicao: 'lateral', compacta: false, autoOcultar: false }; }
}

function salvarNavPrefs(mudanca) {
  try {
    localStorage.setItem(CHAVE_NAV, JSON.stringify({ ...lerNavPrefs(), ...mudanca }));
  } catch { /* sem storage */ }
}

function status(container, msg) {
  const el = container.querySelector('#pers-status');
  if (el) el.textContent = msg;
  anunciar(msg);
}

function ligarEventos(container, { podeConfigSistema }) {
  const rolarParaAoSalvar = (msg) => status(container, msg);

  // ---- Tema ----
  container.querySelectorAll('[data-tema]').forEach((b) => {
    b.onclick = () => {
      setTema(b.dataset.tema);
      marcar(container, '[data-tema]', b.dataset.tema);
      rolarParaAoSalvar(`Tema ${b.dataset.tema} aplicado.`);
    };
  });

  // ---- Densidade ----
  container.querySelectorAll('[data-densidade]').forEach((b) => {
    b.onclick = () => {
      setDensity(b.dataset.densidade);
      marcar(container, '[data-densidade]', b.dataset.densidade);
      rolarParaAoSalvar(`Densidade ${b.dataset.densidade} aplicada.`);
    };
  });

  // ---- Cores ----
  container.querySelectorAll('[data-cor]').forEach((inp) => {
    inp.oninput = () => setCorPersonalizada(inp.dataset.cor, inp.value);
    inp.onchange = () => rolarParaAoSalvar('Cor atualizada.');
  });
  container.querySelectorAll('[data-cor-reset]').forEach((b) => {
    b.onclick = () => {
      resetarCorPersonalizada(b.dataset.corReset);
      const inp = container.querySelector(`[data-cor="${b.dataset.corReset}"]`);
      if (inp) inp.value = ThemeState.cores?.[b.dataset.corReset] ?? '#000000';
      rolarParaAoSalvar('Cor restaurada.');
    };
  });

  // ---- Fonte ----
  const rotular = () => {
    const el = container.querySelector('#pers-fonte-valor');
    if (el) el.textContent = ROTULO_FONTE[A11yState.tamanhoFonte];
  };
  container.querySelector('#pers-fonte-menos').onclick = () => { definirTamanhoFonte(-1); rotular(); rolarParaAoSalvar(`Fonte: ${ROTULO_FONTE[A11yState.tamanhoFonte]}.`); };
  container.querySelector('#pers-fonte-mais').onclick = () => { definirTamanhoFonte(1); rotular(); rolarParaAoSalvar(`Fonte: ${ROTULO_FONTE[A11yState.tamanhoFonte]}.`); };

  // ---- Conforto ----
  const alternar = (id, fn, rotulo) => {
    const el = container.querySelector(`#${id}`);
    if (!el) return;
    el.onchange = () => { fn(); status(container, `${rotulo} ${el.checked ? 'ativado' : 'desativado'}.`); };
  };
  alternar('pers-alto-contraste', toggleAltoContraste, 'Alto contraste');
  alternar('pers-reduzir-motion', toggleReduzirMotion, 'Reduzir animações');
  alternar('pers-uma-mao', toggleModoUmaMao, 'Modo uma mão');

  // ---- Navegação ----
  container.querySelectorAll('[data-nav-pos]').forEach((b) => {
    b.onclick = () => {
      salvarNavPrefs({ posicao: b.dataset.navPos });
      marcar(container, '[data-nav-pos]', b.dataset.navPos);
      rolarParaAoSalvar('Posição do menu salva. Reabra a tela para aplicar.');
    };
  });
  const navCompacta = container.querySelector('#nav-compacta');
  if (navCompacta) navCompacta.onchange = () => {
    salvarNavPrefs({ compacta: navCompacta.checked });
    status(container, 'Menu compacto salvo.');
  };
  const navAuto = container.querySelector('#nav-auto');
  if (navAuto) navAuto.onchange = () => {
    salvarNavPrefs({ autoOcultar: navAuto.checked });
    status(container, 'Menu recolhível salvo.');
  };

  // ---- Padrões do estabelecimento ----
  const tg = container.querySelector('#pers-tema-global');
  if (tg) tg.onchange = () => { usarTemaGlobal(); status(container, 'Padrão do estabelecimento aplicado.'); };

  // ---- Restaurar padrões ----
  const resetar = container.querySelector('#pers-resetar');
  if (resetar) resetar.onclick = async () => {
    const ok = await confirmar(
      'Restaurar padrões?',
      'Fonte, contraste, cores, densidade e navegação voltam ao estado inicial <strong>deste aparelho</strong>. '
      + 'Os padrões do estabelecimento não são alterados.',
    );
    if (!ok) return;
    try {
      localStorage.removeItem(CHAVE_A11Y);
      localStorage.removeItem(CHAVE_TEMA);
      localStorage.removeItem(CHAVE_NAV);
    } catch { /* sem storage */ }
    toast('Preferências restauradas. Recarregando…', 'ok');
    setTimeout(() => location.reload(), 600);
  };
  void modal;
}

function marcar(container, seletor, valor) {
  container.querySelectorAll(seletor).forEach((b) => {
    const ativo = b.getAttribute(seletor.replace('[', '').replace(']', '')) === valor;
    b.classList.toggle('ativa', ativo);
    b.setAttribute('aria-checked', String(ativo));
  });
}

export default renderPersonalizacao;