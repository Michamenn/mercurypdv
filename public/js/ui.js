// Componentes de UI: toasts, modais, confirmação, numpad
import { fmt, reaisParaCentavos } from './api.js';

export function toast(mensagem, tipo = 'info', ms = 3500) {
  const raiz = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${tipo === 'ok' ? 'ok' : tipo === 'erro' ? 'erro' : ''}`;
  el.textContent = mensagem;
  raiz.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export function modal(conteudo, { aoFechar } = {}) {
  const raiz = document.getElementById('modal-root');
  const fundo = document.createElement('div');
  fundo.className = 'modal-fundo';
  const caixa = document.createElement('div');
  caixa.className = 'modal';
  caixa.setAttribute('role', 'dialog');
  caixa.setAttribute('aria-modal', 'true');
  const titulo = conteudo.match(/<h2>(.*?)<\/h2>/);
  if (titulo) caixa.setAttribute('aria-label', titulo[1].replace(/<[^>]*>/g, ''));
  caixa.innerHTML = conteudo;
  fundo.appendChild(caixa);
  fundo.addEventListener('click', (e) => { if (e.target === fundo) fechar(); });
  const focoAnterior = document.activeElement;
  function fechar() {
    fundo.remove();
    document.removeEventListener('keydown', trap, true);
    if (focoAnterior?.focus) focoAnterior.focus();
    aoFechar?.();
  }
  // Focus trap: Tab circula dentro do modal (a11y item 1)
  function trap(e) {
    if (e.key !== 'Tab') return;
    const focos = [...caixa.querySelectorAll('button:not(:disabled), input:not(:disabled), select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => el.offsetParent !== null);
    if (!focos.length) return;
    const primeiro = focos[0], ultimo = focos[focos.length - 1];
    if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
  }
  document.addEventListener('keydown', trap, true);
  raiz.appendChild(fundo);
  // Foco inicial: primeiro campo ou botão primário
  const inicial = caixa.querySelector('input:not([type="hidden"]), [data-a="ok"], [data-a="sim"], .btn.primario, button');
  if (inicial) setTimeout(() => inicial.focus(), 30);
  return { caixa, fechar };
}

// Confirmação para ações destrutivas (fase 11)
export function confirmar(titulo, texto, { perigo = false } = {}) {
  return new Promise((resolve) => {
    const m = modal(`
      <h2>${titulo}</h2>
      <p>${texto}</p>
      <div class="modal-acoes">
        <button class="btn ghost" data-a="nao">Cancelar</button>
        <button class="btn ${perigo ? 'perigo' : 'primario'}" data-a="sim">Confirmar</button>
      </div>`);
    m.caixa.querySelector('[data-a="nao"]').onclick = () => { m.fechar(); resolve(false); };
    m.caixa.querySelector('[data-a="sim"]').onclick = () => { m.fechar(); resolve(true); };
  });
}

// Numpad tátil: PIN, quantidades e valores monetários.
// acaoExtra (opcional): { rotulo, aoClicar } — botão "atalho" que confirma direto (ex.: troco exato).
// aoCancelar (opcional): chamado quando o numpad é fechado SEM confirmar (clique fora).
export function numpadConteudo({ monetario = false, aoDigitar, aoConfirmar, aoCancelar, rotulo = 'Confirmar', acaoExtra = null }) {
  const html = `
    <div class="display-valor" data-papel="display" aria-live="polite">R$ 0,00</div>
    <div class="numpad">
      ${[1,2,3,4,5,6,7,8,9].map(n => `<button class="btn" data-n="${n}" aria-label="${n}">${n}</button>`).join('')}
      <button class="btn" data-n="C" aria-label="Limpar">C</button>
      <button class="btn" data-n="0" aria-label="0">0</button>
      <button class="btn" data-n="<" aria-label="Apagar último dígito">⌫</button>
      ${monetario ? `
      <button class="btn" data-n="," aria-label="Vírgula decimal">,</button>
      <button class="btn" data-n="00" aria-label="Dois zeros">00</button>
      <button class="btn" data-n="000" aria-label="Três zeros">000</button>` : ''}
    </div>`;
  let buffer = '';
  let confirmado = false;
  function refletir() {
    const el = caixa.querySelector('[data-papel="display"]');
    if (monetario) {
      const cv = reaisParaCentavos(buffer === '' || buffer === ',' ? '0' : buffer);
      el.textContent = cv === null ? 'Valor inválido' : fmt(cv);
    } else {
      el.textContent = buffer;
    }
    aoDigitar?.(buffer);
  }
  const m = modal(`
    ${html}
    ${acaoExtra ? `<button class="btn grande btn-full" data-papel="extra">${acaoExtra.rotulo}</button>` : ''}
    <button class="btn primario grande btn-full" data-papel="ok" disabled>${rotulo}</button>
  `, { aoFechar: () => { if (!confirmado) aoCancelar?.(); } });
  const caixa = m.caixa;
  caixa.querySelectorAll('[data-n]').forEach((b) => {
    b.onclick = () => {
      const n = b.dataset.n;
      if (n === 'C') buffer = '';
      else if (n === '<') buffer = buffer.slice(0, -1);
      else if (n === ',' && monetario && !buffer.includes(',') && !buffer.includes('.') && buffer !== '') buffer += ',';
      else if ((n === '00' || n === '000') && monetario) {
        const semSep = !buffer.includes(',') && !buffer.includes('.');
        if (semSep && (buffer + n).length <= 10) buffer += n;
      }
      else if (n !== ',' && n !== '00' && n !== '000' && buffer.length < 10) buffer += n;
      refletir();
      const valido = monetario
        ? (reaisParaCentavos(buffer === '' || buffer === ',' ? '0' : buffer) ?? 0) > 0
        : buffer.length > 0;
      caixa.querySelector('[data-papel="ok"]').disabled = !valido;
    };
  });
  caixa.querySelector('[data-papel="ok"]').onclick = () => { confirmado = true; m.fechar(); aoConfirmar?.(buffer); };
  const btnExtra = caixa.querySelector('[data-papel="extra"]');
  if (btnExtra && acaoExtra) btnExtra.onclick = () => { confirmado = true; m.fechar(); acaoExtra.aoClicar?.(); };
  return { m, get valor() { return buffer; } };
}

// Modal com senha de admin (step-up) para operações sensíveis
export function pedirAutorizacaoAdmin({ titulo = 'Autorização administrativa' } = {}) {
  return new Promise((resolve) => {
    const m = modal(`
      <h2>${titulo}</h2>
      <p>Informe usuário e senha de um administrador para autorizar esta operação.</p>
      <input class="campo" data-papel="usuario" placeholder="Usuário admin" autocomplete="off" />
      <input class="campo" data-papel="senha" type="password" placeholder="Senha" autocomplete="off" />
      <div class="modal-acoes">
        <button class="btn ghost" data-a="cancelar">Cancelar</button>
        <button class="btn primario" data-a="ok">Autorizar</button>
      </div>`);
    m.caixa.querySelector('[data-a="cancelar"]').onclick = () => { m.fechar(); resolve(null); };
    m.caixa.querySelector('[data-a="ok"]').onclick = () => {
      const usuario = m.caixa.querySelector('[data-papel="usuario"]').value.trim();
      const senha = m.caixa.querySelector('[data-papel="senha"]').value;
      if (!usuario || !senha) return;
      m.fechar();
      resolve({ admin_usuario: usuario, admin_senha: senha });
    };
  });
}

export function escapar(s) {
  // Entidades NUMÉRICAS construídas em código (imunes a dupla interpretação).
  return String(s ?? '').replace(/[&<>"']/g, (c) => '&#' + ({ '&': 38, '<': 60, '>': 62, '"': 34, "'": 39 }[c]) + ';');
}
