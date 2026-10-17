# Mercury PDV 1.3.1 — Guia Completo de Implantação na Nuvem AWS

> **Painel Cloud AWS & DevOps** — implantação profissional em instâncias
> **EC2**, **ECS Fargate** ou **Elastic Beanstalk**, com endereço de conexão
> online para os garçons (celular via web), HTTPS automático, backups e
> sincronização de dispositivos em tempo real.

Este guia leva o Mercury PDV 1.3.1 — PDV offline-first (Express + SQLite +
WebSocket, banco `node:sqlite` nativo, zero dependência externa) — para a AWS
sem alterar o código. Tudo o que o sistema precisa é de **um processo Node.js
e três diretórios persistentes** (`data/`, `backups/`, `logs/`).

---

## Índice

1. [Arquitetura na AWS](#1-arquitetura-na-aws)
2. [Pré-requisitos](#2-pré-requisitos)
3. [Preparar a imagem Docker (ECR)](#3-preparar-a-imagem-docker-ecr)
4. [Caminho A — EC2 + Docker Compose (recomendado)](#4-caminho-a--ec2--docker-compose-recomendado)
5. [Caminho B — ECS Fargate (sem servidor)](#5-caminho-b--ecs-fargate-sem-servidor)
6. [Caminho C — Elastic Beanstalk (gerenciado)](#6-caminho-c--elastic-beanstalk-gerenciado)
7. [Endereço de conexão online (o link dos garçons)](#7-endereço-de-conexão-online-o-link-dos-garçons)
8. [Backups em nuvem (S3)](#8-backups-em-nuvem-s3)
9. [Segurança](#9-segurança)
10. [Custos estimados](#10-custos-estimados)
11. [Operação: atualizar, rollback e monitoramento](#11-operação-atualizar-rollback-e-monitoramento)
12. [Checklist de go-live](#12-checklist-de-go-live)
13. [Solução de problemas](#13-solução-de-problemas)

---

## 1. Arquitetura na AWS

O Mercury PDV é **um único container stateful**: o banco é um arquivo SQLite
em WAL. Isso simplifica (sem RDS, sem Redis) e exige uma regra:

> **Uma tarefa por vez, com diretórios em volume persistente.**
> Nunca escale horizontalmente (2 containers no mesmo banco = corrupção).
> O app já serializa escritas com `BEGIN IMMEDIATE` — 1 instância aguenta um
> caixa cheio com folga.

```
                    Internet
                        │
             ┌──────────▼───────────┐
             │  Caddy (HTTPS 443)  │  ← Let's Encrypt automático (EC2)
             │  ou ALB + ACM (ECS) │
             └──────────┬──────────┘
                        │ rede interna
             ┌──────────▼───────────┐
             │  Container mercury- │
             │  pdv (Node 24)       │  ← Express + WS na porta 3000
             │  /app/data  ────────┼──► Volume EBS | EFS | pasta do host
             │  /app/backups       │     (lanchonete.sqlite + WAL)
             │  /app/logs          │
             └─────────────────────┘
                        ▲
                        │ WebSocket /ws (seq monotônico)
        ┌───────────────┴────────────────┐
        │  PDV no balcão · Garçons no    │
        │  celular (web/QR) · KDS na     │
        │  cozinha · Celular em qualquer │
        │  lugar via LP_URL_PUBLICA      │
        └────────────────────────────────┘
```

**Como escolher o caminho:**

| Caminho | Use quando | Esforço | Dados ficam em |
|---|---|---|---|
| **A — EC2 + Compose** | Quer o mais barato e direto (1 instância) | ~30 min | Volume EBS (`/var/lib/docker/volumes`) |
| **B — ECS Fargate** | Não quer gerenciar servidor | ~50 min | EFS (requer PV 1.4.0+) |
| **C — Elastic Beanstalk** | Quer console gerenciado + deploys por upload | ~40 min | Pastas do host (`/var/app/...`) |

Instância sugerida: **`t3.small`** (2 vCPU / 2 GB) atende bem; `t3.micro`
funciona para testes. Região com latência baixa no Brasil: **`sa-east-1`**.

---

## 2. Pré-requisitos

- Conta AWS ativa + usuário IAM com permissões de EC2/ECS/ECR/Beanstalk/EFS
- [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) configurado (`aws configure`)
- Docker local (para build) — ou o próprio EC2 com Docker instalado
- Um par de chaves SSH na região (`aws ec2 create-key-pair --key-name mercury-kp --query 'KeyMaterial' --output text > mercury-kp.pem`)
- **O pepper do seu banco atual** (de `.env` local): ele é necessário para os
  logins existentes funcionarem na nuvem. Se for uma instalação nova, gere um:
  `openssl rand -hex 32`

---

## 3. Preparar a imagem Docker (ECR)

### 3.1 Criar o repositório no ECR

```bash
export REGION=sa-east-1
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
aws ecr create-repository --repository-name mercury-pdv --region $REGION
```

### 3.2 Build e push

```bash
# Na raiz do projeto Mercury PDV 1.3.1:
docker build -t mercury-pdv:1.3.1 -f deploy/aws/Dockerfile .

aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com

docker tag mercury-pdv:1.3.1 ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/mercury-pdv:1.3.1
docker push ${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/mercury-pdv:1.3.1
```

> **Otimizações já embutidas no `deploy/aws/Dockerfile`:** base
> `node:24-alpine` (~120 MB), camada de dependências cacheada
> (`npm ci --omit=dev` — runtime usa só `express` + `ws`), usuário não-root,
> `HEALTHCHECK` no endpoint `/health` e `STOPSIGNAL SIGTERM` para o
> checkpoint do WAL no encerramento.

Caminhos A e C também aceitam **build na própria instância** (o compose
faz o build; o Beanstalk aceita bundle com Dockerfile) — o ECR é opcional
para o caminho A.

---

## 4. Caminho A — EC2 + Docker Compose (recomendado)

### 4.1 Criar a instância EC2

```bash
# Security Group: 22 (SSH, restrinja ao seu IP), 80 e 443 públicos. NUNCA exponha a 3000.
aws ec2 create-security-group --group-name mercury-sg --description "Mercury PDV 1.3.1"
export SG_ID=<id-do-grupo-criado>
aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 22 --cidr SEU_IP/32
aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 80  --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id $SG_ID --protocol tcp --port 443 --cidr 0.0.0.0/0

# Ubuntu 24.04 LTS, t3.small, 20 GB gp3
aws ec2 run-instances \
  --image-id ami-xxxxx \   # Ubuntu 24.04 em sa-east-1 (consulte o console/SSM Parameter Store)
  --instance-type t3.small \
  --key-name mercury-kp \
  --security-group-ids $SG_ID \
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":20,"VolumeType":"gp3"}}]' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=mercury-pdv}]'
```

Associe um **Elastic IP** à instância (IP fixo) — console EC2 → Elastic IPs.

### 4.2 Instalar Docker + Compose na instância

```bash
ssh -i mercury-kp.pem ubuntu@<ELASTIC_IP>
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker
```

### 4.3 Subir o Mercury PDV

```bash
# Copie o projeto (ou clone do seu repositório Git)
scp -i mercury-kp.pem -r "MercuryPDV 1.3.1" ubuntu@<ELASTIC_IP>:mercury
cd mercury
cp deploy/aws/.env.example deploy/aws/.env
nano deploy/aws/.env        # preencha LP_PEPPER e LP_URL_PUBLICA (§7)
export MERCURY_DOMINIO=pdv.sualanchonete.com.br   # ou use :80 no Caddyfile antes de ter domínio
docker compose -f deploy/aws/docker-compose.yml up -d --build
docker compose -f deploy/aws/docker-compose.yml ps   # aguarde "healthy"
```

Pronto: `http://<ELASTIC_IP>` já responde (modo HTTP do Caddyfile) e, com o
domínio apontado, `https://pdv.sualanchonete.com.br` emite o certificado
automaticamente em ~1 minuto.

> **Trazer os dados da loja local:** com o servidor **local** parado, copie
> `data/lanchonete.sqlite` (e os `-wal`/`-shm`, se houver) para dentro do
> volume:
> ```bash
> docker cp data/lanchonete.sqlite $(docker ps -q -f name=app):/tmp/
> docker compose -f deploy/aws/docker-compose.yml down
> docker run --rm -v mercury-pdv-aws_vol_dados:/data -v $(pwd):/origem alpine \
>   sh -c "cp /origem/lanchonete.sqlite /data/ && chown 1000:1000 /data/lanchonete.sqlite"
> docker compose -f deploy/aws/docker-compose.yml up -d
> ```

---

## 5. Caminho B — ECS Fargate (sem servidor)

### 5.1 Rede e armazenamento

```bash
aws ecs create-cluster --cluster-name mercury
# VPC padrão serve. Crie o EFS:
aws efs create-file-system --name mercury-dados --region $REGION
aws efs create-mount-target --file-system-id <EFS_ID> --subnet-id <SUBNET_ID> --security-groups <SG_EFS>
```

O **security group do EFS** deve permitir entrada **TCP 2049** vinda do
security group da tarefa. Crie também um **Access Point** (console EFS →
Access Points → Create) com:
- Root directory: `/`
- POSIX: UID/GID **1000** (usuário `node` do container), permissão `0755`

### 5.2 Segredo do pepper (Secrets Manager — nunca no JSON)

```bash
aws secretsmanager create-secret --name mercury-pdv/pepper \
  --secret-string "$(openssl rand -hex 32)"
```

### 5.3 Roles

- **Execution role** (obrigatória no Fargate): use a política gerenciada
  `AmazonECSTaskExecutionRolePolicy` + `secretsmanager:GetSecretValue`
  (para o pepper) e permissão de leitura no ECR.
- **Task role**: adicione `elasticfilesystem:ClientMount`,
  `ClientWrite`, `ClientRootAccess` (o mount usa IAM).

### 5.4 Task definition e serviço

```bash
# edite deploy/aws/ecs-task-definition.json: ACCOUNT_ID, REGION, ARNs, EFS_ID, ACCESS_POINT_ID
aws ecs register-task-definition --cli-input-json file://deploy/aws/ecs-task-definition.json

aws ecs create-service \
  --cluster mercury \
  --service-name mercury-pdv \
  --task-definition mercury-pdv \
  --desired-count 1 \
  --launch-type FARGATE \
  --platform-version LATEST \
  --network-configuration "awsvpcConfiguration={subnets=[<SUBNET_ID>],securityGroups=[<TASK_SG>],assignPublicIp=ENABLED}" \
  --region $REGION
```

> **desiredCount é sempre 1** (SQLite single-writer). Para HTTPS, coloque um
> **ALB** na frente (target group na porta 3000 do serviço, listener 443 com
> certificado **ACM**) e use o DNS do ALB como `LP_URL_PUBLICA`.

---

## 6. Caminho C — Elastic Beanstalk (gerenciado)

### 6.1 Aplicação e ambiente

Console Elastic Beanstalk → **Create environment** → plataforma
**Docker running on Amazon Linux 2023** → aplicação `mercury-pdv`.

### 6.2 Artefato de deploy (imagem do ECR)

Edite `deploy/aws/Dockerrun.aws.json` (substitua `<ACCOUNT_ID>`/`<REGION>`)
e gere o bundle:

```bash
cd deploy/aws && zip ../../mercury-eb.zip Dockerrun.aws.json && cd ../..
```

> Alternativa sem ECR: coloque o `Dockerfile` na **raiz** de um bundle com o
> código (`server/`, `public/`, `package*.json`) — o Beanstalk constrói a
> imagem na instância. Os mapeamentos de volume do Dockerrun valem igual.

### 6.3 Variáveis de ambiente (pepper e endereço)

Crie `.ebextensions/options.config` no bundle:

```yaml
option_settings:
  aws:elasticbeanstalk:application:environment:
    LP_PEPPER: "<seu-pepper-hex-64>"
    LP_URL_PUBLICA: "https://pdv.seudominio.com.br"
    LP_AMBIENTE: "producao"
    TZ: "America/Sao_Paulo"
  aws:elasticbeanstalk:environment:proxy:staticfiles:
    # nada: o Express serve tudo
    /: ""
```

> **Melhor prática:** evite o pepper em texto no bundle — prefira
> `aws:elasticbeanstalk:application:environment` com valor buscado de
> Secrets Manager via `.platform/hooks` no boot, e apague o arquivo após o
> deploy. O essencial: o pepper NÃO pode mudar depois.

### 6.4 Upload

```bash
aws elasticbeanstalk create-application --application-name mercury-pdv
aws elasticbeanstalk create-application-version --application-name mercury-pdv \
  --version-label 1.3.1 --source-bundle S3Bucket=<SEU_BUCKET>,S3Key=mercury-eb.zip
# crie o ambiente apontando para a versão (console ou CLI create-environment)
```

Os volumes do Dockerrun (`/var/app/mercury-data`, `-backups`, `-logs`)
persistem entre redeploys no mesmo host. Para o domínio: associe um
certificado ACM ao listener 443 do ELB do ambiente (console EB →
Configuration → Load balancer).

---

## 7. Endereço de conexão online (o link dos garçons)

O 1.3.1 cria o **endereço de acesso online** do estabelecimento. Ele é a URL
pública da sua instalação — usada pelo módulo de conexão via celular (web) e
pelo painel Dev:

1. **Aponte o domínio** (Route 53): registro A/CNAME
   `pdv.seudominio.com.br` → Elastic IP (EC2), ALB (Fargate) ou ELB (Beanstalk).
2. **Configure no Mercury** — uma das formas:
   - variável no `.env` do deploy: `LP_URL_PUBLICA=https://pdv.seudominio.com.br`
   - ou no painel: **Administração → Sistema → Configurações → Celular → Online (AWS)**
3. **Divulgue**: o QR Code online aparece na mesma tela *Configurações →
   Celular*, ao lado do QR da rede local. O garçom escaneia e cai direto em
   `https://pdv.seudominio.com.br/#comandas` — funciona **de qualquer lugar
   com internet**, sem depender do Wi-Fi da loja.
4. Confirme no **Painel Dev → Cloud AWS & DevOps** o endereço ativo e a
   contagem de dispositivos sincronizados.

Formato do endereço (padrão Mercury):

```
https://pdv.<seu-estabelecimento>.com.br/#comandas   ← garçons (comandas)
https://pdv.<seu-estabelecimento>.com.br/#mobile     ← venda rápida mobile
https://pdv.<seu-estabelecimento>.com.br/#kds        ← monitor da cozinha
```

---

## 8. Backups em nuvem (S3)

O sistema já gera backups consistentes (`VACUUM INTO` + `integrity_check`)
a cada 6h em `/app/backups` com retenção de 30. Para guardá-los fora do
servidor, sincronize com S3 (cron na instância EC2):

```bash
aws s3api create-bucket --bucket mercury-backups-<CONTA> --region sa-east-1
# exemplo de cron diário (crontab -e):
0 3 * * * aws s3 sync /var/lib/docker/volumes/mercury-pdv-aws_vol_backups/_data s3://mercury-backups-<CONTA>/ --sse AES256
```

Restore: baixe o `.sqlite`, pare o serviço, substitua o arquivo em
`data/` (ou use *Administração → Backups → Importar* no próprio painel,
que valida a integridade antes de aceitar) e suba de novo.

---

## 9. Segurança

| Item | Regra |
|---|---|
| Portas públicas | **Somente 80/443** (Caddy/ALB). A 3000 vive na rede interna. SSH (22) restrito ao seu IP. |
| Banco | `data/` nunca é servido por HTTP (o Express só expõe `public/`). |
| Pepper | Fica em Secrets Manager/.env — se vazar, **troque todas as senhas**. Se mudar, todos os logins caem. |
| Sessões | 12 h / 30 min de inatividade; painel *Pessoas → Sessões ativas* desconecta dispositivos na hora. |
| HTTPS | Obrigatório na internet (Caddy/Let's Encrypt ou ACM). `SameSite=Lax` + CSRF header já embutidos. |
| Rate limit | Login com limitador por IP nativo (4 tentativas → bloqueio). |
| Auditoria | `auditoria` é append-only; exportação de backups e CSV ficam registradas. |

---

## 10. Custos estimados (região sa-east-1, out/2026, valores aproximados)

| Item | Custo/mês (USD) |
|---|---|
| EC2 `t3.small` + EBS 20 GB gp3 + Elastic IP (EC2 parado não cobra IP se associado) | ~USD 18–22 |
| Fargate 0,5 vCPU / 1 GB contínuo (730 h) + EFS | ~USD 20–26 |
| Elastic Beanstalk (t3.small gerenciado) | igual EC2 + nada extra |
| ECR (imagem ~150 MB) | < USD 0,02 |
| S3 backups (30 × ~1 MB) | < USD 0,01 |
| Route 53 + certificado | ~USD 1 |

Todos os caminhos custam **~USD 20/mês** para uma lanchonete. Instâncias
menores (`t3.micro`/Fargate 256) ficam na metade para testes.

---

## 11. Operação: atualizar, rollback e monitoramento

### Atualizar a versão (ex.: 1.3.1 → futura)

```bash
# EC2/Compose:
git pull            # ou copie a nova versão
docker compose -f deploy/aws/docker-compose.yml up -d --build
# migrations rodam sozinhas no boot (schema_migrations versionado)

# Fargate: build/push da nova tag → register-task-definition (nova revisão)
#   → aws ecs update-service --force-new-deployment
# Beanstalk: novo application version → Deploy
```

### Rollback

1. Pare o serviço.
2. Baixe o backup desejado do S3 (ou `backups/` do volume).
3. Substitua `data/lanchonete.sqlite` **com o servidor parado** (regra do
   sistema; a rota de restauração bloqueia overwrite online).
4. Suba o serviço e confira `PRAGMA integrity_check` no log do boot.

### Monitoramento

- `/health` → `{"ok":true,"versao":"1.3.1"}` (compose healthcheck + ALB target)
- Logs: `docker compose logs -f app` (EC2) ou CloudWatch Logs `/ecs/mercury-pdv` (Fargate)
- Painel Dev: uptime, memória, seq de eventos, dispositivos conectados
- CloudWatch Agent é opcional; nada do Mercury depende dele.

---

## 12. Checklist de go-live

- [ ] `/health` responde `ok` no domínio HTTPS
- [ ] LP_PEPPER idêntico ao da loja local (logins de teste passam)
- [ ] `LP_URL_PUBLICA` salva e o QR Code online abre `/#comandas` no celular
- [ ] WebSocket ativo (sino de notificações conta dispositivos no topo)
- [ ] Abriu caixa, vendeu 1 item, pagou, imprimiu recibo 58/80mm
- [ ] KDS avançou pedido → sino tocou no celular do garçom
- [ ] Relatórios + exportação CSV baixam corretamente
- [ ] Backup automático apareceu em `backups/` (ou force "Fazer backup agora")
- [ ] Sessões ativas listam IP/origem; desconexão funciona
- [ ] Security Group expõe só 80/443; porta 3000 não responde da internet

---

## 13. Solução de problemas

| Sintoma | Causa provável | Correção |
|---|---|---|
| `502` no domínio | App ainda subindo (healthcheck) | Aguarde 30 s; `docker compose ps` deve mostrar `healthy` |
| Ninguém consegue logar | Pepper diferente do banco original | Use o pepper da instalação que gerou o banco |
| `SQLITE_BUSY` no log | >1 container no mesmo `data/` | `desiredCount=1`; nunca suba 2 réplicas |
| WS conecta e cai em loop | Proxy sem upgrade WebSocket | Caddy/ALB já suportam; verifique Nginx manual (`proxy_set_header Upgrade`) |
| HTTPS não emite (EC2) | Domínio sem A-record ou porta 80 bloqueada | Confirme Route 53 e o SG |
| Dados sumiram após redeploy (Beanstalk) | Bundle sem Dockerrun (volumes não mapeados) | Use o `Dockerrun.aws.json` desta pasta |
| Celular não sincroniza fora da loja | `LP_URL_PUBLICA` vazio ou só LAN | Configure §7 e recarregue o painel |

---

*Mercury PDV 1.3.1 — os três caminhos usam os mesmos arquivos desta pasta
`deploy/aws/`. Dúvidas de operação diária: `docs/06-manual-por-cargo.md`;
arquitetura local: `docs/02-arquitetura-e-decisoes.md`.*
