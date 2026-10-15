import { registrar } from '../core/audit.js';
import { transacao } from '../db/connection.js';
import { erro } from '../core/errors.js';

const erroValidacao = (mensagem) => erro.validacao(mensagem);

// Configurações: dados da empresa (recibo), feature flags e opções operacionais.
export const CHAVES_PADRAO = {
  empresa_nome: 'Mercury PDV',
  empresa_cnpj: '',
  empresa_telefone: '',
  empresa_endereco: '',
  recibo_rodape: 'Obrigado pela preferência!',
  recibo_largura_mm: '80',
  modulo_kds: '1',
  modulo_comanda: '1',
  modulo_estoque: '1',
  bloquear_apos_venda: '0',
  desconto_caixa_permitido: '0',
  backup_intervalo_horas: '6',
  // Tema/acessibilidade (defaults globais do estabelecimento; cada operador pode sobrescrever localmente)
  tema_padrao: 'escuro',
  fonte_padrao: '1',
  densidade_padrao: 'normal',
  cor_acao: '#F97316',
  cor_ok: '#10B981',
  cor_alerta: '#EF4444',
  cor_amarelo: '#FACC15',
  nav_posicao_padrao: 'lateral',
  logo_path: '',
  tema_global_definido: '0',
  // Salão Pro (migração 010)
  nomenclatura_pedido: 'mesa',
  checkin_obrigatorio: '0',
  checkin_exige_cadastro: '0',
  taxa_servico_modo: 'desativada',
  taxa_servico_pct: '10',
  taxa_servico_fixo_centavos: '0',
  taxa_servico_cobrar_por: 'subtotal',
  mesa_ociosa_minutos: '45',
  comissao_pct: '0',
  layout_salao_largura: '1200',
  layout_salao_altura: '800',
};

export function validarValorConfig(chave, valor) {
const CORES_VALIDAS = new Set(['cor_acao', 'cor_ok', 'cor_alerta', 'cor_amarelo']);
  if (CORES_VALIDAS.has(chave) && !/^#[0-9a-fA-F]{6}$/.test(valor)) {
    throw new Error(`Cor inválida em "${chave}": use hexadecimal #RRGGBB.`);
  }
  if (chave === 'tema_padrao' && !['escuro', 'claro', 'contraste', 'premium'].includes(valor)) {
    throw new Error('Tema deve ser: escuro, claro, contraste ou premium.');
  }
  if (chave === 'fonte_padrao' && !['0', '1', '2', '3'].includes(valor)) {
    throw new Error('Fonte padrão deve ser 0, 1, 2 ou 3.');
  }
  if (chave === 'densidade_padrao' && !['normal', 'compacto'].includes(valor)) {
    throw new Error('Densidade deve ser: normal ou compacto.');
  }
  if (chave === 'nav_posicao_padrao' && !['lateral', 'superior'].includes(valor)) {
    throw new Error('Posição da navegação deve ser: lateral ou superior.');
  }
  if (chave === 'logo_path' && valor !== '' && !/^uploads\/logo-[a-f0-9]{16}\.(png|jpg)$/.test(valor)) {
    throw new Error('Caminho de logo inválido.');
  }
  if (chave === 'tema_global_definido' && !['0', '1'].includes(valor)) {
    throw new Error('Marcador de tema global inválido.');
  }
  if (chave === 'nomenclatura_pedido' && !['mesa', 'comanda'].includes(valor)) {
    throw new Error('Nomenclatura deve ser: mesa ou comanda.');
  }
  if (['checkin_obrigatorio', 'checkin_exige_cadastro', 'tema_global_definido'].includes(chave) && !['0', '1'].includes(valor)) {
    if (chave !== 'tema_global_definido') throw new Error(`${chave} deve ser 0 ou 1.`);
  }
  if (chave === 'taxa_servico_modo' && !['desativada', 'percentual', 'fixa'].includes(valor)) {
    throw new Error('Taxa de serviço deve ser: desativada, percentual ou fixa.');
  }
  if (chave === 'taxa_servico_cobrar_por' && !['subtotal', 'bruto'].includes(valor)) {
    throw new Error('Base da taxa de serviço deve ser: subtotal ou bruto.');
  }
  // Campos numéricos com faixa — evita config que derruba o caixa.
  const NUMERICOS = {
    taxa_servico_pct: [0, 100],
    taxa_servico_fixo_centavos: [0, 100000],
    mesa_ociosa_minutos: [1, 1440],
    comissao_pct: [0, 100],
    layout_salao_largura: [400, 5000],
    layout_salao_altura: [300, 5000],
  };
  if (chave in NUMERICOS) {
    const n = Number(valor);
    const [min, max] = NUMERICOS[chave];
    if (!Number.isFinite(n) || n < min || n > max) {
      throw new Error(`${chave} deve estar entre ${min} e ${max}.`);
    }
  }
}

export function obterTodas(db) {
  const rows = db.prepare('SELECT chave, valor FROM configuracao').all();
  const mapa = { ...CHAVES_PADRAO };
  for (const r of rows) mapa[r.chave] = r.valor;
  return mapa;
}

export function obterPublicas(db) {
  const todas = obterTodas(db);
  return {
    empresa_nome: todas.empresa_nome,
    setup_necessario: null, // preenchido pela rota de auth
  };
}

export function salvar(db, usuario, valores, ip) {
  return transacao(db, () => {
    const permitidas = new Set(Object.keys(CHAVES_PADRAO));
    const aplicadas = {};
    for (const [chave, valor] of Object.entries(valores ?? {})) {
      if (!permitidas.has(chave)) continue;
      const v = String(valor ?? '').slice(0, 300);
      try { validarValorConfig(chave, v); }
      catch (e) { throw erroValidacao(e.message); }
      db.prepare(
        `INSERT INTO configuracao (chave, valor, atualizado_em, atualizado_por) VALUES (?, ?, ?, ?)
         ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor, atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por`
      ).run(chave, v, new Date().toISOString(), usuario.id);
      aplicadas[chave] = v;
    }
    registrar(db, { usuarioId: usuario.id, acao: 'config_alterada', entidade: 'configuracao', entidadeId: null, detalhes: { chaves: Object.keys(aplicadas) }, ip });
    return obterTodas(db);
  });
}
