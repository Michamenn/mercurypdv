# Arquitetura e Decisões Técnicas — Lanchonete Pro / MercuryPDV 1.1

Data: 2026-10-12 · Responsável: Architect/Integrator

## 1. Stack efetiva (verificada no ambiente)

| Camada | Escolha | Justificativa |
|---|---|---|
| Runtime | Node.js **v24.21.0 LTS** (instalado) | Compatível com plano (v20/v22+); LTS atual |
| HTTP | **Express 5** | Padrão do plano; maduro |
| Banco | **SQLite via `node:sqlite` (nativo do Node 24)** | Verificado executando no ambiente. Zero compilação nativa, transações ACID, WAL. `better-sqlite3` foi descartado por exigir binário nativo compilado/baixado — risco de instalação que o driver nativo elimina |
| Tempo real | **ws** (WebSocket) | Padrão do plano |
| Hash de credenciais | **`node:crypto` scrypt** (N=32768, r=8, p=1, 64 bytes) + salt por usuário + pepper em `.env` | Sem dependência nativa (bcrypt/argon2); scrypt é memory-hard e adequado |
| Sessão | Token opaco aleatório (256 bits), **hash SHA-256 no banco**, cookie `httpOnly` `SameSite=Lax` | Revogação server-side trivial; sem segredo JWT a proteger |
| Testes | **`node:test`** (nativo) | Sem dependências; testes de integração com HTTP real |
| Front-end | SPA vanilla JS + CSS, sem build, sem CDN | Operação 100% offline em rede local; nada carregado da internet |
| PWA | `manifest.webmanifest` + `sw.js` + IndexedDB | Contingência limitada (ver PWA-002) |

Dependências externas de produção: **apenas `express` e `ws`**.

## 2. Módulos e fronteiras

```
server/src/
  index.js          Bootstrap: config, db, migrations, express, ws, rotas, shutdown limpo
  config.js         Env/.env validado; geração de pepper na 1ª execução
  db/connection.js  Conexão SQLite (WAL, FK ON, busy_timeout), helper de transação
  db/migrations.js  Runner versionado (schema_migrations), idempotente
  db/migrations/001_init.sql
  core/errors.js    AppError + handler único de erros (sem stack leak)
  core/money.js     Formatação/validação em centavos inteiros
  core/validate.js  Validadores de entrada (tamanho, tipo, faixa)
  core/logger.js    Log com rotação (logs/app-*.log, 10MB × 5)
  core/audit.js     Trilha append-only (INSERT-only; sem UPDATE/DELETE)
  auth/crypto.js    scrypt hash/verify, tokens, sha256
  auth/sessions.js  Criar/validar/revogar sessões; expiração absoluta + inatividade
  auth/ratelimit.js Atraso progressivo + bloqueio por usuário e limitador por IP
  auth/rbac.js      Middleware requireAuth/requirePerm; matriz carregada do banco
  ws/hub.js         Hub WS: auth por mensagem, seq global, heartbeat, broadcast
  services/*.js     Regras de negócio (pedidos, pagamentos, caixa, kds, estoque, backup)
  routes/*.js       Rotas REST finas → delegam aos services
  tools/backup.js   VACUUM INTO + integrity_check + retenção (CLI e endpoint)
public/             SPA (view por cargo), sw.js, manifest
scripts/            iniciar_sistema.bat, parar_sistema.bat, backup.ps1, restaurar_backup.ps1, firewall.ps1
docs/               Documentação operacional e de segurança
data/               lanchonete.sqlite (NUNCA servido por HTTP; fora de public/)
backups/ logs/      Fora de public/
```

**Regra estrutural:** `public/` é a única raiz servida estaticamente; `data/`, `backups/` e `logs/` ficam fora dela — o arquivo SQLite nunca é exposto por HTTP.

## 3. Contratos principais (API)

- Autenticação: `POST /api/auth/login` (pin ou senha), `POST /api/auth/logout`, `GET /api/auth/me`.
- Mutações exigem header `X-Requested-With: XMLHttpRequest` (anti-CSRF; header custom não pode ser enviado cross-origin sem preflight liberado).
- Idempotência: vendas e pagamentos aceitam `Idempotency-Key` (string única, armazenada com UNIQUE). Repetição retorna o registro original (HTTP 200 com `idempotent: true`) — BR-007.
- Dinheiro: sempre **centavos inteiros** (`*_centavos`). O servidor recalcula subtotais/totais; valores vindos do cliente são ignorados (RBAC-002).
- Erros: JSON `{ erro, codigo }`; códigos estáveis (`401_SESSAO`, `403_PERMISSAO`, `409_SALDO_PENDENTE`, `409_CAIXA_FECHADO`, `409_CONFLITO_ESTADO`, `422_VALIDACAO`, `429_BLOQUEIO`...).
- WS: cliente autentica com `{type:"auth", token}`; servidor responde snapshot + `seq` atual; eventos incrementais carregam `seq` monotônico; cliente descarta `seq <= último` e refaz snapshot em lacuna.

## 4. Regras de concorrência, idempotência e transações

1. SQLite em modo **WAL** + `busy_timeout=5000ms`; escritas são serializadas pelo SQLite (single-writer) — operações financeiras rodam em `db.transaction(...)` (BEGIN IMMEDIATE) garantindo atomicidade.
2. **Venda balcão**: criação do pedido + itens em 1 transação, com `Idempotency-Key` única → retransmissão não duplica pedido.
3. **Pagamento**: `pagamentos.idempotency_key` UNIQUE; inserção dentro de transação que recalcula saldo. Empate exato exigido: `sum(pagamentos não estornados) == total` para fechar (BR-003).
4. **Fechamento**: transação única = recalcula total → confere saldo 0 → marca `fechado` → baixa de estoque (movimentação com UNIQUE `tipo+ref+ingrediente`) → evento WS. Reprocessamento não duplica baixa (EST-002).
5. **Caixa**: `CHECK` no serviço — 1 sessão aberta por vez; pagamentos vinculam `caixa_sessao_id` da sessão aberta no momento.
6. **KDS**: transição de estado validada server-side (`pendente→preparando→pronto→entregue`); evento WS com seq; reconexão = snapshot do banco (KDS-004).

## 5. Estratégia de autenticação/autorização

- Login por PIN (4–6 dígitos) para operação; senha forte obrigatória para admin (≥10 chars com letra e dígito). Ambos scrypt+salt+pepper.
- Sessão: cookie `lp_session` httpOnly SameSite=Lax; token hasheado (SHA-256) no banco; expiração 12 h absoluta e 30 min de inatividade; logout revoga imediatamente.
- Rate limit: 5 falhas → bloqueio progressivo 1, 2, 4, 8, 16, 30 min (cap); limiter por IP no endpoint de login; respostas de erro não revelam se o usuário existe.
- RBAC: tabela `permissoes` por cargo; middleware consulta o banco (não o payload do cliente). Negação por padrão: rota sem permissão explícita = 403.
- Step-up: sangria (caixa), cancelamento de item já enviado à cozinha, estorno de pagamento e painel dev exigem `admin_usuario` + `admin_senha` válidos no corpo (DIV-005: sem senha mestra universal).
- CSRF: cookie SameSite=Lax + header custom obrigatório em mutações + sem CORS aberto (mesma origem).
- Bootstrap: se e somente se `usuarios` vazio, `POST /api/auth/setup` cria o 1º admin (senha forte). Depois o endpoint retorna 403 para sempre — nenhuma credencial padrão é enviada em produção.

## 6. Operação offline (delimitada)

- **Sem internet externa**: 100% funcional (tudo local).
- **Sem servidor local**: leitura (catálogo em cache IndexedDB, estado de mesas/KDS do último snapshot) + **fila apenas para transições do KDS** (idempotentes: o servidor revalida e ignora transição já aplicada). Vendas, pagamentos e alterações financeiras **nunca** são feitos offline — o cliente só finaliza com confirmação do servidor (PWA-002).

## 7. Recibos/impressão

- O servidor gera `conteudo_json` estruturado (itens, pagamentos, troco) e o cliente renderiza HTML 58/80 mm (`@page`) para `window.print()`. Reimpressão é registrada em auditoria. Sem valor fiscal (BR-002).

## 8. Decisões registradas

| ID | Decisão | Motivo |
|---|---|---|
| AD-001 | `node:sqlite` nativo em vez de better-sqlite3 | Verificado no ambiente; remove risco de build nativo |
| AD-002 | Desconto admin-only (caixa opt-in via config) | Sem regra documentada; conservador e configurável |
| AD-003 | Estorno de pagamento só com pedido aberto | Evita retrabalho de fechamentos confirmados; cancelamentos posteriores = fluxo de suporte |
| AD-004 | Estoque permite saldo negativo com alerta | Fast-food não pode bloquear venda por ficha desatualizada; alerta e histórico garantem visibilidade |
| AD-005 | Sessão opaca em vez de JWT | Revogação imediata e simples; sem segredo de assinatura para gerenciar |
| AD-006 | Sem CDN/fontes externas | Offline-first estrito |
