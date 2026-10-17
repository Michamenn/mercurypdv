# Mercury PDV 1.3.1 — Operação na AWS (estado vivo + runbook do agente)

> Instalação de produção criada em **17/10/2026**. Este é o registro de estado
> e o manual de operação da nuvem. **Atualize este arquivo após qualquer
> mudança na infraestrutura** (IP, domínio, versão, dados migrados).

## Estado atual (17/10/2026)

| Item | Valor |
|---|---|
| Endereço público | **http://<IP_PUBLICO>** (HTTP; HTTPS pendente — ver §Domínio) |
| Conta AWS | `<CONTA_AWS>` (acesso do agente via MCP `aws-mcp`; não há AWS CLI instalado) |
| Região | `sa-east-1` (São Paulo) |
| Instância | `<ID_DA_INSTANCIA>` · **t3.micro** (free tier, 750 h/mês) · Ubuntu 24.04 LTS · AMI `<AMI>` |
| VPC / Sub-rede / AZ | `<VPC>` · `<SUBNET>` · `sa-east-1a` |
| Security Group | `<SG>` (*mercury-pdv-sg*): 22 só do IP do operador (`<IP_DO_OPERADOR>`), 80 e 443 públicos |
| ECR | `<CONTA_AWS>.dkr.ecr.sa-east-1.amazonaws.com/mercury-pdv` — criado, **ainda sem imagem** (o build roda na instância) |
| App na instância | código em `/opt/mercury` · compose: `deploy/aws/docker-compose.yml` · `.env` em `deploy/aws/.env` |
| Containers | `mercury-pdv-aws-app-1` (Node 24, porta 3000) + `mercury-pdv-aws-caddy-1` (`:80`) |
| Volumes | `vol_dados` (SQLite) · `vol_backups` · `vol_logs` · `vol_caddy` |
| Pepper | Gerado **no servidor** (instalação nova) — existe APENAS em `/opt/mercury/deploy/aws/.env`; nunca copiar para o repo |
| `LP_URL_PUBLICA` | `http://<IP_PUBLICO>` (no `.env` do servidor E na config `url_publica` do sistema) |
| Dados | Instalação **do zero**: admin criado pelo usuário; **cardápio importado** (4 categorias / 35 produtos — ver `cardapio-para-importar.json` na raiz do projeto) |
| Custos | Dentro do free tier (t3.micro + EBS 20 GB de 30 GB). **Sem Elastic IP** (IP muda se parar a instância — por escolha de custo zero) |

## Como o agente acessa

1. **APIs da AWS** — sempre pelo MCP `aws-mcp` (`aws___run_script` com
   `call_boto3`). AWS CLI e Docker **não existem** nesta máquina.
2. **Shell da instância** — EC2 Instance Connect (a AMI Ubuntu já vem com o agente):
   1. Gerar par de chaves local: `ssh-keygen -t ed25519 -f %TEMP%\opencode\mercury-deploy\mercury-eci -N ""`
   2. `SendSSHPublicKey` via MCP (`InstanceId` acima, `InstanceOSUser: ubuntu`,
      `AvailabilityZone: sa-east-1a`) — a chave vale **60 s**; cada `ssh`/`scp`
      novo exige um push novo.
   3. `ssh -i <chave> ubuntu@<IP_PUBLICO> "..."` (usar `-o StrictHostKeyChecking=accept-new`).
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
