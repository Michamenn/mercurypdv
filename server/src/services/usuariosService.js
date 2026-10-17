import { erro } from '../core/errors.js';
import { hashSegredo, verificarSegredo, senhaForte, pinValido } from '../auth/crypto.js';
import { verificarBloqueio, registrarFalhaLogin, limparFalhas } from '../auth/ratelimit.js';
import { criarSessao, revogarSessao, revogarTodasDoUsuario } from '../auth/sessions.js';
import { registrar } from '../core/audit.js';
import { texto } from '../core/validate.js';
import { transacao, agoraISO } from '../db/connection.js';
import { config } from '../config.js';
import { CARGOS_GESTAO, CARGOS_VALIDOS, ehAdmin } from '../auth/cargos.js';

// ---------- Bootstrap: 1º admin apenas com 0 usuários (nada de credencial padrão) ----------
export function quantidadeUsuarios(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n;
}

export function criarPrimeiroAdmin(db, body, ip) {
  if (quantidadeUsuarios(db) > 0) {
    throw erro.permissao('Setup indisponível: já existe usuário cadastrado. Use login.');
  }
  const nome = texto(body?.nome, 'nome', { minimo: 3, maximo: 60 });
  const senha = typeof body?.senha === 'string' ? body.senha : '';
  if (!senhaForte(senha)) {
    throw erro.validacao('Senha forte obrigatória: mínimo 10 caracteres com letras e números.');
  }
  const pin = typeof body?.pin === 'string' && body.pin !== '' ? body.pin : null;
  if (pin !== null && !pinValido(pin)) throw erro.validacao('PIN deve ter 4 a 6 dígitos.');
  return transacao(db, () => {
    const agora = agoraISO();
    const info = db.prepare(
      `INSERT INTO usuarios (nome, cargo, senha_hash, pin_hash, ativo, criado_em) VALUES (?, 'admin', ?, ?, 1, ?)`
    ).run(nome, hashSegredo(senha, config.pepper), pin ? hashSegredo(pin, config.pepper) : null, agora);
    const id = Number(info.lastInsertRowid);
    db.prepare('UPDATE permissoes SET pode_config_sistema = 1 WHERE cargo = ?').run('admin');
    registrar(db, { usuarioId: id, acao: 'setup_admin_inicial', entidade: 'usuario', entidadeId: id, ip });
    return { id, nome, cargo: 'admin' };
  });
}

// ---------- Login (PIN ou senha) ----------
export function login(db, body, ip, userAgent) {
  const nome = texto(body?.usuario, 'usuario', { minimo: 1, maximo: 60 });
  const pin = typeof body?.pin === 'string' && body.pin !== '' ? body.pin : null;
  const senha = typeof body?.senha === 'string' && body.senha !== '' ? body.senha : null;
  if (!pin && !senha) throw erro.validacao('Informe PIN ou senha.');

  // Tempo constante aproximado: sempre executa verificação mesmo com usuário inexistente.
  const usuario = db.prepare('SELECT * FROM usuarios WHERE nome = ?').get(nome);
  const hashReferencia = usuario?.pin_hash ?? usuario?.senha_hash ?? `scrypt$32768$8$1$${Buffer.alloc(16).toString('base64')}$${Buffer.alloc(64).toString('base64')}`;
  const segredo = pin ?? senha;
  const ok = usuario ? (pin ? verificarSegredo(pin, usuario.pin_hash ?? '\u0000', config.pepper)
                            : verificarSegredo(senha, usuario.senha_hash ?? '\u0000', config.pepper))
                     : verificarSegredo(segredo ?? 'x', hashReferencia, config.pepper);
  if (!usuario || !ok || !usuario.ativo) {
    if (usuario) registrarFalhaLogin(db, usuario.id);
    registrar(db, { usuarioId: usuario?.id ?? null, acao: 'login_falhou', entidade: 'usuario', entidadeId: usuario?.id ?? null, detalhes: { motivo: 'credenciais' }, ip });
    throw erro.credenciais();
  }
  verificarBloqueio(usuario);
  limparFalhas(db, usuario.id);
  const sessao = criarSessao(db, usuario.id, ip, userAgent);
  db.prepare('UPDATE usuarios SET ultimo_login = ? WHERE id = ?').run(agoraISO(), usuario.id);
  registrar(db, { usuarioId: usuario.id, acao: 'login_ok', entidade: 'usuario', entidadeId: usuario.id, ip });
  const perms = db.prepare('SELECT * FROM permissoes WHERE cargo = ?').get(usuario.cargo);
  return {
    token: sessao.token, expira_em: sessao.expiraEm,
    usuario: { id: usuario.id, nome: usuario.nome, cargo: usuario.cargo },
    permissoes: perms ?? {},
  };
}

// Reautenticação (step-up) do próprio admin logado OU de outro admin/Proprietário
// — usada em operações sensíveis. O Proprietário autoriza sozinho, igual ao admin.
export function autorizarAdmin(db, body, ip) {
  const nome = texto(body?.admin_usuario, 'admin_usuario', { minimo: 1, maximo: 60 });
  const senha = typeof body?.admin_senha === 'string' ? body.admin_senha : '';
  if (!senha) throw erro.permissao('Senha de administrador obrigatória.');
  const marcadores = CARGOS_GESTAO.map(() => '?').join(', ');
  const admin = db.prepare(`SELECT * FROM usuarios WHERE nome = ? AND cargo IN (${marcadores}) AND ativo = 1`)
    .get(nome, ...CARGOS_GESTAO);
  const ok = admin?.senha_hash ? verificarSegredo(senha, admin.senha_hash, config.pepper) : false;
  if (!admin || !ok) {
    if (admin) registrarFalhaLogin(db, admin.id);
    registrar(db, { usuarioId: admin?.id ?? null, acao: 'stepup_admin_falhou', ip });
    throw erro.permissao('Autorização administrativa inválida.');
  }
  limparFalhas(db, admin.id);
  registrar(db, { usuarioId: admin.id, acao: 'stepup_admin_ok', ip });
  return admin.id;
}

// ---------- CRUD de usuários (admin) ----------
// Trava anti-escalada: só um Administrador (cargo 'admin') gerencia contas de
// Administrador. O Proprietário tem pode_gerenciar_usuarios, mas não pode criar
// admin, elevar alguém a admin, nem editar/desativar/resetar/desbloquear admin.
function exigirAdminDoSistema(executor) {
  if (!ehAdmin(executor?.cargo)) {
    throw erro.permissao('Apenas um Administrador pode gerenciar contas de Administrador.');
  }
}

export function listarUsuarios(db) {
  return db.prepare(
    `SELECT u.id, u.nome, u.cargo, u.ativo, u.ultimo_login, u.criado_em,
            (u.pin_hash IS NOT NULL) AS tem_pin, (u.senha_hash IS NOT NULL) AS tem_senha,
            u.falhas_login, u.bloqueado_ate
     FROM usuarios u ORDER BY u.nome`
  ).all();
}

export function criarUsuario(db, adminExecutor, body, ip) {
  const nome = texto(body?.nome, 'nome', { minimo: 3, maximo: 60 });
  const cargo = CARGOS_VALIDOS.includes(body?.cargo) ? body.cargo : null;
  if (!cargo) throw erro.validacao('Cargo deve ser: admin, proprietario, caixa, garcom ou cozinha.');
  const pin = typeof body?.pin === 'string' && body.pin !== '' ? body.pin : null;
  const senha = typeof body?.senha === 'string' && body.senha !== '' ? body.senha : null;
  // Anti-escalada: um não-admin (ex.: Proprietário) nunca cria uma conta admin.
  if (cargo === 'admin') exigirAdminDoSistema(adminExecutor);
  if ((cargo === 'admin' || cargo === 'proprietario') && !senha) throw erro.validacao('Administrador/Proprietário exige senha forte.');
  if (!pin && !senha) throw erro.validacao('Defina PIN (4–6 dígitos) e/ou senha.');
  if (pin && !pinValido(pin)) throw erro.validacao('PIN deve ter 4 a 6 dígitos.');
  if (senha && !senhaForte(senha)) throw erro.validacao('Senha forte obrigatória: mínimo 10 caracteres com letras e números.');
  if (pin && senha && pin === senha) throw erro.validacao('PIN e senha não podem ser iguais.');

  return transacao(db, () => {
    const dup = db.prepare('SELECT id FROM usuarios WHERE nome = ?').get(nome);
    if (dup) throw erro.conflito('409_CONFLITO_ESTADO', 'Já existe usuário com esse nome.');
    const info = db.prepare(
      `INSERT INTO usuarios (nome, cargo, pin_hash, senha_hash, ativo, criado_em, criado_por) VALUES (?, ?, ?, ?, 1, ?, ?)`
    ).run(nome, cargo, pin ? hashSegredo(pin, config.pepper) : null, senha ? hashSegredo(senha, config.pepper) : null, agoraISO(), adminExecutor.id);
    registrar(db, { usuarioId: adminExecutor.id, acao: 'usuario_criado', entidade: 'usuario', entidadeId: Number(info.lastInsertRowid), detalhes: { nome, cargo }, ip });
    return { id: Number(info.lastInsertRowid), nome, cargo };
  });
}

export function alterarCredenciais(db, adminExecutor, usuarioId, body, ip) {
  const alvo = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(usuarioId);
  if (!alvo) throw erro.naoEncontrado('Usuário não encontrado.');
  // Anti-escalada: só um Administrador edita/desativa/reseta/deleta credenciais
  // de outra conta Administrador.
  if (alvo.cargo === 'admin') exigirAdminDoSistema(adminExecutor);
  // Anti-escalada: elevar qualquer usuário ao cargo admin exige ser Administrador
  // (defensivo — hoje o cargo não é alterado por esta rota).
  if (body?.cargo !== undefined && body.cargo !== alvo.cargo && body.cargo === 'admin') {
    exigirAdminDoSistema(adminExecutor);
  }
  const pin = typeof body?.pin === 'string' && body.pin !== '' ? body.pin : null;
  const senha = typeof body?.senha === 'string' && body.senha !== '' ? body.senha : null;
  const ativo = body?.ativo === undefined ? undefined : (body.ativo ? 1 : 0);
  if (pin && !pinValido(pin)) throw erro.validacao('PIN deve ter 4 a 6 dígitos.');
  if (senha && !senhaForte(senha)) throw erro.validacao('Senha forte obrigatória: mínimo 10 caracteres com letras e números.');

  return transacao(db, () => {
    if (pin) db.prepare('UPDATE usuarios SET pin_hash = ? WHERE id = ?').run(hashSegredo(pin, config.pepper), usuarioId);
    if (senha) db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(hashSegredo(senha, config.pepper), usuarioId);
    if (ativo !== undefined) {
      if (alvo.id === adminExecutor.id && ativo === 0) throw erro.validacao('Você não pode desativar a si mesmo.');
      db.prepare('UPDATE usuarios SET ativo = ? WHERE id = ?').run(ativo, usuarioId);
      if (ativo === 0) revogarTodasDoUsuario(db, usuarioId);
    }
    registrar(db, {
      usuarioId: adminExecutor.id, acao: 'usuario_credenciais_alteradas', entidade: 'usuario', entidadeId: usuarioId,
      detalhes: { pin_alterado: !!pin, senha_alterada: !!senha, ativo: ativo ?? undefined }, ip,
    });
    return { ok: true };
  });
}


// ---------- Matriz de permissões por cargo (liberação de funções) ----------
export const FLAGS_PERMISSAO = [
  'pode_vender_balcao', 'pode_dividir_pagar', 'pode_abrir_fechar_caixa',
  'pode_sangria_suprimento', 'pode_cancelar_item', 'pode_lancar_comanda',
  'pode_ver_kds', 'pode_avancar_kds', 'pode_gerenciar_produtos',
  'pode_gerenciar_usuarios', 'pode_ver_relatorios', 'pode_gerenciar_mesas',
  'pode_desconto', 'pode_estoque_gerenciar', 'pode_config_sistema',
  'pode_backup', 'pode_gerenciar_combos', 'pode_brinde',
  'pode_fazer_checkin', 'pode_gerenciar_taxa_servico', 'pode_painel_dev',
];

export const ROTULOS_PERMISSAO = {
  pode_vender_balcao: 'Vender no balcão (PDV)',
  pode_dividir_pagar: 'Receber/dividir pagamentos e fechar',
  pode_abrir_fechar_caixa: 'Abrir e fechar turno de caixa',
  pode_sangria_suprimento: 'Sangria/suprimento (c/ autorização)',
  pode_cancelar_item: 'Cancelar itens',
  pode_lancar_comanda: 'Lançar comandas de mesa',
  pode_ver_kds: 'Ver a cozinha (KDS)',
  pode_avancar_kds: 'Avançar etapas no KDS',
  pode_gerenciar_produtos: 'Cadastrar produtos/preços',
  pode_gerenciar_usuarios: 'Gerenciar funcionários',
  pode_ver_relatorios: 'Ver relatórios gerenciais',
  pode_gerenciar_mesas: 'Gerenciar mesas',
  pode_desconto: 'Aplicar descontos',
  pode_estoque_gerenciar: 'Gerenciar estoque',
  pode_config_sistema: 'Configurações do sistema',
  pode_backup: 'Backups',
  pode_gerenciar_combos: 'Gerenciar combos/promoções',
  pode_brinde: 'Dar cortesia/brinde',
  pode_fazer_checkin: 'Check-in de cliente',
  pode_gerenciar_taxa_servico: 'Configurar taxa de serviço',
  pode_painel_dev: 'Painel do desenvolvedor (Suporte técnico)',
};

export function matrizPermissoes(db) {
  return db.prepare('SELECT * FROM permissoes ORDER BY cargo').all();
}

// Salva a matriz inteira. Travas de segurança:
//  - o cargo admin nunca pode perder pode_config_sistema nem pode_gerenciar_usuarios
//    (evita lockout total);
//  - pode_painel_dev NÃO é editável pela matriz: é ignorado na entrada e forçado
//    ao seu valor canônico (admin = 1, todos os demais = 0). Assim o Proprietário
//    nunca consegue escalar para o painel dev e o admin nunca perde o dele.
export function salvarMatriz(db, adminExecutor, matriz, ip) {
  const cargos = ['admin', 'proprietario', 'caixa', 'garcom', 'cozinha'];
  const entrada = matriz ?? {};
  return transacao(db, () => {
    for (const cargo of cargos) {
      const flags = entrada[cargo] ?? {};
      const valores = {};
      for (const flag of FLAGS_PERMISSAO) {
        if (flag === 'pode_painel_dev') continue; // fora da matriz editável (ver abaixo)
        if (!(flag in flags)) continue;
        const v = flags[flag];
        if (v !== 0 && v !== 1 && v !== false && v !== true) {
          throw erro.validacao(`Valor inválido para ${flag} (${cargo}).`);
        }
        valores[flag] = v ? 1 : 0;
      }
      if (cargo === 'admin') {
        if ('pode_config_sistema' in valores && !valores.pode_config_sistema) {
          throw erro.validacao('O admin não pode perder "Configurações do sistema" (trava anti-bloqueio).');
        }
        if ('pode_gerenciar_usuarios' in valores && !valores.pode_gerenciar_usuarios) {
          throw erro.validacao('O admin não pode perder "Gerenciar funcionários" (trava anti-bloqueio).');
        }
      }
      const sets = Object.entries(valores);
      if (!sets.length) continue;
      db.prepare(`UPDATE permissoes SET ${sets.map(([f]) => `${f} = ?`).join(', ')} WHERE cargo = ?`)
        .run(...sets.map(([, v]) => v), cargo);
    }
    // Invariantes do painel dev (não editável por nenhum cargo da matriz).
    db.prepare(`UPDATE permissoes SET pode_painel_dev = 0 WHERE cargo != 'admin'`).run();
    db.prepare(`UPDATE permissoes SET pode_painel_dev = 1 WHERE cargo = 'admin'`).run();
    registrar(db, { usuarioId: adminExecutor.id, acao: 'permissoes_alteradas', detalhes: { por: adminExecutor.nome }, ip });
    return matrizPermissoes(db);
  });
}

export function desbloquearUsuario(db, adminExecutor, usuarioId, ip) {
  const alvo = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(usuarioId);
  if (!alvo) throw erro.naoEncontrado('Usuário não encontrado.');
  // Anti-escalada: só um Administrador desbloqueia uma conta Administrador.
  if (alvo.cargo === 'admin') exigirAdminDoSistema(adminExecutor);
  limparFalhas(db, usuarioId);
  registrar(db, { usuarioId: adminExecutor.id, acao: 'usuario_desbloqueado', entidade: 'usuario', entidadeId: usuarioId, detalhes: { nome: alvo.nome }, ip });
  return { ok: true };
}

// ---------- Excluir usuário (painel dev — Suporte técnico) ----------
// Exclusão LÓGICA: o usuário sai do sistema na hora (não loga mais, sessões caem,
// sai da lista de ativos) e o NOME volta a ficar livre para recadastro. O registro
// permanece no banco porque pedidos, caixa e auditoria apontam para ele — apagar a
// linha quebraria FKs e o histórico append-only.
export function excluirUsuario(db, adminExecutor, usuarioId, ip) {
  const alvo = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(Number(usuarioId));
  if (!alvo) throw erro.naoEncontrado('Usuário não encontrado.');
  if (!alvo.ativo) throw erro.conflito('409_CONFLITO_ESTADO', 'Este usuário já está excluído/desativado.');
  if (alvo.id === adminExecutor.id) throw erro.validacao('Você não pode excluir a própria conta.');
  // Anti-escalada: só um Administrador exclui uma conta Administrador.
  if (alvo.cargo === 'admin') {
    exigirAdminDoSistema(adminExecutor);
    const outros = db.prepare(
      `SELECT COUNT(*) AS n FROM usuarios WHERE cargo = 'admin' AND ativo = 1 AND id != ?`
    ).get(alvo.id).n;
    if (outros === 0) throw erro.validacao('O sistema precisa de pelo menos um Administrador ativo.');
  }
  return transacao(db, () => {
    // Libera o nome (UNIQUE COLLATE NOCASE) sem perder o vínculo histórico.
    db.prepare(`UPDATE usuarios SET ativo = 0, nome = nome || ' (excluído ' || id || ')' WHERE id = ?`).run(alvo.id);
    revogarTodasDoUsuario(db, alvo.id);
    registrar(db, {
      usuarioId: adminExecutor.id, acao: 'usuario_excluido', entidade: 'usuario', entidadeId: alvo.id,
      detalhes: { nome: alvo.nome, cargo: alvo.cargo }, ip,
    });
    return { ok: true, id: alvo.id, nome: alvo.nome, cargo: alvo.cargo };
  });
}

// Desfaz a exclusão lógica (Suporte técnico → Usuários): volta o acesso e o nome
// original — que precisa estar livre (o login só é liberado na exclusão, então
// pode ter sido recadastrado por outra pessoa nesse meio-tempo).
export function restaurarUsuario(db, adminExecutor, usuarioId, ip) {
  const alvo = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(Number(usuarioId));
  if (!alvo) throw erro.naoEncontrado('Usuário não encontrado.');
  if (alvo.ativo) throw erro.conflito('409_CONFLITO_ESTADO', 'Este usuário já está ativo.');
  // Anti-escalada: só um Administrador restaura uma conta Administrador.
  if (alvo.cargo === 'admin') exigirAdminDoSistema(adminExecutor);
  const original = String(alvo.nome).replace(/\s*\(excluído \d+\)$/i, '').trim() || alvo.nome;
  const ocupado = db.prepare('SELECT id FROM usuarios WHERE nome = ? AND id != ?').get(original, alvo.id);
  if (ocupado) {
    throw erro.conflito('409_CONFLITO_ESTADO', `O nome "${original}" já está em uso por outro usuário — renomeie a conta nova antes de restaurar.`);
  }
  return transacao(db, () => {
    db.prepare('UPDATE usuarios SET ativo = 1, nome = ?, falhas_login = 0, bloqueado_ate = NULL WHERE id = ?').run(original, alvo.id);
    registrar(db, {
      usuarioId: adminExecutor.id, acao: 'usuario_restaurado', entidade: 'usuario', entidadeId: alvo.id,
      detalhes: { nome: original, cargo: alvo.cargo }, ip,
    });
    return { ok: true, id: alvo.id, nome: original };
  });
}

// ---------- Sessões ativas (1.3.1) ----------
// Controle de usuários logados: quem está conectado agora (Web ou celular/APK),
// de qual IP e qual foi a última atividade, com desconexão individual.

// Classifica a origem pelo User-Agent informado pelo cliente no login.
export function rotuloDispositivo(userAgent) {
  const ua = String(userAgent ?? '');
  if (!ua) return 'Desconhecido';
  if (/mercury[-_ ]?apk|cordova|capacitor/i.test(ua)) return 'APK Mobile';
  if (/android|iphone|ipad|ipod|mobile/i.test(ua)) return 'Celular (navegador)';
  return 'Web (computador)';
}

export function listarSessoes(db, { sessaoIdAtual = null, inatividadeMin = 30 } = {}) {
  const limiteInatividade = Date.now() - inatividadeMin * 60_000;
  const linhas = db.prepare(
    `SELECT s.id, s.usuario_id, u.nome, u.cargo, u.ativo, s.criado_em, s.ultimo_uso, s.expira_em, s.ip, s.user_agent
     FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
     WHERE s.revogada = 0 AND s.expira_em > ?
     ORDER BY s.ultimo_uso DESC LIMIT 200`
  ).all(new Date().toISOString());
  return linhas
    .filter((s) => new Date(s.ultimo_uso).getTime() >= limiteInatividade)
    .map((s) => ({
      id: s.id,
      usuario_id: s.usuario_id,
      nome: s.nome,
      cargo: s.cargo,
      ativo: s.ativo,
      origem: rotuloDispositivo(s.user_agent),
      ip: s.ip,
      criado_em: s.criado_em,
      ultimo_uso: s.ultimo_uso,
      expira_em: s.expira_em,
      atual: s.id === sessaoIdAtual,
    }));
}

export function desconectarSessao(db, adminExecutor, sessaoId, ip, { sessaoIdAtual = null } = {}) {
  const s = db.prepare(
    `SELECT s.*, u.nome AS usuario_nome, u.cargo AS usuario_cargo
     FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id WHERE s.id = ?`
  ).get(String(sessaoId));
  if (!s || s.revogada) throw erro.naoEncontrado('Sessão não encontrada (ou já encerrada).');
  if (sessaoIdAtual && s.id === sessaoIdAtual) {
    throw erro.validacao('Use "Sair" para encerrar a sua própria sessão.');
  }
  // Anti-escalada: só um Administrador derruba a sessão de um Administrador
  // (o Proprietário não pode "expulsar" o admin do sistema).
  if (s.usuario_cargo === 'admin') exigirAdminDoSistema(adminExecutor);
  return transacao(db, () => {
    db.prepare('UPDATE sessoes SET revogada = 1 WHERE id = ?').run(s.id);
    registrar(db, {
      usuarioId: adminExecutor.id, acao: 'sessao_desconectada', entidade: 'sessao', entidadeId: s.id,
      detalhes: { usuario_alvo: s.usuario_nome, ip_alvo: s.ip }, ip,
    });
    return { ok: true, usuario: s.usuario_nome };
  });
}
