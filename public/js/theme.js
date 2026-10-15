// Tema System Essencial — Claro/Escuro/Alto Contraste + Color Picker + Density
// Persistência: localStorage (user) + banco (global admin)

import { ic } from './icons.js';
import { get, post } from './api.js';
import { toast } from './ui.js';

const STORAGE_KEY = 'lp-theme-prefs';

export const ThemeState = {
  // Tema base: 'escuro' | 'claro' | 'premium' | 'alto-contraste'
  tema: 'escuro',
  
  // Cores personalizadas (override das variáveis CSS)
  cores: {
    acao: null,    // --acao
    ok: null,      // --ok
    alerta: null,  // --alerta
  },
  
  // Density: 'normal' (48px) | 'compacto' (36px)
  density: 'normal',
  
  // Se está usando configuração global do admin
  usandoGlobal: false,
};

// Variáveis CSS por tema base
const TEMAS_BASE = {
  escuro: {
    '--canvas': '#0B0F17',
    '--superficie': '#111827',
    '--painel': '#1E293B',
    '--borda': '#334155',
    '--texto': '#E5E7EB',
    '--texto-fraco': '#94A3B8',
    '--acao': '#F97316',
    '--acao-escuro': '#EA580C',
    '--ok': '#10B981',
    '--alerta': '#EF4444',
    '--amarelo': '#FACC15',
  },
  claro: {
    '--canvas': '#F8FAFC',
    '--superficie': '#FFFFFF',
    '--painel': '#F1F5F9',
    '--borda': '#CBD5E1',
    '--texto': '#0F172A',
    '--texto-fraco': '#475569',
    '--acao': '#F97316',
    '--acao-escuro': '#EA580C',
    '--ok': '#10B981',
    '--alerta': '#EF4444',
    '--amarelo': '#F59E0B',
  },
  'alto-contraste': {
    '--canvas': '#000000',
    '--superficie': '#000000',
    '--painel': '#111111',
    '--borda': '#FFFFFF',
    '--texto': '#FFFFFF',
    '--texto-fraco': '#CCCCCC',
    '--acao': '#FFFF00',
    '--acao-escuro': '#CCCC00',
    '--ok': '#00FF00',
    '--alerta': '#FF0000',
    '--amarelo': '#FFFF00',
  },
  premium: {
    '--canvas': '#F5F4F1',
    '--superficie': '#FFFFFF',
    '--painel': '#FFFFFF',
    '--borda': '#E8E3DA',
    '--texto': '#1C1917',
    '--texto-fraco': '#78716C',
    '--acao': '#9A3412',
    '--acao-escuro': '#7C2D12',
    '--ok': '#047857',
    '--alerta': '#B91C1C',
    '--amarelo': '#B45309',
  },
};

// Tamanhos por density
const DENSITY_SIZES = {
  normal: {
    '--touch-min': '48px',
    '--btn-padding-y': '10px',
    '--btn-padding-x': '18px',
    '--btn-font': '1rem',
    '--btn-grande': '64px',
    '--numpad-btn': '60px',
    '--numpad-font': '1.2rem',
    '--input-padding': '12px',
    '--card-padding': '14px',
    '--gap': '10px',
  },
  compacto: {
    '--touch-min': '36px',
    '--btn-padding-y': '6px',
    '--btn-padding-x': '12px',
    '--btn-font': '0.9rem',
    '--btn-grande': '48px',
    '--numpad-btn': '48px',
    '--numpad-font': '1rem',
    '--input-padding': '8px',
    '--card-padding': '10px',
    '--gap': '6px',
  },
};

// Carrega preferências do localStorage
export function carregarPreferenciasTema() {
  try {
    const salvo = localStorage.getItem(STORAGE_KEY);
    if (salvo) {
      const prefs = JSON.parse(salvo);
      ThemeState.tema = prefs.tema ?? 'escuro';
      ThemeState.cores = prefs.cores ?? { acao: null, ok: null, alerta: null };
      ThemeState.density = prefs.density ?? 'normal';
      ThemeState.usandoGlobal = prefs.usandoGlobal ?? false;
    }
  } catch { /* ignora erro */ }
  aplicarTema();
}

// Salva preferências no localStorage
function salvarPreferenciasTema() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      tema: ThemeState.tema,
      cores: ThemeState.cores,
      density: ThemeState.density,
      usandoGlobal: ThemeState.usandoGlobal,
    }));
  } catch { /* ignora erro */ }
}

// Aplica tema atual
export function aplicarTema() {
  const html = document.documentElement;
  
  // 1. Aplica tema base
  const base = TEMAS_BASE[ThemeState.tema] || TEMAS_BASE.escuro;
  Object.entries(base).forEach(([varName, value]) => {
    html.style.setProperty(varName, value);
  });
  
  // 2. Aplica cores personalizadas (override)
  Object.entries(ThemeState.cores).forEach(([key, value]) => {
    if (value) {
      html.style.setProperty(`--${key}`, value);
    } else {
      // Remove override, volta pro tema base
      html.style.removeProperty(`--${key}`);
    }
  });
  
  // 3. Aplica density
  const density = DENSITY_SIZES[ThemeState.density] || DENSITY_SIZES.normal;
  Object.entries(density).forEach(([varName, value]) => {
    html.style.setProperty(varName, value);
  });
  
  // 4. Classes CSS para alto contraste (compatibilidade a11y)
  html.classList.remove('tema-escuro', 'tema-claro', 'tema-alto-contraste', 'tema-premium');
  html.classList.add(`tema-${ThemeState.tema.replace('alto-contraste', 'alto-contraste')}`);
  
  // 5. Atualiza controles de tema abertos (se a tela de config estiver visível)
  try {
    const desc = document.querySelector('#tema-desc');
    if (desc) {
      const nomes = { escuro: 'Padrão noturno', claro: 'Para ambientes claros', 'alto-contraste': 'WCAG AAA (preto/branco/amarelo)' };
      desc.textContent = nomes[ThemeState.tema] ?? '';
    }
    document.querySelectorAll('[data-tema]').forEach((b) => {
      const ativo = b.dataset.tema === ThemeState.tema;
      b.classList.toggle('ativa', ativo);
      b.setAttribute('aria-checked', String(ativo));
    });
  } catch { /* tela de config fechada */ }
}

// ===== SETTERS =====

export function setTema(novoTema) {
  if (TEMAS_BASE[novoTema]) {
    ThemeState.tema = novoTema;
    // Alto contraste não permite cores personalizadas
    if (novoTema === 'alto-contraste') {
      ThemeState.cores = { acao: null, ok: null, alerta: null };
    }
    salvarPreferenciasTema();
    aplicarTema();
  }
}

export function setCorPersonalizada(chave, valor) {
  if (ThemeState.tema === 'alto-contraste') return; // Não permite no alto contraste
  if (['acao', 'ok', 'alerta'].includes(chave)) {
    ThemeState.cores[chave] = valor;
    salvarPreferenciasTema();
    aplicarTema();
  }
}

export function resetarCorPersonalizada(chave) {
  if (['acao', 'ok', 'alerta'].includes(chave)) {
    ThemeState.cores[chave] = null;
    salvarPreferenciasTema();
    aplicarTema();
  }
}

export function setDensity(novaDensity) {
  if (DENSITY_SIZES[novaDensity]) {
    ThemeState.density = novaDensity;
    salvarPreferenciasTema();
    aplicarTema();
  }
}

// ===== PERSISTÊNCIA GLOBAL (ADMIN) =====

// Carrega configuração global do servidor (chaves granulares).
// Só sobrescreve o tema local se o admin tiver SALVO um global
// (marcador tema_global_definido=1). Sem isso, a preferência do operador prevalece.
export async function carregarTemaGlobal() {
  try {
    const config = await get('/config');
    if (config.tema_global_definido !== '1') return false;
    if (config.tema_padrao && TEMAS_BASE[config.tema_padrao]) {
      ThemeState.tema = config.tema_padrao;
    }
    for (const k of ['acao', 'ok', 'alerta']) {
      const v = config[`cor_${k}`];
      if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) ThemeState.cores[k] = v;
    }
    if (config.densidade_padrao && DENSITY_SIZES[config.densidade_padrao]) {
      ThemeState.density = config.densidade_padrao;
    }
    ThemeState.usandoGlobal = true;
    salvarPreferenciasTema();
    aplicarTema();
  } catch { /* servidor pode não ter config ainda */ }
}

// Aplica os padrões do servidor quando o operador NÃO tem preferência local
// (primeiro acesso no dispositivo). cfg = config_publica do /auth/me.
export function aplicarPadroesServidor(cfg = {}) {
  let salvas = null;
  try { salvas = localStorage.getItem(STORAGE_KEY); } catch { /* sem storage */ }
  if (salvas) return false; // preferência local do operador prevalece
  const mapaTema = { escuro: 'escuro', claro: 'claro', contraste: 'alto-contraste', premium: 'premium' };
  if (mapaTema[cfg.tema_padrao]) ThemeState.tema = mapaTema[cfg.tema_padrao];
  for (const k of ['acao', 'ok', 'alerta']) {
    const v = cfg[`cor_${k}`];
    if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) ThemeState.cores[k] = v;
  }
  if (cfg.densidade_padrao === 'compacto' || cfg.densidade_padrao === 'normal') ThemeState.density = cfg.densidade_padrao;
  aplicarTema();
  return true;
}

// Salva configuração global (apenas admin) — chaves granulares do servidor
// (tema_padrao, densidade_padrao, cor_acao/cor_ok/cor_alerta), com valores
// efetivos atuais para que o estabelecimento herde exatamente o que o admin vê.
export async function salvarTemaGlobal() {
  try {
    const base = TEMAS_BASE[ThemeState.tema] ?? TEMAS_BASE.escuro;
    const efetiva = (k) => ThemeState.cores[k] ?? base[`--${k}`];
    await post('/config', {
      tema_padrao: ThemeState.tema === 'alto-contraste' ? 'contraste' : ThemeState.tema,
      densidade_padrao: ThemeState.density,
      cor_acao: efetiva('acao'),
      cor_ok: efetiva('ok'),
      cor_alerta: efetiva('alerta'),
      tema_global_definido: '1',
    });
    ThemeState.usandoGlobal = true;
    salvarPreferenciasTema();
    toast('Tema global salvo como padrão do estabelecimento', 'ok');
  } catch (e) {
    toast('Erro ao salvar tema global: ' + e.message, 'erro');
  }
}

// Usa configuração global como base
export function usarTemaGlobal() {
  carregarTemaGlobal();
}

// Reseta para preferências do usuário (ignora global)
export function usarTemaUsuario() {
  ThemeState.usandoGlobal = false;
  carregarPreferenciasTema();
}

// ===== UI DE CONFIGURAÇÃO (Admin/Perfil) =====

export function renderThemeConfig(container, isAdmin = false) {
  const temas = [
    { id: 'escuro', label: ic('lua') + ' Escuro', desc: 'Padrão noturno' },
    { id: 'claro', label: ic('sol') + ' Claro', desc: 'Para ambientes claros' },
    { id: 'premium', label: ic('estrela') + ' Premium', desc: 'Minimalista e sofisticado' },
    { id: 'alto-contraste', label: '● Alto Contraste', desc: 'WCAG AAA (preto/branco/amarelo)' },
  ];
  
  const coresEditaveis = [
    { key: 'acao', label: 'Cor Principal (Ação)', var: '--acao' },
    { key: 'ok', label: 'Cor Sucesso (OK)', var: '--ok' },
    { key: 'alerta', label: 'Cor Alerta/Erro', var: '--alerta' },
  ];
  
  const densities = [
    { id: 'normal', label: 'Normal (48px)', desc: 'Alvo toque padrão' },
    { id: 'compacto', label: 'Compacto (36px)', desc: 'Mais densidade, telas pequenas' },
  ];
  
  const corAtual = (key) => ThemeState.cores[key] || getComputedStyle(document.documentElement).getPropertyValue(`--${key}`).trim() || TEMAS_BASE[ThemeState.tema][`--${key}`];
  
  container.innerHTML = `
    <div class="cartao">
      <h3> Tema do Sistema</h3>
      
      <!-- Seleção de Tema Base -->
      <div style="margin-bottom:20px">
        <label style="display:block;margin-bottom:8px;font-weight:600">Tema Base</label>
        <div class="abas" role="radiogroup" aria-label="Tema base">
          ${temas.map(t => `
            <button class="btn ${ThemeState.tema === t.id ? 'ativa' : ''}" 
                    role="radio" aria-checked="${ThemeState.tema === t.id}"
                    data-tema="${t.id}" data-desc="${t.desc}">
              ${t.label}
            </button>
          `).join('')}
        </div>
        <small style="color:var(--texto-fraco)" id="tema-desc">${temas.find(t => t.id === ThemeState.tema)?.desc}</small>
      </div>
      
      <!-- Color Pickers -->
      <div style="margin-bottom:20px">
        <label style="display:block;margin-bottom:8px;font-weight:600">
          Cores da Marca ${ThemeState.tema === 'alto-contraste' ? '<span style="color:var(--alerta)"> (Indisponível no Alto Contraste)</span>' : ''}
        </label>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">
          ${coresEditaveis.map(c => `
            <div class="cartao" style="padding:12px">
              <label style="display:block;margin-bottom:6px;font-size:.9rem">${c.label}</label>
              <div style="display:flex;gap:8px;align-items:center">
                <input type="color" id="color-${c.key}" value="${corAtual(c.key)}" 
                       ${ThemeState.tema === 'alto-contraste' ? 'disabled' : ''}
                       style="width:48px;height:36px;border:none;border-radius:8px;cursor:pointer">
                <input type="text" id="color-hex-${c.key}" value="${corAtual(c.key)}" 
                       style="flex:1;font-family:var(--mono);font-size:.9rem;padding:8px;background:var(--canvas);border:1px solid var(--borda);border-radius:8px;color:var(--texto)"
                       ${ThemeState.tema === 'alto-contraste' ? 'disabled' : ''}
                       placeholder="#RRGGBB">
                ${ThemeState.cores[c.key] ? `<button class="btn ghost" data-reset-cor="${c.key}" style="padding:4px 8px;font-size:.8rem" title="Restaurar padrão">↩</button>` : ''}
              </div>
              <small style="color:var(--texto-fraco)">Var: ${c.var}</small>
            </div>
          `).join('')}
        </div>
        ${ThemeState.tema !== 'alto-contraste' ? `
          <div style="margin-top:12px;text-align:center">
            <button class="btn ghost" id="reset-all-colors">Restaurar todas as cores do tema</button>
          </div>
        ` : ''}
      </div>
      
      <!-- Density -->
      <div style="margin-bottom:20px">
        <label style="display:block;margin-bottom:8px;font-weight:600">Densidade / Tamanho Toque</label>
        <div class="abas" role="radiogroup" aria-label="Densidade">
          ${densities.map(d => `
            <button class="btn ${ThemeState.density === d.id ? 'ativa' : ''}" 
                    role="radio" aria-checked="${ThemeState.density === d.id}"
                    data-density="${d.id}" data-desc="${d.desc}">
              ${d.label}
            </button>
          `).join('')}
        </div>
        <small style="color:var(--texto-fraco)" id="density-desc">${densities.find(d => d.id === ThemeState.density)?.desc}</small>
      </div>
      
      <!-- Global (Admin) -->
      ${isAdmin ? `
        <div style="border-top:1px solid var(--borda);padding-top:16px">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600">
              <input type="checkbox" id="usar-global" ${ThemeState.usandoGlobal ? 'checked' : ''}>
              <span>Usar como padrão global do estabelecimento</span>
            </label>
            ${ThemeState.usandoGlobal ? `
              <button class="btn ok" id="salvar-global">${ic('disquete')} Salvar como Global</button>
            ` : `
              <button class="btn primario" id="salvar-global">${ic('globo')} Definir como Global</button>
            `}
            <button class="btn ghost" id="reset-global">↩ Usar meu tema pessoal</button>
          </div>
          <small style="color:var(--texto-fraco);display:block;margin-top:8px">
            O tema global é aplicado a todos usuários que não personalizaram. Requer permissão <code>pode_config_sistema</code>.
          </small>
        </div>
      ` : ''}
    </div>
  `;
  
  // Event listeners
  container.querySelectorAll('[data-tema]').forEach(btn => {
    btn.onclick = () => {
      setTema(btn.dataset.tema);
      container.querySelector('#tema-desc').textContent = btn.dataset.desc;
      // Re-render para atualizar color pickers (alto contraste desabilita)
      renderThemeConfig(container, isAdmin);
    };
  });
  
  coresEditaveis.forEach(c => {
    const inputColor = container.querySelector(`#color-${c.key}`);
    const inputHex = container.querySelector(`#color-hex-${c.key}`);
    const btnReset = container.querySelector(`[data-reset-cor="${c.key}"]`);
    
    if (inputColor) {
      inputColor.onchange = (e) => {
        setCorPersonalizada(c.key, e.target.value);
        if (inputHex) inputHex.value = e.target.value;
      };
    }
    if (inputHex) {
      inputHex.onchange = (e) => {
        const val = e.target.value.trim();
        if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
          setCorPersonalizada(c.key, val);
          if (inputColor) inputColor.value = val;
        } else {
          toast('Cor inválida (use #RRGGBB)', 'erro');
          inputHex.value = corAtual(c.key);
        }
      };
    }
    if (btnReset) {
      btnReset.onclick = () => {
        resetarCorPersonalizada(c.key);
        if (inputColor) inputColor.value = corAtual(c.key);
        if (inputHex) inputHex.value = corAtual(c.key);
      };
    }
  });
  
  const resetAll = container.querySelector('#reset-all-colors');
  if (resetAll) {
    resetAll.onclick = () => {
      ['acao', 'ok', 'alerta'].forEach(k => resetarCorPersonalizada(k));
      renderThemeConfig(container, isAdmin);
    };
  }
  
  container.querySelectorAll('[data-density]').forEach(btn => {
    btn.onclick = () => {
      setDensity(btn.dataset.density);
      container.querySelector('#density-desc').textContent = btn.dataset.desc;
    };
  });
  
  const usarGlobal = container.querySelector('#usar-global');
  const salvarGlobal = container.querySelector('#salvar-global');
  const resetGlobal = container.querySelector('#reset-global');
  
  if (usarGlobal) {
    usarGlobal.onchange = (e) => {
      if (e.target.checked) {
        usarTemaGlobal();
      } else {
        usarTemaUsuario();
      }
      renderThemeConfig(container, isAdmin);
    };
  }
  if (salvarGlobal) {
    salvarGlobal.onclick = () => salvarTemaGlobal();
  }
  if (resetGlobal) {
    resetGlobal.onclick = () => {
      usarTemaUsuario();
      renderThemeConfig(container, isAdmin);
    };
  }
}