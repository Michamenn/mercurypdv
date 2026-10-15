import { ic } from './icons.js';
// Sound Module - Web Audio API para alertas sonoros KDS
// Sons sintéticos gerados via OscillatorNode (sem arquivos externos)

const STORAGE_KEY = 'lp-kds-sound-prefs';

export const SoundState = {
  habilitado: true,
  volume: 0.5, // 0.0 a 1.0
  sons: {
    novo: true,      // Novo pedido chegou
    atrasado: true,  // Pedido atrasado (>15min)
    pronto: true,    // Pedido marcado como pronto
    avancar: true,   // Avançou etapa
  },
};

let audioContext = null;

// Inicializa AudioContext (precisa de interação do usuário)
function getAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Resume se suspenso (política de autoplay)
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  return audioContext;
}

// Carrega preferências do localStorage
export function carregarPreferenciasSom() {
  try {
    const salvo = localStorage.getItem(STORAGE_KEY);
    if (salvo) {
      const prefs = JSON.parse(salvo);
      SoundState.habilitado = prefs.habilitado ?? true;
      SoundState.volume = prefs.volume ?? 0.5;
      SoundState.sons = { ...SoundState.sons, ...prefs.sons };
    }
  } catch { /* ignora erro */ }
}

// Salva preferências no localStorage
function salvarPreferenciasSom() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      habilitado: SoundState.habilitado,
      volume: SoundState.volume,
      sons: SoundState.sons,
    }));
  } catch { /* ignora erro */ }
}

// Gera tom sintético via OscillatorNode
function tocarTom(frequencia, duracao, tipo = 'sine', volume = null) {
  if (!SoundState.habilitado) return;
  
  const ctx = getAudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  
  osc.type = tipo;
  osc.frequency.value = frequencia;
  gain.gain.value = (volume ?? SoundState.volume) * 0.3; // Master volume * 0.3 para não estourar
  
  osc.connect(gain);
  gain.connect(ctx.destination);
  
  const agora = ctx.currentTime;
  osc.start(agora);
  osc.stop(agora + duracao);
  
  // Fade out suave
  gain.gain.exponentialRampToValueAtTime(0.001, agora + duracao);
}

// Sons pré-definidos
export function tocarNovoPedido() {
  if (!SoundState.sons.novo) return;
  // Dois tons ascendentes: "ding-dong"
  tocarTom(800, 0.15, 'sine');
  setTimeout(() => tocarTom(600, 0.2, 'sine'), 100);
}

export function tocarAtrasado() {
  if (!SoundState.sons.atrasado) return;
  // Tom grave pulsante: "bip-bip-bip" grave
  for (let i = 0; i < 3; i++) {
    setTimeout(() => tocarTom(200, 0.3, 'square', 0.4), i * 400);
  }
}

export function tocarPronto() {
  if (!SoundState.sons.pronto) return;
  // Acorde maior ascendente: "ta-da!"
  tocarTom(523.25, 0.15, 'sine'); // C5
  setTimeout(() => tocarTom(659.25, 0.15, 'sine'), 100); // E5
  setTimeout(() => tocarTom(783.99, 0.25, 'sine'), 200); // G5
}

export function tocarAvancar() {
  if (!SoundState.sons.avancar) return;
  // Click suave
  tocarTom(1000, 0.05, 'sine', 0.3);
}

// Teste de som (para configuração)
export function testarSom(tipo) {
  switch (tipo) {
    case 'novo': tocarNovoPedido(); break;
    case 'atrasado': tocarAtrasado(); break;
    case 'pronto': tocarPronto(); break;
    case 'avancar': tocarAvancar(); break;
  }
}

// Toggle global
export function toggleSom() {
  SoundState.habilitado = !SoundState.habilitado;
  salvarPreferenciasSom();
  return SoundState.habilitado;
}

// Set volume (0-1)
export function setVolume(vol) {
  SoundState.volume = Math.max(0, Math.min(1, vol));
  salvarPreferenciasSom();
}

// Toggle som específico
export function toggleSomEspecifico(chave) {
  if (SoundState.sons.hasOwnProperty(chave)) {
    SoundState.sons[chave] = !SoundState.sons[chave];
    salvarPreferenciasSom();
  }
  return SoundState.sons[chave];
}

// UI de configuração de sons (para painel KDS)
export function renderSoundConfig(container) {
  container.innerHTML = `
    <div class="cartao">
      <h3>${ic('som')} Alertas Sonoros KDS</h3>
      <div style="display:flex;flex-direction:column;gap:12px">
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-weight:600">
          <input type="checkbox" id="som-global" ${SoundState.habilitado ? 'checked' : ''} style="width:20px;height:20px">
          <span>Ativar alertas sonoros</span>
        </label>
        
        <div style="display:flex;align-items:center;gap:10px">
          <label style="min-width:100px">Volume</label>
          <input type="range" id="som-volume" min="0" max="1" step="0.1" value="${SoundState.volume}" style="flex:1" />
          <span id="som-volume-label" style="min-width:40px;font-family:var(--mono)">${Math.round(SoundState.volume * 100)}%</span>
        </div>
        
        <div style="border-top:1px solid var(--borda);padding-top:12px">
          <h4 style="margin:0 0 8px">Sons individuais</h4>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px">
            ${[
              { key: 'novo', label: ic('sino') + ' Novo pedido', desc: 'Chegou novo pedido na fila' },
              { key: 'atrasado', label: ic('alerta') + '️ Atrasado (>15min)', desc: 'Pedido passou de 15 min' },
              { key: 'pronto', label: ic('check') + ' Pronto', desc: 'Pedido marcado como pronto' },
              { key: 'avancar', label: '▶ Avançar etapa', desc: 'Transição de status' },
            ].map(s => `
              <label class="cartao" style="padding:10px;cursor:pointer;display:flex;flex-direction:column;gap:4px">
                <div style="display:flex;align-items:center;gap:8px">
                  <input type="checkbox" data-som="${s.key}" ${SoundState.sons[s.key] ? 'checked' : ''} style="width:18px;height:18px">
                  <strong>${s.label}</strong>
                </div>
                <small style="color:var(--texto-fraco)">${s.desc}</small>
                <button class="btn ghost" data-test="${s.key}" style="margin-top:4px;padding:4px 8px;font-size:.8rem">${ic('som')} Testar</button>
              </label>
            `).join('')}
          </div>
        </div>
      </div>
    </div>
  `;

  // Event listeners
  container.querySelector('#som-global').addEventListener('change', (e) => {
    SoundState.habilitado = e.target.checked;
    salvarPreferenciasSom();
  });

  container.querySelector('#som-volume').addEventListener('input', (e) => {
    const vol = parseFloat(e.target.value);
    SoundState.volume = vol;
    container.querySelector('#som-volume-label').textContent = `${Math.round(vol * 100)}%`;
    salvarPreferenciasSom();
  });

  container.querySelectorAll('[data-som]').forEach(chk => {
    chk.addEventListener('change', (e) => {
      SoundState.sons[e.target.dataset.som] = e.target.checked;
      salvarPreferenciasSom();
    });
  });

  container.querySelectorAll('[data-test]').forEach(btn => {
    btn.onclick = () => testarSom(btn.dataset.test);
  });
}