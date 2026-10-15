// Hub WebSocket: reconexão automática, seq monotônico e snapshot na reconexão (KDS-003)
let sock = null;
let ultimoSeq = 0;
let handlers = new Set();
let estadoHandlers = new Set();
let reconectarEm = 1000;

export function aoEvento(fn) { handlers.add(fn); return () => handlers.delete(fn); }
export function aoEstado(fn) { estadoHandlers.add(fn); return () => estadoHandlers.delete(fn); }

function notificarEstado(online) {
  for (const fn of estadoHandlers) fn(online);
}

export function conectarWS(token) {
  if (sock) { try { sock.close(); } catch { /* noop */ } }
  sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);

  sock.onopen = () => {
    reconectarEm = 1000;
    sock.send(JSON.stringify({ type: 'auth', token }));
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
    setTimeout(() => conectarWS(token), reconectarEm);
    reconectarEm = Math.min(reconectarEm * 2, 15000);
  };
  sock.onerror = () => { try { sock.close(); } catch { /* noop */ } };
}

export function desconectarWS() {
  if (sock) { try { sock.close(); } catch { /* noop */ } sock = null; }
  ultimoSeq = 0;
}

export function seqAtual() { return ultimoSeq; }
