import { erro } from '../core/errors.js';
import { agoraISO } from '../db/connection.js';

// Bloqueio persistente por usuário (banco): 5 falhas -> atraso progressivo exponencial, teto de 30 min.
export function verificarBloqueio(usuario) {
  if (usuario.bloqueado_ate) {
    const restanteMs = new Date(usuario.bloqueado_ate).getTime() - Date.now();
    if (restanteMs > 0) {
      const seg = Math.ceil(restanteMs / 1000);
      throw erro.bloqueio(`Usuario bloqueado por tentativas invalidas. Tente novamente em ${seg} segundos.`, {
        bloqueado_ate: usuario.bloqueado_ate,
      });
    }
  }
}

export function registrarFalhaLogin(db, usuarioId) {
  const u = db.prepare('SELECT falhas_login FROM usuarios WHERE id = ?').get(usuarioId);
  const n = (u?.falhas_login ?? 0) + 1;
  let bloqueadoAte = null;
  if (n >= 5) {
    const minutos = Math.min(2 ** (n - 5), 30);
    bloqueadoAte = new Date(Date.now() + minutos * 60_000).toISOString();
  }
  db.prepare('UPDATE usuarios SET falhas_login = ?, bloqueado_ate = ? WHERE id = ?').run(n, bloqueadoAte, usuarioId);
  return { tentativas: n, bloqueadoAte };
}

export function limparFalhas(db, usuarioId) {
  db.prepare('UPDATE usuarios SET falhas_login = 0, bloqueado_ate = NULL WHERE id = ?').run(usuarioId);
}

// Limitador em memória por IP para endpoints sensíveis (login/setup).
const balcoes = new Map();
// Seam de teste: limpa o estado entre servidores de teste (nunca usar em produção).
export function _resetLimitadores() { balcoes.clear(); }
export function limitarIP(req, _res, next) {
  const ip = req.ip || req.socket?.remoteAddress || 'desconhecido';
  const agora = Date.now();
  const janela = 60_000;
  let b = balcoes.get(ip);
  if (!b || agora - b.inicio > janela) {
    b = { inicio: agora, count: 0 };
    balcoes.set(ip, b);
  }
  b.count++;
  // limpeza oportunista
  if (balcoes.size > 5000) {
    for (const [k, v] of balcoes) if (agora - v.inicio > janela) balcoes.delete(k);
  }
  if (b.count > 30) {
    return next(erro.bloqueio('Muitas requisições. Aguarde um minuto.', { retry_apos: 60 }));
  }
  next();
}

export function agora() {
  return agoraISO();
}
