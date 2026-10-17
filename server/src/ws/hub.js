import { WebSocketServer } from 'ws';
import { extrairTokenDoCookie } from '../auth/sessions.js';

// Hub WebSocket: autenticação por 1ª mensagem (cookie OU token no corpo),
// seq global persistida (tabela eventos), heartbeat, broadcast com ordem garantida.
// 1.3.1 — presença de dispositivos: cada conexão identifica a origem
// (PDV, garçom mobile, web) e conecta/desconecta gera evento de presença
// em tempo real (sem poluir a tabela de eventos, que é o log do negócio).
export class HubWS {
  constructor(db, logger) {
    this.db = db;
    this.logger = logger;
    this.sockets = new Set(); // { ws, usuario, sessaoId, dispositivo, ip, desde, vivo }
    this.wss = null;
    this.heartbeat = null;
  }

  anexar(httpServer) {
    this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });
    this.wss.on('connection', (ws, req) => {
      const cliente = {
        ws, usuario: null, sessaoId: null, dispositivo: 'web', vivo: true,
        ip: req?.socket?.remoteAddress ?? null, desde: Date.now(),
      };
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
          if (msg?.type === 'auth') {
            // 1.3.1: identificação do dispositivo de origem (pdv/mobile/web/apk)
            if (typeof msg.dispositivo === 'string' && msg.dispositivo.length <= 30) {
              cliente.dispositivo = msg.dispositivo;
            }
            if (typeof msg.token === 'string' && msg.token) {
              this.autenticarCliente(cliente, msg.token);
            }
          }
        } catch { /* mensagem inválida ignorada */ }
      });
      ws.on('close', () => { this.sockets.delete(cliente); this.transmitirPresenca(); });
      ws.on('error', () => { cliente.vivo = false; });
      this.sockets.add(cliente);
    });

    this.heartbeat = setInterval(() => {
      for (const c of this.sockets) {
        if (!c.vivo) { try { c.ws.terminate(); } catch { /* noop */ } this.sockets.delete(c); this.transmitirPresenca(); continue; }
        c.vivo = false;
        try { c.ws.ping(); } catch { /* noop */ }
      }
    }, 30_000);
  }

  autenticarCliente(cliente, token) {
    // validaSessao é injetado para evitar ciclo de dependência com sessions.js
    try {
      const { usuario, sessaoId } = this.validar(token);
      cliente.usuario = usuario;
      cliente.sessaoId = sessaoId;
      this.transmitirPresenca();
      try {
        cliente.ws.send(JSON.stringify({
          type: 'auth_ok',
          usuario,
          seq: this.seqAtual(),
        }));
      } catch { /* noop */ }
    } catch {
      try { cliente.ws.send(JSON.stringify({ type: 'auth_erro' })); } catch { /* noop */ }
    }
  }

  setValidador(fnValidar) {
    this.validar = fnValidar;
  }

  seqAtual() {
    const r = this.db.prepare('SELECT MAX(seq) AS s FROM eventos').get();
    return r?.s ?? 0;
  }

  // Lista de dispositivos conectados AGORA (para painel de sessões e sync).
  clientes() {
    const lista = [];
    for (const c of this.sockets) {
      if (!c.usuario) continue;
      lista.push({
        usuario: c.usuario.nome,
        cargo: c.usuario.cargo,
        dispositivo: c.dispositivo,
        ip: c.ip,
        desde: new Date(c.desde).toISOString(),
        online: c.vivo,
      });
    }
    return lista;
  }

  totalClientes() {
    let n = 0;
    for (const c of this.sockets) if (c.usuario) n++;
    return n;
  }

  // Encerra na hora os sockets de uma sessão revogada (desconexão remota).
  encerrarSessao(sessaoId) {
    const alvo = String(sessaoId ?? '');
    if (!alvo) return 0;
    let n = 0;
    for (const c of [...this.sockets]) {
      if (c.sessaoId === alvo) {
        try { c.ws.terminate(); } catch { /* noop */ }
        this.sockets.delete(c);
        n++;
      }
    }
    if (n > 0) this.transmitirPresenca();
    return n;
  }

  // Broadcast sem persistir (presença/sincronização — não é evento de negócio).
  transmitir(mensagem) {
    const txt = JSON.stringify(mensagem);
    for (const c of this.sockets) {
      if (!c.usuario) continue;
      try { c.ws.send(txt); } catch { /* reconexão cuidará */ }
    }
  }

  transmitirPresenca() {
    this.transmitir({ type: 'presenca', total: this.totalClientes() });
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
