// Acessibilidade (WCAG 2.1 AA) — Módulo central
// Teclado, ARIA, Alto Contraste, Fonte Escalável, Redução Motion, Live Regions, Modo 1 Mão

import { get, post } from './api.js';
import { toast } from './ui.js';

const STORAGE_KEY = 'lp-a11y-prefs';

export const A11yState = {
  altoContraste: false,
  tamanhoFonte: 1, // 0=pequeno, 1=médio, 2=grande, 3=extra-grande
  reduzirMotion: false,
  modoUmaMao: false,
};

// Tamanhos de fonte base (rem)
const FONT_SIZES = [
  '0.875rem', // 14px - Pequeno
  '1rem',     // 16px - Médio (padrão)
  '1.25rem',  // 20px - Grande
  '1.5rem',   // 24px - Extra Grande
];

// Carrega preferências do localStorage
export function carregarPreferencias() {
  try {
    const salvo = localStorage.getItem(STORAGE_KEY);
    if (salvo) {
      const prefs = JSON.parse(salvo);
      A11yState.altoContraste = prefs.altoContraste ?? false;
      A11yState.tamanhoFonte = prefs.tamanhoFonte ?? 1;
      A11yState.reduzirMotion = prefs.reduzirMotion ?? false;
      A11yState.modoUmaMao = prefs.modoUmaMao ?? false;
    }
  } catch { /* ignora erro */ }
  aplicarTodas();
}

// Salva preferências no localStorage
function salvarPreferencias() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(A11yState));
  } catch { /* ignora erro */ }
}

// Aplica todas as configurações ativas
function aplicarTodas() {
  aplicarAltoContraste();
  aplicarTamanhoFonte();
  aplicarReduzirMotion();
  aplicarModoUmaMao();
  atualizarBotoesUI();
}

// ===== ALTO CONTRASTE =====
function aplicarAltoContraste() {
  const html = document.documentElement;
  if (A11yState.altoContraste) {
    html.classList.add('alto-contraste');
    // Cores WCAG AAA: branco puro #FFF sobre preto puro #000
    html.style.setProperty('--canvas', '#000000');
    html.style.setProperty('--superficie', '#000000');
    html.style.setProperty('--painel', '#111111');
    html.style.setProperty('--borda', '#FFFFFF');
    html.style.setProperty('--texto', '#FFFFFF');
    html.style.setProperty('--texto-fraco', '#CCCCCC');
    html.style.setProperty('--acao', '#FFFF00');
    html.style.setProperty('--acao-escuro', '#CCCC00');
    html.style.setProperty('--ok', '#00FF00');
    html.style.setProperty('--alerta', '#FF0000');
    html.style.setProperty('--amarelo', '#FFFF00');
  } else {
    html.classList.remove('alto-contraste');
    // Restaura variáveis originais (definidas no CSS)
    html.style.removeProperty('--canvas');
    html.style.removeProperty('--superficie');
    html.style.removeProperty('--painel');
    html.style.removeProperty('--borda');
    html.style.removeProperty('--texto');
    html.style.removeProperty('--texto-fraco');
    html.style.removeProperty('--acao');
    html.style.removeProperty('--acao-escuro');
    html.style.removeProperty('--ok');
    html.style.removeProperty('--alerta');
    html.style.removeProperty('--amarelo');
  }
}

export function toggleAltoContraste() {
  A11yState.altoContraste = !A11yState.altoContraste;
  salvarPreferencias();
  aplicarAltoContraste();
  anunciar(`Alto contraste ${A11yState.altoContraste ? 'ativado' : 'desativado'}`);
}

// ===== TAMANHO DA FONTE =====
function aplicarTamanhoFonte() {
  const html = document.documentElement;
  html.style.fontSize = FONT_SIZES[A11yState.tamanhoFonte];
  html.dataset.fontSize = A11yState.tamanhoFonte;
}

export function alterarTamanhoFonte(delta) {
  return definirTamanhoFonte(A11yState.tamanhoFonte + delta);
}

// Define tamanho absoluto (0-3); usado pelos padrões do servidor no 1º acesso.
export function definirTamanhoFonte(n) {
  const novo = Math.max(0, Math.min(3, Number(n) || 0));
  if (novo !== A11yState.tamanhoFonte) {
    A11yState.tamanhoFonte = novo;
    aplicarTamanhoFonte();
    salvarPreferencias();
    anunciar(`Tamanho da fonte: ${['pequeno', 'médio', 'grande', 'extra grande'][novo]}`);
  }
  return novo;
}

// ===== REDUZIR MOTION =====
function aplicarReduzirMotion() {
  const html = document.documentElement;
  if (A11yState.reduzirMotion) {
    html.classList.add('reduzir-motion');
  } else {
    html.classList.remove('reduzir-motion');
  }
}

export function toggleReduzirMotion() {
  A11yState.reduzirMotion = !A11yState.reduzirMotion;
  salvarPreferencias();
  aplicarReduzirMotion();
  anunciar(`Redução de movimento ${A11yState.reduzirMotion ? 'ativada' : 'desativada'}`);
}

// ===== MODO UMA MÃO (MOBILE) =====
function aplicarModoUmaMao() {
  const html = document.documentElement;
  if (A11yState.modoUmaMao) {
    html.classList.add('modo-uma-mao');
  } else {
    html.classList.remove('modo-uma-mao');
  }
}

export function toggleModoUmaMao() {
  A11yState.modoUmaMao = !A11yState.modoUmaMao;
  salvarPreferencias();
  aplicarModoUmaMao();
  anunciar(`Modo uma mão ${A11yState.modoUmaMao ? 'ativado' : 'desativado'}`);
}

// ===== LIVE REGIONS (ANÚNCIOS PARA LEITORES DE TELA) =====
let liveRegionPolite = null;
let liveRegionAssertive = null;

function garantirLiveRegions() {
  if (!liveRegionPolite) {
    liveRegionPolite = document.createElement('div');
    liveRegionPolite.id = 'a11y-live-polite';
    liveRegionPolite.setAttribute('role', 'status');
    liveRegionPolite.setAttribute('aria-live', 'polite');
    liveRegionPolite.setAttribute('aria-atomic', 'true');
    liveRegionPolite.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;';
    document.body.appendChild(liveRegionPolite);
  }
  if (!liveRegionAssertive) {
    liveRegionAssertive = document.createElement('div');
    liveRegionAssertive.id = 'a11y-live-assertive';
    liveRegionAssertive.setAttribute('role', 'alert');
    liveRegionAssertive.setAttribute('aria-live', 'assertive');
    liveRegionAssertive.setAttribute('aria-atomic', 'true');
    liveRegionAssertive.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;';
    document.body.appendChild(liveRegionAssertive);
  }
}

export function anunciar(mensagem, assertive = false) {
  garantirLiveRegions();
  const region = assertive ? liveRegionAssertive : liveRegionPolite;
  region.textContent = '';
  // Força re-leitura pelo screen reader
  requestAnimationFrame(() => {
    region.textContent = mensagem;
  });
}

// ===== NAVEGAÇÃO POR TECLADO =====
// Mapeia atalhos globais: Alt+1..Alt+A
const ATALHOS_GLOBAIS = {
  '1': () => navegarModulo('pdv'),
  '2': () => navegarModulo('mesas'),
  '3': () => navegarModulo('kds'),
  '4': () => navegarModulo('caixa'),
  'a': () => navegarModulo('admin'),
  'A': () => navegarModulo('admin'),
};

function navegarModulo(id) {
  const btn = document.querySelector(`[data-rota="${id}"]`);
  if (btn && !btn.disabled) {
    btn.click();
    anunciar(`Navegou para ${btn.textContent.trim()}`);
  }
}

export function initKeyboardNavigation() {
  document.addEventListener('keydown', (e) => {
    // Atalhos globais Alt+1..Alt+4, Alt+A
    if (e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
      const handler = ATALHOS_GLOBAIS[e.key];
      if (handler) {
        e.preventDefault();
        handler();
        return;
      }
    }

    // Escape fecha modais (o do topo primeiro)
    if (e.key === 'Escape') {
      const modais = document.querySelectorAll('.modal-fundo');
      const modal = modais[modais.length - 1];
      if (modal) {
        const btnFechar = modal.querySelector('[data-a="cancelar"], [data-a="nao"], .btn.ghost');
        if (btnFechar) {
          e.preventDefault();
          btnFechar.click();
        }
      }
    }

    // Enter/Space em elementos com role=button
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"]:not(button)')) {
      e.preventDefault();
      e.target.click();
    }

    // Setas em grids (produtos, mesas, KDS)
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      const grid = e.target.closest('.grid-produtos, .grid-mesas, .kanban');
      if (grid) {
        navegarGrid(grid, e.key, e.target);
        e.preventDefault();
      }
    }
  });
}

function navegarGrid(grid, direcao, origem) {
  const botoes = Array.from(grid.querySelectorAll('button:not(:disabled), [role="button"]:not([aria-disabled="true"])'));
  const idx = botoes.indexOf(origem?.closest('button, [role="button"]'));
  if (idx === -1) return;

  let novoIdx = idx;
  const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length || 3;

  switch (direcao) {
    case 'ArrowRight': novoIdx = Math.min(idx + 1, botoes.length - 1); break;
    case 'ArrowLeft': novoIdx = Math.max(idx - 1, 0); break;
    case 'ArrowDown': novoIdx = Math.min(idx + cols, botoes.length - 1); break;
    case 'ArrowUp': novoIdx = Math.max(idx - cols, 0); break;
  }

  if (novoIdx !== idx) {
    botoes[novoIdx].focus();
  }
}

// ===== ARIA HELPERS =====
export function setAriaPressed(elemento, pressed) {
  elemento.setAttribute('aria-pressed', pressed);
}

export function setAriaExpanded(elemento, expanded) {
  elemento.setAttribute('aria-expanded', expanded);
}

export function setAriaSelected(elemento, selected) {
  elemento.setAttribute('aria-selected', selected);
}

export function setAriaLabel(elemento, label) {
  elemento.setAttribute('aria-label', label);
}

export function setAriaDescribedBy(elemento, id) {
  elemento.setAttribute('aria-describedby', id);
}

// Cria elemento com ARIA para live region inline
export function criarLiveRegion(mensagem, assertive = false) {
  const div = document.createElement('div');
  div.setAttribute('role', assertive ? 'alert' : 'status');
  div.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
  div.setAttribute('aria-atomic', 'true');
  div.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;';
  div.textContent = mensagem;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 1000);
  return div;
}

// ===== FOCO VISÍVEL =====
export function initFocusVisible() {
  // Garante outline visível em foco por teclado
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      document.body.classList.add('keyboard-nav');
    }
  });
  document.addEventListener('mousedown', () => {
    document.body.classList.remove('keyboard-nav');
  });
}

// ===== INICIALIZAÇÃO COMPLETA =====
export function initA11y() {
  carregarPreferencias();
  initKeyboardNavigation();
  initFocusVisible();

  // Detecta preferência do sistema para reduzir motion
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    A11yState.reduzirMotion = true;
    aplicarReduzirMotion();
  }

  // Detecta mudança de preferência do sistema
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
    if (!A11yState.reduzirMotion) { // Só se não for forçado pelo usuário
      A11yState.reduzirMotion = e.matches;
      aplicarReduzirMotion();
    }
  });

  // Anuncia carregamento inicial
  setTimeout(() => anunciar('Mercury PDV carregado'), 500);
}

// ===== UI DE CONFIGURAÇÕES A11Y (para menu perfil/admin) =====
export function renderA11yConfig(container) {
  container.innerHTML = `
    <div class="cartao">
      <h3>Acessibilidade</h3>
      <div style="display:flex;flex-direction:column;gap:12px">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
          <input type="checkbox" id="a11y-contraste" ${A11yState.altoContraste ? 'checked' : ''}>
          <span>Alto Contraste (WCAG AAA)</span>
        </label>
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
          <input type="checkbox" id="a11y-motion" ${A11yState.reduzirMotion ? 'checked' : ''}>
          <span>Reduzir Animações</span>
        </label>
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
          <input type="checkbox" id="a11y-uma-mao" ${A11yState.modoUmaMao ? 'checked' : ''}>
          <span>Modo Uma Mão (Mobile)</span>
        </label>
        <div>
          <label style="display:block;margin-bottom:6px">Tamanho da Fonte</label>
          <div style="display:flex;gap:8px;align-items:center">
            <button class="btn ghost" id="a11y-font-dec" aria-label="Diminuir fonte">A-</button>
            <span id="a11y-font-label" style="min-width:120px">${['Pequeno (14px)','Médio (16px)','Grande (20px)','Extra Grande (24px)'][A11yState.tamanhoFonte]}</span>
            <button class="btn ghost" id="a11y-font-inc" aria-label="Aumentar fonte">A+</button>
          </div>
        </div>
      </div>
    </div>
  `;

  container.querySelector('#a11y-contraste').addEventListener('change', (e) => {
    A11yState.altoContraste = e.target.checked;
    salvarPreferencias();
    aplicarAltoContraste();
  });
  container.querySelector('#a11y-motion').addEventListener('change', (e) => {
    A11yState.reduzirMotion = e.target.checked;
    salvarPreferencias();
    aplicarReduzirMotion();
  });
  container.querySelector('#a11y-uma-mao').addEventListener('change', (e) => {
    A11yState.modoUmaMao = e.target.checked;
    salvarPreferencias();
    aplicarModoUmaMao();
  });
  container.querySelector('#a11y-font-dec').addEventListener('click', () => alterarTamanhoFonte(-1));
  container.querySelector('#a11y-font-inc').addEventListener('click', () => alterarTamanhoFonte(1));
}

// Atualiza labels dos botões de configuração
function atualizarBotoesUI() {
  const label = document.getElementById('a11y-font-label');
  if (label) {
    label.textContent = ['Pequeno (14px)','Médio (16px)','Grande (20px)','Extra Grande (24px)'][A11yState.tamanhoFonte];
  }
  const checkboxes = {
    'a11y-contraste': A11yState.altoContraste,
    'a11y-motion': A11yState.reduzirMotion,
    'a11y-uma-mao': A11yState.modoUmaMao,
  };
  Object.entries(checkboxes).forEach(([id, checked]) => {
    const el = document.getElementById(id);
    if (el) el.checked = checked;
  });
}