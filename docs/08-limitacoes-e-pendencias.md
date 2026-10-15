# Limitações e Pendências (registro honesto do estado real)

Data: 2026-10-12 (atualizado — A1+A2 concluídas, 61/61 testes) · Estado geral: **IMPLEMENTADO + TESTADO (70/70) — PENDENTE DE HOMOLOGAÇÃO EM AMBIENTE REAL**

O sistema não deve ser considerado "em produção" até executar o `docs/07-homologacao-checklist.md` no estabelecimento, especialmente os itens de hardware (impressora térmica), rede real e restauração de backup fora da máquina de produção.

## Baixadas (atualizado: A1 + A2 + A3 + evolucao + cardapio/backup concluidas — 75/75 testes)
- ✅ **A2 Custo real e estoque profissional (itens 1.12, 1.13, 2.4–2.9): CONCLUÍDA**
- ✅ **A3 Salão e fechamento (itens 3.1, 3.2, 3.5, 3.7, 3.9, 3.12–3.14, 3.16, 3.17): CONCLUÍDA** — custo/margem automáticos, perda na ficha e na baixa, transferência entre locais, FIFO por validade com bloqueio de venda, inventário rotativo, curva ABC, sugestão de compra, chopp/barris, perdas tipadas, aba Estoque no admin.
- ✅ **A1 Cardápio inteligente (itens 1.1–1.10): CONCLUÍDA** — tipos, variações, apelidos+busca, código de barras+bip, indisponível com motivo, preço programado com vigência, períodos, cardápio PDF, mais vendidos.
- ✅ Combos como entidade dedicada: **CONCLUÍDO** (4 tipos + validação de estoque + uso no PDV/comanda).
- ✅ Exportação PDF de relatórios: **CONCLUÍDO** (jsPDF local, botão no admin).
- ✅ Alerta sonoro KDS: **CONCLUÍDO** (Web Audio + toggle + sons por estado).
- ✅ Renumerar/excluir mesa: **CONCLUÍDO** (PUT + DELETE validados + edição inline no mapa).
- ⏳ Teste automatizado de queda de rede KDS (item 12), Opções PDV úteis (item 7), KDS extras filtros/timer (item 8), Dashboard (9), Treinamento (10), Guia impressora (11): **pendentes — próximos da fila autorizada**.

## Divergência de escopo registrada (BR-010)
O `ESCOPO_FINAL_CONSOLIDADO.md` propõe 40 itens e pergunta "tudo de uma vez ou releases?". **Prevalece a lista explícita de 12 itens autorizada na mensagem do responsável.** Os 28 itens extras (KDS-01/03/04/05/06/07, MESA-01/02/03, REL-05, SYS-01/03/07, TRANS-02/03/05/06, N-01..N-10) e a seleção CAIXA-01..12 **não foram implementados** — aguardam decisão explícita. TLS local (P-03) também segue pendente de decisão.

## Decisões derivadas de divergências (ver docs/01 §2)
- DIV-003: sincronização em nuvem NÃO implementada (conflito com offline-first e segurança).
- DIV-004: delivery NÃO implementado (sem fluxo especificado nos documentos).
- DIV-005: sem senha mestra universal — painel dev usa reautenticação do próprio admin.

## Pendências técnicas registradas (não bloqueiam homologação, mas são conhecidas)

| ID | Pendência | Impacto | Prioridade |
|---|---|---|---|
| P-01 | Combos/promoções (doc B menciona "montador de combos") não implementados como entidade dedicada — podem ser cadastrados como produto composto com preço fixo | Operacional (contorna via cadastro) | P2 |
| P-02 | Fotos de produtos no catálogo não implementadas (apenas nome/preço) | Visual | P3 |
| P-03 | HTTPS/TLS na rede local não implementado — cookie de sessão viaja em claro na LAN (R-02/R-03) | Segurança em LAN hostil | P1 se a rede for compartilhada |
| P-04 | Exportação de relatórios (PDF/CSV) não implementada (dados visíveis na tela) | Gerencial | P2 |
| P-05 | "Cópia do recibo para WhatsApp" (doc B) não implementada — depende de integração externa opcional | Visual | P3 |
| P-06 | Alerta sonoro do KDS não implementado (apenas visual) | Operacional | P2 |
| P-07 | Renumerar/excluir mesa não implementado (criar nova mesa sim) | Administrativo | P3 |
| P-08 | Fila offline KDS implementada no cliente (offdb.js), mas o drenar automático ainda não foi exercitado em teste automatizado de queda real de rede | Resiliência | P2 — validar no checklist E-06 |
| P-09 | Rotação automática de logs por tamanho implementada, mas sem compressão dos arquivos antigos | Disco | P3 |

## Testes que NÃO puderam ser executados neste ambiente

1. **Impressão em impressora térmica física** (58/80 mm) — sem hardware no ambiente. O preview HTML e a formatação foram validados em navegador; a impressão real é item F do checklist de homologação.
2. **Regra de firewall aplicada** — exige PowerShell elevado (administrador) na máquina alvo; o script está pronto e documentado, execução é manual (checklist A-03).
3. **Múltiplos dispositivos físicos simultâneos** (celular + tablet + caixa) — validado em navegador desktop e por testes de concorrência automatizados (6 pagamentos paralelos), mas o teste físico com 3 aparelhos é o item G-01.
4. **Login por PIN com teclado numérico físico** — o PIN pad tátil foi validado no navegador; teclado físico funciona via foco+digitação, mas não foi testado em quiosque real.

## Não-objetivos permanentes (decisão comercial confirmada)
- Emissão fiscal SAT/NFC-e/NFe (BR-002).
- Taxa de serviço sob qualquer forma (BR-001).
- Confirmação automática de PIX/cartão por integração — pagamentos são sempre lançados pelo operador.
- Senha mestra universal/backdoor (BR-009).
