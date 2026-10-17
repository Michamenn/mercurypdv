import { erro } from '../core/errors.js';
import { texto } from '../core/validate.js';
import { registrar } from '../core/audit.js';
import { transacao, agoraISO } from '../db/connection.js';

// ---------- Impressoras térmicas (1.3.1) ----------
// Cadastro de impressoras USB, Bluetooth e Rede IP com bobina 58/80mm,
// cabeçalho/rodapé customizados e nº de vias. A impressão em si continua
// sendo feita pelo diálogo do sistema operacional (janela Impressar) com
// layout formatado pelo Mercury — nada de binário/envio cru ao dispositivo.

export const TIPOS_CONEXAO = {
  usb: 'USB',
  bluetooth: 'Bluetooth',
  rede: 'Rede (IP)',
};

function validarEndereco(conexao, bruto) {
  const endereco = String(bruto ?? '').trim();
  if (conexao === 'rede') {
    // host:porta (porta opcional; padrão 9100 em impressoras térmicas de rede)
    if (!/^([a-zA-Z0-9.-]{2,120})(:\d{1,5})?$/.test(endereco)) {
      throw erro.validacao('Endereço de rede inválido. Use IP ou host, opcionalmente com porta (ex: 192.168.0.50:9100).');
    }
    return endereco;
  }
  if (conexao === 'bluetooth') {
    // MAC (AA:BB:CC:DD:EE:FF) ou nome do dispositivo emparelhado
    if (!/^([0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}|[a-zA-Z0-9 ._-]{2,60})$/.test(endereco)) {
      throw erro.validacao('Endereço Bluetooth inválido. Use o MAC (ex: 00:11:22:33:44:55) ou o nome do dispositivo emparelhado.');
    }
    return endereco;
  }
  // USB: nome amigável da impressora instalada no sistema operacional
  if (!endereco) return null;
  if (endereco.length > 120) throw erro.validacao('Nome da impressora USB muito longo (máx. 120).');
  return endereco;
}

export function listarImpressoras(db, { comInativas = true } = {}) {
  return db.prepare(
    `SELECT * FROM impressoras ${comInativas ? '' : 'WHERE ativo = 1'} ORDER BY ativo DESC, nome`
  ).all();
}

export function obterImpressora(db, id) {
  const imp = db.prepare('SELECT * FROM impressoras WHERE id = ?').get(Number(id));
  if (!imp) throw erro.naoEncontrado('Impressora não encontrada.');
  return imp;
}

export function salvarImpressora(db, usuario, body, impressoraId = null, ip) {
  const nome = texto(body?.nome, 'nome', { minimo: 2, maximo: 60 });
  const conexao = ['usb', 'bluetooth', 'rede'].includes(body?.conexao) ? body.conexao : null;
  if (!conexao) throw erro.validacao('Conexão deve ser: usb, bluetooth ou rede.');
  const endereco = validarEndereco(conexao, body?.endereco);
  const largura = Number(body?.largura_mm) === 58 ? 58 : Number(body?.largura_mm) === 80 ? 80 : null;
  if (!largura) throw erro.validacao('Bobina deve ser 58 ou 80 mm.');
  const vias = Number(body?.vias) === 2 ? 2 : 1;
  const cabecalho = body?.cabecalho === undefined || body?.cabecalho === null || String(body.cabecalho).trim() === ''
    ? null : String(body.cabecalho).trim().slice(0, 400);
  const rodape = body?.rodape === undefined || body?.rodape === null || String(body.rodape).trim() === ''
    ? null : String(body.rodape).trim().slice(0, 400);
  const ativo = body?.ativo === 0 || body?.ativo === false ? 0 : 1;

  return transacao(db, () => {
    const agora = agoraISO();
    if (impressoraId) {
      const atual = db.prepare('SELECT * FROM impressoras WHERE id = ?').get(Number(impressoraId));
      if (!atual) throw erro.naoEncontrado('Impressora não encontrada.');
      db.prepare(
        `UPDATE impressoras SET nome=?, conexao=?, endereco=?, largura_mm=?, cabecalho=?, rodape=?, vias=?, ativo=?, atualizado_em=? WHERE id=?`
      ).run(nome, conexao, endereco, largura, cabecalho, rodape, vias, ativo, agora, Number(impressoraId));
      registrar(db, {
        usuarioId: usuario.id, acao: 'impressora_alterada', entidade: 'impressora', entidadeId: Number(impressoraId),
        detalhes: { nome, conexao, largura_mm: largura, ativo }, ip,
      });
      return db.prepare('SELECT * FROM impressoras WHERE id = ?').get(Number(impressoraId));
    }
    const dup = db.prepare('SELECT id FROM impressoras WHERE nome = ?').get(nome);
    if (dup) throw erro.conflito('409_CONFLITO_ESTADO', 'Já existe uma impressora com esse nome.');
    const info = db.prepare(
      `INSERT INTO impressoras (nome, conexao, endereco, largura_mm, cabecalho, rodape, vias, ativo, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(nome, conexao, endereco, largura, cabecalho, rodape, vias, ativo, agora);
    const id = Number(info.lastInsertRowid);
    registrar(db, {
      usuarioId: usuario.id, acao: 'impressora_criada', entidade: 'impressora', entidadeId: id,
      detalhes: { nome, conexao, largura_mm: largura }, ip,
    });
    return db.prepare('SELECT * FROM impressoras WHERE id = ?').get(id);
  });
}

export function removerImpressora(db, usuario, impressoraId, ip) {
  return transacao(db, () => {
    const atual = db.prepare('SELECT * FROM impressoras WHERE id = ?').get(Number(impressoraId));
    if (!atual) throw erro.naoEncontrado('Impressora não encontrada.');
    db.prepare('DELETE FROM impressoras WHERE id = ?').run(Number(impressoraId));
    registrar(db, {
      usuarioId: usuario.id, acao: 'impressora_removida', entidade: 'impressora', entidadeId: Number(impressoraId),
      detalhes: { nome: atual.nome, conexao: atual.conexao }, ip,
    });
    return { ok: true, removida: atual.nome };
  });
}

// Pré-visualização textual (servidor): gera o recibo de teste com a largura e
// cabeçalho/rodapé da impressora + dados da empresa. Usada pela aba Impressão
// e pelo botão "testar" (a renderização em si fica no navegador).
export function previaTeste(db, impressora) {
  const larg = impressora.largura_mm === 58 ? 30 : 40;
  const linha = '-'.repeat(larg);
  const config = db.prepare(
    `SELECT chave, valor FROM configuracao WHERE chave IN ('empresa_nome','empresa_cnpj','empresa_telefone','empresa_endereco')`
  ).all();
  const cfg = Object.fromEntries(config.map((r) => [r.chave, r.valor]));
  const cabecalho = (impressora.cabecalho ?? '').split(/\r?\n/).filter(Boolean);
  const rodape = (impressora.rodape ?? '').split(/\r?\n/).filter(Boolean);
  const agora = new Date();
  const itens = [
    { q: 2, nome: 'X-Burger (exemplo)', total: '50,00' },
    { q: 1, nome: 'Refrigerante (exemplo)', total: '6,00' },
  ];
  return [
    ...cabecalho,
    cfg.empresa_nome ?? 'Mercury PDV',
    cfg.empresa_cnpj ?? '', cfg.empresa_telefone ?? '', cfg.empresa_endereco ?? '',
    linha,
    `TESTE DE IMPRESSAO - ${impressora.nome}`,
    `${TIPOS_CONEXAO[impressora.conexao]}${impressora.endereco ? ' · ' + impressora.endereco : ''} · Bobina ${impressora.largura_mm}mm`,
    `Emitido em ${agora.toLocaleString('pt-BR')}`,
    linha,
    ...itens.map((i) => `${i.q}x ${i.nome}\n${String(i.total).padStart(larg)}`),
    linha,
    `TOTAL${'56,00'.padStart(larg - 5)}`,
    linha,
    `VIAS: ${impressora.vias}`,
    ...rodape,
    'Documento nao fiscal - teste de configuracao',
  ].filter((l) => l !== '').join('\n');
}
