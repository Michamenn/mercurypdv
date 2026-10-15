# Mercury PDV 1.3 — Agent Instructions

## Quick Start

```bash
# Start server (production)
.\scripts\iniciar_sistema.bat
# Or: node server/src/index.js

# Stop server
.\scripts\parar_sistema.bat

# Run all tests (183 tests)
npm test

# Single test file
node --test tests/01-auth.test.js

# Manual backup
.\scripts\backup.ps1
```

## Architecture Essentials

- **Runtime**: Node.js ≥ 22.5 (uses `node:sqlite` native driver)
- **Stack**: Express 5 + SQLite (WAL mode) + `ws` WebSocket
- **Offline-first**: 100% local LAN, no external CDN/internet required
- **SPA**: Vanilla JS/CSS in `public/` (no build step)

### Directory Boundaries (Critical)

```
public/          → ONLY static root served by Express
data/            → SQLite DB (lanchonete.sqlite) — NEVER served via HTTP
backups/         → VACUUM INTO backups — NEVER served
logs/            → App logs — NEVER served
node_modules/    → Dependencies (already installed, no npm install needed)
```

### Key Entry Points

| File | Purpose |
|------|---------|
| `server/src/index.js` | Bootstrap: config, DB, migrations, Express, WS, routes, graceful shutdown |
| `server/src/config.js` | Loads `.env`, generates pepper on first run, validates config |
| `server/src/routes/api.js` | All REST routes (factory pattern for test isolation) |
| `server/src/services/*.js` | Business logic (pedidos, caixa, estoque, salao, etc.) |
| `server/src/auth/rbac.js` | Permission middleware — checks DB `permissoes` table per request |
| `server/src/tools/backup.js` | VACUUM INTO + integrity_check + retention |
| `deploy/` | VPS deployment kit (Dockerfile, compose, Caddy, scripts) — see `docs/12-deploy-vps-windows.md` |

## Developer Commands

```bash
# Start dev server (same as production)
npm run dev
# or
node server/src/index.js

# Run tests (uses node:test, ephemeral DB per test suite)
npm test

# Create backup manually
node server/src/tools/backup.js
# or PowerShell
.\scripts\backup.ps1 -Motivo "pre-deploy"

# Restore backup (SERVER MUST BE STOPPED)
.\scripts\restaurar_backup.ps1 -Arquivo "lanchonete-2026-10-13T10-00-00-000Z.sqlite"

# Open firewall for LAN access (run once as Admin)
.\scripts\firewall.ps1
```

## Test Conventions

- **Runner**: `node:test` (native, no deps)
- **Isolation**: Each test file calls `iniciarServidorTeste()` → fresh temp DB + server on random port
- **Helpers**: `tests/helpers.js` provides `cliente()`, `semear()` for seeded users/catalog
- **Naming**: `TEST-ID: description` (e.g., `AUTH-001`, `RBAC-001`, `BR-003`)
- **Order**: Tests run sequentially in package.json `test` script order

### Running Focused Tests

```bash
# Auth & RBAC only
node --test tests/01-auth.test.js

# PDV + caixa
node --test tests/02-pdv.test.js tests/13-pdv-fechamento.test.js tests/14-caixa-pagamentos.test.js

# Stock (A2)
node --test tests/08-estoque-a2.test.js
```

## Critical Conventions (Non-Obvious)

### 1. Money = Integer Centavos
- All monetary fields end in `_centavos` (INTEGER)
- Server **recalculates** totals; client values ignored (RBAC-002)
- Never send `total_centavos` from client — it's discarded

### 2. Idempotency Keys Required
- `POST /pedidos/balcao`, `POST /pedidos/:id/pagamentos`, `POST /pedidos/:id/aplicar-combo`
- Header: `Idempotency-Key: <unique-string>` (max 100 chars)
- Repeat → HTTP 200 with `{ idempotent: true }`

### 3. CSRF Protection
- All mutating endpoints require `X-Requested-With: XMLHttpRequest`
- Missing header → 403 (tested in AUTH-003)

### 4. Auth & Sessions
- Cookie: `lp_session` (httpOnly, SameSite=Lax)
- Token stored as **SHA-256 hash** in `sessoes.token_hash`
- Expiry: 12h absolute, 30min inactivity
- Logout = immediate server-side revocation

### 5. RBAC = DB-Driven
- `permissoes` table defines flags per cargo (`admin`, `caixa`, `garcom`, `cozinha`)
- Middleware queries DB on each request — no client-trusted payload
- Default deny: route without explicit permission = 403

### 6. Step-Up Admin (Sensitive Ops)
Required for: caixa sangria/suprimento, cancel item sent to kitchen, payment estorno, dev panel
```json
{ "admin_usuario": "Dono", "admin_senha": "SenhaForte123" }
```
- No master password exists (DIV-005)

### 7. SQLite Concurrency
- WAL mode + `busy_timeout=5000`
- Write transactions use `BEGIN IMMEDIATE` (serializes writers)
- `db.transaction(fn)` helper in `db/connection.js`

### 8. Append-Only Tables (Triggers Enforce)
- `auditoria`, `caixa_movimentacoes`, `estoque_movimentacoes` — no UPDATE/DELETE allowed

### 9. Backup = VACUUM INTO
- Online consistent copy, then `PRAGMA integrity_check`
- Auto every 6h, retains 30 (configurable via `.env`)
- Restore **blocks** overwriting running DB — must stop server first

### 10. WebSocket Protocol
- Auth: `{ type: "auth", token: "<session-token>" }`
- Server replies snapshot + global `seq`
- Events carry monotonic `seq`; client discards `seq <= last_seen`, refetches on gap

## Environment (.env)

```env
LP_PORTA=3000
LP_HOST=0.0.0.0
LP_DB_PATH=data/lanchonete.sqlite
LP_PEPPER=<auto-generated 64-char hex — NEVER SHARE>
LP_BACKUP_DIR=backups
LP_LOG_DIR=logs
LP_SESSAO_HORAS=12
LP_SESSAO_INATIVIDADE_MIN=30
LP_BACKUP_INTERVALO_HORAS=6
LP_BACKUP_RETENCAO=30
LP_AMBIENTE=producao
```

> **Never commit `.env`**. Pepper protects password hashes. If leaked, rotate all passwords.

## Common Gotchas

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Sem conexão" on load | Server not running | `.\scripts\iniciar_sistema.bat` |
| Blank page / no styles | Cached old assets | `Ctrl+F5` force refresh |
| Port 3000 in use | Another process | `.\scripts\parar_sistema.bat` or kill PID |
| Forgot admin password | 4 failed attempts → lockout | Restore latest backup from `backups/` |
| Want clean slate | — | Delete `data/lanchonete.sqlite`, restart |
| Mobile can't connect | Windows firewall | Run `.\scripts\firewall.ps1` as Admin once |

## Key Documentation References

- `docs/02-arquitetura-e-decisoes.md` — Architecture decisions (AD-001..AD-006)
- `docs/03-seguranca-e-riscos.md` — Threat model, encryption, audit
- `docs/04-testes-e-evidencias.md` — Test matrix, coverage
- `docs/06-manual-por-cargo.md` — Operator workflows per role
- `docs/07-homologacao-checklist.md` — Pre-release validation steps
- `docs/12-deploy-vps-windows.md` — VPS hosting (Windows Server + WSL2 + Docker Compose)
- `docs/13-checklist-pos-instalacao-vps.md` — VPS go-live smoke test (infra + negócio)
- `docs/14-manual-instalacao-vps.md` — Manual passo a passo explicativo da instalação na VPS
- `docs/15-github-e-testes-online.md` — Subir no GitHub, CI dos 183 testes e Codespaces

## Permission Flags (from `permissoes` table)

| Flag | Admin | Caixa | Garçom | Cozinha |
|------|-------|-------|--------|---------|
| `pode_vender_balcao` | ✅ | ✅ | ❌ | ❌ |
| `pode_dividir_pagar` | ✅ | ✅ | ❌ | ❌ |
| `pode_abrir_fechar_caixa` | ✅ | ✅ | ❌ | ❌ |
| `pode_sangria_suprimento` | ✅ | ✅ | ❌ | ❌ |
| `pode_cancelar_item` | ✅ | ✅ | ❌ | ❌ |
| `pode_lancar_comanda` | ✅ | ❌ | ✅ | ❌ |
| `pode_ver_kds` | ✅ | ❌ | ❌ | ✅ |
| `pode_avancar_kds` | ✅ | ❌ | ❌ | ✅ |
| `pode_gerenciar_produtos` | ✅ | ❌ | ❌ | ❌ |
| `pode_gerenciar_usuarios` | ✅ | ❌ | ❌ | ❌ |
| `pode_ver_relatorios` | ✅ | ❌ | ❌ | ❌ |
| `pode_gerenciar_mesas` | ✅ | ❌ | ❌ | ❌ |
| `pode_desconto` | ✅ | ⚙️ config | ❌ | ❌ |
| `pode_estoque_gerenciar` | ✅ | ❌ | ❌ | ❌ |
| `pode_config_sistema` | ✅ | ❌ | ❌ | ❌ |
| `pode_backup` | ✅ | ❌ | ❌ | ❌ |

> Caixa discount enabled via config `desconto_caixa_permitido = '1'`