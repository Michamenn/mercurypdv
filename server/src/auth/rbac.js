import { extrairTokenDoCookie, validarSessao } from './sessions.js';
import { erro } from '../core/errors.js';

// Middleware: autentica por cookie de sessão (token hasheado no banco).
export function autenticar(db) {
  return (req, _res, next) => {
    try {
      const token = extrairTokenDoCookie(req);
      const { sessaoId, usuario } = validarSessao(db, token);
      req.usuario = usuario;
      req.sessaoId = sessaoId;
      req.token = token;
      req.ipCliente = req.ip || req.socket?.remoteAddress || null;
      next();
    } catch (e) {
      next(e);
    }
  };
}

// Negação por padrão: exige flag de permissão válida na tabela permissoes do cargo.
export function exigirPerm(db, flag) {
  return (req, _res, next) => {
    try {
      const p = db.prepare('SELECT * FROM permissoes WHERE cargo = ?').get(req.usuario.cargo);
      if (!p || !p[flag]) throw erro.permissao();
      next();
    } catch (e) {
      next(e);
    }
  };
}

// CSRF: mutações exigem header custom (formulários cross-site não conseguem enviá-lo
// sem preflight CORS, que este servidor não libera).
export function guardaMutacao(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const h = req.headers['x-requested-with'];
  if (h !== 'XMLHttpRequest') {
    return next(erro.permissao('Requisição sem identificador de origem confiável (X-Requested-With).'));
  }
  next();
}

// Step-up: exige credencial de um admin válido no corpo para operações sensíveis.
export function verificarStepUpAdmin(db, crypto, pepper, body, { usuarioExecutorId } = {}) {
  const nome = typeof body?.admin_usuario === 'string' ? body.admin_usuario.trim() : '';
  const senha = typeof body?.admin_senha === 'string' ? body.admin_senha : '';
  if (!nome || !senha) throw erro.permissao('Autorização administrativa obrigatória: informe usuário e senha de administrador.');
  const admin = db.prepare('SELECT * FROM usuarios WHERE nome = ? AND cargo = ? AND ativo = 1').get(nome, 'admin');
  if (!admin || !admin.senha_hash || !crypto.verificarSegredo(senha, admin.senha_hash, pepper)) {
    db.prepare('UPDATE usuarios SET falhas_login = falhas_login + 1 WHERE id = ? AND falhas_login < 99').run(admin?.id ?? 0);
    throw erro.permissao('Autorização administrativa inválida.');
  }
  return admin.id;
}
