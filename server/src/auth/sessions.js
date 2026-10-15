import { config } from '../config.js';
import { novoToken, sha256, novoId } from './crypto.js';
import { erro } from '../core/errors.js';
import { agoraISO } from '../db/connection.js';

export function criarSessao(db, usuarioId, ip, userAgent) {
  const token = novoToken();
  const agora = new Date();
  const expira = new Date(agora.getTime() + config.sessaoHoras * 3600_000);
  const id = novoId();
  db.prepare(
    `INSERT INTO sessoes (id, token_hash, usuario_id, criado_em, expira_em, ultimo_uso, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, sha256(token), usuarioId, agora.toISOString(), expira.toISOString(), agora.toISOString(), ip ?? null, String(userAgent ?? '').slice(0, 200));
  return { token, id, expiraEm: expira.toISOString() };
}

// Retorna { usuario } ou lança 401. Atualiza último uso e expira por inatividade.
export function validarSessao(db, token) {
  if (!token || typeof token !== 'string' || token.length > 200) throw erro.sessao();
  const s = db.prepare(
    `SELECT s.*, u.nome, u.cargo, u.ativo FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
     WHERE s.token_hash = ?`
  ).get(sha256(token));
  if (!s || s.revogada) throw erro.sessao();
  const agora = Date.now();
  if (new Date(s.expira_em).getTime() < agora) throw erro.sessao('Sessão expirada. Faça login novamente.');
  const inatividadeMax = config.sessaoInatividadeMin * 60_000;
  if (agora - new Date(s.ultimo_uso).getTime() > inatividadeMax) {
    db.prepare('UPDATE sessoes SET revogada = 1 WHERE id = ?').run(s.id);
    throw erro.sessao('Sessão expirada por inatividade.');
  }
  if (!s.ativo) throw erro.sessao('Usuário desativado.');
  db.prepare('UPDATE sessoes SET ultimo_uso = ? WHERE id = ?').run(agoraISO(), s.id);
  return { sessaoId: s.id, usuario: { id: s.usuario_id, nome: s.nome, cargo: s.cargo } };
}

export function revogarSessao(db, sessaoId) {
  db.prepare('UPDATE sessoes SET revogada = 1 WHERE id = ?').run(sessaoId);
}

export function revogarTodasDoUsuario(db, usuarioId) {
  db.prepare('UPDATE sessoes SET revogada = 1 WHERE usuario_id = ? AND revogada = 0').run(usuarioId);
}

export function extrairTokenDoCookie(req) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const parte of raw.split(';')) {
    const [k, ...resto] = parte.trim().split('=');
    if (k === 'lp_session') return decodeURIComponent(resto.join('='));
  }
  return null;
}

export function setCookieSessao(res, token, expiraEm) {
  res.setHeader('Set-Cookie',
    `lp_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expiraEm).toUTCString()}`);
}

export function limparCookieSessao(res) {
  res.setHeader('Set-Cookie', 'lp_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}
