// Erros de aplicacao com codigo estavel para o frontend.
export class AppError extends Error {
  constructor(status, codigo, mensagem, extras = {}) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
    this.extras = extras;
  }
}

export const erro = {
  validacao: (mensagem, extras) => new AppError(422, '422_VALIDACAO', mensagem, extras),
  credenciais: (mensagem = 'Credenciais invalidas, usuario inativo ou bloqueado temporariamente.') =>
    new AppError(401, '401_CREDENCIAIS', mensagem),
  sessao: (mensagem = 'Sessao invalida ou expirada.') => new AppError(401, '401_SESSAO', mensagem),
  permissao: (mensagem = 'Voce nao tem permissao para esta operacao.') => new AppError(403, '403_PERMISSAO', mensagem),
  naoEncontrado: (mensagem = 'Registro nao encontrado.') => new AppError(404, '404_NAO_ENCONTRADO', mensagem),
  conflito: (codigo, mensagem, extras) => new AppError(409, codigo, mensagem, extras),
  bloqueio: (mensagem, extras) => new AppError(429, '429_BLOQUEIO', mensagem, extras),
};

import { logger } from './logger.js';

// Handler unico: nunca expõe stack trace ao cliente.
export function handlerErros(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ erro: err.message, codigo: err.codigo, ...err.extras });
  }
  logger.erro(`${req.method} ${req.path} :: ${err.message} :: ${String(err.stack).split('\n').slice(1, 3).join(' | ')}`);
  return res.status(500).json({ erro: 'Erro interno do servidor.', codigo: '500_INTERNO' });
}
