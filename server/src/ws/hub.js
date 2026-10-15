import { WebSocketServer } from 'ws';
import { extrairTokenDoCookie } from '../auth/sessions.js';

// Hub WebSocket: autenticação por 1ª mensagem (cookie OU token no corpo),
// seq global persistida (tabela eventos), heartbeat, broadcast com ordem garantida.
export class HubWS {
  constructor(db, logger) {
    this.db = db;
    this.logger = logger;
    this.sockets = new Set(); // { ws, usuario, vivo }
    this.wss = null;
    this.heartbeat = null;
  }

  anexar(httpServer) {
    this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });
    this.wss.on('connection', (ws, req) => {
      const cliente = { ws, usuario: null, vivo: true };
      // Cookie de sessão enviado automaticamente na conexão (mesma origem).
      try {
        req.headers.cookie = req.headers.cookie || '';
        const fakeReq = { headers: { cookie: req.headers.cookie } };
        const token = extrairTokenDoCookie(fakeReq);
        if (token) this.autenticarCliente(cliente, token);
      } catch { /* auth pela 1ª mensagem */ }

      ws.on('pong', () => { cliente.vivo = true; });
      ws.on('message', (dados) => {
        try {
          const msg = JSON.parse(String(dados));
          if (msg?.type === 'auth' && typeof msg.token === 'string') {
            this.autenticarCliente(cliente, msg.token);
          }
        } catch { /* mensagem inválida ignorada */ }
      });
      ws.on('close', () => this.sockets.delete(cliente));
      ws.on('error', () => { cliente.vivo = false; });
      this.sockets.add(cliente);
    });

    this.heartbeat = setInterval(() => {
      for (const c of this.sockets) {
        if (!c.vivo) { try { c.ws.terminate(); } catch { /* noop */ } this.sockets.delete(c); continue; }
        c.vivo = false;
        try { c.ws.ping(); } catch { /* noop */ }
      }
    }, 30_000);
  }

  autenticarCliente(cliente, token) {
    // validaSessao é injetado para evitar ciclo de dependência com sessions.js
    const { usuario } = this.validar(token);
    cliente.usuario = usuario;
    try {
      cliente.ws.send(JSON.stringify({
        type: 'auth_ok',
        usuario,
        seq: this.seqAtual(),
      }));
    } catch { /* noop */ }
  }

  setValidador(fnValidar) {
    this.validar = fnValidar;
  }

  seqAtual() {
    const r = this.db.prepare('SELECT MAX(seq) AS s FROM eventos').get();
    return r?.s ?? 0;
  }

  // Persiste o evento (seq monotônico) e transmite para clientes autenticados.
  publicar(tipo, payload, dadosExtras = {}) {
    const info = this.db.prepare('INSERT INTO eventos (tipo, payload, criado_em) VALUES (?, ?, ?)')
      .run(tipo, JSON.stringify(payload ?? {}), new Date().toISOString());
    const seq = Number(info.lastInsertRowid);
    const mensagem = JSON.stringify({ type: 'evento', seq, tipo, payload, ...dadosExtras });
    for (const c of this.sockets) {
      if (!c.usuario) continue;
      try { c.ws.send(mensagem); } catch { /* reconexão cuidará */ }
    }
    // Retenção: mantém últimos 10k eventos.
    if (seq % 1000 === 0) {
      try { this.db.prepare('DELETE FROM eventos WHERE seq <= ? - 10000').run(seq); } catch { /* noop */ }
    }
    return seq;
  }

  fechar() {
    clearInterval(this.heartbeat);
    for (const c of this.sockets) { try { c.ws.terminate(); } catch { /* noop */ } }
    this.sockets.clear();
    if (this.wss) { try { this.wss.close(); } catch { /* noop */ } }
  }
}
