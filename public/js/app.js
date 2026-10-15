// App shell: login, roteamento por cargo, estado global
import { ic } from './icons.js';
import { api, get, post, aoPerderSessao } from './api.js';
import { toast, escapar, modal } from './ui.js';
import { conectarWS, desconectarWS, aoEstado } from './ws.js';
import { drenarFilaKds } from './offdb.js';
import { post as postFila } from './offline-bridge.js';
import { initA11y, anunciar, definirTamanhoFonte } from './a11y.js';
import { carregarPreferenciasTema, aplicarTema, usarTemaGlobal, aplicarPadroesServidor } from './theme.js';
import * as vLogin from './views/login.js';
import * as vPdv from './views/pdv.js';
import * as vMesas from './views/mesas.js';
import * as vKds from './views/kds.js';
import * as vCaixa from './views/caixa.js';
import * as vAdmin from './views/admin.js';
import * as vMobile from './views/mobile.js';
import * as vComandas from './views/comandas.js';

export const estado = {
  usuario: null,
  permissoes: {},
  configPublica: {},
};

const app = document.getElementById('app');

aoPerderSessao(() => { desconectarWS(); estado.usuario = null; renderLogin('Sessão encerrada. Faça login novamente.'); });
aoEstado((online) => {
  const el = document.getElementById('estado-conexao');
  if (el) {
    el.textContent = online ? '● Online' : '● Sem conexão';
    el.className = `estado-conexao ${online ? 'on' : 'off'}`;
  }
  if (online && estado.usuario) drenarFilaKds(async (item) => postFila(`/pedidos/${item.pedido_id}/kds-avancar`, {}));
});

const ROTAS = [
  { id: 'pdv', icone: 'recibo', rotulo: 'PDV Balcão', perm: 'pode_vender_balcao', view: vPdv },
  { id: 'mobile', icone: 'celular', rotulo: 'Venda rápida', permOu: ['pode_vender_balcao', 'pode_lancar_comanda'], view: vMobile },
  { id: 'mesas', icone: 'prato', rotulo: 'Mesas & Comandas', perm: 'pode_lancar_comanda', view: vMesas },
  { id: 'comandas', icone: 'recibo', rotulo: 'Comandas', permOu: ['pode_lancar_comanda', 'pode_dividir_pagar'], view: vComandas },
  { id: 'kds', icone: 'panela', rotulo: 'Cozinha (KDS)', perm: 'pode_ver_kds', view: vKds },
  { id: 'caixa', icone: 'dinheiro', rotulo: 'Caixa', perm: 'pode_abrir_fechar_caixa', view: vCaixa },
  { id: 'admin', icone: 'engrenagem', rotulo: 'Administração', perm: 'pode_config_sistema', view: vAdmin },
  { id: 'relatorios', icone: 'grafico', rotulo: 'Relatórios', perm: 'pode_ver_relatorios', view: vAdmin, sub: 'relatorios' },
];

function temAcesso(rota) {
  if (!rota.perm && !rota.permOu) return true;
  if (rota.perm) return !!estado.permissoes[rota.perm];
  return (rota.permOu ?? []).some((p) => estado.permissoes[p]);
}

// Preferências da navegação flutuante: posição (lateral/superior) + rótulos.
// Padrão do estabelecimento vem do servidor; operador pode sobrescrever localmente.
function prefsNav() {
  let salvas = {};
  try { salvas = JSON.parse(localStorage.getItem('lp-nav') ?? '{}'); } catch { /* ignora */ }
  return {
    posicao: ['lateral', 'superior'].includes(salvas.posicao) ? salvas.posicao
      : (estado.configPublica?.nav_posicao_padrao === 'superior' ? 'superior' : 'lateral'),
    compacta: salvas.compacta === true,
    rotulos: (salvas.rotulos && typeof salvas.rotulos === 'object') ? salvas.rotulos : {},
    autoOcultar: salvas.autoOcultar === true,
  };
}

function salvarPrefsNav(prefs) {
  try { localStorage.setItem('lp-nav', JSON.stringify(prefs)); } catch { /* sem storage */ }
}

export function navegar(id) {
  location.hash = '#' + id;
  render();
}

function rotaAtual() {
  const h = (location.hash || '#pdv').slice(1);
  const [id, sub] = h.split('/');
  const rota = ROTAS.find((r) => r.id === id);
  if (!rota) return ROTAS[0];
  if (!temAcesso(rota)) return ROTAS[0];
  return { ...rota, sub: sub || rota.sub };
}

function renderTopo() {
  const rotasVisiveis = ROTAS.filter(temAcesso);
  const nav = prefsNav();
  const rotuloDe = (r) => (nav.rotulos[r.id] ?? '').trim() || r.rotulo;
  const logo = estado.configPublica?.logo_path ? `<img class="logo-marca" src="/${estado.configPublica.logo_path}" alt="Logomarca" />` : ic('lanche');
  return `
    <header class="topo">
      <span class="marca">${logo} ${escapar(estado.configPublica?.empresa_nome ?? 'Mercury PDV')}</span>
      <span class="operador">${escapar(estado.usuario.nome)} · ${rotuloCargo(estado.usuario.cargo)}</span>
      <span id="estado-conexao" class="estado-conexao on">● Online</span>
      <span class="spacer"></span>
      <button class="btn ghost nav-toggle" id="btn-menu" title="Menu" aria-label="Abrir menu" aria-expanded="false" aria-controls="nav-principal">
        <span aria-hidden="true">${ic('menu')}</span>
      </button>
    </header>
    <div class="corpo" data-nav="${nav.posicao}" data-nav-compacta="${nav.compacta ? '1' : '0'}" data-auto="${nav.posicao === 'lateral' && nav.autoOcultar ? '1' : '0'}">
      <nav class="nav-flutuante" id="nav-principal" aria-label="Navegação principal">
        ${rotasVisiveis.map((r) => `<button class="btn nav-item" data-rota="${r.id}" title="${escapar(rotuloDe(r))}" aria-label="${escapar(rotuloDe(r))}" aria-current="${r.id === rotaIdAtual() ? 'page' : 'false'}">
          <span class="nav-icone" aria-hidden="true">${ic(r.icone)}</span><span class="nav-rotulo">${escapar(rotuloDe(r))}</span>
        </button>`).join('')}
        <span class="nav-sep" role="separator" aria-hidden="true"></span>
        <button class="btn nav-item" id="btn-nav" title="Personalizar navegação (posição e rótulos)" aria-label="Personalizar navegação">
          <span class="nav-icone" aria-hidden="true">${ic('bussola')}</span><span class="nav-rotulo">Personalizar</span>
        </button>
        <button class="btn nav-item" id="btn-bloquear" title="Bloquear tela e trocar de operador" aria-label="Bloquear tela e trocar de operador">
          <span class="nav-icone" aria-hidden="true">${ic('cadeado')}</span><span class="nav-rotulo">Bloquear</span>
        </button>
        <button class="btn nav-item perigo" id="btn-sair" title="Sair do sistema" aria-label="Sair do sistema">
          <span class="nav-icone" aria-hidden="true">${ic('x')}</span><span class="nav-rotulo">Sair</span>
        </button>
      </nav>
      <div class="nav-scrim" data-menu-fechar hidden></div>
      <main class="conteudo" id="conteudo" tabindex="-1"></main>
    </div>`;
}

function rotaIdAtual() {
  try { return (location.hash || '#pdv').slice(1).split('/')[0]; } catch { return 'pdv'; }
}

function rotuloCargo(cargo) {
  return { admin: 'Administrador', caixa: 'Operador de Caixa', garcom: 'Garçom', cozinha: 'Cozinha' }[cargo] ?? cargo;
}

// No celular o menu fica oculto (folha inferior) e abre pelo botão de menu do topo.
function definirMenu(aberto) {
  const corpo = document.querySelector('.corpo');
  const btn = document.querySelector('#btn-menu');
  const scrim = document.querySelector('.nav-scrim');
  if (!corpo) return;
  if (aberto) corpo.setAttribute('data-nav-aberto', '1');
  else corpo.removeAttribute('data-nav-aberto');
  btn?.setAttribute('aria-expanded', String(!!aberto));
  if (scrim) scrim.hidden = !aberto;
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') definirMenu(false); });

function render() {
  if (!estado.usuario) return;
  const rota = rotaAtual();
  definirMenu(false); // re-render sempre fecha a folha do celular
  app.innerHTML = renderTopo();
  app.querySelectorAll('[data-rota]').forEach((b) => {
    b.onclick = () => navegar(b.dataset.rota);
    if (b.dataset.rota === rota.id) b.classList.add('ativa');
  });
  app.querySelector('#btn-menu').onclick = () => definirMenu(document.querySelector('.corpo')?.getAttribute('data-nav-aberto') !== '1');
  app.querySelector('[data-menu-fechar]').onclick = () => definirMenu(false);
  app.querySelectorAll('.nav-flutuante .nav-item').forEach((b) => b.addEventListener('click', () => definirMenu(false)));
  app.querySelector('#btn-sair').onclick = sair;
  app.querySelector('#btn-bloquear').onclick = sair; // bloqueio = trocar operador
  app.querySelector('#btn-nav').onclick = () => {
    const atual = prefsNav();
    const rotasVisiveisModal = ROTAS.filter(temAcesso);
    const m = modal(`<h2>${ic('bussola')} Navegação</h2>
      <p class="campo-ajuda">Posição da barra (no celular, sempre inferior).</p>
      <div class="abas" role="radiogroup" aria-label="Posição da navegação">
        <button class="btn ${atual.posicao === 'lateral' ? 'ativa' : ''}" role="radio" aria-checked="${atual.posicao === 'lateral'}" data-pos="lateral">◀ Lateral</button>
        <button class="btn ${atual.posicao === 'superior' ? 'ativa' : ''}" role="radio" aria-checked="${atual.posicao === 'superior'}" data-pos="superior">▲ Superior</button>
      </div>
      <label class="nav-modal-group">
        <input type="checkbox" id="nav-compacta" ${atual.compacta ? 'checked' : ''} /> Ocultar rótulos (só ícones)
      </label>
      <label class="nav-modal-group" title="No modo lateral, o menu recolhe sozinho e expande ao passar o mouse">
        <input type="checkbox" id="nav-auto" ${atual.autoOcultar ? 'checked' : ''} /> Ocultar menu lateral automaticamente
      </label>
      <h3>Rótulos personalizados</h3>
      ${rotasVisiveisModal.map((r) => `<label class="nav-modal-rotulo"><span aria-hidden="true">${r.icone}</span>
        <input data-rotulo="${r.id}" value="${escapar(atual.rotulos[r.id] ?? '')}" placeholder="${escapar(r.rotulo)}" maxlength="24" aria-label="Rótulo de ${escapar(r.rotulo)}" /></label>`).join('')}
      <button class="btn primario grande nav-modal-submit" data-a="ok">Aplicar</button>`);
    let posicao = atual.posicao;
    m.caixa.querySelectorAll('[data-pos]').forEach((b) => {
      b.onclick = () => {
        posicao = b.dataset.pos;
        m.caixa.querySelectorAll('[data-pos]').forEach((x) => { x.classList.remove('ativa'); x.setAttribute('aria-checked', 'false'); });
        b.classList.add('ativa'); b.setAttribute('aria-checked', 'true');
      };
    });
    m.caixa.querySelector('[data-a="ok"]').onclick = () => {
      const rotulos = {};
      m.caixa.querySelectorAll('[data-rotulo]').forEach((inp) => {
        const v = inp.value.trim().slice(0, 24);
        if (v) rotulos[inp.dataset.rotulo] = v;
      });
      salvarPrefsNav({ posicao, compacta: m.caixa.querySelector('#nav-compacta').checked, rotulos, autoOcultar: m.caixa.querySelector('#nav-auto').checked });
      m.fechar(); render();
      toast('Navegação atualizada', 'ok');
    };
  };
  rota.view.render(app.querySelector('#conteudo'), rota.sub, estado, navegar);
}

async function sair() {
  try { await post('/auth/logout', {}); } catch { /* sessão já morreu */ }
  desconectarWS();
  estado.usuario = null;
  renderLogin();
}

async function bootComSessao() {
  try {
    const me = await get('/auth/me');
    estado.usuario = me.usuario;
    estado.permissoes = me.permissoes ?? {};
    estado.configPublica = me.config_publica ?? {};
    // reconecta WS com cookie de sessão (token não é exposto ao JS)
    conectarWS(null);
    // Inicializa acessibilidade
    initA11y();
    // Inicializa tema
    carregarPreferenciasTema(); aplicarTema();
    // Padrões do estabelecimento no 1º acesso (sem preferência local)
    aplicarPadroesServidor(estado.configPublica);
    if (['0', '1', '2', '3'].includes(String(estado.configPublica.fonte_padrao ?? ''))) {
      try {
        if (!localStorage.getItem('lp-a11y-prefs')) definirTamanhoFonte(Number(estado.configPublica.fonte_padrao));
      } catch { /* sem storage */ }
    }
    // Carrega tema global se admin
    if (estado.permissoes.pode_config_sistema) {
      usarTemaGlobal();
    }
    render();
    drenarFilaKds(async (item) => postFila(`/pedidos/${item.pedido_id}/kds-avancar`, {}));
  } catch {
    renderLogin();
  }
}

function renderLogin(mensagem) {
  vLogin.render(app, mensagem, async (sessao) => {
    estado.usuario = sessao.usuario;
    estado.permissoes = sessao.permissoes ?? {};
    const cfg = await get('/auth/me');
    estado.configPublica = cfg.config_publica ?? {};
    conectarWS(null);
    // Inicializa acessibilidade
    initA11y();
    // Inicializa tema
    carregarPreferenciasTema(); aplicarTema();
    // Padrões do estabelecimento no 1º acesso (sem preferência local)
    aplicarPadroesServidor(estado.configPublica);
    if (['0', '1', '2', '3'].includes(String(estado.configPublica.fonte_padrao ?? ''))) {
      try {
        if (!localStorage.getItem('lp-a11y-prefs')) definirTamanhoFonte(Number(estado.configPublica.fonte_padrao));
      } catch { /* sem storage */ }
    }
    // Carrega tema global se admin
    if (estado.permissoes.pode_config_sistema) {
      usarTemaGlobal();
    }
    render();
    toast(`Bem-vindo, ${sessao.usuario.nome}!`, 'ok');
  });
}

window.addEventListener('hashchange', () => { if (estado.usuario) render(); });
bootComSessao();
