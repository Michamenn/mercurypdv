**Aceite do responsavel (2026-10-13): ACEITO integralmente. Parte 1 toda aceita. Parte 2 pelo padrao sugerido (caixa: desconto/sangria/cancelar/receber/caixa; garcom: so comandas; cozinha: so KDS; demais: so admin). Desconto do caixa segue via config opt-in (desconto_caixa_permitido).

# Checklist de Funcionalidades — Atuais e Novas a Atribuir
**Lanchonete Pro / MercuryPDV 1.1 · Data: 2026-10-12 · Base: 61/61 testes + matriz de permissões do banco**

Legenda de estado: ✅ implementado e testado · 🛠 implementado, aguardando este aceite · ⏳ nas atualizações autorizadas (A4 / evolução) · 🔒 só admin (trava anti-bloqueio)
Marque: `[ ]` pendente · `[x]` aceito · `[~]` aceito com ressalva (anotar ao lado)

---

## Parte 1 — Funcionalidades atuais (conferir e aceitar)

### Acesso e equipe
| # | Funcionalidade | Estado | Aceite |
|---|---|---|---|
| 1 | Login por PIN (4–6 dígitos) + senha forte p/ admin | ✅ | `[ ]` |
| 2 | Bloqueio progressivo após 5 erros + botão desbloquear | ✅ | `[ ]` |
| 3 | Sessão com expiração, logout imediato, bloqueio de tela | ✅ | `[ ]` |
| 4 | Cadastro de funcionários por cargo (admin/caixa/garçom/cozinha) | ✅ | `[ ]` |
| 5 | **NOVO:** matriz de permissões editável por cargo (18 funções, com trava anti-bloqueio do admin) | 🛠 | `[ ]` |
| 6 | **NOVO:** desabilitar/habilitar funcionário sem apagar histórico | ✅ (ativo/inativo) | `[ ]` |

### PDV e vendas
| # | Funcionalidade | Estado | Aceite |
|---|---|---|---|
| 7 | Catálogo por categoria, busca por nome/apelido, bip de código de barras | ✅ | `[ ]` |
| 8 | Variações (P/M/G, ponto, sabor) com preço, adicionais, observações | ✅ | `[ ]` |
| 9 | Mais vendidos na tela + F2 vender / F4 limpar / F8 buscar | ✅ | `[ ]` |
| 10 | Pagamento dividido (dinheiro/PIX/débito/crédito/vale) + troco + valor exato | ✅ | `[ ]` |
| 11 | Trava de saldo pendente (não fecha conta aberta) | ✅ | `[ ]` |
| 12 | Combos (4 tipos) + promoções com janela dia/horário e limite de usos | ✅ | `[ ]` |
| 13 | Desconto e cortesia só com permissão + motivo auditado | ✅ | `[ ]` |
| 14 | Venda para viagem 🥡 e pedido guardado ⏸ com retomada | ✅ | `[ ]` |
| 15 | Recibo não fiscal 58/80 mm + reimpressão auditada, **sem taxa de serviço** | ✅ | `[ ]` |

### Mesas, comandas e cozinha
| # | Funcionalidade | Estado | Aceite |
|---|---|---|---|
| 16 | Mapa de mesas (livre/ocupada), renumerar, bloquear, excluir sem histórico | ✅ | `[ ]` |
| 17 | Comanda numerada do dia, observação, encaminhar à cozinha | ✅ | `[ ]` |
| 18 | Conta consolidada (impressão), divisão por pessoa com totais no servidor | ✅ | `[ ]` |
| 19 | Chamado de garçom 🔔 com aviso sonoro + atendimento | ✅ | `[ ]` |
| 20 | KDS em tempo real, som por estado, atraso, transições validadas | ✅ | `[ ]` |

### Caixa e financeiro
| # | Funcionalidade | Estado | Aceite |
|---|---|---|---|
| 21 | Abertura/fechamento com fundo, conferência por forma, divergência | ✅ | `[ ]` |
| 22 | Sangria/suprimento com autorização admin + motivo | ✅ | `[ ]` |
| 23 | PDF do fechamento do turno | ✅ | `[ ]` |
| 24 | Relatórios (bruto/desconto/líquido/ticket/top) + PDF, fechamento de salão assinado | ✅ | `[ ]` |

### Estoque e cardápio
| # | Funcionalidade | Estado | Aceite |
|---|---|---|---|
| 25 | Ficha técnica com perda %, custo/margem automáticos | ✅ | `[ ]` |
| 26 | Baixa FIFO por validade, bloqueio de vencido, transferência entre locais | ✅ | `[ ]` |
| 27 | Inventário rotativo, curva ABC, sugestão de compra, chopp/barris | ✅ | `[ ]` |
| 28 | Preço programado com vigência + histórico, períodos de cardápio | ✅ | `[ ]` |
| 29 | Cardápio em PDF por categoria | ✅ | `[ ]` |

### Sistema
| # | Funcionalidade | Estado | Aceite |
|---|---|---|---|
| 30 | Temas (escuro/claro/contraste), fonte, densidade, navegação lateral/superior | ✅ | `[ ]` |
| 31 | Acessibilidade (teclado, foco visível, contraste, leitor de tela) | ✅ | `[ ]` |
| 32 | Backup automático + manual + restauração validada | ✅ | `[ ]` |
| 33 | Trilha de auditoria imutável de tudo crítico | ✅ | `[ ]` |
| 34 | PWA instalável, funciona sem internet externa, fila KDS offline | ✅ | `[ ]` |

---

## Parte 2 — Novas a atribuir por cargo (preencher e aplicar na matriz)

Para cada função nova abaixo, marque quais cargos liberam. Depois aplique em **Administração → Permissões**.

| # | Função nova | Admin | Caixa | Garçom | Cozinha |
|---|---|---|---|---|---|
| N1 | Dar cortesia/brinde (`pode_brinde`) | 🔒 Sim | `[ ]` | `[ ]` | `[ ]` |
| N2 | Gerenciar combos/promoções (`pode_gerenciar_combos`) | 🔒 Sim | `[ ]` | `[ ]` | `[ ]` |
| N3 | Aplicar desconto (`pode_desconto`) | 🔒 Sim | `[ ]` | `[ ]` | `[ ]` |
| N4 | Ver relatórios gerenciais (`pode_ver_relatorios`) | 🔒 Sim | `[ ]` | `[ ]` | `[ ]` |
| N5 | Sangria/suprimento (`pode_sangria_suprimento`, sempre c/ autorização) | 🔒 Sim | `[ ]` | `[ ]` | `[ ]` |
| N6 | Cancelar item já enviado (`pode_cancelar_item` + step-up) | 🔒 Sim | `[ ]` | `[ ]` | `[ ]` |
| N7 | Gerenciar mesas: criar/renumerar/bloquear (`pode_gerenciar_mesas`) | 🔒 Sim | `[ ]` | `[ ]` | `[ ]` |
| N8 | Avançar KDS (`pode_avancar_kds`) | 🔒 Sim | `[ ]` | `[ ]` | `[ ]` |
| N9 | Gerenciar estoque (`pode_estoque_gerenciar`) | 🔒 Sim | `[ ]` | `[ ]` | `[ ]` |
| N10 | Backups manuais (`pode_backup`) | 🔒 Sim | `[ ]` | `[ ]` | `[ ]` |
| N11 | Receber/fechar contas (`pode_dividir_pagar`) | 🔒 Sim | `[ ]` | `[ ]` | `[ ]` |
| N12 | Abrir/fechar caixa (`pode_abrir_fechar_caixa`) | 🔒 Sim | `[ ]` | `[ ]` | `[ ]` |

Sugestão padrão (só confirme ou ajuste): Caixa = N3*, N5, N6*, N11, N12 (*com autorização admin); Garçom = nenhuma das N (só comandas+KDS leitura); Cozinha = N8.
*Regras comerciais fixas (não atribuíveis):* sem taxa de serviço, só recibo não fiscal, trava de saldo pendente, auditoria sempre ativa.

---

## Parte 3 — Faltantes autorizados (acompanhar)

| Item | Estado |
|---|---|
| A4 — KDS por setor/etapa, ficha do dia, prioridades | ⏳ próximo |
| Navegação flutuante personalizável | 🛠 em implementação |
| Tela mobile de pedidos | 🛠 em implementação |
| Logo do estabelecimento (upload) | 🛠 em implementação |
| Janela dia/horário + limite nas promos (UI) | 🛠 em implementação |
| Homologação no estabelecimento (docs/07) | ⏳ após aceite |

**Como usar:** responda com os `[x]` da Parte 1, a tabela da Parte 2 preenchida (ex: `N3: caixa; N8: cozinha`) e `OK A4` ou ajustes. Só marco como HOMOLOGADO após esse retorno + checklist docs/07 no local.
