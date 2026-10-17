// Testes 1.3.1: impressoras térmicas, sessões ativas, dispositivos e exportação CSV
import test from 'node:test';
import assert from 'node:assert/strict';
import { iniciarServidorTeste, semear } from './helpers.js';

const BASE = (porta) => `http://127.0.0.1:${porta}/api`;

test('IMPR-001..003: CRUD de impressoras térmicas com permissão, validação e auditoria', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);

    // admin cria impressora de rede 80mm com cabeçalho/rodapé próprios
    const cria = await s.adminCli.post('/impressoras', {
      nome: 'Balcão Principal', conexao: 'rede', endereco: '192.168.0.50:9100',
      largura_mm: 80, cabecalho: 'LANCHONETE DO ZÉ', rodape: 'Volte sempre!', vias: 1,
    });
    assert.equal(cria.status, 201);
    assert.equal(cria.corpo.largura_mm, 80);
    assert.equal(cria.corpo.cabecalho, 'LANCHONETE DO ZÉ');

    // listagem liberada para qualquer autenticado (garçom imprime recibo)
    const lista = await s.garcomCli.get('/impressoras');
    assert.equal(lista.status, 200);
    assert.ok(lista.corpo.impressoras.some((i) => i.nome === 'Balcão Principal'));

    // garçom NÃO cria/edita/exclui (default deny)
    const negado = await s.garcomCli.post('/impressoras', { nome: 'X', conexao: 'usb', largura_mm: 58 });
    assert.equal(negado.status, 403);

    // validação: largura fora de 58/80
    const ruim = await s.adminCli.post('/impressoras', { nome: 'Errada', conexao: 'usb', largura_mm: 100 });
    assert.equal(ruim.status, 422);
    // validação: rede exige endereço válido
    const semEnd = await s.adminCli.post('/impressoras', { nome: 'Sem Endereço', conexao: 'rede', largura_mm: 58 });
    assert.equal(semEnd.status, 422);
    const endRuim = await s.adminCli.post('/impressoras', { nome: 'End Ruim', conexao: 'rede', endereco: 'não é endereço', largura_mm: 80 });
    assert.equal(endRuim.status, 422);
    // validação: conexão inválida
    const conRuim = await s.adminCli.post('/impressoras', { nome: 'Con Ruim', conexao: 'wifi', largura_mm: 80 });
    assert.equal(conRuim.status, 422);

    // bluetooth com MAC válido + 2 vias + bobina 58
    const bt = await s.adminCli.post('/impressoras', { nome: 'Cozinha BT', conexao: 'bluetooth', endereco: '00:11:22:33:44:55', largura_mm: 58, vias: 2 });
    assert.equal(bt.status, 201);
    assert.equal(bt.corpo.vias, 2);

    // nome duplicado → conflito
    const dup = await s.adminCli.post('/impressoras', { nome: 'Balcão Principal', conexao: 'usb', largura_mm: 80 });
    assert.equal(dup.status, 409);

    // editar (muda bobina para 58)
    const ed = await s.adminCli.put(`/impressoras/${cria.corpo.id}`, { nome: 'Balcão Principal', conexao: 'rede', endereco: '10.0.0.9:9100', largura_mm: 58 });
    assert.equal(ed.status, 200);
    assert.equal(ed.corpo.largura_mm, 58);

    // prévia de teste (server-side) reflete nome, conexão e bobina
    const teste = await s.adminCli.post(`/impressoras/${cria.corpo.id}/teste`, {});
    assert.equal(teste.status, 200);
    assert.match(teste.corpo.previa, /Balcão Principal/);
    assert.match(teste.corpo.previa, /Bobina 58mm/);
    assert.match(teste.corpo.previa, /Rede \(IP\)/);

    // auditoria registrou criações
    const aud = sv.db.prepare(`SELECT COUNT(*) AS n FROM auditoria WHERE acao = 'impressora_criada'`).get();
    assert.equal(aud.n, 2);

    // excluir
    const del = await s.adminCli.delete(`/impressoras/${bt.corpo.id}`);
    assert.equal(del.status, 200);
    const depois = await s.adminCli.get('/impressoras');
    assert.ok(!depois.corpo.impressoras.some((i) => i.id === bt.corpo.id));
  } finally { await sv.fechar(); }
});

test('CFG-011: url_publica (endereço online AWS) e impressora padrão validados', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    const cria = await s.adminCli.post('/impressoras', { nome: 'Padrão', conexao: 'usb', largura_mm: 80 });
    assert.equal(cria.status, 201);

    const cfg = await s.adminCli.put('/config', { url_publica: 'https://pdv.minhalanchonete.com.br', impressora_padrao_id: String(cria.corpo.id) });
    assert.equal(cfg.status, 200);
    assert.equal(cfg.corpo.url_publica, 'https://pdv.minhalanchonete.com.br');
    assert.equal(cfg.corpo.impressora_padrao_id, String(cria.corpo.id));

    // endereço sem protocolo → 422
    const ruim = await s.adminCli.put('/config', { url_publica: 'pdv.minhalanchonete.com.br' });
    assert.equal(ruim.status, 422);
    // impressora padrão não numérica → 422
    const ruim2 = await s.adminCli.put('/config', { impressora_padrao_id: 'abc' });
    assert.equal(ruim2.status, 422);
    // vazio volta ao padrão (só LAN)
    const volta = await s.adminCli.put('/config', { url_publica: '' });
    assert.equal(volta.status, 200);
    assert.equal(volta.corpo.url_publica, '');
  } finally { await sv.fechar(); }
});

test('CSV-001/002: exportação de vendas e resumo em CSV (Excel pt-BR, BOM + ;)', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    await s.caixaCli.post('/caixa/abrir', { saldo_inicial_centavos: 5000 });
    const pedido = await s.caixaCli.post('/pedidos/balcao',
      { itens: [{ produto_id: s.produtos.xburger.id, quantidade: 2 }] }, { idem: 'csv-1' });
    assert.equal(pedido.status, 201);
    await s.caixaCli.post(`/pedidos/${pedido.corpo.id}/pagamentos`,
      { forma: 'dinheiro', valor_centavos: 5000 }, { idem: 'csv-p1' });
    const fecho = await s.caixaCli.post(`/pedidos/${pedido.corpo.id}/fechar`, {});
    assert.equal(fecho.status, 200);
    const hoje = new Date().toISOString().slice(0, 10);

    // vendas.csv: cabeçalho, BOM, valor formatado pt-BR e forma de pagamento
    const resVendas = await fetch(`${BASE(sv.porta)}/relatorios/vendas.csv?de=${hoje}&ate=${hoje}`,
      { headers: { Cookie: s.adminCli._cookie() } });
    assert.equal(resVendas.status, 200);
    assert.match(resVendas.headers.get('content-type'), /text\/csv/);
    const bytesVendas = new Uint8Array(await resVendas.arrayBuffer());
    assert.equal(bytesVendas[0], 0xEF, 'BOM UTF-8 presente para Excel (byte 1)');
    assert.equal(bytesVendas[1], 0xBB, 'BOM UTF-8 presente para Excel (byte 2)');
    assert.equal(bytesVendas[2], 0xBF, 'BOM UTF-8 presente para Excel (byte 3)');
    const decod = new TextDecoder();
    const texto = decod.decode(bytesVendas.subarray(3));
    assert.match(texto, /Pedido;Origem/);
    assert.match(texto, /Balcão/);
    assert.match(texto, /50,00/);
    assert.match(texto, /dinheiro=50,00/);

    // resumo.csv: faturamento, ticket médio, pedidos e formas de pagamento
    const resResumo = await fetch(`${BASE(sv.porta)}/relatorios/resumo.csv?de=${hoje}&ate=${hoje}`,
      { headers: { Cookie: s.adminCli._cookie() } });
    assert.equal(resResumo.status, 200);
    const resumoTxt = await resResumo.text();
    assert.match(resumoTxt, /Pedidos fechados;1/);
    assert.match(resumoTxt, /Faturamento bruto \(R\$\);50,00/);
    assert.match(resumoTxt, /Ticket médio \(R\$\);50,00/);
    assert.match(resumoTxt, /Dinheiro;50,00/);

    // caixa (sem pode_ver_relatorios) → 403
    const negado = await fetch(`${BASE(sv.porta)}/relatorios/vendas.csv?de=${hoje}&ate=${hoje}`,
      { headers: { Cookie: s.caixaCli._cookie() } });
    assert.equal(negado.status, 403);

    // auditoria registrou as duas exportações
    const aud = sv.db.prepare(`SELECT COUNT(*) AS n FROM auditoria WHERE acao = 'relatorio_csv_exportado'`).get();
    assert.equal(aud.n, 2);
  } finally { await sv.fechar(); }
});

test('SESS-001..003: sessões ativas com origem, IP e desconexão imediata', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);

    // garçom não lista sessões (default deny)
    const negado = await s.garcomCli.get('/sessoes');
    assert.equal(negado.status, 403);

    // admin lista: vê a própria sessão (marcada) e a do garçom, com origem e IP
    const lista = await s.adminCli.get('/sessoes');
    assert.equal(lista.status, 200);
    assert.ok(lista.corpo.sessoes.length >= 5, 'uma sessão por papel logado no seed');
    const minha = lista.corpo.sessoes.find((x) => x.atual);
    assert.ok(minha, 'sessão atual marcada com "atual"');
    assert.equal(minha.origem, 'Web (computador)');
    assert.ok(minha.ip, 'IP registrado');
    const doGarcom = lista.corpo.sessoes.find((x) => x.nome === 'Joana');
    assert.ok(doGarcom, 'sessão do garçom listada');

    // desconectar a própria sessão → bloqueado com mensagem clara
    const self = await s.adminCli.post(`/sessoes/${minha.id}/desconectar`, {});
    assert.equal(self.status, 422);

    // desconectar o garçom → próximas requisições dele viram 401
    const desc = await s.adminCli.post(`/sessoes/${doGarcom.id}/desconectar`, {});
    assert.equal(desc.status, 200);
    assert.equal(desc.corpo.usuario, 'Joana');
    const depois = await s.garcomCli.get('/pedidos/abertos');
    assert.equal(depois.status, 401);

    // auditoria registrou a desconexão
    const aud = sv.db.prepare(`SELECT COUNT(*) AS n FROM auditoria WHERE acao = 'sessao_desconectada'`).get();
    assert.equal(aud.n, 1);
  } finally { await sv.fechar(); }
});

test('DISP-001: /dispositivos expõe total a todos; detalhe só a quem gerencia', async () => {
  const sv = await iniciarServidorTeste();
  try {
    const s = await semear(sv);
    const garcom = await s.garcomCli.get('/dispositivos');
    assert.equal(garcom.status, 200);
    assert.equal(typeof garcom.corpo.total, 'number');
    assert.ok(!('itens' in garcom.corpo), 'garçom não vê o detalhe (só o total)');

    const admin = await s.adminCli.get('/dispositivos');
    assert.equal(admin.status, 200);
    assert.ok(Array.isArray(admin.corpo.itens), 'admin recebe o detalhe de dispositivos');
    // detalhe populado com conexões WS é coberto em WS-PRES (tests/27)
  } finally { await sv.fechar(); }
});
