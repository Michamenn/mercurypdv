// Hub WebSocket: reconexão automática, seq monotônico e snapshot na reconexão (KDS-003)
// 1.3.1 — identifica a origem da conexão (pdv, mobile, web, apk) para o
// painel de sincronização de dispositivos e sessões ativas.
let sock = null;
let ultimoSeq = 0;
let handlers = new Set();
let estadoHandlers = new Set();
let reconectarEm = 1000;
let dispositivoAtual = 'web';

export function aoEvento(fn) { handlers.add(fn); return () => handlers.delete(fn); }
export function aoEstado(fn) { estadoHandlers.add(fn); return () => estadoHandlers.delete(fn); }

function notificarEstado(online) {
  for (const fn of estadoHandlers) fn(online);
}

// Detecta a origem pelo User-Agent (o APK pode forçar via segundo argumento).
export function detectarDispositivo(forcado = null) {
  if (forcado) return forcado;
  const ua = navigator.userAgent || '';
  if (/mercury[-_ ]?apk|cordova|capacitor/i.test(ua)) return 'apk-mobile';
  if (/android|iphone|ipad|ipod|mobile/i.test(ua)) return 'celular-web';
  return 'pdv-web';
}

export function conectarWS(token, dispositivo = null) {
  dispositivoAtual = detectarDispositivo(dispositivo);
  if (sock) { try { sock.close(); } catch { /* noop */ } }
  sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);

  sock.onopen = () => {
    reconectarEm = 1000;
    sock.send(JSON.stringify({ type: 'auth', token, dispositivo: dispositivoAtual }));
    notificarEstado(true);
  };

  sock.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === 'auth_ok') {
      // snapshot: se nosso seq ficou para trás, o app recarrega o estado (regra do app)
      if (msg.seq > ultimoSeq) ultimoSeq = msg.seq;
      notificarEstado(true);
      return;
    }
    if (msg.type === 'evento') {
      // idempotência de eventos: descarta duplicados e fora de ordem (BR-007)
      if (msg.seq <= ultimoSeq) return;
      ultimoSeq = msg.seq;
      for (const fn of handlers) fn(msg);
    }
  };

  sock.onclose = () => {
    notificarEstado(false);
    setTimeout(() => conectarWS(null, dispositivoAtual === 'web' ? null : dispositivoAtual), reconectarEm);
    reconectarEm = Math.min(reconectarEm * 2, 15000);
  };
  sock.onerror = () => { try { sock.close(); } catch { /* noop */ } };
}

export function desconectarWS() {
  if (sock) { try { sock.close(); } catch { /* noop */ } sock = null;
  }
  ultimoSeq = 0;
}

export function seqAtual() { return ultimoSeq; }
export function dispositivoLocal() { return dispositivoAtual; }
