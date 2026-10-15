# Relatório de Melhorias — Lanchonete Pro / MercuryPDV 1.1
## Grupos e 4 atualizações (a partir das sugestões do responsável)

Data: 2026-10-12 · Base técnica: sistema atual (41/41 testes) · Regras vigentes: BR-001..BR-010

**Como ler:** cada item traz o estado atual (`✅ existe` / `⚠️ parcial` / `❌ faltante`) e a atualização de destino (`A1`–`A4`). Itens que conflitam com regras comerciais estão em §5 (bloqueados, com alternativa).

---

## Grupo 1 — Cardápio e produtos

| # | Sugestão | Estado atual | Destino |
|---|---|---|---|
| 1.1 | Tipos de item (lanche, prato, porção, bebida, serviço) | ❌ Só há categoria + área (cozinha/bar) | A1 |
| 1.2 | Variações e opcionais (P/M/G, ponto da carne, sabor do açaí) com preço próprio | ⚠️ Adicionais com preço existem; variação estruturada (tamanho/sabor) não | A1 |
| 1.3 | Apelidos/palavras-chave p/ busca rápida no PDV ("pão de queijo") | ❌ | A1 |
| 1.4 | Busca por nome/apelido no PDV | ❌ (só navegação por categoria) | A1 |
| 1.5 | Leitor de código de barras (campo + scanner USB) | ❌ | A1 |
| 1.6 | Item indisponível com motivo (acabou, sem estoque, sem gás) | ❌ (só ativo/inativo) | A1 |
| 1.7 | Histórico de preço com data de vigência | ⚠️ Alteração de preço é auditada, sem vigência programada | A1 |
| 1.8 | Horários de funcionamento + períodos de cardápio (almoço, happy hour, jantar) | ❌ | A1 |
| 1.9 | Impressão de cardápio/folders (PDF por categoria) | ❌ (PDF só de relatórios) | A1 |
| 1.10 | Caixa rápido: mais vendidos na tela principal | ❌ | A1 |
| 1.11 | Ficha técnica/receita por item (insumos + qtd + custo) | ✅ Existe (`produto_ingredientes`) | — |
| 1.12 | Custo e margem automáticos a partir da ficha | ❌ Custo é manual; margem só estimada no relatório | A2 |
| 1.13 | Perda de preparo % embutida (10% carne, 5% massa) + rendimento por porção | ❌ | A2 |

## Grupo 2 — Estoque de insumos e bebidas

| # | Sugestão | Estado atual | Destino |
|---|---|---|---|
| 2.1 | Baixa automática pela ficha ao vender | ✅ Existe (idempotente) | — |
| 2.2 | Contagem de insumos + ajustes auditados | ✅ Existe (entrada/perda/ajuste) | — |
| 2.3 | Estoque mínimo + alerta | ✅ Existe | — |
| 2.4 | Transferência entre locais (depósito / câmara fria / bar / salão) | ❌ Estoque é único por insumo | A2 |
| 2.5 | Inventário rotativo + ganho/perda | ❌ | A2 |
| 2.6 | Validade/lotes + **bloqueio de venda** do vencido | ❌ | A2 |
| 2.7 | Curva ABC + sugestão de compra | ❌ | A2 |
| 2.8 | Chopp/barril (tipo, nº, instalação, copos estimados, ruptura) | ❌ | A2 |
| 2.9 | Perdas de preparo, sobras e quebras registradas | ❌ (só "perda" genérica) | A2 |

## Grupo 3 — Salão, comandas e caixa

| # | Sugestão | Estado atual | Destino |
|---|---|---|---|
| 3.1 | Comanda com numeração automática + nome + observação | ⚠️ Nome existe; numeração sequencial do dia e obs. da comanda, não | A3 |
| 3.2 | Pedido em aberto ("guardar" / "vai levar") + retomada + impressão | ❌ | A3 |
| 3.3 | Ajuste da comanda: adição/remoção/obs./cancelamento com motivo | ✅ Existe | — |
| 3.4 | Desconto com permissão | ✅ Existe | — |
| 3.5 | Brinde/cortesia com permissão | ⚠️ Só via combo; item avulso a preço zero, não | A3 |
| 3.6 | Mesa ocupada/livre | ✅ Existe | — |
| 3.7 | Bloqueio de mesa (reserva/manutenção) | ❌ (só livre/ocupada) | A3 |
| 3.8 | Troco + pagamento dividido | ✅ Existe | — |
| 3.9 | Divisão por pessoas e por itens | ❌ | A3 |
| 3.10 | Múltiplos meios na mesma conta | ✅ Existe | — |
| 3.11 | Recibo não fiscal | ✅ Existe (58/80 mm) | — |
| 3.12 | Conta consolidada (conferência da mesa) | ❌ | A3 |
| 3.13 | Relatório de fechamento (PDF do turno) | ⚠️ Conferência existe; PDF do fechamento, não | A3 |
| 3.14 | Atalhos de teclado p/ pico (F-keys) | ⚠️ Só Alt+1..4; F-keys e fluxo caixa, não | A3 |
| 3.15 | Sangria + fechamento de turno | ✅ Existe | — |
| 3.16 | Chamado de garçom / apoio e aviso de mesa | ❌ | A3 |
| 3.17 | Fechamento de salão (quem entregou o quê, assinatura) | ❌ | A3 |

## Grupo 4 — Produção (KDS / cozinha / bar)

| # | Sugestão | Estado atual | Destino |
|---|---|---|---|
| 4.1 | KDS com comandas, tempo real, som, pronto/entregue | ✅ Existe | — |
| 4.2 | Comanda separada por setor (bar / cozinha / salão) | ⚠️ Área existe no produto; filtro por setor no KDS, não | A4 |
| 4.3 | Controle de produção por etapa (quente, frios, corte, montagem) | ❌ | A4 |
| 4.4 | Ficha de produção do dia (check-list abertura/fechamento, impressa) | ❌ | A4 |
| 4.5 | Rendimento real ("quantas porções de molho feitas/sobraram") | ❌ | A4 |
| 4.6 | Prioridade de comandas no KDS | ❌ | A4 |
| 4.7 | Tempo estimado de preparo na comanda | ❌ | A4 |

---

## As 4 atualizações propostas (ordem por dependência)

### A1 — Cardápio inteligente (base de tudo) — ✅ CONCLUÍDA (47/47 testes + E2E navegador)
Itens 1.1–1.10. Banco: `tipo_item`, `codigo_barras`, `apelidos`, `indisponivel_motivo`, `preco_historico` (com vigência), `periodos_cardapio`, variações (`produto_variacoes` com delta de preço). PDV: busca por nome/apelido, grade + mais vendidos, indisponíveis marcados com motivo. Admin: impressão do cardápio em PDF por categoria.
**Depende de:** nada. **Desbloqueia:** A2 (custo), A3, A4.

### A2 — Custo real e estoque profissional — ✅ CONCLUÍDA (53/53 testes + E2E navegador)
Itens 1.12, 1.13, 2.4–2.9. Custo recalculado da ficha (+ perda %) com margem por produto; locais de estoque com transferência; validade com bloqueio de venda; inventário rotativo; curva ABC + sugestão de compra; módulo chopp/barril.

### A3 — Salão e fechamento — ✅ CONCLUÍDA (61/61 testes + E2E navegador)
Itens 3.1, 3.2, 3.5, 3.7, 3.9, 3.12–3.14, 3.16, 3.17. Comanda numerada do dia, pedido guardar/vai-levar com retomada, bloqueio de mesa, divisão por pessoa/item, conta consolidada, PDF de fechamento, F-keys, chamado de garçom, fechamento de salão.
**Depende de:** A1 (busca e disponibilidade). **Esforço:** médio.

### A4 — Produção por setor e etapa
Itens 4.2–4.7. KDS filtrado por setor, etapas de produção, ficha do dia impressa, rendimento real, prioridades, tempo estimado na comanda.
**Depende de:** A3 (comand
...[truncated 2085 chars]