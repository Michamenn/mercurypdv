import { Router, json } from 'express';
import fs from 'node:fs';
import nodeCrypto from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ROOT } from '../config.js';
import { erro, handlerErros } from '../core/errors.js';
import { autenticar, exigirPerm, guardaMutacao, verificarStepUpAdmin } from '../auth/rbac.js';
import { ehGestao } from '../auth/cargos.js';
import { limitarIP } from '../auth/ratelimit.js';
import { criarSessao, revogarSessao, setCookieSessao, limparCookieSessao } from '../auth/sessions.js';
import { login, criarPrimeiroAdmin, quantidadeUsuarios, autorizarAdmin, listarUsuarios, criarUsuario, alterarCredenciais, excluirUsuario, restaurarUsuario, matrizPermissoes, salvarMatriz, desbloquearUsuario, listarSessoes, desconectarSessao, ROTULOS_PERMISSAO } from '../services/usuariosService.js';
import * as caixa from '../services/caixaService.js';
import * as pedidos from '../services/pedidosService.js';
import * as estoque from '../services/estoqueService.js';
import * as catalogo from '../services/catalogoService.js';
import * as combos from '../services/combosService.js';
import * as promocoes from '../services/promocoesService.js';
import * as relatorios from '../services/relatoriosService.js';
import * as recibos from '../services/recibosService.js';
import * as salao from '../services/salaoService.js';
import * as configService from '../services/configService.js';
import * as notificacoes from '../services/notificacoesService.js';
import * as impressoras from '../services/impressorasService.js';
import { listarBackups, criarBackup } from '../tools/backup.js';
import { registrar, consultar as consultarAuditoria } from '../core/audit.js';

// Fábrica de rotas: recebe dependências (db, hub, crypto, config) para testes isolados.
export function criarRouter({ db, hub, crypto, pepper, configApp, logger }) {
  const r = Router();
  r.use(json({ limit: '64mb' }));

  // 1.3.1 — IP do cliente disponível em TODAS as rotas (login/setup também),
  // para gravar origem nas sessões ativas e na auditoria. Antes só existia
  // após o middleware `autenticar`, e o IP nunca era salvo no login.
  r.use((req, _res, next) => {
    req.ipCliente = req.ip || req.socket?.remoteAddress || null;
    next();
  });

  const auth = autenticar(db);
  const perm = (flag) => exigirPerm(db, flag);

  // ---------- Auth ----------
  r.get('/auth/status', (_req, res) => {
    const cfg = configService.obterTodas(db);
    res.json({ setup_necessario: quantidadeUsuarios(db) === 0, empresa_nome: cfg.empresa_nome, logo_path: cfg.logo_path ?? '' });
  });

  // Lista de operadores ativos para o PIN pad (sem hashes nem credenciais).
  r.get('/auth/operadores', (_req, res) => {
    const usuarios = db.prepare(
      `SELECT nome, cargo, (pin_hash IS NOT NULL) AS tem_pin FROM usuarios WHERE ativo = 1 ORDER BY nome`
    ).all();
    res.json({ usuarios });
  });

  r.post('/auth/setup', limitarIP, (req, res, next) => {
    try {
      const usuario = criarPrimeiroAdmin(db, req.body, req.ipCliente);
      const sessao = criarSessao(db, usuario.id, req.ipCliente, req.headers['user-agent']);
      setCookieSessao(res, sessao.token, sessao.expiraEm);
      res.status(201).json({ usuario, permissoes: db.prepare('SELECT * FROM permissoes WHERE cargo = ?').get('admin') });
    } catch (e) { next(e); }
  });

  r.post('/auth/login', limitarIP, (req, res, next) => {
    try {
      const resultado = login(db, req.body, req.ipCliente, req.headers['user-agent']);
      setCookieSessao(res, resultado.token, resultado.expira_em);
      delete resultado.token; // cookie httpOnly é o canal do token
      res.json(resultado);
    } catch (e) { next(e); }
  });

  r.post('/auth/logout', auth, guardaMutacao, (req, res) => {
    revogarSessao(db, req.sessaoId);
    limparCookieSessao(res);
    registrar(db, { usuarioId: req.usuario.id, acao: 'logout', ip: req.ipCliente });
    res.json({ ok: true });
  });

  r.get('/auth/me', auth, (req, res) => {
    const perms = db.prepare('SELECT * FROM permissoes WHERE cargo = ?').get(req.usuario.cargo) ?? {};
    const cfg = configService.obterTodas(db);
    res.json({ usuario: req.usuario, permissoes: perms, config_publica: {
      empresa_nome: cfg.empresa_nome,
      bloquear_apos_venda: cfg.bloquear_apos_venda === '1',
      tema_padrao: cfg.tema_padrao,
      fonte_padrao: cfg.fonte_padrao,
      densidade_padrao: cfg.densidade_padrao,
      cor_acao: cfg.cor_acao,
      cor_ok: cfg.cor_ok,
      cor_alerta: cfg.cor_alerta,
      cor_amarelo: cfg.cor_amarelo,
      nav_posicao_padrao: cfg.nav_posicao_padrao,
      logo_path: cfg.logo_path ?? '',
    } });
  });

  // Step-up admin (para o frontend obter autorização antes de operações sensíveis)
  r.post('/auth/autorizar-admin', auth, guardaMutacao, (req, res, next) => {
    try {
      const adminId = autorizarAdmin(db, req.body, req.ipCliente);
      res.json({ autorizado: true, admin_id: adminId });
    } catch (e) { next(e); }
  });

  // ---------- Usuários (admin) ----------
  // Usuários ATIVOS: quem foi excluído/desativado sai da tela (Pessoas → Usuários).
  // O histórico completo (inclusive excluídos) fica no painel dev → Suporte técnico → Usuários.
  r.get('/usuarios', auth, perm('pode_gerenciar_usuarios'), (_req, res) => res.json(listarUsuarios(db).filter((u) => u.ativo)));
  r.post('/usuarios', auth, guardaMutacao, perm('pode_gerenciar_usuarios'), (req, res, next) => {
    try { res.status(201).json(criarUsuario(db, req.usuario, req.body, req.ipCliente)); } catch (e) { next(e); }
  });
  r.post('/usuarios/:id/credenciais', auth, guardaMutacao, perm('pode_gerenciar_usuarios'), (req, res, next) => {
    try { res.json(alterarCredenciais(db, req.usuario, Number(req.params.id), req.body, req.ipCliente)); } catch (e) { next(e); }
  });
  r.post('/usuarios/:id/desbloquear', auth, guardaMutacao, perm('pode_gerenciar_usuarios'), (req, res, next) => {
    try { res.json(desbloquearUsuario(db, req.usuario, Number(req.params.id), req.ipCliente)); } catch (e) { next(e); }
  });
  // ---------- Sessões ativas & dispositivos (1.3.1) ----------
  // Controle de usuários logados (Web, celular e APK), IP e última atividade.
  r.get('/sessoes', auth, perm('pode_gerenciar_usuarios'), (req, res) => {
    const inatividade = configApp.sessaoInatividadeMin ?? 30;
    const itens = listarSessoes(db, { sessaoIdAtual: req.sessaoId, inatividadeMin: inatividade });
    // Marca as sessões cujo dono tem um socket WS vivo agora (sincronização em tempo real)
    const sockets = hub.clientes();
    for (const s of itens) {
      s.online = sockets.some((c) => c.usuario === s.nome);
    }
    res.json({ sessoes: itens, online_agora: sockets.length, sockets });
  });
  r.post('/sessoes/:id/desconectar', auth, guardaMutacao, perm('pode_gerenciar_usuarios'), (req, res, next) => {
    try {
      const r = desconectarSessao(db, req.usuario, req.params.id, req.ipCliente, { sessaoIdAtual: req.sessaoId });
      hub.encerrarSessao(req.params.id); // derruba o socket na hora
      res.json(r);
    } catch (e) { next(e); }
  });

  // Dispositivos conectados via WebSocket agora (sincronização em tempo real).
  // Qualquer autenticado vê o total; o detalhe exige gerenciar usuários.
  r.get('/dispositivos', auth, (req, res) => {
    const p = db.prepare('SELECT pode_gerenciar_usuarios FROM permissoes WHERE cargo = ?').get(req.usuario.cargo);
    const saida = { total: hub.totalClientes() };
    if (p?.pode_gerenciar_usuarios) saida.itens = hub.clientes();
    res.json(saida);
  });

  // Matriz de permissões por cargo (liberação de funções)
  r.get('/permissoes', auth, perm('pode_config_sistema'), (_req, res) => {
    res.json({ flags: matrizPermissoes(db), rotulos: ROTULOS_PERMISSAO });
  });
  r.put('/permissoes', auth, guardaMutacao, perm('pode_config_sistema'), (req, res, next) => {
    try { res.json({ flags: salvarMatriz(db, req.usuario, req.body?.matriz, req.ipCliente) }); } catch (e) { next(e); }
  });

  // ---------- Catálogo ----------
  r.get('/catalogo', auth, (_req, res) => {
    res.json({
      categorias: catalogo.listarCategorias(db),
      produtos: catalogo.listarProdutos(db),
      adicionais: catalogo.listarAdicionais(db),
    });
  });
  r.post('/categorias', auth, guardaMutacao, perm('pode_gerenciar_produtos'), (req, res, next) => {
    try { res.status(201).json(catalogo.criarCategoria(db, req.usuario, req.body, req.ipCliente)); } catch (e) { next(e); }
  });
  r.post('/produtos', auth, guardaMutacao, perm('pode_gerenciar_produtos'), (req, res, next) => {
    try { res.status(201).json(catalogo.salvarProduto(db, req.usuario, req.body, null, req.ipCliente)); } catch (e) { next(e); }
  });
  r.put('/produtos/:id', auth, guardaMutacao, perm('pode_gerenciar_produtos'), (req, res, next) => {
    try { res.json(catalogo.salvarProduto(db, req.usuario, req.body, Number(req.params.id), req.ipCliente)); } catch (e) { next(e); }
  });
  r.post('/adicionais', auth, guardaMutacao, perm('pode_gerenciar_produtos'), (req, res, next) => {
    try { res.status(201).json(catalogo.criarAdicional(db, req.usuario, req.body, req.ipCliente)); } catch (e) { next(e); }
  });
  r.put('/produtos/:id/adicionais', auth, guardaMutacao, perm('pode_gerenciar_produtos'), (req, res, next) => {
    try { res.json(catalogo.vincularAdicionais(db, req.usuario, Number(req.params.id), req.body?.adicional_ids, req.ipCliente)); } catch (e) { next(e); }
  });
  // ---------- Cardápio inteligente (A1) ----------
  r.get('/catalogo/mais-vendidos', auth, (req, res, next) => {
    try {
      res.json(catalogo.topVendidos(db, {
        dias: req.query.dias === undefined ? 30 : Number(req.query.dias),
        limite: req.query.limite === undefined ? 8 : Number(req.query.limite),
      }));
    } catch (e) { next(e); }
  });
  r.get('/produtos/:id/variacoes', auth, (req, res) => res.json(catalogo.listarVariacoes(db, Number(req.params.id))));
  r.post('/produtos/:id/variacoes', auth, guardaMutacao, perm('pode_gerenciar_produtos'), (req, res, next) => {
    try { res.status(201).json(catalogo.salvarVariacao(db, req.usuario, Number(req.params.id), req.body, null, req.ipCliente)); } catch (e) { next(e); }
  });
  r.put('/variacoes/:id', auth, guardaMutacao, perm('pode_gerenciar_produtos'), (req, res, next) => {
    try {
      const v = db.prepare('SELECT produto_id FROM produto_variacoes WHERE id = ?').get(Number(req.params.id));
      if (!v) throw erro.naoEncontrado('Variação não encontrada.');
      res.json(catalogo.salvarVariacao(db, req.usuario, v.produto_id, req.body, Number(req.params.id), req.ipCliente));
    } catch (e) { next(e); }
  });
  r.get('/produtos/:id/precos', auth, perm('pode_gerenciar_produtos'), (req, res) => {
    res.json(catalogo.historicoPrecos(db, Number(req.params.id)));
  });
  r.post('/produtos/:id/preco-programado', auth, guardaMutacao, perm('pode_gerenciar_produtos'), (req, res, next) => {
    try { res.status(201).json(catalogo.programarPreco(db, req.usuario, Number(req.params.id), req.body, req.ipCliente)); } catch (e) { next(e); }
  });
  r.get('/periodos', auth, (req, res) => res.json(catalogo.listarPeriodos(db)));
  r.post('/periodos', auth, guardaMutacao, perm('pode_gerenciar_produtos'), (req, res, next) => {
    try { res.status(201).json(catalogo.salvarPeriodo(db, req.usuario, req.body, null, req.ipCliente)); } catch (e) { next(e); }
  });
  r.put('/periodos/:id', auth, guardaMutacao, perm('pode_gerenciar_produtos'), (req, res, next) => {
    try { res.json(catalogo.salvarPeriodo(db, req.usuario, req.body, Number(req.params.id), req.ipCliente)); } catch (e) { next(e); }
  });
  r.delete('/periodos/:id', auth, guardaMutacao, perm('pode_gerenciar_produtos'), (req, res, next) => {
    try { res.json(catalogo.removerPeriodo(db, req.usuario, Number(req.params.id), req.ipCliente)); } catch (e) { next(e); }
  });
  r.put('/produtos/:id/periodos', auth, guardaMutacao, perm('pode_gerenciar_produtos'), (req, res, next) => {
    try { res.json(catalogo.vincularPeriodos(db, req.usuario, Number(req.params.id), req.body?.periodo_ids, req.ipCliente)); } catch (e) { next(e); }
  });
  // ---------- Promoções por produto ----------
  r.get('/promocoes-produto', auth, (req, res) => {
    res.json(promocoes.listarPromocoes(db, req.query.produto_id ? Number(req.query.produto_id) : null));
  });
  r.post('/promocoes-produto', auth, guardaMutacao, perm('pode_gerenciar_combos'), (req, res, next) => {
    try { res.status(201).json(promocoes.criarPromocao(db, req.usuario, req.body, req.ipCliente)); } catch (e) { next(e); }
  });
  r.put('/promocoes-produto/:id', auth, guardaMutacao, perm('pode_gerenciar_combos'), (req, res, next) => {
    try { res.json(promocoes.atualizarPromocao(db, req.usuario, Number(req.params.id), req.body, req.ipCliente)); } catch (e) { next(e); }
  });
  r.delete('/promocoes-produto/:id', auth, guardaMutacao, perm('pode_gerenciar_combos'), (req, res, next) => {
    try { res.json(promocoes.removerPromocao(db, req.usuario, Number(req.params.id), req.ipCliente)); } catch (e) { next(e); }
  });
  r.put('/produtos/:id/ficha', auth, guardaMutacao, perm('pode_estoque_gerenciar'), (req, res, next) => {
    try { res.json(estoque.fichaSalvar(db, req.usuario, Number(req.params.id), req.body?.itens, req.ipCliente)); } catch (e) { next(e); }
  });
  r.get('/produtos/:id/ficha', auth, perm('pode_gerenciar_produtos'), (req, res) => {
    res.json(estoque.listarFicha(db, Number(req.params.id)));
  });

  // ---------- Combos/Promoções ----------
  r.get('/combos', auth, (_req, res) => res.json(combos.listarCombos(db)));
  r.get('/combos/vigentes', auth, (_req, res) => {
    const agora = new Date();
    const iso = agora.toISOString();
    const dia = agora.getDay();
    const hhmm = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
    const vigentes = db.prepare(`
      SELECT * FROM combos WHERE ativo = 1
        AND (valido_de IS NULL OR valido_de <= ?)
        AND (valido_ate IS NULL OR valido_ate >= ?)
        AND (limite_usos IS NULL OR usos < limite_usos)
      ORDER BY nome
    `).all(iso, iso).filter((c) => {
      const dias = String(c.dias_semana ?? '0,1,2,3,4,5,6').split(',').map((d) => Number(d.trim()));
      if (!dias.includes(dia)) return false;
      if (c.hora_ini && c.hora_fim && !(c.hora_ini <= hhmm && hhmm < c.hora_fim)) return false;
      return true;
    });
    for (const c of vigentes) {
      c.itens = db.prepare(`
        SELECT ci.*, p.nome AS produto_nome, p.preco_centavos AS produto_preco, p.ativo AS produto_ativo, p.area AS produto_area
        FROM combo_itens ci JOIN produtos p ON p.id = ci.produto_id
        WHERE ci.combo_id = ? ORDER BY ci.obrigatorio DESC, ci.grupo_escolha, p.nome
      `).all(c.id);
    }
    res.json({ combos: vigentes });
  });
  r.get('/combos/:id', auth, (req, res, next) => {
    try { res.json(combos.obterCombo(db, Number(req.params.id))); } catch (e) { next(e); }
  });
  r.post('/combos', auth, guardaMutacao, perm('pode_gerenciar_combos'), (req, res, next) => {
    try { res.status(201).json(combos.criarCombo(db, req.usuario, req.body, req.ipCliente)); } catch (e) { next(e); }
  });
  r.put('/combos/:id', auth, guardaMutacao, perm('pode_gerenciar_combos'), (req, res, next) => {
    try { res.json(combos.atualizarCombo(db, req.usuario, Number(req.params.id), req.body, req.ipCliente)); } catch (e) { next(e); }
  });
  r.post('/combos/:id/toggle', auth, guardaMutacao, perm('pode_gerenciar_combos'), (req, res, next) => {
    try { res.json(combos.toggleComboAtivo(db, req.usuario, Number(req.params.id), req.ipCliente)); } catch (e) { next(e); }
  });
  r.delete('/combos/:id', auth, guardaMutacao, perm('pode_gerenciar_combos'), (req, res, next) => {
    try { res.json(combos.removerCombo(db, req.usuario, Number(req.params.id), req.ipCliente)); } catch (e) { next(e); }
  });
  r.post('/combos/:id/validar-estoque', auth, (req, res, next) => {
    try { res.json({ alertas: combos.verificarEstoqueCombo(db, Number(req.params.id)) }); } catch (e) { next(e); }
  });
  r.post('/pedidos/:id/aplicar-combo', auth, guardaMutacao, (req, res, next) => {
    try {
      const p = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(Number(req.params.id));
      if (!p) throw erro.naoEncontrado('Pedido não encontrado.');
      if (p.tipo === 'balcao' && !(ehGestao(req.usuario.cargo) || req.usuario.cargo === 'caixa')) throw erro.permissao();
      if (p.tipo === 'mesa' && !exigePermLancarComanda(db, req.usuario)) throw erro.permissao();
      const comboId = Number(req.body?.combo_id);
      if (!comboId) throw erro.validacao('combo_id obrigatório.');
      const combo = db.prepare('SELECT * FROM combos WHERE id = ?').get(comboId);
      if (!combo) throw erro.naoEncontrado('Combo não encontrado.');
      const key = req.headers['idempotency-key'] ?? req.body?.idempotency_key ?? null;
      const resultado = combos.aplicarComboAPedido(db, p, combo, {
        escolhas: req.body?.escolhas ?? [],
        somenteDesconto: req.body?.somente_desconto === true,
        usuario: req.usuario,
        ip: req.ipCliente,
        hub,
        idempotencyKey: key ? String(key).slice(0, 100) : null,
      });
      res.status(resultado.idempotente ? 200 : 201).json(resultado);
    } catch (e) { next(e); }
  });

  // ---------- Mesas ----------
  r.get('/mesas', auth, (_req, res) => res.json(catalogo.listarMesas(db)));
  r.post('/mesas', auth, guardaMutacao, perm('pode_gerenciar_mesas'), (req, res, next) => {
    try { res.status(201).json(catalogo.salvarMesa(db, req.usuario, req.body, null, req.ipCliente)); } catch (e) { next(e); }
  });
  r.put('/mesas/:id', auth, guardaMutacao, perm('pode_gerenciar_mesas'), (req, res, next) => {
    try { res.json(catalogo.salvarMesa(db, req.usuario, req.body, Number(req.params.id), req.ipCliente)); } catch (e) { next(e); }
  });
  r.delete('/mesas/:id', auth, guardaMutacao, perm('pode_gerenciar_mesas'), (req, res, next) => {
    try { res.json(catalogo.removerMesa(db, req.usuario, Number(req.params.id), req.ipCliente)); } catch (e) { next(e); }
  });
  r.post('/mesas/:id/comanda', auth, guardaMutacao, perm('pode_lancar_comanda'), (req, res, next) => {
    try {
      res.status(201).json(pedidos.abrirComanda(db, req.usuario, Number(req.params.id), req.body?.cliente, req.ipCliente, hub, {
        canal: req.body?.canal,
        observacao: req.body?.observacao,
        individual: req.body?.individual === true || req.body?.individual === 1,
        cliente_id: req.body?.cliente_id,
      }));
    } catch (e) { next(e); }
  });
  r.post('/mesas/:id/bloqueio', auth, guardaMutacao, perm('pode_gerenciar_mesas'), (req, res, next) => {
    try { res.json(catalogo.bloquearMesa(db, req.usuario, Number(req.params.id), req.body, req.ipCliente)); } catch (e) { next(e); }
  });
  r.post('/mesas/:id/chamar', auth, guardaMutacao, (req, res, next) => {
    try {
      const perms = db.prepare('SELECT pode_lancar_comanda FROM permissoes WHERE cargo = ?').get(req.usuario.cargo);
      if (!perms?.pode_lancar_comanda && !ehGestao(req.usuario.cargo)) throw erro.permissao();
      res.status(201).json(catalogo.chamarGarcom(db, req.usuario, Number(req.params.id), req.body, req.ipCliente, hub));
    } catch (e) { next(e); }
  });

  // ---------- Salão Pro: mapa, layout, movimentação e comissão ----------
  r.get('/salao/mapa', auth, (_req, res) => res.json(salao.mapaSalao(db)));
  r.get('/salao/mesas/:id', auth, (req, res, next) => {
    try { res.json(salao.detalheMesa(db, Number(req.params.id))); } catch (e) { next(e); }
  });
  r.put('/salao/layout', auth, guardaMutacao, perm('pode_gerenciar_mesas'), (req, res, next) => {
    try { res.json(salao.salvarLayout(db, req.usuario, req.body, req.ipCliente)); } catch (e) { next(e); }
  });
  r.post('/salao/transferir', auth, guardaMutacao, perm('pode_gerenciar_mesas'), (req, res, next) => {
    try {
      res.json(salao.transferirMesa(db, req.usuario, Number(req.body?.origem_id), Number(req.body?.destino_id), req.ipCliente, hub, req.body?.motivo));
    } catch (e) { next(e); }
  });
  r.post('/salao/juntar', auth, guardaMutacao, perm('pode_gerenciar_mesas'), (req, res, next) => {
    try {
      res.json(salao.juntarMesas(db, req.usuario, req.body?.mesa_ids, Number(req.body?.destino_id), req.ipCliente, hub, req.body?.motivo));
    } catch (e) { next(e); }
  });
  r.get('/salao/comissoes', auth, perm('pode_ver_relatorios'), (req, res, next) => {
    try { res.json(salao.comissoes(db, req.query.de ?? null, req.query.ate ?? null)); } catch (e) { next(e); }
  });

  // ---------- Check-in de cliente ----------
  r.get('/clientes', auth, perm('pode_fazer_checkin'), (req, res, next) => {
    try { res.json(salao.buscarClientes(db, req.query.q ?? '', Number(req.query.limite) || 20)); } catch (e) { next(e); }
  });
  r.post('/clientes', auth, guardaMutacao, perm('pode_fazer_checkin'), (req, res, next) => {
    try { res.status(201).json(salao.criarCliente(db, req.usuario, req.body, req.ipCliente)); } catch (e) { next(e); }
  });

  // ---------- Atendente, gorjeta e taxa ----------
  r.post('/pedidos/:id/atendente', auth, guardaMutacao, (req, res, next) => {
    try {
      const perms = db.prepare('SELECT pode_lancar_comanda, pode_gerenciar_usuarios FROM permissoes WHERE cargo = ?').get(req.usuario.cargo);
      if (!perms?.pode_lancar_comanda && !perms?.pode_gerenciar_usuarios && !ehGestao(req.usuario.cargo)) {
        throw erro.permissao('Vincular atendente requer permissão de comandas.');
      }
      res.json(salao.definirAtendente(db, req.usuario, Number(req.params.id), req.body?.atendente_id, req.ipCliente, hub));
    } catch (e) { next(e); }
  });
  r.post('/pedidos/:id/gorjeta', auth, guardaMutacao, perm('pode_dividir_pagar'), (req, res, next) => {
    try { res.status(201).json(salao.registrarGorjeta(db, req.usuario, Number(req.params.id), req.body, req.ipCliente, hub)); } catch (e) { next(e); }
  });
  r.get('/chamados', auth, (req, res, next) => {
    try {
      const perms = db.prepare('SELECT pode_lancar_comanda FROM permissoes WHERE cargo = ?').get(req.usuario.cargo);
      if (!perms?.pode_lancar_comanda && !perms?.pode_avancar_kds && !ehGestao(req.usuario.cargo) && req.usuario.cargo !== 'caixa') throw erro.permissao();
      res.json(catalogo.listarChamados(db));
    } catch (e) { next(e); }
  });
  r.post('/chamados/:id/atender', auth, guardaMutacao, (req, res, next) => {
    try { res.json(catalogo.atenderChamado(db, req.usuario, Number(req.params.id), req.ipCliente, hub)); } catch (e) { next(e); }
  });

  // ---------- Pedidos / PDV ----------
  r.post('/pedidos/balcao', auth, guardaMutacao, perm('pode_vender_balcao'), (req, res, next) => {
    try {
      const key = req.headers['idempotency-key'] ?? req.body?.idempotency_key ?? null;
      res.status(201).json(pedidos.criarBalcao(db, req.usuario, req.body, key ? String(key).slice(0, 100) : null, req.ipCliente, hub));
    } catch (e) { next(e); }
  });
  r.get('/pedidos/abertos', auth, (_req, res) => res.json(pedidos.listarAbertos(db)));
  r.get('/pedidos/:id', auth, (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) throw erro.naoEncontrado('Pedido não encontrado.');
      res.json(pedidos.obter(db, id));
    } catch (e) { next(e); }
  });
  r.post('/pedidos/:id/itens', auth, guardaMutacao, (req, res, next) => {
    try {
      const p = db.prepare('SELECT tipo FROM pedidos WHERE id = ?').get(Number(req.params.id));
      if (!p) throw erro.naoEncontrado('Pedido não encontrado.');
      // balcão: caixa/admin; mesa: quem lança comanda (garçom/caixa/admin)
      if (p.tipo === 'balcao' && !(ehGestao(req.usuario.cargo) || req.usuario.cargo === 'caixa')) throw erro.permissao();
      if (p.tipo === 'mesa' && !exigePermLancarComanda(db, req.usuario)) throw erro.permissao();
      const key = req.headers['idempotency-key'] ?? req.body?.idempotency_key ?? null;
      res.status(201).json(pedidos.adicionarItem(db, req.usuario, Number(req.params.id), req.body, key ? String(key).slice(0, 100) : null, req.ipCliente, hub));
    } catch (e) { next(e); }
  });
  r.post('/pedidos/:id/encaminhar', auth, guardaMutacao, (req, res, next) => {
    try {
      const p = db.prepare('SELECT tipo FROM pedidos WHERE id = ?').get(Number(req.params.id));
      if (!p) throw erro.naoEncontrado('Pedido não encontrado.');
      if (p.tipo === 'balcao' && !(ehGestao(req.usuario.cargo) || req.usuario.cargo === 'caixa')) throw erro.permissao();
      if (p.tipo === 'mesa' && !exigePermLancarComanda(db, req.usuario)) throw erro.permissao();
      res.json(pedidos.encaminhar(db, req.usuario, Number(req.params.id), req.ipCliente, hub));
    } catch (e) { next(e); }
  });
  r.post('/pedidos/:id/itens/:itemId/cancelar', auth, guardaMutacao, perm('pode_cancelar_item'), (req, res, next) => {
    try {
      const item = db.prepare('SELECT enviado_cozinha_em, pedido_id FROM pedido_itens WHERE id = ?').get(Number(req.params.itemId));
      if (!item) throw erro.naoEncontrado('Item não encontrado.');
      let stepUpAdminId = null;
      if (item.enviado_cozinha_em && !ehGestao(req.usuario.cargo)) {
        stepUpAdminId = verificarStepUpAdmin(db, crypto, pepper, req.body, { usuarioExecutorId: req.usuario.id });
      }
      res.json(pedidos.cancelarItem(db, req.usuario, Number(req.params.itemId), req.body?.motivo, req.ipCliente, hub, stepUpAdminId));
    } catch (e) { next(e); }
  });
  r.post('/pedidos/:id/desconto', auth, guardaMutacao, (req, res, next) => {
    try {
      const perms = db.prepare('SELECT * FROM permissoes WHERE cargo = ?').get(req.usuario.cargo);
      const descontoCaixa = configService.obterTodas(db).desconto_caixa_permitido === '1';
      const pode = perms?.pode_desconto === 1 || (req.usuario.cargo === 'caixa' && descontoCaixa);
      if (!pode) throw erro.permissao('Aplicar desconto requer permissão.');
      res.json(pedidos.aplicarDesconto(db, req.usuario, Number(req.params.id), req.body?.valor_centavos, req.body?.motivo, req.ipCliente, hub));
    } catch (e) { next(e); }
  });
  r.post('/pedidos/:id/pagamentos', auth, guardaMutacao, perm('pode_dividir_pagar'), (req, res, next) => {
    try {
      const key = req.headers['idempotency-key'] ?? req.body?.idempotency_key ?? null;
      if (!key) throw erro.validacao('Idempotency-Key obrigatória (header Idempotency-Key).');
      res.status(201).json(pedidos.pagar(db, req.usuario, Number(req.params.id), req.body, String(key).slice(0, 100), req.ipCliente, hub));
    } catch (e) { next(e); }
  });
  r.post('/pagamentos/:id/estornar', auth, guardaMutacao, (req, res, next) => {
    try {
      let stepUpAdminId = null;
      if (!ehGestao(req.usuario.cargo)) {
        stepUpAdminId = verificarStepUpAdmin(db, crypto, pepper, req.body, { usuarioExecutorId: req.usuario.id });
      }
      res.json(pedidos.estornarPagamento(db, req.usuario, Number(req.params.id), req.body?.motivo, req.ipCliente, hub, stepUpAdminId));
    } catch (e) { next(e); }
  });
  r.post('/pedidos/:id/fechar', auth, guardaMutacao, perm('pode_dividir_pagar'), (req, res, next) => {
    try { res.json(pedidos.fechar(db, req.usuario, Number(req.params.id), req.ipCliente, hub)); } catch (e) { next(e); }
  });
  r.get('/pedidos/:id/validacao', auth, (req, res, next) => {
    try { res.json(pedidos.validarQuitacao(db, Number(req.params.id))); } catch (e) { next(e); }
  });
  r.post('/pedidos/:id/guardar', auth, guardaMutacao, perm('pode_lancar_comanda'), (req, res, next) => {
    try { res.json(pedidos.guardarPedido(db, req.usuario, Number(req.params.id), req.body?.guardado !== false, req.ipCliente, hub)); } catch (e) { next(e); }
  });
  r.post('/pedidos/:id/cortesia', auth, guardaMutacao, perm('pode_brinde'), (req, res, next) => {
    try { res.status(201).json(pedidos.cortesiaItem(db, req.usuario, Number(req.params.id), req.body, req.ipCliente, hub)); } catch (e) { next(e); }
  });
  r.get('/pedidos/:id/divisao', auth, (req, res, next) => {
    try {
      const p = db.prepare('SELECT pode_dividir_pagar FROM permissoes WHERE cargo = ?').get(req.usuario.cargo);
      if (!p?.pode_dividir_pagar) throw erro.permissao();
      res.json(pedidos.divisaoTotais(db, Number(req.params.id)));
    } catch (e) { next(e); }
  });
  r.post('/pedidos/:id/grupos', auth, guardaMutacao, perm('pode_dividir_pagar'), (req, res, next) => {
    try { res.status(201).json(pedidos.criarGrupo(db, req.usuario, Number(req.params.id), req.body?.nome, req.ipCliente)); } catch (e) { next(e); }
  });
  r.put('/pedidos/:id/grupos/:grupoId', auth, guardaMutacao, perm('pode_dividir_pagar'), (req, res, next) => {
    try { res.json(pedidos.atribuirGrupo(db, req.usuario, Number(req.params.id), Number(req.params.grupoId), req.body?.itens, req.ipCliente)); } catch (e) { next(e); }
  });
  r.delete('/pedidos/:id/grupos/:grupoId', auth, guardaMutacao, perm('pode_dividir_pagar'), (req, res, next) => {
    try { res.json(pedidos.removerGrupo(db, req.usuario, Number(req.params.id), Number(req.params.grupoId), req.ipCliente)); } catch (e) { next(e); }
  });
  r.get('/caixa/sessoes/:id', auth, perm('pode_abrir_fechar_caixa'), (req, res, next) => {
    try { res.json(caixa.detalheSessao(db, Number(req.params.id))); } catch (e) { next(e); }
  });
  r.get('/relatorios/fechamento-salao', auth, perm('pode_ver_relatorios'), (req, res, next) => {
    try { res.json(relatorios.fechamentoSalao(db, req.query.de, req.query.ate)); } catch (e) { next(e); }
  });
  r.post('/relatorios/fechamento-salao', auth, guardaMutacao, perm('pode_ver_relatorios'), (req, res, next) => {
    try { res.status(201).json(relatorios.salvarFechamentoSalao(db, req.usuario, req.body, req.ipCliente)); } catch (e) { next(e); }
  });
  r.post('/pedidos/:id/kds-avancar', auth, guardaMutacao, perm('pode_avancar_kds'), (req, res, next) => {
    try { res.json(pedidos.avancarKds(db, req.usuario, Number(req.params.id), req.ipCliente, hub)); } catch (e) { next(e); }
  });
  r.get('/kds', auth, perm('pode_ver_kds'), (_req, res) => res.json(pedidos.filaKds(db)));

  // ---------- Notificações do sino (1.3.1) ----------
  // Pedidos prontos na cozinha avisam garçons e atendentes em tempo real.
  r.get('/notificacoes', auth, (req, res, next) => {
    try { res.json(notificacoes.listar(db)); } catch (e) { next(e); }
  });
  r.post('/notificacoes/ler-todas', auth, guardaMutacao, (req, res, next) => {
    try { res.json(notificacoes.marcarTodasLidas(db)); } catch (e) { next(e); }
  });
  r.post('/notificacoes/limpar', auth, guardaMutacao, (req, res, next) => {
    try { res.json(notificacoes.limpar(db)); } catch (e) { next(e); }
  });

  // ---------- Impressoras térmicas (1.3.1) ----------
  r.get('/impressoras', auth, (_req, res) => res.json({ impressoras: impressoras.listarImpressoras(db) }));
  r.post('/impressoras', auth, guardaMutacao, perm('pode_config_sistema'), (req, res, next) => {
    try { res.status(201).json(impressoras.salvarImpressora(db, req.usuario, req.body, null, req.ipCliente)); } catch (e) { next(e); }
  });
  r.put('/impressoras/:id', auth, guardaMutacao, perm('pode_config_sistema'), (req, res, next) => {
    try { res.json(impressoras.salvarImpressora(db, req.usuario, req.body, Number(req.params.id), req.ipCliente)); } catch (e) { next(e); }
  });
  r.delete('/impressoras/:id', auth, guardaMutacao, perm('pode_config_sistema'), (req, res, next) => {
    try { res.json(impressoras.removerImpressora(db, req.usuario, Number(req.params.id), req.ipCliente)); } catch (e) { next(e); }
  });
  // Pré-visualização de teste com os dados da empresa e o layout da impressora.
  r.post('/impressoras/:id/teste', auth, guardaMutacao, perm('pode_config_sistema'), (req, res, next) => {
    try {
      const imp = impressoras.obterImpressora(db, Number(req.params.id));
      res.json({ impressora: imp, previa: impressoras.previaTeste(db, imp) });
    } catch (e) { next(e); }
  });

  // ---------- Caixa ----------
  r.get('/caixa/atual', auth, (_req, res) => res.json(caixa.resumoAberto(db)));
  r.post('/caixa/abrir', auth, guardaMutacao, perm('pode_abrir_fechar_caixa'), (req, res, next) => {
    try { res.status(201).json(caixa.abrir(db, req.usuario, req.body?.saldo_inicial_centavos ?? 0, req.ipCliente)); } catch (e) { next(e); }
  });
  r.post('/caixa/movimentar', auth, guardaMutacao, perm('pode_sangria_suprimento'), (req, res, next) => {
    try {
      const sessao = caixa.exigirCaixaAberto(db);
      let autorizadoPor = null;
      if (!ehGestao(req.usuario.cargo)) {
        autorizadoPor = verificarStepUpAdmin(db, crypto, pepper, req.body, { usuarioExecutorId: req.usuario.id });
      }
      res.status(201).json(caixa.movimentar(db, sessao, req.usuario, req.body, autorizadoPor, req.ipCliente, hub));
    } catch (e) { next(e); }
  });
  r.post('/caixa/fechar', auth, guardaMutacao, perm('pode_abrir_fechar_caixa'), (req, res, next) => {
    try {
      const sessao = caixa.exigirCaixaAberto(db);
      res.json(caixa.fechar(db, sessao, req.usuario, req.body?.conferencia, req.body?.observacoes, req.ipCliente, hub));
    } catch (e) { next(e); }
  });
  r.get('/caixa/historico', auth, perm('pode_abrir_fechar_caixa'), (_req, res) => res.json(caixa.historico(db)));

  // ---------- Estoque ----------
  r.get('/estoque', auth, (req, res) => res.json(estoque.listarIngredientes(db, { apenasBaixos: req.query.apenas_baixos === '1' })));
  r.post('/estoque/ingredientes', auth, guardaMutacao, perm('pode_estoque_gerenciar'), (req, res, next) => {
    try { res.status(201).json(estoque.criarIngrediente(db, req.usuario, req.body, req.ipCliente)); } catch (e) { next(e); }
  });
  r.post('/estoque/movimentar/:id', auth, guardaMutacao, perm('pode_estoque_gerenciar'), (req, res, next) => {
    try { res.json(estoque.movimentar(db, req.usuario, Number(req.params.id), req.body, req.ipCliente, hub)); } catch (e) { next(e); }
  });
  r.get('/estoque/movimentacoes', auth, perm('pode_estoque_gerenciar'), (req, res) => {
    res.json(estoque.listarMovimentacoes(db, { ingredienteId: req.query.ingrediente_id ? Number(req.query.ingrediente_id) : null }));
  });
  // ---------- Estoque profissional (A2) ----------
  r.post('/estoque/transferir', auth, guardaMutacao, perm('pode_estoque_gerenciar'), (req, res, next) => {
    try { res.status(201).json(estoque.transferir(db, req.usuario, req.body, req.ipCliente)); } catch (e) { next(e); }
  });
  r.get('/estoque/vencidos', auth, perm('pode_estoque_gerenciar'), (_req, res) => res.json(estoque.lotesVencidos(db)));
  r.post('/estoque/baixar-vencidos', auth, guardaMutacao, perm('pode_estoque_gerenciar'), (req, res, next) => {
    try { res.json(estoque.baixarVencidos(db, req.usuario, req.ipCliente)); } catch (e) { next(e); }
  });
  r.get('/estoque/inventario', auth, perm('pode_estoque_gerenciar'), (req, res, next) => {
    try { res.json(estoque.listaInventario(db, { quantidade: req.query.quantidade ? Number(req.query.quantidade) : 10 })); } catch (e) { next(e); }
  });
  r.post('/estoque/inventario', auth, guardaMutacao, perm('pode_estoque_gerenciar'), (req, res, next) => {
    try { res.status(201).json(estoque.registrarContagem(db, req.usuario, req.body, req.ipCliente)); } catch (e) { next(e); }
  });
  r.get('/estoque/curva-abc', auth, perm('pode_ver_relatorios'), (req, res, next) => {
    try { res.json(estoque.curvaABC(db, { dias: req.query.dias ? Number(req.query.dias) : 30 })); } catch (e) { next(e); }
  });
  r.get('/estoque/sugestao-compra', auth, perm('pode_estoque_gerenciar'), (_req, res) => res.json(estoque.sugestaoCompra(db)));
  r.post('/produtos/:id/recalcular-custo', auth, guardaMutacao, perm('pode_estoque_gerenciar'), (req, res, next) => {
    try { res.json(estoque.recalcularCusto(db, Number(req.params.id), req.usuario, req.ipCliente)); } catch (e) { next(e); }
  });
  r.get('/barris', auth, perm('pode_estoque_gerenciar'), (req, res, next) => {
    try { res.json(estoque.listarBarris(db, { copoMl: req.query.copo_ml ? Number(req.query.copo_ml) : 473 })); } catch (e) { next(e); }
  });
  r.post('/barris', auth, guardaMutacao, perm('pode_estoque_gerenciar'), (req, res, next) => {
    try { res.status(201).json(estoque.instalarBarril(db, req.usuario, req.body, req.ipCliente)); } catch (e) { next(e); }
  });
  r.post('/barris/:id/esgotar', auth, guardaMutacao, perm('pode_estoque_gerenciar'), (req, res, next) => {
    try { res.json(estoque.esgotarBarril(db, req.usuario, Number(req.params.id), req.ipCliente)); } catch (e) { next(e); }
  });

  // ---------- Relatórios ----------
  r.get('/relatorios/resumo', auth, perm('pode_ver_relatorios'), (req, res, next) => {
    try { res.json(relatorios.resumo(db, req.query.de, req.query.ate)); } catch (e) { next(e); }
  });
  r.get('/relatorios/vendas', auth, perm('pode_ver_relatorios'), (req, res, next) => {
    try { res.json(relatorios.vendasDoPeriodo(db, req.query.de, req.query.ate)); } catch (e) { next(e); }
  });
  // 1.3.1 — Exportação CSV direta (Excel pt-BR: ";" + BOM UTF-8)
  r.get('/relatorios/vendas.csv', auth, perm('pode_ver_relatorios'), (req, res, next) => {
    try {
      const csv = relatorios.vendasCSV(db, req.query.de, req.query.ate);
      registrar(db, { usuarioId: req.usuario.id, acao: 'relatorio_csv_exportado', entidade: 'relatorio', entidadeId: 'vendas', detalhes: { de: req.query.de, ate: req.query.ate }, ip: req.ipCliente });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="vendas-${req.query.de}-a-${req.query.ate}.csv"`);
      res.send(csv);
    } catch (e) { next(e); }
  });
  r.get('/relatorios/resumo.csv', auth, perm('pode_ver_relatorios'), (req, res, next) => {
    try {
      const csv = relatorios.resumoCSV(db, req.query.de, req.query.ate);
      registrar(db, { usuarioId: req.usuario.id, acao: 'relatorio_csv_exportado', entidade: 'relatorio', entidadeId: 'resumo', detalhes: { de: req.query.de, ate: req.query.ate }, ip: req.ipCliente });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="resumo-${req.query.de}-a-${req.query.ate}.csv"`);
      res.send(csv);
    } catch (e) { next(e); }
  });

  // ---------- Recibos (não fiscais) ----------
  r.post('/pedidos/:id/recibo', auth, guardaMutacao, perm('pode_dividir_pagar'), (req, res, next) => {
    try { res.status(201).json(recibos.emitirReciboCliente(db, req.usuario, Number(req.params.id), req.body?.largura_mm, req.ipCliente)); } catch (e) { next(e); }
  });
  r.post('/recibos/:id/reimprimir', auth, guardaMutacao, (req, res, next) => {
    try {
      const r = db.prepare('SELECT 1 FROM recibos WHERE id = ?').get(Number(req.params.id));
      if (!r) throw erro.naoEncontrado('Recibo não encontrado.');
      res.json(recibos.reimprimir(db, req.usuario, Number(req.params.id), req.ipCliente));
    } catch (e) { next(e); }
  });
  r.get('/pedidos/:id/recibos', auth, (req, res) => res.json(recibos.listarRecibos(db, Number(req.params.id))));
  r.post('/pedidos/:id/ticket-cozinha', auth, guardaMutacao, (req, res, next) => {
    try {
      const perms = db.prepare('SELECT * FROM permissoes WHERE cargo = ?').get(req.usuario.cargo);
      if (!perms?.pode_ver_kds && !perms?.pode_lancar_comanda) throw erro.permissao();
      res.json(recibos.ticketCozinha(db, req.usuario, Number(req.params.id), req.ipCliente));
    } catch (e) { next(e); }
  });

  // ---------- Configurações ----------
  r.get('/config', auth, (req, res) => {
    const todas = configService.obterTodas(db);
    if (!ehGestao(req.usuario.cargo)) {
      // não-admin vê apenas o necessário para operação
      return res.json({ empresa_nome: todas.empresa_nome, recibo_largura_mm: todas.recibo_largura_mm, modulo_kds: todas.modulo_kds, modulo_comanda: todas.modulo_comanda, bloquear_apos_venda: todas.bloquear_apos_venda,
        tema_padrao: todas.tema_padrao, fonte_padrao: todas.fonte_padrao, densidade_padrao: todas.densidade_padrao,
        cor_acao: todas.cor_acao, cor_ok: todas.cor_ok, cor_alerta: todas.cor_alerta, cor_amarelo: todas.cor_amarelo,
        // Operacional: o garçom precisa ver como a mesa é chamada e se há taxa.
        nomenclatura_pedido: todas.nomenclatura_pedido, taxa_servico_modo: todas.taxa_servico_modo,
        taxa_servico_pct: todas.taxa_servico_pct, taxa_servico_fixo_centavos: todas.taxa_servico_fixo_centavos,
        taxa_servico_cobrar_por: todas.taxa_servico_cobrar_por, mesa_ociosa_minutos: todas.mesa_ociosa_minutos,
        checkin_obrigatorio: todas.checkin_obrigatorio, checkin_exige_cadastro: todas.checkin_exige_cadastro });
    }
    res.json(todas);
  });
  r.put('/config', auth, guardaMutacao, perm('pode_config_sistema'), (req, res, next) => {
    try {
      const cfg = configService.salvar(db, req.usuario, req.body, req.ipCliente);
      // Taxa de serviço alterada → reprecifica as comandas abertas.
      const mexeuNaTaxa = Object.keys(req.body ?? {}).some((k) => k.startsWith('taxa_servico'));
      if (mexeuNaTaxa) {
        const r = salao.recalcularTaxasAbertas(db);
        cfg.taxas_recalculadas = r.recalculadas;
      }
      res.json(cfg);
    } catch (e) { next(e); }
  });

  // Upload da logomarca (Step6): valida magic bytes + tamanho, nunca confia na extensão.
  // PNG ou JPEG até 400 KB. Servido em /uploads (somente leitura).
  r.post('/config/logo', auth, guardaMutacao, perm('pode_config_sistema'), (req, res, next) => {
    try {
      const dataUrl = typeof req.body?.imagem_data_url === 'string' ? req.body.imagem_data_url : '';
      const m = dataUrl.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/);
      if (!m) throw erro.validacao('Envie imagem PNG ou JPEG em data URL base64.');
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length === 0 || buf.length > 400 * 1024) throw erro.validacao('Logo deve ter até 400 KB.');
      const ehPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
      const ehJpg = buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
      const ext = m[1] === 'png' ? 'png' : 'jpg';
      if ((ext === 'png' && !ehPng) || (ext === 'jpg' && !ehJpg)) {
        throw erro.validacao('Conteúdo do arquivo não corresponde ao formato declarado.');
      }
      const dir = path.join(ROOT, 'public', 'uploads');
      fs.mkdirSync(dir, { recursive: true });
      // remove logo anterior
      const anterior = configService.obterTodas(db).logo_path;
      if (anterior) {
        try { fs.rmSync(path.join(ROOT, 'public', anterior), { force: true }); } catch { /* segue */ }
      }
      const nome = `uploads/logo-${nodeCrypto.randomBytes(8).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(ROOT, 'public', nome), buf);
      const cfg = configService.salvar(db, req.usuario, { logo_path: nome }, req.ipCliente);
      res.status(201).json({ logo_path: nome, empresa_nome: cfg.empresa_nome });
    } catch (e) { next(e); }
  });
  r.delete('/config/logo', auth, guardaMutacao, perm('pode_config_sistema'), (req, res, next) => {
    try {
      const anterior = configService.obterTodas(db).logo_path;
      if (anterior) {
        try { fs.rmSync(path.join(ROOT, 'public', anterior), { force: true }); } catch { /* segue */ }
      }
      res.json(configService.salvar(db, req.usuario, { logo_path: '' }, req.ipCliente));
    } catch (e) { next(e); }
  });

  // ---------- Backups ----------
  r.get('/backups', auth, perm('pode_backup'), (_req, res) => res.json(listarBackups()));
  r.post('/backups', auth, guardaMutacao, perm('pode_backup'), (req, res, next) => {
    try { res.status(201).json(criarBackup(db, { usuarioId: req.usuario.id, motivo: 'manual' })); } catch (e) { next(e); }
  });
  // Exportar arquivo de backup (download). Nome validado contra path traversal.
  r.get('/backups/download/:arquivo', auth, perm('pode_backup'), (req, res, next) => {
    try {
      const nome = String(req.params.arquivo ?? '');
      if (!/^lanchonete-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.sqlite$/.test(nome)) {
        throw erro.validacao('Nome de backup inválido.');
      }
      const caminho = path.join(configApp.backupsDir, nome);
      if (!fs.existsSync(caminho)) throw erro.naoEncontrado('Backup não encontrado.');
      registrar(db, { usuarioId: req.usuario.id, acao: 'backup_exportado', entidade: 'backup', entidadeId: nome, ip: req.ipCliente });
      res.download(caminho, nome);
    } catch (e) { next(e); }
  });
  // Importar arquivo de backup (upload p/ pasta de backups). Valida cabeçalho SQLite
  // + integrity_check em cópia temporária. NÃO restaura sobre produção (ver script).
  r.post('/backups/upload', auth, guardaMutacao, perm('pode_backup'), (req, res, next) => {
    try {
      const nome = typeof req.body?.nome === 'string' ? req.body.nome : '';
      const b64 = typeof req.body?.conteudo_base64 === 'string' ? req.body.conteudo_base64 : '';
      if (!/^lanchonete-.*\.sqlite$/.test(nome) || nome.includes('/') || nome.includes('\\') || nome.includes('..')) {
        throw erro.validacao('Nome de arquivo inválido.');
      }
      const buf = Buffer.from(b64, 'base64');
      if (buf.length === 0 || buf.length > 60 * 1024 * 1024) throw erro.validacao('Arquivo vazio ou maior que 60 MB.');
      if (buf.subarray(0, 7).toString('ascii') !== 'SQLite ' || buf.subarray(0, 16).toString('ascii') !== 'SQLite format 3\0') {
        throw erro.validacao('Arquivo não é um banco SQLite válido (cabeçalho).');
      }
      fs.mkdirSync(configApp.backupsDir, { recursive: true });
      const tmp = path.join(configApp.backupsDir, `.upload-${Date.now()}.tmp`);
      fs.writeFileSync(tmp, buf);
      let integ = 'falha';
      try {
        const d = new DatabaseSync(tmp, { readOnly: true });
        try { integ = d.prepare('PRAGMA integrity_check').get()?.integrity_check ?? 'falha'; } finally { d.close(); }
      } catch { integ = 'falha'; }
      if (integ !== 'ok') {
        try { fs.rmSync(tmp, { force: true }); } catch { /* segue */ }
        throw erro.validacao(`Backup corrompido (integrity_check: ${integ}).`);
      }
      const destino = path.join(configApp.backupsDir, nome);
      fs.renameSync(tmp, destino);
      registrar(db, { usuarioId: req.usuario.id, acao: 'backup_importado', entidade: 'backup', entidadeId: nome, detalhes: { bytes: buf.length }, ip: req.ipCliente });
      res.status(201).json({ arquivo: nome, bytes: buf.length, integrity: 'ok' });
    } catch (e) { next(e); }
  });
  // Cardápio: exportar (JSON) e importar (com backup automático antes)
  r.get('/cardapio/exportar', auth, perm('pode_gerenciar_produtos'), (_req, res) => {
    res.json(catalogo.exportarCardapio(db));
  });
  r.post('/cardapio/importar', auth, guardaMutacao, perm('pode_gerenciar_produtos'), (req, res, next) => {
    try {
      res.json(catalogo.importarCardapio(db, req.usuario, req.body?.cardapio, req.ipCliente,
        (banco, opts) => criarBackup(banco, opts)));
    } catch (e) { next(e); }
  });

  // ---------- Auditoria (admin) ----------
  r.get('/auditoria', auth, perm('pode_gerenciar_usuarios'), (req, res) => {
    res.json(consultarAuditoria(db, {
      limite: Math.min(Number(req.query.limite ?? 200), 500),
      acao: req.query.acao ?? null,
      entidade: req.query.entidade ?? null,
    }));
  });

  // ---------- Painel do desenvolvedor (DIV-005: reauth de senha, sem senha mestra) ----------
  // O acesso é controlado pela flag pode_painel_dev (admin = 1; Proprietário = 0),
  // e ainda exige step-up de gestor (admin ou Proprietário).
  r.post('/admin/dev', auth, guardaMutacao, perm('pode_painel_dev'), (req, res, next) => {
    try {
      verificarStepUpAdmin(db, crypto, pepper, req.body, { usuarioExecutorId: req.usuario.id });
      const cfgTodas = configService.obterTodas(db);
      const stats = {
        node: process.version, uptime_s: Math.round(process.uptime()),
        ambiente: configApp.ambiente,
        db_bytes: fs.statSync(configApp.dbPath).size,
        seq_eventos: db.prepare('SELECT COALESCE(MAX(seq),0) AS s FROM eventos').get().s,
        usuarios: quantidadeUsuarios(db),
        pedidos_abertos: db.prepare(`SELECT COUNT(*) AS n FROM pedidos WHERE status='aberto'`).get().n,
        caixa_aberto: !!caixa.sessaoAberta(db),
        backups: listarBackups().backups.length,
        mem_mb: Math.round(process.memoryUsage().rss / 1048576),
        // 1.3.1 — sincronização de dispositivos e endereço online (AWS)
        dispositivos_conectados: hub.totalClientes(),
        url_publica: cfgTodas.url_publica || configApp.urlPublica || '',
        versao: '1.3.1',
      };
      res.json({ diagnostico: stats });
    } catch (e) { next(e); }
  });

  // Painel dev → exclusão de usuário (exclusão lógica com step-up de gestor).
  // Mesmo portão do painel dev (pode_painel_dev) + reautenticação de admin/Proprietário.
  r.get('/admin/dev/usuarios', auth, perm('pode_painel_dev'), (_req, res) => {
    res.json({ usuarios: listarUsuarios(db) });
  });
  r.post('/admin/dev/usuarios/:id/excluir', auth, guardaMutacao, perm('pode_painel_dev'), (req, res, next) => {
    try {
      verificarStepUpAdmin(db, crypto, pepper, req.body, { usuarioExecutorId: req.usuario.id });
      res.json(excluirUsuario(db, req.usuario, req.params.id, req.ipCliente));
    } catch (e) { next(e); }
  });
  // Desfaz a exclusão lógica (a tela Pessoas → Usuários só mostra ativos).
  r.post('/admin/dev/usuarios/:id/restaurar', auth, guardaMutacao, perm('pode_painel_dev'), (req, res, next) => {
    try {
      verificarStepUpAdmin(db, crypto, pepper, req.body, { usuarioExecutorId: req.usuario.id });
      res.json(restaurarUsuario(db, req.usuario, req.params.id, req.ipCliente));
    } catch (e) { next(e); }
  });

  function exigePermLancarComanda(dbLocal, usuario) {
    const p = dbLocal.prepare('SELECT pode_lancar_comanda FROM permissoes WHERE cargo = ?').get(usuario.cargo);
    return !!p?.pode_lancar_comanda;
  }

  r.use((_req, res) => res.status(404).json({ erro: 'Rota não encontrada.', codigo: '404_ROTA' }));
  r.use(handlerErros);
  return r;
}
