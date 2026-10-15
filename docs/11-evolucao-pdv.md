# Evolução PDV — Navegação Flutuante, Mobile, Logo, Promos, Permissões
**Data: 2026-10-13 · Suíte: 67/67 aprovados · `npm audit`: 0 vulnerabilidades · E2E em navegador real**

## 1. Diagnóstico do sistema atual
Node.js 24 + Express 5 + SQLite nativo + WS; SPA vanilla sem build e sem CDN (offline-first); 100 rotas REST; 8 migrações; 9 arquivos de teste. RBAC por cargo validado no servidor, auditoria imutável, PDV com totais server-side, KDS tempo real, backups validados. Nada precisou ser reconstruído.

## 2. Funcionalidades existentes preservadas
Autenticação/PIN/sessões, as 4 fases de venda e caixa, combos, estoque FIFO, mesas/comandas, KDS, relatórios, backups, PWA, temas e acessibilidade — todas cobertas pela suíte de regressão (61 testes antigos continuam verdes).

## 3. Problemas identificados e evidências
| # | Problema | Evidência |
|---|---|---|
| P1 | Navegação lateral fixa, sem personalização | Código: `menu-lateral` estático em `app.js` |
| P2 | Sem logomarca (só nome em texto) | `configuracao` sem campo de imagem; login sem logo |
| P3 | Sem tela de pedido otimizada p/ celular | Só PDV desktop responsivo |
| P4 | Promos sem janela dia/horário e sem limite de usos | Tabela `combos` sem os campos (migração 008 os criou) |
| P5 | Operador bloqueado exigia intervenção no banco | Sem endpoint/UI de desbloqueio |
| P6 | Aba Combos do admin sempre quebrava | `TypeError: estadoApp undefined` no console (assinatura com 2 args vs 3 params) |
| P7 | Imports quebrados travavam boot (`initTheme`, `atualizarUI`) | Erros no console, corrigidos na extensão anterior |

## 4. Arquitetura proposta (e aplicada)
Mantida a arquitetura (Express + SQLite + SPA sem build). Novos módulos: `views/mobile.js` (pedido mobile), aba Permissões + telas em `admin.js`, preferências de nav em `localStorage` + default no servidor (`nav_posicao_padrao`), uploads validados em `public/uploads/`, janela promocional nas tabelas `combos`. Sem dependências novas, sem CDN, sem ciclos de import.

## 5. Plano de melhorias priorizado
| Ordem | Item | Estado |
|---|---|---|
| 1 | Fiação backend (008, logo, matriz, desbloqueio) | ✅ feito |
| 2 | Navegação flutuante personalizável | ✅ feito |
| 3 | Tela mobile de pedidos | ✅ feito |
| 4 | Logo upload + exibição | ✅ feito |
| 5 | UI da janela promocional | ✅ feito |
| 6 | Aba Permissões + desbloquear | ✅ feito |
| 7 | Testes + E2E + docs | ✅ feito |

## 6. Alterações implementadas
Backend: migração 008; janela/limite em `combosService` + filtro em `/combos/vigentes`; `nav_posicao_padrao`/`logo_path` validados; `POST/DELETE /config/logo` (magic bytes, 400 KB); `GET/PUT /permissoes` (trava anti-bloqueio do admin); `POST /usuarios/:id/desbloquear`; `logo_path` em `/auth/status` e `/auth/me`.
Frontend: nav flutuante lateral/superior/inferior-mobile com ícones + rótulos editáveis + modo compacto; `views/mobile.js` (modalidades, cards, carrinho, idempotência); upload de logo com prévia; janela dia/hora/limite no cadastro de promo; aba 🔐 Permissões (18×4 toggles); botão 🔓 desbloquear; logo no login e no topo; correção da aba Combos.

## 7. Arquivos criados ou modificados
Criados: `migrations/008_promo_janela.sql`, `views/mobile.js`, `tests/10-evolucao.test.js`, `public/uploads/.gitkeep`, este documento. Modificados: `combosService.js`, `usuariosService.js`, `configService.js`, `routes/api.js`, `app.js`, `app.css`, `sw.js`, `admin.js`, `combos.js`, `login.js`, `mobile` (novo), `package.json`, `.gitignore`, `docs/01`.

## 8. Testes realizados e resultados
`npm test`: **67/67 aprovados** (6 novos: EV-001..EV-006). `npm audit`: 0 vulnerabilidades. E2E no navegador: nav lateral→superior+compacta+rótulo custom persistido; venda mobile criada (R$ 25,00); upload de logo 201 com exibição no topo; matriz editada pela UI com confirmação; aba Combos abrindo com janela dia/hora/limite. Bugs pegos pelos testes/E2E: `crypto` sombreado no router, `nav_posicao_padrao`/`logo_path` fora do `/auth/me`, `mobile.js` fora do SW, aba Combos com assinatura errada.

## 9. Instruções para executar localmente
`npm install` → duplo clique em `scripts\iniciar_sistema.bat` → http://localhost:3000. Celulares: mesmo Wi-Fi, `http://<IP-do-servidor>:3000`, instalar como PWA. Detalhes em `docs/05-operacao-windows11.md`.

## 10. Limitações conhecidas
- Novo perfil "gerente" intermediário exige rebuild de tabelas com CHECK (migração destrutiva) — documentado como evolução futura; os 4 cargos atuais cobrem a operação.
- Uploads ficam em `public/uploads/` (git-ignorados, incluídos no backup de arquivos).
- Sem TLS na LAN (P-03, decisão pendente do responsável).
- Homologação física (impressora, 3 aparelhos) segue pendente (docs/07).

## 11. Sugestões adicionais de evolução
Dashboard gerencial em tempo real (era item 9 da lista de 12); TLS local; exportação contábil; fechamento cego; fidelidade; pacotes SUG-XX já apresentados aguardam códigos.

## 12. Próximos passos recomendados
1. Aceitar este checklist (docs/10) marcando `[x]`.
2. Escolher: `A4` (KDS por setor/etapa — última das 4 atualizações) ou códigos `SUG-*`.
3. Homologação no estabelecimento (docs/07) antes de produção.

## Extensão — Tema Premium + UI monocromática (2026-10-13)
Quarta opção de tema (bronze #9A3412 sobre neutros claros, blur, sombras suaves) válida no servidor e herdável como global. Correção: global do admin sobrescrevia a preferência local em todo boot (marcador tema_global_definido). Toda a UI migrada de emojis coloridos para ~60 ícones SVG monocromáticos (currentColor, aria-hidden); teste UI-001 proíbe regressão. Bugs: concatenação literal vazando em template (reparo sistemático), ic() em toasts (texto puro), SW desatualizado (versão lp-v5).
