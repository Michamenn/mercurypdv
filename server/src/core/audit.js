// Trilha de auditoria APPEND-ONLY: triggers no banco abortam UPDATE/DELETE.
// NUNCA registrar senhas, PINs, tokens ou segredos aqui.
export function registrar(db, { usuarioId = null, acao, entidade = null, entidadeId = null, detalhes = null, ip = null }) {
  db.prepare(
    `INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id, detalhes, ip, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(usuarioId, acao, entidade, entidadeId === null ? null : String(entidadeId),
        detalhes === null ? null : JSON.stringify(detalhes), ip ?? null, new Date().toISOString());
}

export function consultar(db, { limite = 200, entidade = null, acao = null, usuarioId = null }) {
  const cond = [];
  const params = [];
  if (entidade) { cond.push('entidade = ?'); params.push(entidade); }
  if (acao) { cond.push('acao = ?'); params.push(acao); }
  if (usuarioId) { cond.push('usuario_id = ?'); params.push(usuarioId); }
  const where = cond.length ? `WHERE ${cond.join(' AND ')}` : '';
  params.push(limite);
  return db.prepare(
    `SELECT a.id, a.usuario_id, u.nome AS usuario_nome, a.acao, a.entidade, a.entidade_id, a.detalhes, a.ip, a.criado_em
     FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
     ${where} ORDER BY a.id DESC LIMIT ?`
  ).all(...params);
}
