# Deploy em VPS Windows Server — Mercury PDV 1.3

Data: 2026-10-15 · Responsável: DevOps/Integrator
Cenário: VPS Windows Server 2022/2025, **apenas IP** (sem domínio), acesso via RDP.
Stack: **WSL2 + Docker Compose** (app Node 24 + proxy Caddy).

> **Manual passo a passo explicativo (para iniciantes): `docs/14-manual-instalacao-vps.md`.**
> Este documento é a referência técnica/complementar.

> **Leia a seção 9 antes de colocar em produção.** Operar o PDV pela internet muda
> o modelo de ameaça assumido em `docs/03-seguranca-e-riscos.md` (R-02/R-03).

## Artefatos (pasta `deploy/`)

| Arquivo | Função |
|---|---|
| `Dockerfile` | Imagem de produção (Node 24 Alpine, usuário não-root) |
| `docker-compose.yml` | App + Caddy, volumes persistentes, healthcheck |
| `Caddyfile` | Proxy reverso (WebSocket `/ws` incluso); HTTP por padrão, HTTPS opcional |
| `.env.example` | Modelo das variáveis do container (**copie para `.env` e preencha**) |
| `preparar-vps-fase1.ps1` | Habilita WSL2 no Windows (Fase 1, exige reboot) |
| `instalar-docker-wsl.sh` | Instala Docker CE + Compose dentro do Ubuntu (Fase 2) |
| `iniciar-mercury-vps.ps1` | Boot: liga Docker, atualiza portproxy + firewall (agendado) |
| `endurecer-firewall.ps1` | Restringe 80/443 aos IPs da lanchonete (padrão: 164.163.11.141) |
| `copiar-backups.sh` | Exporta backups do volume p/ `C:\BackupsMercuryPDV` |
| `restaurar-backup.sh` | Restaura backup `.sqlite` no volume (para o app antes) |

## 0. Arquitetura resultante

```
Navegador/PWA (lanchonete, celulares, caixa)
        │  http://IP-DA-VPS:80
        ▼
[Windows Server]  firewall 80/443 + portproxy (IP do WSL muda a cada boot)
        ▼
[WSL2 Ubuntu]  Docker
   ├─ caddy  ─── proxy reverso :80 → app:3000
   └─ app    ─── Node 24 + SQLite (node:sqlite nativo)
        volumes: vol_dados (banco) · vol_backups · vol_logs
```

- O container `app` **não é publicado** na internet — só o Caddy.
- `data/`, `backups/` e `logs/` ficam em volumes Docker (persistem entre rebuilds).
- SQLite roda em filesystem ext4 do WSL2 (não em bind mount `/mnt/c` — veja §4).

## 1. Pré-requisitos

- Windows Server **2022 ou 2025**, acesso Administrador via RDP.
- **Virtualização aninhada habilitada no provedor** (WSL2 usa Hyper-V dentro da VM).
  Muitos provedores só habilitam sob pedido — confirme antes de começar.
- 2 GB RAM livres, 10 GB disco livres.
- Copie o projeto para a VPS (ex.: zip sem `node_modules`/`data`/`logs` → RDP → descompacte em `C:\MercuryPDV13`).

## 2. Fase 1 — Habilitar WSL2 (PowerShell como Administrador)

```powershell
cd C:\MercuryPDV13\deploy
powershell -ExecutionPolicy Bypass -File .\preparar-vps-fase1.ps1
# ao final: REINICIE A VPS
Restart-Computer
```

## 3. Fase 2 — Ubuntu + Docker (após o reboot)

### 3.1 Instalar a distro (PowerShell)

```powershell
wsl --install -d Ubuntu-24.04
```

Defina usuário/senha do Ubuntu quando solicitado. Confirme `wsl -l -v` → `VERSION 2`.

> **Fallback** (sem Store/CDN): baixe o rootfs em
> `https://cloud-images.ubuntu.com/wsl/releases/24.04.current/ubuntu-noble-wsl-amd64-wsl.rootfs.tar.gz`
> e: `wsl --import Ubuntu-24.04 C:\WSL\Ubuntu24 <caminho-do.tar.gz>` (entra como root; crie usuário depois).

### 3.2 Instalar o Docker (dentro do Ubuntu)

```bash
cp /mnt/c/MercuryPDV13/deploy/instalar-docker-wsl.sh ~/
bash ~/instalar-docker-wsl.sh
# se pedir reinício do WSL: saia, rode `wsl --shutdown` no PowerShell, reabra e rode de novo
```

Feche e reabra o terminal do Ubuntu (grupo `docker`).

### 3.3 Auto-start no boot da VPS (PowerShell como Administrador)

Inicia Docker + portproxy + firewall automaticamente a cada boot:

```powershell
schtasks /Create /TN "MercuryPDV Boot" /SC ONSTART /DELAY 0001:00 /RU SYSTEM /RL HIGHEST ^
  /TR "powershell -ExecutionPolicy Bypass -File C:\MercuryPDV13\deploy\iniciar-mercury-vps.ps1"
```

## 4. Fase 3 — Projeto no filesystem do WSL

⚠️ **Rode de `~/mercurypdv`, nunca de `/mnt/c`.** Bind mount pelo `/mnt/c` usa o
filesystem 9P do WSL, cujo locking quebra o SQLite (WAL). Copie para dentro:

```bash
mkdir -p ~/mercurypdv && cd ~/mercurypdv
cp -r /mnt/c/MercuryPDV13/server .
cp -r /mnt/c/MercuryPDV13/public .
cp -r /mnt/c/MercuryPDV13/deploy .
cp /mnt/c/MercuryPDV13/package.json /mnt/c/MercuryPDV13/package-lock.json .
cp /mnt/c/MercuryPDV13/.dockerignore .
# NAO copie: node_modules, data, backups, logs, .env (locais)
```

## 5. Fase 4 — Pepper e configuração

```bash
cd ~/mercurypdv/deploy
cp .env.example .env
openssl rand -hex 32        # copie a saída
nano .env                   # cole em LP_PEPPER=
```

> **Guarde o pepper FORA da VPS** (gerenciador de senhas). Se perder, TODOS os
> logins deixam de funcionar (hashes ficam inválidos) — só resetando senhas.
> Nunca reutilize o pepper da máquina local: senhas locais não valerão na VPS.

## 6. Fase 5 — Subir e validar

```bash
cd ~/mercurypdv
docker compose -f deploy/docker-compose.yml up -d --build
docker compose -f deploy/docker-compose.yml ps        # app: healthy
curl -s http://127.0.0.1/health                        # {"ok":true,...}
```

No navegador (de qualquer dispositivo): `http://IP-DA-VPS`
→ tela de **setup** (primeiro admin, senha forte) → login.

**Smoke test mínimo:** login, abrir caixa, venda balcão com pagamento, KDS recebe
o item, fechamento baixa estoque, relatório fecha o dia.
Checklist completo de go-live: **`docs/13-checklist-pos-instalacao-vps.md`**.

## 7. Exposição e firewall

Enquanto não endurecida, a VPS aceita 80/443 de qualquer origem (regras criadas
pelo `iniciar-mercury-vps.ps1` no boot). Endureça o quanto antes:

- **Porta 80 ocupada?** Server images vêm com IIS às vezes:
  `Get-NetTCPConnection -LocalPort 80 -State Listen` → se houver:
  `Stop-Service W3SVC; Set-Service W3SVC -StartupType Disabled`
- **Restringir aos IPs da lanchonete** (script já vem com `164.163.11.141` como padrão):
  ```powershell
  cd C:\MercuryPDV13\deploy
  .\endurecer-firewall.ps1                # libera só 164.163.11.141 na porta 80
  .\endurecer-firewall.ps1 -IncluirHTTPS  # idem + porta 443
  .\endurecer-firewall.ps1 -Desfazer      # emergência (IP mudou e travou o acesso)
  ```
  - Os IPs são **de origem** — de QUEM acessa (internet da lanchonete, casa do dono).
    **Nunca use o IP da VPS** nessa lista, senão bloqueia todo mundo.
  - O script grava marcador em `C:\ProgramData\MercuryPDV\firewall-restrito.txt`;
    a partir daí o boot **não recria** as regras abertas.
  - **Prova negativa obrigatória**: por 4G (fora da lanchonete) o acesso deve FALHAR;
    de dentro da lanchonete deve abrir normalmente.
  - **IP dinâmico?** Se o IP da lanchonete mudar, o acesso cai — rode
    `.\endurecer-firewall.ps1 -Desfazer`, atualize o IP e endureça de novo
    (ou adote Tailscale, §8.1, e o problema desaparece).
- Verifique também o **firewall do provedor** da VPS (painel do provedor).
- **RDP (3389)** segue aberto ao mundo — restrinja ao seu IP de gestão se possível.

## 8. HTTPS (recomendado)

Sem domínio, as opções são:

### 8.1 Tailscale (melhor; nada exposto publicamente)

Na VPS e em cada dispositivo: instale o Tailscale, faça login na mesma tailnet.
O Caddy passa a responder com certificado válido real em
`https://mercury.<sua-tailnet>.ts.net` (ativar provisionamento HTTPS no painel).
Firewall externo pode então **fechar o 80** completamente.

### 8.2 Caddy `tls internal`

1. `docker-compose.yml`: descomente `"443:443"`.
2. `Caddyfile`: descomente o bloco `https://SEU_IP_AQUI`.
3. Extraia e importe a CA raiz nos dispositivos:
   ```bash
   docker cp mercury-pdv-caddy-1:/data/caddy/pki/authorities/local/root.crt /mnt/c/
   ```
   ```powershell
   certutil -addstore -f Root C:\root.crt   # em cada caixa Windows
   ```
   (Android/iOS: importar o certificado manualmente nas configurações.)

Sem uma das duas, o tráfego vai em HTTP puro — na internet pública isso expõe
o cookie de sessão a sniffing (risco R-03 do `docs/03`).

## 9. O que muda operar pela VPS (avisos)

- **Internet da lanchonete caiu = PDV parado.** O modo offline do PWA só permite
  leitura + transições de KDS (PWA-002) — **vendas e pagamentos exigem o servidor**.
- Latência por operação e dependência do provedor da VPS.
- Recomendação: se a lanchonete puder manter o servidor local como primário, use a
  VPS como acesso remoto/plano B. Operação 100% na VPS só se a internet local for
  estável e o risco de indisponibilidade for aceitável.
- **Restaure um backup local na VPS** se quiser levar o catálogo/mesas já
  configurados (§11) — senão comece com base vazia via setup.

## 10. Backups fora da VPS

O app gera VACUUM INTO a cada 6h dentro do volume. Exporte periodicamente:

```bash
bash ~/mercurypdv/deploy/copiar-backups.sh   # → C:\BackupsMercuryPDV
```

Agendamento diário 03:00 (PowerShell, Administrador):

```powershell
schtasks /Create /TN "MercuryPDV Exportar Backups" /SC DAILY /ST 03:00 /RU SYSTEM ^
  /TR "wsl.exe -d Ubuntu-24.04 -u root bash /root/mercurypdv/deploy/copiar-backups.sh"
```

> Ajuste o caminho se seu usuário WSL não for root. Baixe `C:\BackupsMercuryPDV`
> para fora da VPS com frequência (backup na mesma máquina não é backup).

## 11. Restaurar backup

**Sempre com o app parado** (o script já faz). Backup da máquina local:

```powershell
# na máquina local (PowerShell): gere o backup e envie à VPS (RDP/SCP)
.\scripts\backup.ps1 -Motivo "migracao-vps"
```

```bash
# na VPS, dentro do WSL
bash ~/mercurypdv/deploy/restaurar-backup.sh /mnt/c/Users/SEU_USUARIO/Downloads/lanchonete-....sqlite
```

## 12. Atualizar a versão do sistema

1. Copie os arquivos novos (zip → `C:\MercuryPDV13`, substituindo `server/`/`public/`).
2. Repita o `cp` da Fase 3 (§4) — **mantenha `deploy/.env`** (o pepper!). Dados não
   são afetados: vivem nos volumes.
3. `docker compose -f deploy/docker-compose.yml up -d --build`

## 13. Comandos úteis (WSL, na pasta `~/mercurypdv`)

```bash
docker compose -f deploy/docker-compose.yml ps          # estado
docker compose -f deploy/docker-compose.yml logs -f app # logs da aplicação
docker compose -f deploy/docker-compose.yml restart     # reiniciar
docker compose -f deploy/docker-compose.yml exec app node server/src/tools/backup.js  # backup manual
docker compose -f deploy/docker-compose.yml down        # parar tudo
docker run --rm -it -v mercury-pdv_vol_logs:/logs alpine sh   # inspecionar logs
```

## 14. Troubleshooting

| Sintoma | Causa provável | Solução |
|---|---|---|
| `wsl` não inicia / erro Hyper-V | Virtualização aninhada desativada no provedor | Pedir ao provedor para habilitar nested virtualization |
| Build falha em `npm ci` | DNS/rede do WSL | Reiniciar WSL: `wsl --shutdown`; testar `curl https://registry.npmjs.org` |
| `app` unhealthy | Ver logs: `docker compose logs app` | Geralmente pepper ausente no `deploy/.env` |
| Porta 80 não responde externamente | IIS ocupando a porta; portproxy sem IP do WSL; firewall do provedor | §7; rodar `iniciar-mercury-vps.ps1` manual; `netsh interface portproxy show all` |
| Ninguém consegue logar após rebuild | Pepper mudou/perdeu | Restaurar `deploy/.env` original; senão, recriar senhas |
| Reset total (apaga TUDO — dados incluídos) | — | `docker compose down -v` (apaga os volumes) e `up -d --build` |

## Apêndice B — Plano C: Node nativo + NSSM (sem WSL/Docker)

Se o provedor não permitir virtualização aninhada: instale o Node 24 LTS (.msi),
copie o projeto para `C:\MercuryPDV13`, crie `.env` com pepper, e registre como
serviço com NSSM (`nssm install MercuryPDV "C:\Program Files\nodejs\node.exe"
"server\src\index.js"` + `appdir`). O SQLite roda direto em NTFS sem problema
nenhuma. Proxy/firewall seguem os mesmos passos (§7/§8) sem portproxy.
