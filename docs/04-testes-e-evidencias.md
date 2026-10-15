# Testes Automatizados — Cenários, Resultados e Evidências

Data da última execução completa: 2026-10-12 · Comando: `npm test` (node:test, 26 casos)
Resultado da última execução: **26 aprovados / 0 reprovados** (registro salvo pelo runner; reexecute `npm test` para reproduzir).

Todos os testes são de **integração real**: sobem servidor HTTP+WS com banco SQLite temporário e exercitam a API exatamente como o frontend faz (cookie de sessão, header anti-CSRF, chaves de idempotência).

## Mapeamento: 18 cenários exigidos × testes

| # | Cenário exigido | Teste (arquivo) | Resultado |
|---|---|---|---|
| 1 | Autenticação válida/inválida | `01-auth` AUTH-001/002 | APROVADO |
| 2 | Bloqueio de operações não autorizadas | `01-auth` RBAC-001/002 (12 tentativas diretas na API) | APROVADO |
| 3 | Isolamento de permissões por cargo | `01-auth` RBAC (garçom/caixa/cozinha × rotas admin) | APROVADO |
| 4 | Cálculo monetário e troco | `02-pdv` PDV-002/004 (10700 exato; troco 1000) | APROVADO |
| 5 | Pagamento dividido (3 formas) | `02-pdv` PDV-002/004 (dinheiro+PIX+crédito = total) | APROVADO |
| 6 | Fechamento com saldo pendente | `02-pdv` + `03-mesas` (409_SALDO_PENDENTE com saldo do servidor) | APROVADO |
| 7 | Duplicação de venda/pagamento | `02-pdv` PDV-006 (retransmissão → 1 registro; key reaproveitada em outro pedido → 409) | APROVADO |
| 8 | Cancelamento rastreável | `02-pdv` PDV-007 + `03-mesas` (motivo, autor, autorização admin pós-envio) | APROVADO |
| 9 | Abertura/fechamento de caixa | `02-pdv` CAX-001/002/003 (2 caixas → 409; conferência com divergência) | APROVADO |
| 10 | Concorrência em pedidos/pagamentos | `02-pdv` DB-004/005 (6 pagamentos paralelos de 200 em saldo 600 → exatamente 3 aceitos) | APROVADO |
| 11 | KDS tempo real (WebSocket) | `03-mesas` KDS-003 (eventos com seq monotônico; snapshot na reconexão) | APROVADO |
| 12 | Reconexão e recuperação de estado | `03-mesas` KDS-003 + `public/js/ws.js` (descarte seq ≤ último) | APROVADO (cliente validado em navegador) |
| 13 | Persistência após reinício | `03-mesas` KDS-004/BR-006 (banco reaberto; pedidos/usuários/caixa intactos) | APROVADO |
| 14 | Backup, integridade e restauração | `04-backup` BKP-001..003 (VACUUM INTO + integrity ok + restauro em banco separado + bloqueio de restauro sobre produção) | APROVADO |
| 15 | Dispositivos autorizados (rede) | `scripts/firewall.ps1` (regra restrita ao perfil privado) + RBAC | PARCIAL — regra exige execução manual como admin (limitação L-02) |
| 16 | Impressão/reimpressão de recibos | `02-pdv` PDV-002 (emissão + reimpressão auditada) + E2E navegador (recibo renderizado 80 mm) | PARCIAL — hardware térmico real pendente (L-05) |
| 17 | Entradas malformadas | `01-auth` RBAC "entrada malformada" (5 casos, 422, servidor estável) | APROVADO |
| 18 | Recuperação após interrupção | KDS-004 (restart) + BKP-003 (restauração) + graceful shutdown (`SIGINT/SIGTERM` com checkpoint WAL) | APROVADO (SIGINT verificado no servidor dev; crash-kill coberto pelo modo WAL) |

## E2E executado em navegador real (evidência adicional)

Sequência executada em 2026-10-12 contra `http://127.0.0.1:3000` (Node 24, Windows 11):
1. Setup do 1º admin pelo formulário da primeira execução → OK.
2. Login por PIN pad tátil (Admin/1234) → shell por cargo renderizado, WebSocket "Online". OK.
3. Admin → Produtos: criada categoria "Lanches" e produto "X-Burger R$ 25,00" pela UI → OK.
4. PDV: venda sem caixa aberto → **bloqueada com mensagem clara** (409_CAIXA_FECHADO). OK.
5. Caixa: abertura com fundo R$ 100,00 pela UI → tabela esperado/forma correta. OK.
6. PDV: item no carrinho (total R$ 25,00), pagamento dinheiro valor 25,00 recebido 30,00 → **troco R$ 5,00**, fechamento automático com saldo zero, **recibo não fiscal** exibido com "Sem taxa de serviço". OK.
7. Estado pós-venda via API: caixa esperado dinheiro = **R$ 125,00** (100 fundo + 25 venda); relatório do dia = 1 pedido, líquido R$ 25,00. **Bateu.**

Erros encontrados e corrigidos durante os testes (registro de qualidade):
- alias SQL `p.forma` → `pg.forma` em `caixaService.apuradoPorForma` (descoberto pelo teste CAX).
- `transacao` não importada em `recibosService.js` (descoberto pelo teste PDV).
- `req`/`_req` na rota de estoque (descoberto pelo teste EST).
- regex inline `:id(\d+)` inválido no Express 5 (descoberto no smoke inicial).
- import inexistente `drenarFilaKds` em `app.js` + roteamento `#admin/produtos` com fallback errado + cache HTTP de assets travando atualização (descobertos no E2E de navegador).

## Verificação de dependências

- `npm audit` executado em 2026-10-12 (ver saída no relatório final; ambiente de rede exigiu `--no-audit` na instalação, auditoria executada explicitamente).
- Superfície mínima: apenas `express@5.3.0` e `ws@8.22.0` em produção; demais módulos são do próprio Node (`node:sqlite`, `node:crypto`, `node:test`).

## Extensão 2026-10-12 (noite) — itens 1–6 da lista autorizada de 12

Suíte expandida para **41 testes (41/41 aprovados)**. Baseline 26/26 confirmada antes das alterações.

| Item autorizado | Estado | Evidência |
|---|---|---|
| 1. Acessibilidade Base (P0) | Pré-existente em `a11y.js`; **completado e verificado**: CSS `:focus-visible`/skip-link/reduced-motion/uma-mão adicionado; focus-trap + `role=dialog` no modal; `anunciar()` assertivo em pagamento/encaminhar/fechar caixa/venda; Esc fecha topo-primeiro | FE-001 + navegador (setas movem foco, Esc 2→1→0, skip link focável) |
| 2. Tema System (P1) | Pré-existente; **integrado**: corrigido import quebrado (`initTheme` inexistente travava o boot); global unificado em chaves granulares validadas; 1º acesso herda servidor; `atualizarUI is not defined` corrigido | FE-002 + navegador (tema claro aplica `--canvas #F8FAFC`) |
| 3. Combos (P1) | Backend existia sem aplicação de preço; **completado**: `aplicarComboAPedido` atômico (4 tipos + grupos + estoque + `pedido_combos` idempotente + `somente_desconto`); rota enxuta; seletor no pagamento e na comanda; fluxo PDV reescrito (a rota `/pedidos/balcao/aplicar-combo` **não existia** — botão quebrava) | CMB-001..006 + E2E navegador (desconto R$ 6,10, pendente R$ 39,90, recibo) |
| 4. Exportação PDF (P1) | Existia com **violação offline-first (CDN jsdelivr)**; **corrigido**: `jspdf` + `autotable` via npm em `public/vendor/`, loader local, SW atualizado | FE-004 + PDF real gerado no navegador (17,8 KB, 53 ms, header válido) |
| 5. Alerta Sonoro KDS (P1) | `sound.js` existia **órfão**; **fiado**: toca em pedido novo/pronto/atraso (1× por pedido); painel 🔔 no KDS com toggle/volume | FE-003 + navegador (botão e painel renderizam) |
| 6. Renumerar/Excluir Mesa (P2) | Inexistente; **implementado**: PUT + DELETE com validações (livre; sem histórico), edição inline no mapa (admin) | MESA-EDIT + navegador (5→7 pela UI) |

Bugs encontrados e corrigidos nesta extensão (todos com evidência de execução):
1. `initTheme`/`carregarTemaGlobal` importados mas inexistentes — **travavam o boot do app** (console do navegador).
2. `atualizarUI is not defined` em `theme.js` — travava aplicação do tema.
3. `pdfExport.js` carregava jsPDF de CDN — incompatível com operação offline.
4. Botão "Combos" do PDV chamava rota inexistente; fluxo de opcionais criava **vendas separadas** em vez de compor o pedido.
5. Esc fechava o modal mais antigo, não o do topo, com modais empilhados.
6. Rate limiter em memória compartilhado entre servidores de teste derrubava testes tardios (seam `_resetLimitadores` só para testes).
7. Numpad do PDV não digita centavos — adicionado botão **"Valor exato"** no pagamento (necessário para totais de combo com centavos).

E2E desta extensão (navegador real, `http://127.0.0.1:3100`): setup → PIN → combo criado via API → fluxo PDV de combo (desconto R$ 6,10) → pagamento PIX via "Valor exato" → recibo → relatório (2 pedidos, líquido R$ 64,90 = 25,00 + 39,90 ✓) → PDF válido → som/edição-mesa/tema verificados.

## Extensão A1 — Cardápio inteligente (41 → 47 testes, 47/47 aprovados)

Migração `005_cardapio.sql`: `tipo_item`, `codigo_barras` (UNIQUE INDEX esparso), `apelidos`, `indisponivel_motivo`, `produto_variacoes`, `preco_historico` (vigência), `periodos_cardapio` + `produto_periodos`, snapshot `variacao_nome/delta` no item.

| Subitem | Estado | Evidência |
|---|---|---|
| 1.1 Tipos | TESTADO | 7 tipos validados; fallback `lanche` |
| 1.2 Variações | TESTADO | Grupos exclusivos, delta somado, snapshot auditado; UI com seletor por grupo |
| 1.3/1.4 Apelidos + busca | TESTADO/VERIFICADO | Normalização minúscula; filtro no PDV ("xburguer" → 1 produto) |
| 1.5 Código de barras | TESTADO/VERIFICADO | UNIQUE; bip (Enter) adiciona direto; inválido = 422 |
| 1.6 Indisponível c/ motivo | TESTADO/VERIFICADO | 422 com motivo no servidor; grade mostra ⛔ + motivo; UI verificada |
| 1.7 Preço programado | TESTADO | Futuro pendente, vigência aplica sozinha com auditoria |
| 1.8 Períodos | TESTADO | Dias/horário validados; fora = 422 |
| 1.9 Cardápio PDF | VERIFICADO | `exportarCardapioPDF` gera PDF válido no navegador (4,8 KB) |
| 1.10 Mais vendidos | TESTADO | Endpoint + faixa ⭐ no PDV |

Bugs desta extensão: `ADD COLUMN ... UNIQUE` rejeitado pelo SQLite (trocado por `CREATE UNIQUE INDEX`, que ainda permite múltiplos NULLs); grade do PDV com dados obsoletos após edição admin sem re-render (comportamento normal de SPA — recarrega ao navegar).


## Extensão A3 — Salão e fechamento (53 → 61 testes, 61/61 aprovados)

Migração `007_salao_a3.sql`: `canal/guardado/numero_dia/observacao` no pedido, `bloqueada/bloqueio_motivo` na mesa, `pode_brinde`, `pedido_grupos` + `pedido_grupo_itens`, `chamados_garcom`, `fechamentos_salao`.

| Subitem | Estado | Evidência |
|---|---|---|
| 3.1 Numeração/canal/obs | TESTADO/VERIFICADO | Sequencial por dia; 🥡 viagem no PDV e na comanda |
| 3.2 Guardar/retomar + impressão | TESTADO/VERIFICADO | Badge ⏸, retomada, impressão da comanda; fechado não guarda |
| 3.5 Cortesia | TESTADO/VERIFICADO | Só admin (pode_brinde), motivo obrigatório, preço zero, total intacto |
| 3.7 Bloqueio de mesa | TESTADO/VERIFICADO | 🔒/🔓 no mapa; ocupada não bloqueia; comanda barrada com motivo |
| 3.9 Divisão por pessoas | TESTADO/VERIFICADO | Subtotais no servidor (25,00 + 25,00); excesso = 422 |
| 3.12 Conta consolidada | VERIFICADO | Impressão com itens/cancelados/pagamentos, sem taxa |
| 3.13 PDF fechamento | TESTADO/VERIFICADO | Endpoint de detalhe + PDF de 14 KB gerado |
| 3.14 F-keys | VERIFICADO | F2 vende, F4 limpa, F8 busca (vazio não dispara) |
| 3.16 Chamado garçom | TESTADO/VERIFICADO | Dedup, atender, WS com toast+som, painel no mapa |
| 3.17 Fechamento salão | TESTADO/VERIFICADO | Por garçom/entregues; assinatura canvas validada e salva |

Bugs desta extensão: `/guardar` retornava pedido sem `itens` (quebrava o redesenho — corrigido com refetch); rota de divisão sem checagem de permissão (teste A3-004 exigia 403); import `registrar` faltante no relatoriosService.

E2E no navegador: comanda #1 com observação → divisão 25+25 → cortesia R$ 0 → guardar ⏸ → chamado atendido → conta impressa → venda viagem → caixa fechado divergência 0 → PDF → assinatura 201.


## Extensão A2 — Custo real e estoque profissional (47 → 53 testes, 53/53 aprovados)

Migração `006_estoque_a2.sql`: `perda_pct` na ficha, `rendimento_porcoes` no produto, rebuild de `estoque_movimentacoes` (tipos + local/origem/destino + custo), `ingrediente_locais`, rebuild de `estoque_lotes` da 002 (+local, sem UNIQUE restritivo), `inventario_contagens`, `barris`. Tabelas mortas da 002 (`fornecedores`, `inventarios`, etc.) preservadas intactas — nenhum código as usa.

| Subitem | Estado | Evidência |
|---|---|---|
| 1.12 Custo/margem automáticos | TESTADO/VERIFICADO | 150g×R$40/kg×1.1 = 660, margem 73,6%; botão 🧮 no produto |
| 1.13 Perda na baixa | TESTADO | Baixa consome 165g (com perda); sem ficha = sem baixa |
| 2.4 Transferência | TESTADO/VERIFICADO | Total preservado (500k+1500k); UI 🔀 |
| 2.5 Inventário | TESTADO/VERIFICADO | Contagem cega ajusta + audita; UI 📋 |
| 2.6 Validade + bloqueio | TESTADO/VERIFICADO | Vencido bloqueia venda (422); `baixar-vencidos`; UI ⚠ |
| 2.7 ABC + sugestão | TESTADO/VERIFICADO | Classes por valor; sugestão mínimo×3; UI 📊 |
| 2.8 Chopp/barril | TESTADO | 1 ativo por chopp; estimativa de copos; UI 🍺 |
| 2.9 Perdas tipadas | TESTADO | perda/sobra/quebra/vencimento/inventario na UI de saída |

Bugs desta extensão: `consumirFIFO` sem coluna `tipo` no INSERT (NOT NULL em `criado_em` — pego pelo teste A2-003); `movimentar` roteava `ajuste` ao ramo de quantidade (422 silencioso — pego pelo A2-002); tabelas da 002 (`estoque_lotes`) reutilizadas em vez de duplicadas.

E2E no navegador: entrada com lote/validade/custo → ficha com perda → custo 660 → transferência íntegra → aba Estoque com 7 ações, inventário e ABC renderizados.
