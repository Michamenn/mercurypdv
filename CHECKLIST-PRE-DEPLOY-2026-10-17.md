# Checklist pré-deploy — Mercury PDV 1.3.1 — 17/10/2026

> **Documento histórico (manhã do dia).** Escrito por volta das 12:45, quando
> ainda faltavam deploys: as seções 4–7 foram **concluídas** nas implantações
> seguintes (12:43 → 13:14) e a suíte fechou o dia em **199 testes**.
> O consolidado final do dia está em **`docs/18-alteracoes-2026-10-17.md`**.

> Horários em horário local (UTC-4). Fonte: histórico real da sessão de hoje
> (`ses_eb5c4d66…`, export `SALV` na Área de Trabalho), `git diff` do working tree,
> `docs/17-operacao-aws.md` e a suíte de testes (`npm test` → **197 pass / 0 fail**).

---

## 0. Situação em uma linha (o que ninguém pode errar)

**O deploy na nuvem JÁ ACONTECEU hoje às 12:03–12:08** (pedidos 1–10, com backup
pré-deploy e migração v13 aplicada na nuvem). **Os pedidos 11 e 12 chegaram DEPOIS**
(12:14 e 12:17) e foram concluídos às 12:41 — **esses 5 arquivos NÃO estão na nuvem**.
Ou seja: falta **1 deploy** para fechar o dia.

---

## 1. As 12 solicitações de hoje — pedido × status

| # | Hora | O que você pediu | Status | O que foi entregue | Na nuvem? |
|---|------|------------------|--------|--------------------|-----------|
| 1 | 10:19 | Busca rápida de produtos ao adicionar item nas **mesas** | ✅ Executado | Campo de busca instantâneo (sem acento, ignora categoria quando há texto) no modal "Adicionar item" — `public/js/views/mesas.js:768-800` | ✔ |
| 2 | 10:21 | A lista de produtos vai crescer; facilitar a busca | ✅ Executado | Mesmo filtro acima (busca em todo o cardápio, por nome/apelido) | ✔ |
| 3 | 10:22 | "Comanda também" | ✅ Executado | `seletorItem()` com busca em `public/js/views/comandas.js` | ✔ |
| 4 | 10:30 | Rodar o site local para verificação | ✅ Executado | Servidor em `http://127.0.0.1:3000` (PID 25928, no ar) | — |
| 5 | 10:34 | (a) PDV Balcão não funcional: padronizar como o fechamento, mantendo **viagem** | ✅ Executado | PDV com "Para viagem" (`pdv.js:130`), painel enxuto, guarda anti-duplo-clique e **aviso + botão Abrir caixa** quando o caixa está fechado (`pdv.js:66-97, 228`) | ✔ |
| 5 | 10:34 | (b) Retirar "mais vendidos" do PDV balcão | ✅ Executado | Bloco removido — restou só a busca/bip (`pdv.js:32,93`) | ✔ |
| 5 | 10:34 | (c) Cards de quantidade exagerados → diminuir | ✅ Executado (e superado pelo pedido 12) | Numpad de cards → **stepper** minimalista (`.qtd-stepper`, `.numpad-qtd` removido — `app.css:312,871`) | ✖ local |
| 6 | 10:56 | Novo cargo **Proprietário**: todos os privilégios, dá desconto, **sem painel dev** | ✅ Executado | `server/src/auth/cargos.js` (novo), cargo `proprietario` na migração **013**, flag `pode_painel_dev` (admin=1, demais=0), bloqueio anti-escalada (só admin cria/eleva admin) em `usuariosService.js`, UI em `admin.js`/`app.js`/`login.js`, `ehGestao` em rbac/api/pedidos | ✔ (migração v13 rodou na nuvem) |
| 7 | 11:04 | Opção **"Conta"** em todos os painéis de venda, em estilo nota fiscal, com **Imprimir** e **Voltar** | ✅ Executado | `public/js/conta.js` (novo): cupom QTD × VLR UNIT, área quadriculada (`.conta-quadriculado`), `window.print()` na largura 58/80 mm, botões Voltar/Imprimir; botão "Conta" nos **4** painéis (`pdv.js:136`, `mobile.js:376`, `mesas.js:637`, `comandas.js:304`) | ✔ |
| 8 | 11:37 | Feedback do designer (fundo #0B0F17, laranja #F97316, mobile-first, carrinho fixo, padronizar 4 painéis, Conta como bottom-sheet, NF-style unit price) | ✅ Executado | Conta vira **bottom-sheet** no mobile e **painel lateral** ≥769 px (`conta.js` + `.conta-lateral`), unit price em estilo NF, recibo minimalista preservado no fechamento | ✔ |
| 9 | 11:51 | "Não altere o banco de dados do sistema" | ✅ Atendido com clarificação | Você foi perguntado (caixa de pergunta) e respondeu autorizando o deploy com o mínimo necessário; única alteração de banco = migração **013** (código versionado). Local já em **v13**, `integrity_check ok` | ✔ |
| 10 | 12:02 | "okay" | ✅ Autorização | Deploy na AWS executado 12:03–12:08 (backup, tag de imagem p/ rollback, build, migração v13, hashes do `.env`/`Caddyfile` conferidos) | ✔ |
| 11 | 12:14 | Painéis com **altura fixa** + itens com **barra de rolagem**; **retirar Cortesia e Gorjeta**; alinhar os demais botões | ✅ Executado | `.painel-comanda{height:min(84vh,680px)}` + lista rolável + grade de botões (`app.css:860-867`); Cortesia/Chamar saíram da UI; **Gorjeta migrou para o Receber/Fechar** (`gorjeta.js` + `pdv.js:519`, `mesas.js:8`) | **✖ NÃO** |
| 12 | 12:17 | Diminuir a largura do modal de quantidade; trocar os números em card por algo minimalista | ✅ Executado | `.modal-quantidade{width:min(360px,100%)}` + stepper `− [n] +` com mínimo 48 px de toque (`app.css:870-873`) | **✖ NÃO** |

**Verificações feitas pelo próprio sistema antes de encerrar (12:39–12:41):** painel da
mesa 680 px com lista rolando (scrollHeight 684 > clientHeight 241), grade 2×2 com
"Receber" em largura total e **sem** Cortesia; gorjeta ponta a ponta
(`gorjeta_centavos: 500` gravado, **total/saldo inalterados** = 18680); PDV com
`.modal-quantidade` 360 px, stepper 1→3→2 e `.numpad-qtd` ausente; mesmos testes no
painel de Comandas.

---

## 2. Alterações por área (checklist de conferência)

### 2.1 Back-end
- [x] `server/src/auth/cargos.js` **(novo)** — `CARGOS_VALIDOS`, `CARGOS_GESTAO`, `ehAdmin`, `ehGestao`.
- [x] `server/src/auth/rbac.js` — usa `CARGOS_GESTAO` (admin + proprietário).
- [x] `server/src/routes/api.js` — `ehGestao` nas rotas de gestão; painel dev re-protegido por `pode_painel_dev`.
- [x] `server/src/services/usuariosService.js` — guarda central `exigirAdminDoSistema()` nos 4 pontos de mutação de conta (criar admin, elevar a admin, editar, inativar) + cargo `proprietario` na matriz.
- [x] `server/src/services/pedidosService.js` — gorjeta fora de `total_centavos` (semântica correta), exposta em `gorjeta_centavos`.
- [x] `server/src/db/migrations.js` — runner desliga `foreign_keys` durante o loop (necessário para reconstrução de tabela).
- [x] `server/src/db/migrations/013_proprietario_painel_dev.sql` **(novo)** — coluna `pode_painel_dev`, CHECK ampliado em `permissoes` e `usuarios`, linha do cargo `proprietario`, `UPDATE … admin=1`. Aplicação automática no start (varredura de `migrations/*.sql`).
- [x] Rota `POST /pedidos/:id/gorjeta` existe e exige `pode_dividir_pagar` (`api.js:380`) — **o front novo não chama rota inexistente**.

### 2.2 Front-end
- [x] `public/js/conta.js` **(novo)** — painel Conta/nota fiscal (imprimir + voltar), bottom-sheet/side-panel.
- [x] `public/js/gorjeta.js` **(novo)** — gorjeta compartilhada (PDV e mesa), extra sobre a conta.
- [x] `public/js/views/pdv.js` — viagem, Conta, Gorjeta no pagamento, aviso de caixa fechado, stepper de quantidade.
- [x] `public/js/views/mesas.js` / `comandas.js` — busca de produto, painel de comanda fixo com rolagem, grade de botões, gorjeta no recebimento, sem Cortesia/Chamar.
- [x] `public/js/views/mobile.js` — Conta no carrinho mobile.
- [x] `public/js/views/admin.js` / `app.js` / `login.js` / `caixa.js` — rótulo e UI do cargo Proprietário, aba dev por `pode_painel_dev`.
- [x] `public/css/app.css` — `.painel-comanda*`, `.modal-quantidade`, `.qtd-stepper`, `.conta-*`, `.conta-lateral`; `.numpad-qtd` removido.
- [x] **Integração por ESM**: `index.html` só carrega `/js/app.js`; `conta.js`/`gorjeta.js` entram pelos imports das views — **não falta `<script>`**.

### 2.3 Testes
- [x] `npm test` → **197 pass / 0 fail** (18 s) — rodado nesta conferência, com o working tree atual.
- [x] `tests/10-evolucao.test.js` (+108 linhas) cobre o cargo Proprietário/painel dev.
- [ ] **Sem teste automatizado novo** para: painel Conta (imprimir/NF), gorjeta ponta a ponta, stepper de quantidade e altura fixa do painel (só verificação manual em navegador).

**Verificações automáticas desta conferência (executadas agora, não relatadas por terceiros):**
- `node --check` nos 15 arquivos alterados/novos → **todos OK**.
- Nenhum handler órfão (`data-a="chamar"` / `data-d="cortesia"` / `.numpad-qtd`) restou na UI.
- `modal()` em `ui.js:13` aceita `{ folha }` → o bottom-sheet da Conta funciona.
- Rotas usadas pelo front novo existem: `POST /pedidos/:id/gorjeta` (`api.js:380`), `GET /auth/operadores` (`api.js:51`); `#area-impressao` + `.recibo-preview` já existem (`recibo.js`).
- Banco local: `schema_migrations` = **v13**, `integrity_check` = ok, cargo `proprietario` presente (`pode_painel_dev=0`, desconto/usuários=1), `admin` com `pode_painel_dev=1`.
- Diff sem `console.log`/`debugger`/TODO, sem segredo/senha hardcoded e sem IP/URL fixa no código (nenhum resquício de debug vai para a nuvem).

---

## 3. O que foi IGNORADO / recusado / não executado

Nenhum pedido seu foi deixado de lado em silêncio — mas **7 subtarefas delegadas
falharam, recusaram ou entregaram lixo** e exigiram retrabalho. Esta é a lista honesta:

| Subtarefa (lane) | O que ela devolveu | Consequência |
|---|---|---|
| `Fiar botão Conta nos 4 painéis` (11:15) | *"Given time constraints, cannot finish."* | Recusa — o orquestrador fiou a Conta nos 4 painéis por conta própria |
| `Painel comanda + modal quantidade` (12:23) | *"NÃO FEITO / NÃO VERIFICADO — não alterei mesas.js, comandas.js, pdv.js nem app.css; não criei gorjeta.js"* | Recusa total — refeito em outra rodada |
| `Implementar painel e modal quantidade` (12:25) | *"Cannot perform the full implementation as specified… beyond the scope of a quick mechanical fix"* | Recusa por escopo — quebrado em partes menores, como ela sugeriu |
| `mesas.js: painel fixo e botões` (12:34) | Devolveu **payload sem sentido** (só um `grep`) e deixou um handler órfão `[data-a="chamar"]` apontando para botão que não existe mais | **Bug real**: quebraria o painel ao renderizar; detectado e corrigido pelo orquestrador (12:35) |
| `Gorjeta na tela de pagamento` (12:33) | *"Unable to uniquely locate insertion point for gorjeta modal… time limited"* | Gorjeta **não** foi ligada pela lane — o orquestrador criou `gorjeta.js` e ligou no PDV e na mesa |
| `PDV balcão: remover mais vendidos + reduzir cards` (11:11) | Devolveu **payload sem sentido** (só um `read`) | Sem relatório; o trabalho existia no disco (conferido: "mais vendidos" ausente), mas a verificação foi perdida |
| `Front-end: cargo Proprietário e aba dev` (11:07) | Registrada como **erro** ("sem texto público") | Na prática entregou (arquivos alterados e descritos); só o registro ficou sujo |

**Itens que continuam abertos (não são código):**
1. **Deploy dos pedidos 11 e 12** (5 arquivos — seção 4).
2. **Sua conferência manual**: criar o usuário com cargo Proprietário na nuvem e testar
   Conta/Gorjeta com `Ctrl+F5` na `:3000`.
3. **Cobertura de teste** para Conta/Gorjeta/Stepper (seção 2.3).
4. **Nuvem — dado antigo, não é bug do deploy**: a linha do cargo **garçom** na nuvem está
   com `pode_desconto`, `pode_gerenciar_usuarios` e `pode_sangria_suprimento = 1`
   (no local está tudo 0). Comparação cargo a cargo provou que **já era assim antes** do
   deploy — é uma edição feita na nuvem; decidir se mantém.
5. HTTPS/domínio ainda pendente; **sem Elastic IP** (o IP muda se a instância parar);
   `aws login` expira e precisa ser refeito a cada sessão.

---

## 4. Deploy pendente: exatamente 5 arquivos

Alterados **depois** do pacote das 12:03 (por isso estão fora da nuvem):

- [ ] `public/js/gorjeta.js` **(arquivo novo — não existe na nuvem)**
- [ ] `public/js/views/pdv.js`
- [ ] `public/js/views/mesas.js`
- [ ] `public/js/views/comandas.js`
- [ ] `public/css/app.css`

> Antes de empacotar: **`git add` nos 4 arquivos não versionados**
> (`public/js/conta.js`, `public/js/gorjeta.js`, `server/src/auth/cargos.js`,
> `server/src/db/migrations/013_proprietario_painel_dev.sql`) — se o deploy for por git,
> eles ficariam de fora. O `tar` do runbook pega o disco e não tem esse risco.

---

## 5. Checklist do 2º deploy de hoje (runbook `docs/17-operacao-aws.md`)

- [ ] `aws login` (CLI 2.38.1; sessão de curta duração).
- [ ] **Backup pré-deploy na nuvem** — `backup.js` **não tem CLI**; chamar
      `criarBackup(db, {motivo:"pre-deploy"})` via `docker compose exec -T -w /app app node --input-type=module -e '…'`
      e conferir o arquivo + `integrity_check` **antes** de subir.
- [ ] Empacotar na raiz: `tar -czf … package.json package-lock.json server public deploy/aws`.
- [ ] Chave ECI: `ssh-keygen` + `aws ec2-instance-connect send-ssh-public-key`
      (vale **60 s** — repetir o push antes de **cada** `ssh`/`scp`).
- [ ] Enviar com **nome relativo** (`scp` lê `C:` como host).
- [ ] No servidor: **preservar `.env`, `Caddyfile` e `docker-compose.yml`**
      (`cp -p` para `mercury-keep` antes, restaurar depois, comparar por `sha256sum`) —
      sobrescrever o Caddyfile **derruba o site**.
- [ ] Rodar o script remoto por **arquivo** (`bash /tmp/x.sh`), nunca por pipe; usar
      `< /dev/null` nos `docker compose exec` (eles consomem o stdin).
- [ ] `docker compose up -d --build` (build no t3.micro, ~1 min).
- [ ] Migração 013 **não** roda de novo na nuvem (já em **v13**) — conferir
      `SELECT version, nome FROM schema_migrations` (colunas são `version`/`nome`, não `versao`).
- [ ] Remover a chave EIC local ao final.

---

## 6. Verificação pós-deploy

- [ ] `curl -s http://<IP público>/health` → ok  *(IP no arquivo local do runbook)*
- [ ] `docker compose ps` → `healthy`; Caddy intacto
- [ ] `PRAGMA integrity_check` na nuvem → `ok`
- [ ] `git`/tar conferido: `gorjeta.js` presente em `/opt/mercury/public/js/`
- [ ] Navegador na nuvem (`Ctrl+F5`): Conta (imprimir/voltar), painel com altura fixa +
      rolagem, **sem** Cortesia, Gorjeta no Receber, stepper de quantidade
- [ ] Local (`:3000`, `Ctrl+F5`): os mesmos 5 itens + busca de produto em mesa/comanda
- [ ] Criar usuário **Proprietário** na nuvem e confirmar: sem aba de painel dev, com desconto

## 7. Rollback (se algo sair errado)

- Imagem anterior: `mercury-pdv:pre-deploy-20261017-160339` (na instância)
- Snapshot do código: `/home/ubuntu/mercury-pre-deploy-snapshot.tar.gz`
- Backup do banco: `lanchonete-2026-10-17T16-04-52-159Z.sqlite` (volume `vol_backups`)

---

*Gerado em 17/10/2026 a partir da sessão de trabalho de hoje. `npm test` = 197/197 ✔*
