# Mercury PDV 1.3.1 — Notas da Versão

> Atualização da 1.3 para a **1.3.1**. Compatível com o banco da 1.3:
> a migração `012_v131_impressao_notificacoes.sql` é aplicada automaticamente
> no primeiro boot e não altera nenhum dado existente. Os **195 testes**
> passam (183 anteriores preservados + 12 novos).

---

## Resumo das entregas

| # | Entrega | Onde usar |
|---|---|---|
| 1 | **Impressão Térmica Customizável** | Administração → Sistema → **Impressão** |
| 2 | **Tempo de Preparo & KDS Inteligente** | Cadastro do produto (campo *Preparo (min)*) + Cozinha (KDS) |
| 3 | **Notificações em Tempo Real** (sino) | Sino no topo da tela (garçons e atendentes) |
| 4 | **Relatórios com Exportação CSV** | Administração → Financeiro → Relatórios |
| 5 | **Sincronização de Dispositivos** | Indicador `⟳ N dispositivos` no topo + Painel Dev |
| 6 | **Painel Cloud AWS & DevOps** | Painel Dev → aba *Cloud AWS & DevOps* + `DEPLOY_AWS.md` |
| 7 | **Controle de Usuários Logados** | Administração → Pessoas → **Sessões ativas** |
| 8 | **Conexão via celular (web) — rede local ou AWS** | Configurações → Celular (QR local **e** online) |
| 9 | **Mesas em lote, lado a lado** | Mesas & Comandas → **+ Nova mesa** (quantidade) |

---

## 1. Impressão Térmica Customizável

Nova aba dedicada (**Administração → Sistema → Impressão**) para configurar
impressoras térmicas:

- **Conexões:** USB, Bluetooth e Rede (IP com porta — padrão 9100)
- **Bobinas:** 58 mm e 80 mm
- **Cabeçalho e rodapé personalizados:** linhas livres por impressora
  (vazio = usa os dados da empresa)
- **Vias:** 1 ou 2 (via cliente + via cozinha)
- **Pré-visualização em tempo real:** a bobina aparece renderizada enquanto
  você digita; botão *testar* gera o recibo de exemplo e imprime
- **Impressora padrão** por estabelecimento (gravada nas configurações)

A impressão física usa o diálogo do sistema operacional (a impressora deve
estar instalada no Windows ou no celular); o Mercury formata o layout da
bobina com a largura e os textos configurados.

**API:** `GET/POST/PUT/DELETE /api/impressoras` (mutações exigem
`pode_config_sistema`), `POST /api/impressoras/:id/teste` (prévia).
**Testes:** IMPR-001..003, CFG-011.

## 2. Tempo de Preparo & KDS Inteligente

- Cada produto tem **tempo de preparo em minutos** (o campo já existia no
  banco; agora aparece no formulário de cadastro — *Preparo (min)*)
- O KDS calcula a **estimativa do pedido** = maior tempo individual
  (cozinha trabalha em paralelo; o item mais demorado dita o total)
- Cada card mostra **cronômetro ao vivo** (atualiza a cada segundo sem
  refazer a fila), **barra de progresso** e estados de cor:
  - verde: dentro do tempo · amarelo: ≥80% do tempo · vermelho: **ATRASADO**
- O alerta sonoro de atraso agora dispara quando o pedido **estoura a própria
  estimativa** (antes era um limite fixo de 15 min)

**API:** `GET /api/kds` retorna `tempo_preparo_min` por item e
`tempo_estimado_min` por pedido. **Testes:** KDS-010.

## 3. Notificações em Tempo Real (sino)

- Quando a cozinha marca um pedido como **pronto**, o sino no topo dispara
  para **garçons e atendentes** (cargos com atendimento): badge com a
  contagem de **não lidas**, som e toast instantâneos via WebSocket
- O painel do sino lista as notificações com origem (mesa/balcão) e há quanto
  tempo aconteceu
- **Marcar todas como lidas** e **Limpar tudo** (a limpeza apaga o feed)
- Notificações ficam no banco (tabela `notificacoes`, retenção ~500 lidas) —
  valem para todos os dispositivos do estabelecimento

**API:** `GET /notificacoes`, `POST /notificacoes/ler-todas`,
`POST /notificacoes/limpar` (mutações exigem header anti-CSRF, como todo o
sistema). **Testes:** NOTIF-001/002, WS-PRES/NOTIF-003.

## 4. Histórico & Relatórios com Exportação CSV

- **Relatórios → Exportar CSV**: baixa a lista detalhada de vendas do período
  (pedido, origem, comanda, operador, horários, desconto, total e formas de
  pagamento)
- **Relatórios → Resumo CSV**: faturamento bruto/líquido, descontos,
  cancelamentos, **ticket médio**, **quantidade de pedidos**, margem
  estimada, formas de pagamento e top produtos
- Formato pronto para o **Excel em português**: separador `;`, valores
  `R$ 1.234,56` e **BOM UTF-8** (acentuação correta ao abrir direto)
- Toda exportação fica registrada na **auditoria**

**API:** `GET /api/relatorios/vendas.csv?de&ate`,
`GET /api/relatorios/resumo.csv?de&ate` (exige `pode_ver_relatorios`).
**Testes:** CSV-001/002.

## 5. Sincronização de Dispositivos

- Indicador no topo: **`⟳ N dispositivos`** — quantos PDVs, garçons
  (celular) e monitores estão conectados via WebSocket neste instante
- Cada conexão identifica a **origem** (`pdv-web`, `celular-web`, `apk-mobile`)
- Conexões e desconexões geram **evento de presença** em tempo real (sem
  poluir o log de eventos de negócio)
- Status online/offline próprio continua no indicador `● Online` ao lado

**API:** `GET /api/dispositivos` (total para todos; detalhe somente para
quem gerencia usuários). **Testes:** DISP-001, WS-PRES.

## 6. Painel Dev: Cloud AWS & DevOps

O Painel do Desenvolvedor (reautenticação de admin, como antes) ganha três
seções: **Diagnóstico**, **Cloud AWS & DevOps** e **Dispositivos**.

- **Diagnóstico:** como antes + `dispositivos_conectados`, `url_publica` e `versao`
- **Cloud AWS & DevOps:** endereço de conexão online configurado (com QR),
  os três caminhos de implantação e comandos rápidos
- **Dispositivos:** tabela ao vivo dos sockets conectados (operador, cargo,
  origem, IP, desde quando)

**Arquivos novos de implantação:**

| Arquivo | Uso |
|---|---|
| `DEPLOY_AWS.md` | Guia completo: EC2, ECS Fargate e Elastic Beanstalk (passo a passo, custos, rollback, checklist) |
| `deploy/aws/Dockerfile` | Imagem otimizada (Alpine, não-root, HEALTHCHECK, SIGTERM→WAL checkpoint) |
| `deploy/aws/docker-compose.yml` | EC2 em produção (app + Caddy HTTPS automático, volumes persistentes) |
| `deploy/aws/Caddyfile` | Proxy reverso com Let's Encrypt |
| `deploy/aws/ecs-task-definition.json` | Fargate com EFS + pepper via Secrets Manager + `stopTimeout` p/ WAL |
| `deploy/aws/Dockerrun.aws.json` | Elastic Beanstalk (Docker AL2023) com volumes do host |
| `deploy/aws/.env.example` | Variáveis do container na nuvem (inclui `LP_URL_PUBLICA`) |

**Teste:** DEV-010.

## 7. Controle de Usuários Logados

Nova aba **Administração → Pessoas → Sessões ativas**:

- Lista **quem está logado agora**, por qual **origem** (Web computador,
  Celular navegador, APK Mobile), **IP**, **última atividade** e expiração
- Marca a sua própria sessão (`você`) e quem tem WebSocket vivo
  (**online agora**)
- **Desconectar** revoga a sessão e **derruba o socket na hora** no
  dispositivo alvo; ação registrada na auditoria
- Correção de base: o IP agora é gravado **desde o login** (antes o campo
  ficava vazio — `req.ipCliente` só existia após a autenticação)

**API:** `GET /sessoes`, `POST /sessoes/:id/desconectar`
(`pode_gerenciar_usuarios`). **Testes:** SESS-001..003.

## 8. Conexão via Celular — rede local e online (AWS)

A tela **Configurações → Celular** agora tem dois modos lado a lado:

- **Rede local (Wi-Fi):** como antes — QR Code gerado localmente com o
  endereço da LAN (`http://192.168.x.x:3000/#comandas`)
- **Online — servidor na nuvem (AWS):** informe o **endereço público**
  (`url_publica`, ex.: `https://pdv.sualanchonete.com.br`) e o sistema gera o
  QR Code online; garçons conectam **de qualquer lugar com internet**, sem
  depender do Wi-Fi da loja
- O endereço também pode vir do ambiente (`LP_URL_PUBLICA`) — usado pelo
  painel Dev e pelos QR Codes

**Formato do endereço online (padrão Mercury):**

```
https://pdv.<estabelecimento>.com.br/#comandas   ← garçons (comandas)
https://pdv.<estabelecimento>.com.br/#mobile     ← venda rápida
https://pdv.<estabelecimento>.com.br/#kds        ← monitor da cozinha
```

## 9. Mesas em lote, lado a lado no mapa

O botão **+ Nova mesa** (Mesas & Comandas) foi reformulado:

- **Quantidade:** crie de 1 a **50 mesas de uma vez** (antes era uma por vez)
- **Número inicial opcional:** vazio = continua automaticamente do último
  (ex.: com mesas 1 e 2, um lote de 8 cria a 3, 4, 5 … 10); informado = começa
  onde você mandar
- **Assentos por mesa** agora é realmente aplicado no cadastro (antes o campo
  era ignorado na criação)
- **Posicionamento automático lado a lado:** cada mesa nova entra na próxima
  célula livre da grade do salão (passo de 130px = mesa 110px + 20px de
  corredor), varrendo da esquerda para a direita e quebrando para a fileira
  de baixo ao atingir a borda — **nunca uma sobre a outra**, mesmo quando já
  existem mesas arrastadas manualmente
- Lote com número já existente **falha inteiro** (transação) sem criar nada
- O botão passou a aparecer apenas para quem pode gerenciar mesas (antes o
  garçom via o botão e recebia "sem permissão")

**API:** `POST /api/mesas` aceita `quantidade` (1–50), `numero` opcional e
`assentos`; responde com `criadas` e a lista `mesas` (id/numero/posição), além
dos campos da 1ª mesa na raiz para compatibilidade.
**Teste:** SP-018.

---

## Correções de base incluídas

- **IP nas sessões e auditoria de login:** middleware global de `ipCliente`
  (o IP antes não era gravado nas sessões criadas no login/setup)
- **WS com token inválido:** agora responde `auth_erro` em vez de deixar a
  exceção subir no handler de mensagem
- **Service worker:** cache renomeado (`mpdv131-v1`) para forçar a
  atualização dos assets da nova versão

## Migração de banco

`012_v131_impressao_notificacoes.sql` cria:

- `impressoras` (nome, conexão, endereço, largura 58/80, cabeçalho, rodapé,
  vias, ativo)
- `notificacoes` (tipo, título, detalhes, pedido, mesa, criada_em, lida)

Nenhuma tabela existente é alterada; sem risco para dados comerciais. O
backup `lanchonete-...sqlite` de antes da atualização permanece em `backups/`
(motivo `pre-update-1.3.1`).

## Como atualizar a instalação existente

1. **Backup** (o instalador/migração não exige, mas é regra de ouro):
   `.\scripts\backup.ps1 -Motivo "pre-update-1.3.1"`
2. Substitua a pasta do sistema pela **1.3.1** (ou `git pull`)
3. Inicie normalmente: `.\scripts\iniciar_sistema.bat` — a migração roda sózinha
4. Confira no rodapé do login / Painel Dev a versão **1.3.1**
