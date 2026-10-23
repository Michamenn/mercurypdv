// Testes de organização da interface e das Configurações.
// Cada teste aqui cobre um defeito que foi REALMENTE observado no navegador:
//   - bloco de configurações sem título, misturando assuntos diferentes
//   - botão "Salvar" no topo de uma página de 2067px (risco de não salvar)
//   - navegação ocupando 71% da tela antes de qualquer conteúdo
//   - dois botões do cabeçalho sem ícone e um deles sem rótulo acessível
//   - rótulo "Administração" cortado na barra lateral
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const raiz = path.resolve(import.meta.dirname, '..');
const ler = (p) => fs.readFileSync(path.join(raiz, p), 'utf8');

const admin = ler('public/js/views/admin.js');
const appjs = ler('public/js/app.js');
const css = ler('public/css/app.css');

// Recorta só a função telaConfig, do início até a próxima função.
const telaConfig = admin.slice(
  admin.indexOf('async function telaConfig'),
  admin.indexOf('async function telaComissoes')
);

test('MOD-060: TODA seção de configuração tem título', () => {
  // Antes: o primeiro bloco começava direto em "Nome da empresa", sem título.
  const cartoes = [...telaConfig.matchAll(/<div class="cartao cartao-secao" id="cfg-(\w+)">/g)].map((m) => m[1]);
  assert.deepEqual(cartoes, ['empresa', 'cupom', 'comportamento', 'salao', 'taxa', 'logo', 'celular'],
    'sete seções nomeadas, na ordem esperada');
  for (const id of cartoes) {
    const bloco = telaConfig.slice(telaConfig.indexOf(`id="cfg-${id}"`), telaConfig.indexOf(`id="cfg-${id}"`) + 400);
    assert.ok(bloco.includes('cartao-titulo'), `a seção "${id}" tem título visível`);
  }
  // Nenhum bloco de configuração fica sem título (o defeito original).
  const semTitulo = [...telaConfig.matchAll(/class="cartao cartao-secao">\s*<(?!h3)/g)];
  assert.equal(semTitulo.length, 0, 'nenhum cartão de configuração abre sem título');
});

test('MOD-061: dados da empresa e comportamento do sistema não ficam misturados', () => {
  // O defeito: CNPJ/telefone/endereço conviviam com "bloquear após venda" e
  // "módulo KDS" no mesmo bloco sem nome.
  const blocoEmpresa = telaConfig.slice(
    telaConfig.indexOf('id="cfg-empresa"'), telaConfig.indexOf('id="cfg-cupom"'));
  // A seção Empresa renderiza pelo array `campos` (não com chaves literais).
  assert.ok(blocoEmpresa.includes('campos.map'), 'a seção Empresa usa a lista de campos');
  const listaCampos = telaConfig.slice(
    telaConfig.indexOf('const campos = ['), telaConfig.indexOf('const campos = [') + 400);
  for (const cfg of ['empresa_nome', 'empresa_cnpj', 'empresa_telefone', 'empresa_endereco']) {
    assert.ok(listaCampos.includes(`'${cfg}'`), `"${cfg}" está na lista de campos da Empresa`);
  }
  // A seção Cupom tem largura, cabeçalho e rodapé — separados da Empresa.
  const blocoCupom = telaConfig.slice(
    telaConfig.indexOf('id="cfg-cupom"'), telaConfig.indexOf('id="cfg-comportamento"'));
  for (const cfg of ['recibo_largura_mm', 'recibo_cabecalho', 'recibo_rodape']) {
    assert.ok(blocoCupom.includes(`data-cfg="${cfg}"`), `"${cfg}" está na seção Cupom`);
  }

  // O ponto crítico: nenhuma chave de comportamento pode estar na seção Empresa.
  for (const flag of ['bloquear_apos_venda', 'desconto_caixa_permitido', 'modulo_kds', 'modulo_comanda']) {
    assert.ok(!blocoEmpresa.includes(flag), `"${flag}" NÃO está na seção Empresa`);
  }
  const blocoComport = telaConfig.slice(
    telaConfig.indexOf('id="cfg-comportamento"'), telaConfig.indexOf('id="cfg-salao"'));
  for (const flag of ['bloquear_apos_venda', 'desconto_caixa_permitido', 'modulo_kds', 'modulo_comanda']) {
    assert.ok(blocoComport.includes(flag), `"${flag}" está na seção Comportamento`);
  }
  assert.ok(!blocoComport.includes('campos.map'), 'a seção Comportamento não repete os dados da empresa');
});

test('MOD-062: o botão Salvar fica sempre visível (o defeito mais grave)', () => {
  // Antes: #salvar ficava dentro do primeiro cartão, a 549px do topo de uma
  // página de 2067px — quem editava a taxa de serviço não achava o botão.
  assert.ok(telaConfig.includes('class="config-save"'), 'existe a barra de salvar');
  // O botão não pode estar dentro de nenhum cartão (ficaria no meio da rolagem).
  const barraIdx = telaConfig.indexOf('class="config-save"');
  const proximoCartaoDepois = telaConfig.indexOf('<div class="cartao cartao-secao"', barraIdx);
  assert.ok(proximoCartaoDepois === -1,
    'a barra de salvar é o último elemento, depois de todas as seções');
  assert.ok(css.includes('.config-save {') && css.includes('position: sticky'),
    'a barra fica fixa na tela (sticky)');
  // E fica no rodapé, não no topo.
  const blocoCss = css.slice(css.indexOf('.config-save {'), css.indexOf('.config-save {') + 700);
  assert.ok(/position:\s*sticky/.test(blocoCss), 'posicionada como sticky');
  assert.ok(/bottom:\s*0/.test(blocoCss), 'ancorada no rodapé da tela');
  assert.ok(!/top:\s*0/.test(blocoCss), 'não está presa ao topo');
});

test('MOD-063: alteração não salva fica visível', () => {
  assert.ok(telaConfig.includes("classList.add('sujo')"), 'marca a barra ao alterar');
  assert.ok(telaConfig.includes('Alterações não salvas'), 'avisa o usuário em texto');
  assert.ok(telaConfig.includes("classList.remove('sujo')"), 'limpa o estado depois de salvar');
  assert.ok(telaConfig.includes('role="status"') && telaConfig.includes('aria-live="polite"'),
    'o aviso é anunciado por leitores de tela');
  assert.ok(css.includes('.config-save.sujo'), 'a barra muda de cor quando está suja');
});

test('MOD-064: menu de âncoras navega entre as seções', () => {
  assert.ok(telaConfig.includes('class="config-ancoras"'), 'menu de âncoras presente');
  assert.ok(telaConfig.includes('aria-label="Seções das configurações"'), 'tem rótulo acessível');
  for (const id of ['empresa', 'comportamento', 'salao', 'taxa', 'logo', 'celular']) {
    assert.ok(telaConfig.includes(`'${id}',`), `seção "${id}" listada no menu`);
  }
  // Não pode sobrescrever o hash, senão a aba fecha ao recarregar.
  assert.ok(telaConfig.includes('ev.preventDefault()'), 'não altera o hash');
  assert.ok(css.includes('scroll-margin-top'), 'a seção não fica escondida atrás do menu fixo');
});

test('MOD-065: navegação do Admin não ocupa a tela inteira', () => {
  // Antes: as 13 telas ficavam sempre visíveis (477px de uma janela de 670px).
  assert.ok(admin.includes('const visiveis = termo ? grupos : grupos.filter'),
    'sem busca, só a categoria ativa é expandida');
  assert.ok(admin.includes('categoriaAtiva?.id'), 'a categoria ativa é a referência');
  // A descrição não pode mais inflar o cartão: vira title.
  assert.ok(admin.includes('title="${escapar(desc)}"'), 'descrição vai para o title');
  assert.ok(css.includes('.admin-aba-txt'), 'rótulo tem wrapper com elipse');
});

test('MOD-066: os botões do cabeçalho têm ícone e nome acessível', () => {
  // Antes: os dois botões nasciam vazios (innerHTML === '') e o de bloqueio
  // não tinha aria-label — invisível e sem nome para leitor de tela.
  for (const [id, rotulo] of [['btn-nav', 'Personalizar navegação'], ['btn-bloquear', 'Bloquear tela']]) {
    const linha = appjs.slice(appjs.indexOf(`id="${id}"`), appjs.indexOf(`id="${id}"`) + 260);
    assert.ok(linha.includes('ic('), `${id} tem ícone`);
    assert.ok(linha.includes('aria-label'), `${id} tem rótulo acessível`);
    assert.ok(linha.includes(rotulo), `${id} descreve a ação (${rotulo})`);
    assert.ok(linha.includes('aria-hidden="true"'), `${id} esconde o ícone do leitor de tela`);
    assert.ok(linha.includes('title='), `${id} tem dica ao passar o mouse`);
  }
  // Nenhum botão pode nascer com o conteúdo vazio.
  const vazios = [...appjs.matchAll(/<button[^>]*id="(btn-[\w-]+)"[^>]*>\s*<\/button>/g)].map((m) => m[1]);
  assert.deepEqual(vazios, [], `nenhum botão vazio: ${vazios.join(', ')}`);
});

test('MOD-067: os rótulos da barra lateral não são cortados', () => {
  // "Administração" é uma palavra única e não cabia em 196px, virando
  // "Administra...". A barra foi alargada e o rótulo ganhou min-width: 0.
  const barra = css.slice(css.indexOf('.corpo[data-nav="lateral"] .nav-flutuante'));
  const largura = Number((barra.match(/width:\s*(\d+)px/) || [])[1]);
  assert.ok(largura >= 210, `barra lateral tem espaço para o rótulo mais longo (${largura}px)`);
  assert.ok(css.includes('.nav-item .nav-rotulo { overflow: hidden; text-overflow: ellipsis; min-width: 0; }'),
    'rótulo pode encolher dentro do flex');
});

test('MOD-068: nenhuma configuração foi perdida na reorganização', () => {
  // Reorganizar não pode apagar nenhuma chave existente.
  const listaCampos = admin.slice(admin.indexOf('const campos = ['), admin.indexOf('const campos = [') + 400);
  for (const k of ['empresa_nome', 'empresa_cnpj', 'empresa_telefone', 'empresa_endereco']) {
    assert.ok(listaCampos.includes(`'${k}'`), `campo de empresa "${k}" preservado`);
  }
  for (const k of ['recibo_largura_mm', 'recibo_cabecalho', 'recibo_rodape',
    'bloquear_apos_venda', 'desconto_caixa_permitido', 'modulo_kds', 'modulo_comanda',
    'nomenclatura_pedido', 'mesa_ociosa_minutos', 'comissao_pct',
    'layout_salao_largura', 'layout_salao_altura',
    'checkin_obrigatorio', 'checkin_exige_cadastro',
    'taxa_servico_modo', 'taxa_servico_pct', 'taxa_servico_fixo_centavos', 'taxa_servico_cobrar_por']) {
    assert.ok(telaConfig.includes(`data-cfg="${k}"`) || telaConfig.includes(`data-flag="${k}"`),
      `config "${k}" preservada`);
  }
  // O envio ao servidor continua igual.
  assert.ok(admin.includes("put('/config', corpo)"), 'salva em /config');
  assert.ok(admin.includes('data-centavos') && admin.includes('reaisParaCentavos'), 'conversão de centavos intacta');
  assert.ok(admin.includes("post('/config/logo'"), 'upload de logo intacto');
});