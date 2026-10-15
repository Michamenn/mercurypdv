# Manual de Instalação — Mercury PDV 1.3 na VPS (passo a passo explicativo)

Data: 2026-10-15 · Público: pessoa responsável pela instalação, **sem exigência de
conhecimento prévio** em Linux/Docker. Tempo estimado: **40–60 min + 1 reinício**.

> Referências: detalhes técnicos em `docs/12-deploy-vps-windows.md` ·
> checklist final de validação em `docs/13-checklist-pos-instalacao-vps.md`.
> **Este manual é autossuficiente** — você só precisa seguir na ordem.

## Visão geral do caminho (o que vamos fazer)

1. Conectar na VPS pela Área de Trabalho Remota (RDP)
2. Copiar os arquivos do Mercury PDV para a VPS
3. Ativar o WSL2 (recurso do Windows que roda Linux) — **reinicia a VPS**
4. Instalar o Ubuntu (o Linux) e o Docker (motor que roda o sistema)
5. Colocar o projeto dentro do Linux
6. Gerar o "pepper" (segredo que protege as senhas)
7. Subir o sistema e criar o primeiro administrador
8. Trancar o acesso só para a lanchonete (firewall)
9. Configurar a cópia de segurança (backup) para fora da VPS
10. Validar tudo (checklist de go-live)

## Quais programas são usados

**No SEU computador (já vem no Windows — nada para instalar):**

| Programa | Como abrir | Para quê |
|---|---|---|
| Área de Trabalho Remota (`mstsc`) | Teclas `Win + R` → digite `mstsc` → Enter | Operar a VPS como se estivesse sentado nela |
| Explorador de Arquivos / PowerShell | normal / menu Iniciar | Criar o .zip dos arquivos |

**O que será INSTALADO NA VPS (o manual faz isso com você):**

| Programa | O que é (em uma frase) |
|---|---|
| **WSL2** | Recurso oficial do Windows que permite rodar Linux dentro dele |
| **Ubuntu 24.04** | O sistema Linux onde o Docker vai rodar |
| **Docker CE + Compose** | Motor que executa o Mercury PDV isolado, como uma "caixa fechada" |
| **Caddy** | Porteiro da porta 80: recebe o tráfego da internet e repassa ao sistema |
| **Imagem `mercury-pdv`** | O próprio sistema (Node.js + banco SQLite já dentro) |

> 💡 **Você NÃO instala Node.js nem nada de programador na VPS.** O Docker baixa o
> Node 24 já embalado dentro do container. Também **não precisa de domínio**:
> o acesso será por `http://IP-DA-VPS`.

---

## Parte 1 — Conectar na VPS (RDP)

1. No seu computador: `Win + R` → digite `mstsc` → Enter.
2. Em **Computador**, digite o **IP da VPS** (o provedor entrega junto com o
   usuário `Administrador` e a senha).
3. **Conectar** → aceite o aviso de certificado → faça login com as credenciais.
4. ✔ **Resultado esperado:** a área de trabalho do Windows Server aparece.

⚠ Durante a instalação a VPS vai **reiniciar uma vez** — a conexão cai, é normal.
Aguarde ~1 min e reconecte pelo mesmo `mstsc`.

---

## Parte 2 — Levar os arquivos do sistema até a VPS

### 2.1 No SEU computador — criar o .zip

Abra o **PowerShell** e rode (uma linha só):

```powershell
Compress-Archive -Path 'G:\onpenclow\MercuryPDV 1.3\server','G:\onpenclow\MercuryPDV 1.3\public','G:\onpenclow\MercuryPDV 1.3\deploy','G:\onpenclow\MercuryPDV 1.3\package.json','G:\onpenclow\MercuryPDV 1.3\package-lock.json','G:\onpenclow\MercuryPDV 1.3\.dockerignore' -DestinationPath "$env:USERPROFILE\Desktop\mercurypdv.zip" -Force
```

✔ **Resultado:** `mercurypdv.zip` na sua **Área de Trabalho**.
(De propósito ficam de fora: `node_modules`, `data`, `logs`, `backups` — são
da máquina local e não servem para a VPS.)

### 2.2 Transferir pela área de trabalho remota

1. Selecione o `mercurypdv.zip` no seu desktop → **Ctrl+C**.
2. Clique dentro da janela do RDP (desktop da VPS) → **Ctrl+V**.
   O arquivo copia pela conexão remota (leva alguns minutos).
   *Alternativa: painel de arquivos do provedor, ou baixar de um drive nuvem
   dentro do navegador Edge da própria VPS.*
3. Clique com o botão direito no zip → **Extrair Tudo…** → para `C:\MercuryPDV13`.

✔ **Resultado:** pasta `C:\MercuryPDV13` com `server`, `public`, `deploy`,
`package.json` e `package-lock.json`. **Guarde esse caminho exato** — os
próximos passos dependem dele.

---

## Parte 3 — Ativar o WSL2 (Linux dentro do Windows)

> **Por quê?** O Docker do Mercury PDV roda em Linux. No Windows Server, a forma
> oficial de ter Linux é o WSL2 — um componente da Microsoft, não um programa
> externo.

1. Na VPS: menu **Iniciar** → digite `PowerShell` → botão direito →
   **Executar como administrador**.
2. Rode:

```powershell
cd C:\MercuryPDV13\deploy
powershell -ExecutionPolicy Bypass -File .\preparar-vps-fase1.ps1
```

✔ **Resultado esperado:** mensagens `[OK] Recursos habilitados…` e
`[OK] WSL instalado…`, terminando com "REINICIE A VPS AGORA".

3. Reinicie:

```powershell
Restart-Computer
```

A conexão RDP cai. Aguarde ~1 min e reconecte (Parte 1).

> ⚠ Se o script reclamar de "virtualização" ou o WSL não iniciar depois, o
> provedor da VPS precisa **habilitar virtualização aninhada** (nested) — abra um
> chamado com eles citando exatamente isso. Depois volte à Parte 3.

---

## Parte 4 — Instalar Ubuntu + Docker

### 4.1 Ubuntu (no PowerShell da VPS)

```powershell
wsl --install -d Ubuntu-24.04
```

Aguarde o download e a abertura de uma janela nova (prompt do Linux). Ele pede:

- **Nome de usuário:** algo simples, ex. `mercury`
- **Senha:** digite e **Enter** — *a tela não mostra nada enquanto digita, é normal.*

✔ **Resultado:** prompt `mercury@NOME-DA-VPS:~$`.

Confira (PowerShell): `wsl -l -v` → a linha do Ubuntu deve mostrar `VERSION 2`.

### 4.2 Docker (dentro do Ubuntu)

Abra o **Ubuntu** pelo menu Iniciar da VPS (ou digite `wsl` no PowerShell) e rode:

```bash
cp /mnt/c/MercuryPDV13/deploy/instalar-docker-wsl.sh ~/
bash ~/instalar-docker-wsl.sh
```

> `/mnt/c/...` é o jeito do Linux enxergar o drive `C:` do Windows.

✔ **Resultado esperado:** instalação termina mostrando as versões do
`docker` e `docker compose`.

- Se aparecer a mensagem sobre **systemd** (" rode `wsl --shutdown`…"):
  no **PowerShell** rode `wsl --shutdown`, reabra o Ubuntu e rode o script de novo.
- Se aparecer **permissão negada** ao usar `docker` depois: feche o Ubuntu,
  reabra e tente de novo (o script libera seu usuário — vale só em sessões novas).

### 4.3 Iniciar junto com a VPS (tarefa de boot)

De volta ao **PowerShell (administrador)** da VPS:

```powershell
schtasks /Create /TN "MercuryPDV Boot" /SC ONSTART /DELAY 0001:00 /RU SYSTEM /RL HIGHEST ^
  /TR "powershell -ExecutionPolicy Bypass -File C:\MercuryPDV13\deploy\iniciar-mercury-vps.ps1"
```

✔ **Resultado:** `SUCESSO: a tarefa agendada "MercuryPDV Boot" foi criada.`
A partir de agora, a cada boot: Docker liga sozinho + portas conectam ao Linux.

---

## Parte 5 — Colocar o projeto DENTRO do Linux

> **Por quê?** O banco de dados (SQLite) precisa do filesystem do Linux para
> funcionar com segurança de gravação. Rodar direto de `C:\` (visto como
> `/mnt/c`) causa corrupção/travamentos — por isso **copiamos para dentro**.

No terminal do **Ubuntu**:

```bash
mkdir -p ~/mercurypdv && cd ~/mercurypdv
cp -r /mnt/c/MercuryPDV13/server .
cp -r /mnt/c/MercuryPDV13/public .
cp -r /mnt/c/MercuryPDV13/deploy .
cp /mnt/c/MercuryPDV13/package.json /mnt/c/MercuryPDV13/package-lock.json .
cp /mnt/c/MercuryPDV13/.dockerignore .
ls   # deve mostrar: deploy  package-lock.json  package.json  public  server
     # (o arquivo oculto .dockerignore so aparece com `ls -a`)
```

---

## Parte 6 — Gerar o "pepper" (o segredo das senhas)

> **O que é?** Uma chave secreta de 64 caracteres misturada nos hashes de senha.
> Se ela **mudar ou se perder, todos os logins deixam de funcionar** — por isso
> você guarda uma cópia FORA da VPS (gerenciador de senhas, impresso no cofre).

Ainda no Ubuntu:

```bash
cd ~/mercurypdv/deploy
cp .env.example .env
openssl rand -hex 32
```

Copie os 64 caracteres exibidos. Agora abra o arquivo:

```bash
nano .env
```

- Preencha a linha `LP_PEPPER=` colando os 64 caracteres
  (no terminal, colar = **botão direito** ou `Ctrl+Shift+V`).
- Salvar: `Ctrl+O` → `Enter`.  Sair: `Ctrl+X`.

✔ **Resultado:** `deploy/.env` com `LP_PEPPER=<64 caracteres>`.
**Anote essa mesma sequência fora da VPS agora** (não depois).

---

## Parte 7 — Subir o sistema e criar o administrador

### 7.1 Construir e iniciar (Ubuntu)

```bash
cd ~/mercurypdv
docker compose -f deploy/docker-compose.yml up -d --build
```

Primeira vez demora (baixa Node/Alpine/Caddy e instala dependências — 3 a 10 min).
Depois:

```bash
docker compose -f deploy/docker-compose.yml ps      # STATUS: app "healthy", caddy "running"
curl -s http://127.0.0.1/health                       # {"ok":true,...}
```

### 7.2 Primeiro acesso (no SEU computador ou celular, na rede da lanchonete)

Abra o navegador em **`http://IP-DA-VPS`** (o IP que você usa no mstsc).

1. Aparece a tela de **criação do administrador** → escolha senha FORTE
   (≥ 10 caracteres, com letra e número) e anote em local seguro.
2. Faça login. O formulário de setup se fecha para sempre — isso é por design.

> ⚠ Se o site não abrir da lanchonete mas abre dentro da VPS (Edge): rode
> `C:\MercuryPDV13\deploy\iniciar-mercury-vps.ps1` no PowerShell admin e teste
> de novo; verifique também o firewall do provedor no painel.

---

## Parte 8 — Trancar o acesso só para a lanchonete

> Até aqui **qualquer pessoa do mundo que souber o IP vê a tela de login**.
> Vamos liberar apenas o IP da internet da lanchonete (**164.163.11.141**),
> que já vem configurado no script.

No **PowerShell (administrador)** da VPS:

```powershell
cd C:\MercuryPDV13\deploy
.\endurecer-firewall.ps1
```

✔ **Resultado:** "Acesso restrito às origens: 164.163.11.141".

**Prova obrigatória (faça as duas):**
- Celular no **4G** (fora do Wi-Fi da lanchonete): o site **NÃO abre** ✔
- Dentro da lanchonete: abre normalmente ✔

> Se um dia a lanchonete ficar sem acesso, provavelmente o IP dela mudou.
> Emergência: `.\endurecer-firewall.ps1 -Desfazer` (libera geral) e depois
> endureça de novo com o IP novo: `.\endurecer-firewall.ps1 -IpsLanchonete "<IP-novo>"`.

---

## Parte 9 — Backup saindo da VPS

O sistema faz backups automáticos (a cada 6 h) **dentro** da VPS. Backup bom
precisa sair dela. Duas linhas configuram isso:

1. No **Ubuntu**: teste a exportação:
   ```bash
   bash ~/mercurypdv/deploy/copiar-backups.sh
   ```
   ✔ **Resultado:** arquivos `.sqlite` aparecem em `C:\BackupsMercuryPDV` na VPS.
2. No **PowerShell (administrador)**: agende a exportação diária às 03:00:
   ```powershell
   schtasks /Create /TN "MercuryPDV Exportar Backups" /SC DAILY /ST 03:00 /RU SYSTEM ^
     /TR "wsl.exe -d Ubuntu-24.04 -u root bash /root/mercurypdv/deploy/copiar-backups.sh"
   ```
3. **Rotina sua:** 1× por semana, entre na VPS por RDP e baixe o mais recente de
   `C:\BackupsMercuryPDV` para o seu computador (Ctrl+C / Ctrl+V pelo RDP).
   *Ajuste o caminho se seu usuário do Ubuntu não for root (ex. `/home/mercury/...`).*

---

## Parte 10 — Validação final (não pule!)

Percorra o **`docs/13-checklist-pos-instalacao-vps.md`** item a item (marque com
data/iniciais). O mais importante:

- **Reboot de prova:** reinicie a VPS → aguarde ~3 min → o sistema volta sozinho
  (task de boot) e o site abre sem você mexer em nada.
- Venda de teste: abrir caixa → venda balcão → pagamento → KDS recebe →
  fechamento baixa estoque → relatório fecha o dia.
- Celular do garçom e tablet do KDS acessam e instalam como PWA
  (menu do navegador → "Instalar aplicativo").

## Rotina depois de instalado

| Frequência | Ação |
|---|---|
| Diária (automático) | Backups às 03:00 → `C:\BackupsMercuryPDV` |
| Semanal | Baixar o backup mais recente para fora da VPS |
| Quando atualizar o sistema | Ver `docs/12` §12 (copiar arquivos novos + `up -d --build` — dados não são afetados) |
| VPS reiniciou (provedor/manutenção) | Nada a fazer — tudo volta sozinho em ~3 min |

## Problemas comuns

| O que acontece | O que fazer |
|---|---|
| `mstsc` não conecta | VPS desligada/bloqueada no painel do provedor — verifique lá |
| PowerShell bloqueia o script | Use exatamente a linha com `-ExecutionPolicy Bypass` do manual |
| WSL/Ubuntu não inicia, erro de "virtualização" | Chame o provedor: precisa de **virtualização aninhada** |
| `docker: permission denied` | Feche e reabra o terminal do Ubuntu |
| Site abre dentro da VPS mas não fora | Rode `iniciar-mercury-vps.ps1`; confira firewall do provedor; confira se a porta 80 não está com IIS (`Stop-Service W3SVC; Set-Service W3SVC -StartupType Disabled`) |
| `app` fica "unhealthy" | `docker compose -f deploy/docker-compose.yml logs app` — quase sempre pepper faltando no `deploy/.env` |
| Ninguém consegue logar | Pepper mudou/perdeu — restaure o `.env` original |
| Lanchonete sem acesso, resto do mundo também não vê | IP da lanchonete mudou → `-Desfazer` + endurecer com IP novo |

## Glossário rápido

| Termo | Significado |
|---|---|
| **VPS** | Computador alugado na internet, seu 24 h por dia |
| **RDP / mstsc** | Programa que mostra a tela da VPS no seu PC |
| **WSL2** | Linux oficial dentro do Windows |
| **Container / Docker** | O sistema rodando "embrulhado", igual em qualquer servidor |
| **Pepper** | Segredo de 64 caracteres que protege as senhas no banco |
| **Firewall / allowlist** | Muro que só deixa passar quem está na lista (164.163.11.141) |
| **Portproxy** | Ponte que liga a porta 80 do Windows à do Linux (refeita a cada boot) |
