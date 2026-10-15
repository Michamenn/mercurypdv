# Lanchonete Pro / MercuryPDV 1.1 — Auditoria Técnica e Matriz de Requisitos

Data: 2026-10-12 · Auditor: Integrator (fase 1)

## 1. Diagnóstico inicial

| Item | Resultado |
|---|---|
| Código-fonte existente | **Nenhum** — projeto greenfield (greenlit para criação, não há evolução a preservar) |
| `package.json` / dependências | Inexistentes |
| Migrações / banco | Inexistentes |
| Testes existentes | Inexistentes — nada a executar antes das mudanças |
| Git | Diretório não é repositório |
| Ambiente de execução | Node.js **v24.21.0** (LTS), npm 11.19.0, Windows NT — compatível com o plano (v20/v22 LTS exigidos; v24 LTS é superior e compatível) |
| Driver SQLite | `node:sqlite` nativo verificado funcionando (teste executado: criação de tabela + insert + select OK). Elimina risco de compilação nativa (better-sqlite3) |
| Arquivos de planejamento | `implementation_plan.md` (doc A) e `implementation_plan1.md` (doc B) lidos integralmente |
| Conteúdo não-produto | `searching-for-skills.json` (log de sessão de agente) e 5 pastas de skills (`ai-agent-development`, `code-documentation-doc-generate`, `code-review-ai-ai-review`, `codex-review`, `design-md`) — **não fazem parte do produto; preservados sem alteração** |

## 2. Divergências entre documentos (BR-010)

| ID | Divergência | Doc A | Doc B | Decisão adotada |
|---|---|---|---|---|
| DIV-001 | Taxa de serviço | **Proibida** ("Proibida a cobrança ou cálculo de taxa de 10%") | Recibo com "taxa de serviço opcional" | **Doc A + BR-001 prevalecem: sem taxa de serviço**, nem como opção. O campo não existirá no código |
| DIV-002 | Cargos | Entidade lista `gerente`, mas a matriz de permissões só tem 4 cargos | 4 cargos (`admin, caixa, garcom, cozinha`) | Implementados os **4 cargos da matriz**. `gerente` não é implementado (não tinha permissões definidas) |
| DIV-003 | Sincronização em nuvem | Não menciona | "sincronização em nuvem" / backup em nuvem | **Não implementado.** Conflita com offline-first e amplia superfície de ataque. Backup 100% local (BR: rede local sem internet externa) |
| DIV-004 | Delivery | Tipos: `balcao`, `mesa` | Tipos incluem `delivery` | **Não implementado nesta versão** — registrado como pendência (nenhum fluxo de delivery foi especificado) |
| DIV-005 | Senha mestra do modo desenvolvedor | "Acesso ao Modo Desenvolvedor: Sim (Senha mestre)" | — | **Sem senha mestra universal** (BR-009 veda backdoor). Modo dev = cargo admin + *step-up* de reautenticação com a própria senha do admin |
| DIV-006 | Vale Refeição | Formas: dinheiro, PIX, cartões | Conferência inclui "Vale Refeição" | **Implementado** como forma de pagamento adicional (união dos documentos, sem alterar regra comercial) |
| DIV-007 | PIN 4 dígitos | "PIN Touch (4 a 6 dígitos)" / `pin_hash` | `pin_code` (implícito texto puro) | **4–6 dígitos, armazenado apenas como hash scrypt com salt + pepper** (requisito de segurança prevalece sobre doc B) |

## 3. Matriz de requisitos (v2 — estado final da implementação)

Prioridades: P0 = crítico (integridade financeira/segurança), P1 = essencial, P2 = desejável.
Estados (2026-10-12): **TESTADO** = validado por suíte automatizada (26/26) e/ou E2E em navegador real. Detalhes em `04-testes-e-evidencias.md`; pendências em `08-limitacoes-e-pendencias.md`. | ID | Requisito | Pri | Critério de aceitação (verificável) | Estado final |
|---|---|---|---|---|
| DB-001 | SQLite persistente em arquivo, WAL, FK ON | P0 | Dados sobrevivem a reinício do processo (teste) | TESTADO |
| DB-002 | Migrações versionadas e idempotentes | P0 | Migração aplica uma vez; reexecução não duplica | TESTADO |
| DB-003 | Valores monetários em centavos inteiros | P0 | Nenhum float armazenado; soma exata em testes | TESTADO |
| DB-004 | Transações em operações financeiras | P0 | Falha no meio = rollback (teste de concorrência) | TESTADO |
| DB-005 | FKs, índices e restrições UNIQUE (idempotência) | P0 | Tentativa de duplicata rejeitada pelo banco | TESTADO |
| DB-006 | Auditoria imutável de operações críticas | P0 | INSERT-only; triggers abortam UPDATE/DELETE | TESTADO |
| AUTH-001 | Login PIN (4–6) e senha forte, hash scrypt+salt+pepper | P0 | Hash em banco; nunca texto puro; pepper fora do repo | TESTADO |
| AUTH-002 | Sessão por cookie httpOnly + token hasheado no banco | P0 | Sessão revogada após logout não autentica mais | TESTADO |
| AUTH-003 | Rate limit + atraso progressivo + bloqueio temporário | P0 | 5 erros → bloqueio crescente (teste) | TESTADO |
| AUTH-004 | Logout efetivo e expiração (absoluta + inatividade) | P0 | Cookie invalidado no servidor | TESTADO |
| AUTH-005 | Bootstrap: 1º admin criado só quando 0 usuários | P0 | Endpoint fecha-se após 1º cadastro; sem credencial padrão | TESTADO |
| AUTH-006 | CSRF: SameSite + header custom obrigatório em mutações | P0 | POST sem header é rejeitado 403 | TESTADO |
| RBAC-001 | Permissões validadas no backend em toda rota protegida | P0 | Requisições diretas à API sem cargo = 403 (12 casos) | TESTADO |
| RBAC-002 | Matriz de permissões em tabela, negócio não confia no cliente | P0 | Cargo/preço/total enviados pelo cliente são ignorados | TESTADO |
| RBAC-003 | Step-up admin (senha) para operações sensíveis | P1 | Sangria/estorno/cancelamento pós-envio conforme matriz | TESTADO |
| PDV-001 | Catálogo: categorias, produtos, adicionais, observações | P1 | CRUD admin + consulta operacional funcionais | TESTADO (UI+E2E) |
| PDV-002 | Carrinho com totais calculados no servidor | P0 | Total nunca vindo do cliente; soma exata (10700) | TESTADO |
| PDV-003 | Desconto com permissão + motivo obrigatório | P0 | Sem permissão = 403; desconto em auditoria | TESTADO |
| PDV-004 | Pagamento dividido (≥2 formas), troco no dinheiro | P0 | Soma exata = total; troco correto (1000) | TESTADO (UI+E2E) |
| PDV-005 | Fechamento bloqueado com saldo pendente > 0 (BR-003) | P0 | Tentativa = 409; saldo calculado no servidor | TESTADO |
| PDV-006 | Idempotência de venda/pagamento (Idempotency-Key) | P0 | Retransmissão não duplica pagamento | TESTADO |
| PDV-007 | Cancelamento/estorno rastreável (usuário, motivo, quando) | P0 | Item mantido com flag cancelado, nunca apagado | TESTADO |
| PDV-008 | Venda exige caixa aberto; responsável registrado | P0 | Sem sessão de caixa = 409 (validado também na UI) | TESTADO (UI+E2E) |
| PDV-009 | Recibo não fiscal + reimpressão controlada (BR-002) | P1 | Recibo 58/80 mm; reimpressões contadas na auditoria | TESTADO (80 mm em UI; 58 mm via API) |
| CAX-001 | Abertura/fechamento de turno com saldo inicial | P0 | 2 caixas abertos simultâneos = 409 | TESTADO |
| CAX-002 | Sangria/suprimento com motivo + autorização | P0 | Sangria caixa exige step-up admin (matriz) | TESTADO |
| CAX-003 | Conferência por forma de pagamento e divergência | P1 | Fechamento apura esperado × informado (−500 testado) | TESTADO |
| CAX-004 | Histórico imutável de movimentações | P0 | Triggers bloqueiam UPDATE/DELETE | TESTADO |
| MESA-001 | Mapa de mesas com estados (livre/ocupada/fechando) | P1 | Transições inválidas rejeitadas (2ª comanda = 409) | TESTADO |
| MESA-002 | Comanda: abrir, adicionar itens, encaminhar cozinha | P1 | Item só vai à cozinha via "encaminhar" explícito | TESTADO |
| MESA-003 | Garçom cancela item apenas antes do envio | P1 | Pós-envio exige permissão + autorização (auditoria) | TESTADO |
| MESA-004 | Pagamento/fechamento da comanda com regras PDV | P0 | Mesma trava de saldo pendente (BR-003) | TESTADO |
| KDS-001 | Fila KDS com transições pendente→preparando→pronto→entregue | P1 | Transição inválida/pulo rejeitado | TESTADO |
| KDS-002 | Tempo/atividade com base em horários do servidor | P1 | Atraso calculado com `enviado_cozinha_em` do banco | TESTADO (UI mostra cronômetro) |
| KDS-003 | WebSocket tempo real com seq + snapshot (recuperação) | P1 | Cliente fora de ordem/duplicado não corrompe estado | TESTADO (seq monotônico verificado) |
| KDS-004 | Estado reconstruído após reinício do servidor | P1 | KDS recarrega do banco pós-restart | TESTADO |
| EST-001 | Ingredientes + ficha técnica (produto→ingredientes) | P2 | Baixa calculada pela ficha (100 g + 150 g testadas) | TESTADO |
| EST-002 | Baixa automática no fechamento, 1× por venda | P1 | Reprocessamento não dupla-baixa (UNIQUE) | TESTADO |
| EST-003 | Entrada/perda/ajuste com histórico e usuário | P1 | Movimentação registrada com autor | TESTADO |
| EST-004 | Estoque mínimo + alerta | P2 | Consulta retorna itens abaixo do mínimo + evento WS | TESTADO |
| REL-001 | Faturamento: bruto, descontos, cancelamentos, líquido | P1 | Metodologia documentada e valores batem (6500/500/600/6000) | TESTADO |
| REL-002 | Ticket médio, top produtos, por forma de pagamento | P1 | Valores batem com dados de teste | TESTADO |
| REL-003 | Acesso a relatórios só admin (matriz) | P0 | Caixa/garçom/cozinha = 403 | TESTADO |
| PWA-001 | Manifest + service worker (cache estático) | P2 | Instalável; API sempre rede | IMPLEMENTADO (SW registrado no E2E) |
| PWA-002 | IndexedDB: cache catálogo + fila SOMENTE para KDS | P1 | Vendas nunca offline; fila idempotente | IMPLEMENTADO — queda real de rede é checklist E-06 (P-08) |
| PWA-003 | Indicador de conexão/sincronização | P1 | "● Online/Sem conexão" no topo | IMPLEMENTADO (visível no E2E) |
| BKP-001 | Backup online consistente (VACUUM INTO) + integrity_check | P0 | Backup validado por PRAGMA | TESTADO |
| BKP-002 | Retenção configurável + registro de execuções | P1 | Backup antigo removido; histórico em jsonl | TESTADO |
| BKP-003 | Restauração testada em banco separado | P0 | Restaurar → integrity ok → dados presentes | TESTADO |
| WIN-001 | Scripts iniciar/parar com logs | P1 | `iniciar_sistema.bat`/`parar_sistema.bat` prontos | PRONTO — execução no PC alvo é manual (checklist A) |
| WIN-002 | Firewall: porta 3000 só perfil privado | P1 | Script pronto; exige PowerShell admin | PRONTO — execução manual (A-03) |
| WIN-003 | Graceful shutdown sem perda de dados | P0 | Restart não apaga dados; SIGINT faz checkpoint WAL | TESTADO |
| HOM-001 | Suíte de testes automatizados (18 cenários) | P0 | `npm test` 26/26 verde | TESTADO |
| HOM-002 | Checklist de homologação + registro de limitações | P0 | docs/07 e docs/08 entregues | ENTREGUE — execução real com o dono |
| CMB-001 | CRUD de combos com permissão por cargo | P1 | Admin cria/edita; caixa = 403 | TESTADO |
| CMB-002 | preco_fixo aplica desconto exato no servidor | P1 | Soma 4600 − fixo 3990 = desconto 610; fecha com pagamento exato | TESTADO (API + UI) |
| CMB-003 | Idempotência de aplicação de combo | P1 | Mesma key → sem duplicar itens/desconto (tabela pedido_combos) | TESTADO |
| CMB-004 | Tipos leve_pague, percentual, brinde, grupos de escolha | P1 | Matemática verificada por tipo; max por grupo imposto | TESTADO |
| CMB-005 | Vigência e estoque bloqueiam combo inválido | P1 | Expirado/inativo/estoque insuficiente = 422 | TESTADO |
| CMB-006 | Modo somente_desconto (pedido montado no carrinho) | P1 | Só benefício, sem duplicar itens; sem cobertura = 422 | TESTADO |
| MESA-EDIT | Renumerar/excluir mesa com validações | P2 | Livre ok; ocupada/duplicada/com histórico = 409; edição inline no mapa (admin) | TESTADO (API + UI) |
| FE-001 | Acessibilidade essencial fiada | P0 | Skip link, live assertive, :focus-visible, reduced-motion, teclado (setas/Esc/Enter) | TESTADO (estático + navegador) |
| FE-002 | Tema 3 bases + densidade + persistência global | P1 | Defaults admin validados (anti-injeção CSS); 1º acesso herda servidor | TESTADO (API + navegador) |
| FE-003 | Som do KDS fiado + toggle | P1 | Toca em novo/pronto/atraso; painel no KDS; Web Audio nativo | TESTADO (estático + navegador) |
| FE-004 | PDF 100% local + combo no PDV/comanda | P1 | Sem CDN (vendor/); seletor no pagamento e na comanda; botão valor exato | TESTADO (PDF real gerado no navegador) |
| A1-001 | Tipos, código de barras único, apelidos normalizados | P1 | UNIQUE + normalização; caixa barrado no cadastro | TESTADO |
| A1-002 | Variações com delta no preço da venda | P1 | Múltiplas por grupo; snapshot no item; cruzada/inativa = 422 | TESTADO |
| A1-003 | Indisponível com motivo trava venda; liberar volta | P1 | 422 com motivo; catálogo sinaliza; auditoria registra | TESTADO (API + UI) |
| A1-004 | Período de cardápio restringe fora do horário | P1 | Validação de dias/horário; sem vínculo = sempre | TESTADO |
| A1-005 | Preço programado aplica na vigência + histórico | P1 | Futuro pendente; passado aplica; aplicação automática auditada | TESTADO |
| A1-006 | Mais vendidos reflete fechadas | P2 | Agregação por produto em período | TESTADO |
| A2-001 | Transferência entre locais preserva total | P1 | Lotes movidos; origem sem saldo = 422; permissão exigida | TESTADO |
| A2-002 | Baixa FIFO por validade | P1 | Lote mais próximo consumido primeiro | TESTADO |
| A2-003 | Vencido bloqueia venda; baixa de vencidos | P0 | 422 com motivo; `baixar-vencidos` auditado | TESTADO |
| A2-004 | Perda na baixa + custo recalculado | P1 | 150g×1.1=165g; custo 660, margem 73,6% | TESTADO |
| A2-005 | Inventário rotativo com ajuste auditado | P1 | Divergência ajusta saldo + trilha | TESTADO |
| A2-006 | Curva ABC, sugestão de compra, barris | P2 | Classes A/B/C; ~copos por barril; 1 ativo por chopp | TESTADO |
| A3-001 | Numeração da comanda, canal viagem, observação | P1 | numero_dia sequencial; canal; obs | TESTADO |
| A3-002 | Guardar/retomar pedido | P1 | Flag + auditoria; fechado não guarda | TESTADO |
| A3-003 | Cortesia com permissão e motivo | P1 | pode_brinde (só admin); item zero; total inalterado | TESTADO |
| A3-004 | Divisão por pessoas no servidor | P1 | Grupos + rateio validado; excesso = 422 | TESTADO |
| A3-005 | Bloqueio de mesa | P1 | Livre bloqueia/desbloqueia; ocupada não; comanda barrada | TESTADO |
| A3-006 | Chamado de garçom | P1 | Dedup por tipo; atender; WS + auditoria | TESTADO |
| A3-007 | Fechamento de salão + assinatura | P1 | Por garçom/entregues; PNG validado; caixa barrado | TESTADO |
| A3-008 | Detalhe da sessão p/ PDF | P1 | Esperado, vendas, movimentações; permissão | TESTADO |
| EV-001 | Posição padrão da navegação configurável | P1 | Admin define; operador sobrescreve; validado | TESTADO |
| EV-002 | Upload de logo com validação de conteúdo | P1 | Magic bytes + 400 KB; login/topo exibem; reversível | TESTADO |
| EV-003 | Promoção com janela dia/horário e limite de usos | P1 | Fora da janela/limite = 422; vigentes filtra | TESTADO |
| EV-004 | Matriz de permissões editável + trava anti-bloqueio | P0 | Revogação imediata; admin protegido; auditoria | TESTADO |
| EV-005 | Desbloquear funcionário | P1 | Zera falhas/bloqueio; só admin; auditado | TESTADO |
| EV-006 | Fiação frontend (nav/mobile/logo) | P1 | Guards estáticos anti-regressão | TESTADO |
| TM-PREM | Quarta opção de tema Premium minimalista | P1 | Paleta bronze/clara, blur, global validado | TESTADO |
| UI-MONO | Interface 100% monocromática (60+ ícones SVG) | P1 | Zero emoji colorido; currentColor; ARIA preservada | TESTADO |
| CB-001 | Exportação de cardápio em JSON | P1 | Estrutura completa; só admin/produtos | TESTADO |
| CB-002 | Importação com backup automático antes | P1 | Upsert por nomes; backup antes-importar; 422 em inválido | TESTADO |
| CB-003 | Download/upload de backup do sistema | P0 | Anti-traversal; valida header+integrity; restauração via script parado | TESTADO |
| PDV-010 | Fechamento valida quitação (anti-corrupção) | P0 | Troco/forma/soma conferidos; 409 com detalhe | TESTADO |
| PDV-011 | Divisão por pessoas só fecha exata | P0 | Rateio centavo a centavo; soma exata exigida | TESTADO |
| PDV-012 | Finalizar + Dividir + Troco exato na UI | P1 | Botão renomeado; atalho exato; numpad com extra | TESTADO |
| PDV-013 | Resumo Total/Pago/Falta + trava visual | P0 | Barra de quitação; botão fechar desabilitado; conferência prévia | TESTADO |

**Não-objetivos (BR-002, DIV-003, DIV-004):** emissão fiscal (SAT/NFC-e/NFe), taxa de serviço, sincronização em nuvem, delivery, pagamento integrado com provedores (PIX confirmado por API / maquininhas) — pagamentos são lançados pelo operador, nunca "confirmados" pelo sistema.

## 4. Riscos iniciais

1. **PIN de 4 dígitos tem entropia baixa** — mitigação: rate limit + bloqueio + pepper + rede local; risco residual documentado em `03-seguranca-e-riscos.md`.
2. **Impressão depende do driver do navegador/impressora térmica** — será validada apenas como preview HTML; teste em hardware real é homologação manual (limitação registrada).
3. **Windows/kiosque, firewall e inicialização automática exigem execução com privilégio local** — fornecidos scripts; execução administrativa é passos manuais do responsável.
