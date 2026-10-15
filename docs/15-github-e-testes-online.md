# GitHub — subir o código e testá-lo online

Data: 2026-10-15 · Objetivo: versionar o Mercury PDV no GitHub, rodar os 183 testes
automaticamente e ter uma instância de teste na nuvem.

## O que o GitHub é — e o que NÃO é

| O GitHub FAZ | O GitHub NÃO FAZ |
|---|---|
| Guarda o código (backup na nuvem) | **Rodar o sistema em produção** — não executa Node.js, banco ou WebSocket (só serve arquivos estáticos) |
| Roda os 183 testes a cada push (Actions) | Substituir a VPS — produção continua sendo o deploy de `docs/12`/`docs/14` |
| Sobe uma VM de TESTE na nuvem (Codespaces) | Manter dados permanentes no Codespace (base temporária) |

> ⚠ Se a intenção for hospedar de verdade: use a VPS (docs/12/14) ou plataformas com
> **disco persistente** que aceitam Docker (Railway, Fly.io, Render pago).
> Plataformas serverless (Vercel/Lambda) **não funcionam** — o SQLite é arquivo.

## Parte 1 — Configurar o git (uma vez só)

No PowerShell, no seu computador:

```powershell
git config --global user.name  "Seu Nome"
git config --global user.email "seu@email.com"
```

## Parte 2 — Criar o repositório no GitHub

1. Acesse **github.com** → crie a conta (ou entre) → botão **New repository**.
2. Nome: `mercury-pdv` · Marque **Private** (é o sistema do seu negócio — código e
   regras comerciais não precisam ser públicos).
3. **NÃO** marque "Add README" (o projeto já tem).
4. Anote a URL: `https://github.com/SEU-USUARIO/mercury-pdv`

## Parte 3 — Primeiro envio (push)

Na pasta do projeto:

```powershell
cd "G:\onpenclow\MercuryPDV 1.3"
git init
git add .
git commit -m "Mercury PDV 1.3 - baseline inicial"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/mercury-pdv.git
git push -u origin main
```

- No primeiro push, o **Git Credential Manager abre o navegador** pedindo login do GitHub → autorize.
- `git add .` é seguro: o `.gitignore` já bloqueia `.env` (pepper), `data/`, `backups/`, `logs/`, `node_modules/`.

✔ **Resultado:** no site do GitHub, aba **Actions** mostra o workflow "Testes"
rodando `npm ci` + `npm test` (os 183 testes). ✔ verde = código íntegro no Linux.
Se ficar ❌ vermelho, clique no run → abra o passo "Rodar os 183 testes" → o log
mostra exatamente qual teste quebrou (se falhar só no Linux, guarde o log — é ajuste de portabilidade).

## Parte 4 — Testar ONLINE agora (Codespaces)

1. Na página do repositório → botão verde **`<> Code`** → aba **Codespaces** →
   **Create codespace on main**.
2. Abre um VS Code na nuvem; aguarde `npm install` terminar (barra azul).
3. O servidor sobe sozinho (`npm start` automático). Aparece a notificação da **porta 3000** →
   **Open in Browser**.
4. Sistema vivo na nuvem: faça o setup do admin e teste qualquer fluxo
   (venda, KDS, estoque) — inclusive do celular, se a porta estiver pública
   (Codespaces → painel Ports → visibilidade Public).

⚠ **Limites do Codespaces:**
- Base de dados **temporária** — ao apagar o codespace, tudo some. Não use dados reais.
- Conta pessoal grátis: ~60 h/mês (desligue o codespace após testar: painel Codespaces → Stop).
- A URL muda a cada codespace novo.

## Parte 5 — Depois do primeiro envio (rotina)

| Ação | Comando |
|---|---|
| Enviar alterações | `git add .` → `git commit -m "o que mudou"` → `git push` |
| Ver o que mudou | `git status` / `git diff` |
| Histórico | `git log --oneline` |

Cada push revalida os 183 testes automaticamente (Actions).

## Segurança

- **Nunca** use `git add -f` em `.env`, `data/`, `backups/` — o pepper vazar significa
  ter que trocar **todas** as senhas.
- Pepper vazou num push antigo? `apagar o arquivo` não remove do histórico —
  gere pepper novo no `.env` e **redefina todas as senhas** (pepper novo invalida os hashes).
- Repositório **Private** mantém o código fora de vista pública; o CI funciona igual.
