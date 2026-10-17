# Mercury PDV 1.3.1 — Operação na AWS (estado vivo + runbook do agente)

> Instalação de produção criada em **17/10/2026**. Este é o registro de estado
> e o manual de operação da nuvem. **Atualize este arquivo após qualquer
> mudança na infraestrutura** (IP, domínio, versão, dados migrados).
>
> **Identificadores (endereço público, conta, instância, SG/VPC, ECR)** ficam no
> arquivo **local** `docs/17-operacao-aws.local.md` — ignorado pelo Git — para o
> repositório não carregar dados da infraestrutura. Este documento usa
> `<PLACEHOLDERS>`.

## Estado atual (17/10/2026)

| Item | Valor |
|---|---|
| Endereço público | **HTTP no IP público da instância** (valor no arquivo local) — HTTPS pendente, ver §Domínio |
| Conta AWS | `<CONTA_AWS>` (valor no arquivo local) · perfil `default` autenticado por **`aws login`** (CLI `2.38.1` em `C:\Users\pc\AppData\Local\Programs\Amazon\AWSCLIV2\aws.exe`; credencial de curta duração — se expirar: `aws login`) |
| MCP `aws-mcp` | Configurado no `opencode.json` (proxy `uvx mcp-proxy-for-aws`), mas **pode não estar carregado na sessão** — nesse caso use o **AWS CLI** (foi o caminho do deploy de 17/10) |
| Região | `sa-east-1` (São Paulo) |
| Instância | `<ID_DA_INSTANCIA>` · **t3.micro** (free tier, 750 h/mês) · Ubuntu 24.04 LTS |
| VPC / Sub-rede / AZ | `<VPC>` · `<SUBNET>` · `sa-east-1a` |
| Security Group | `<SG>` (*mercury-pdv-sg*): 22 restrito ao **IP do operador** (valor no arquivo local), 80 e 443 públicos |
| ECR | `<ACCOUNT_ID>.dkr.ecr.sa-east-1.amazonaws.com/mercury-pdv` — criado, **ainda sem imagem** (o build roda na instância) |
| App na instância | código em `/opt/mercury` · compose: `deploy/aws/docker-compose.yml` · `.env` em `deploy/aws/.env` |
| Containers | `mercury-pdv-aws-app-1` (Node 24, porta 3000) + `mercury-pdv-aws-caddy-1` (`:80`) |
| Volumes | `vol_dados` (SQLite) · `vol_backups` · `vol_logs` · `vol_caddy` |
| Pepper | Gerado **no servidor** (instalação nova) — existe APENAS em `/opt/mercury/deploy/aws/.env`; nunca copiar para o repo |
| `LP_URL_PUBLICA` | `http://<IP_PUBLICO>` (no `.env` do servidor E na config `url_publica` do sistema; valor no arquivo local) |
| Dados | Instalação **do zero**: admin criado pelo usuário; **cardápio importado** (4 categorias / 35 produtos — ver `cardapio-para-importar.json` na raiz do projeto). Em 17/10 (pós-deploy): **49 produtos, 15 mesas, 5 usuários, 10 pedidos** |
| Custos | Dentro do free tier (t3.micro + EBS 20 GB de 30 GB). **Sem Elastic IP** (IP muda se parar a instância — por escolha de custo zero) |
| Versão em produção | Código de **17/10/2026** (cargo Proprietário, painel Conta, trava de caixa fechado no PDV; painéis de comanda com **altura fixa** e lista rolável, **Gorjeta no fluxo Receber/Fechar**, **modal de quantidade** estreito com stepper, Cortesia/Gorjeta/Chamar fora do painel; **Conta** em papel branco liso, fonte maior e painel lateral compacto (430 px), item do cupom com **qtd + produto + preço na mesma linha**; **exclusão de usuário no painel dev** — Suporte técnico → Usuários, com **Reativar**; **Pessoas → Usuários lista só ativos**; **painel do PDV padronizado** com o da mesa — `painel-comanda`, ação principal em largura total) · banco na migração **v13** (`013_proprietario_painel_dev`) |
| Backups pré-deploy (17/10) | `lanchonete-2026-10-17T16-04-52-159Z.sqlite` (520 KB), `…T16-43-36-084Z` (524 KB), `…T16-45-41-273Z` (524 KB), `…T16-51-25-771Z` (524 KB), `…T17-01-09-601Z` (524 KB) e `…T17-14-32-659Z` — todos `integrity: ok`, motivo `pre-deploy`, no volume `vol_backups` |
| Rollback dos deploys (17/10) | imagens `mercury-pdv:pre-deploy-20261017-160339`, `-164335`, `-164540`, `-165125`, `-170109` e `-171432` + snapshots `/home/ubuntu/mercury-pre-deploy-<TS>.tar.gz` na instância |

## Como o agente acessa

1. **APIs da AWS** — pelo MCP `aws-mcp` (`aws___run_script` com `call_boto3`)
   **ou** pelo **AWS CLI v2** (instalado nesta máquina desde 17/10; perfil
   `default` via `aws login`). Se o MCP não estiver carregado na sessão (sem
   ferramentas no registry), use o CLI — foi o caminho do deploy de 17/10.
   Docker continua **não** existindo localmente (o build roda na instância).
2. **Shell da instância** — EC2 Instance Connect (a AMI Ubuntu já vem com o agente):
   1. Gerar par de chaves local: `ssh-keygen -t ed25519 -f %TEMP%\opencode\mercury-deploy\mercury-eci -N ""`
   2. `SendSSHPublicKey` via MCP (`InstanceId` acima, `InstanceOSUser: ubuntu`,
      `AvailabilityZone: sa-east-1a`) — a chave vale **60 s**; cada `ssh`/`scp`
      novo exige um push novo.
   3. `ssh -i <chave> ubuntu@<IP_PUBLICO> "..."` (usar `-o StrictHostKeyChecking=accept-new`;
      IP no arquivo local) — os IDs (`--instance-id`, AZ) também estão lá.
   4. **Remover a chave local depois** do uso.
3. O sandbox do MCP **bloqueia** `base64` e `__import__` — gerar base64 em
   JS (`btoa`) e injetar como literal na string do script.

## Runbook

### Atualizar a versão do app na nuvem

```powershell
# 1. empacotar localmente (NA RAIZ do projeto; sem node_modules/.git/dados)
tar -czf $env:TEMP\opencode\mercury-src.tar.gz package.json package-lock.json server public deploy/aws
# 2. push da chave EIC (ver §acesso) e subir o pacote
scp -i <chave> <pacote> ubuntu@<IP>:/home/ubuntu/mercury-src.tar.gz
# 3. novo push de chave + aplicar
ssh -i <chave> ubuntu@<IP> "tar -xzf /home/ubuntu/mercury-src.tar.gz -C /opt/mercury && cd /opt/mercury/deploy/aws && docker compose up -d --build"
```

Migrações rodam sozinhas no boot (`schema_migrations` versionado).
**Nunca** sobrescrever `deploy/aws/.env` do servidor — o pepper mora lá.

### Reiniciar / logs / saúde

```bash
cd /opt/mercury/deploy/aws
docker compose ps            # app deve mostrar (healthy)
docker compose logs -f app   # acompanhar
docker compose restart app   # reinício (checkpoint do WAL é feito no SIGTERM)
curl -s localhost/health     # {"ok":true,"versao":"1.3.1",...}
```

### IP mudou (instância foi parada/reiniciada)

1. Descobrir o novo IP (`DescribeInstances` via MCP) e conferir SG/SSH.
2. SSH → editar `/opt/mercury/deploy/aws/.env` (`LP_URL_PUBLICA=http://<NOVO_IP>`) → `docker compose up -d`.
3. No painel web: *Configurações → Celular → Online (AWS)* atualizar
   `url_publica` (ou via API `PUT /api/config`).
4. Atualizar este documento.
   → Solução definitiva: associar um **Elastic IP** (custa ~USD 3,6/mês fora
   de promoções) quando colocar o domínio.

### Colocar domínio + HTTPS

Seguir `DEPLOY_AWS.md` **§7**: Elastic IP → registro A/CNAME no Route 53 →
`Caddyfile` do servidor trocado de `:80` para `{$MERCURY_DOMINIO}` (o original
com Let's Encrypt está em `deploy/aws/Caddyfile`) → `LP_URL_PUBLICA` em
`https://...` → `docker compose up -d` → atualizar este documento.

### Importar cardápio

- Pelo painel: *Administração → Operação → Produtos → Importar cardápio* (faz
  backup automático antes e valida integridade).
- Arquivo semente com o cardápio REAL da loja: `cardapio-para-importar.json`
  (raiz do projeto; 35 itens, formato `lanchonete-pro-cardapio` v1).
- **Pegadinha de validação em banco de teste**: `importarCardapio` registra
  auditoria com FK `usuario_id` — em base vazia, criar um usuário antes de
  chamar (senão: `FOREIGN KEY constraint failed`).

### Backup / restore na nuvem

- Backups automáticos (VACUUM INTO, 6 em 6 h) no volume `vol_backups`.
- Download/restore pelo painel (*Administração → Backups*), ou S3 conforme
  `DEPLOY_AWS.md` §8 (S3 não estava habilitado na conta em 17/10/2026).

## Pegadinhas aprendidas na implantação (17/10/2026)

| Sintoma | Causa | Solução |
|---|---|---|
| Arquivo novo em `/opt/mercury/public/` não é servido | `public/` é assado **na imagem**, não é volume | `docker cp <arquivo> mercury-pdv-aws-app-1:/app/public/` (ou rebuild) — remover depois |
| JSON chega com acentos corrompidos (`CafǸ`) | Round-trip de JSON por string do PowerShell quebra UTF-8 | Transferir binário (`scp`) ou buscar pelo navegador (`fetch` dentro da página) |
| `OptInRequired` / `NotSignedUp` em EC2/S3 | Conta nova sem ativação | Passo manual do dono no console (billing/contato) — ECR e IAM já funcionam antes |
| `fill_form`/`click` do navegador falham com ref stale | Re-render da tela de login/PIN pad | Novo `snapshot` e usar refs frescos |
| Evaluate não acha elementos com classe `.mesa` | Classe correta é `.mesa-salao` (mapa do salão) | Ver `cartaoMesa()` em `public/js/views/mesas.js` |
| **Caddyfile do servidor sobrescrito no deploy** | O `Caddyfile` do repo é a versão com domínio/Let's Encrypt; o do servidor é `:80` (HTTP puro) — extrair o tar por cima **derruba o site** | Antes de extrair: `cp -p deploy/aws/{.env,Caddyfile,docker-compose.yml} /home/ubuntu/mercury-keep/` e restaurar depois (comparar por `sha256sum`). Idem para `docker-compose.yml` (usar `diff`) |
| Script remoto morre no meio (`| bash`) | `docker compose exec -T` **consome o stdin** (que era o próprio script) | Gravar o script em arquivo na instância e rodar `bash /tmp/x.sh`; usar `< /dev/null` nos `docker compose exec` |
| `node server/src/tools/backup.js` não faz nada | O arquivo só **exporta** funções — não tem entrada de CLI | `docker compose exec -T -w /app app node --input-type=module -e '...criarBackup(db, {motivo:"pre-deploy"})...'` (ou pelo painel *Administração → Backups*) |
| `no such column: versao` em `schema_migrations` | As colunas são `version` / `nome` / `aplicado_em` | Usar `SELECT version, nome FROM schema_migrations` |
| `scp` falha com caminho Windows (`C:\...`) | `scp` lê `host:caminho` — `C:` vira host | `Push-Location` na pasta do arquivo e passar só o nome relativo |
| `ssh` com aspas quebradas pelo PowerShell | PowerShell remove as aspas ao chamar exe nativo | Enviar o script em **base64**: `ssh ... "echo '<b64>' | base64 -d > /tmp/x.sh && bash /tmp/x.sh"` |

### Deploy pela CLI (sem MCP) — sequência usada em 17/10/2026

```powershell
# 0. credenciais (sessão de curta duração):  aws login
# 1. pacote (na raiz do projeto)
tar -czf $env:TEMP\opencode\mercury-src.tar.gz package.json package-lock.json server public deploy/aws
# 2. chave ECI (vale 60 s — repetir o push antes de CADA ssh/scp)
ssh-keygen --% -q -t ed25519 -f C:\Users\pc\AppData\Local\Temp\opencode\mercury-deploy\mercury-eci -N "" -C mercury-eci
#    (se o -N "" falhar no PowerShell, gerar via node: spawnSync('ssh-keygen', ['-q','-t','ed25519','-f',p,'-N','','-C','mercury-eci']))
aws ec2-instance-connect send-ssh-public-key --instance-id <ID_DA_INSTANCIA> --instance-os-user ubuntu `
  --availability-zone sa-east-1a --ssh-public-key (Get-Content <chave>.pub -Raw) --output json
# 3. subir o pacote (nome relativo!) e 4. novo push + extrair preservando .env/Caddyfile/compose
# 5. docker compose up -d --build   (build roda na instância, ~1 min no t3.micro)
# 6. conferir: docker compose ps, curl -s localhost/health, migração v13, integrity_check
```

**Nunca** sobrescrever `deploy/aws/.env` (pepper) nem o `Caddyfile` do servidor. Remover a chave local ao final.
