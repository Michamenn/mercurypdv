# Mercury PDV 1.3.1

PDV offline-first para lanchonetes: caixa, comandas, KDS inteligente, impressão
térmica, notificações em tempo real, estoque e relatórios com CSV. **Funciona
sem internet na rede local — e também na nuvem AWS.**

---

## Como usar (3 passos)

### 1. Iniciar

Dê dois cliques em:

```
scripts\iniciar_sistema.bat
```

Ou pelo PowerShell:

```powershell
.\scripts\iniciar_sistema.bat
```

### 2. Abrir no navegador

```
http://localhost:3000
```

### 3. Criar o administrador

Na **primeira execução** o sistema pede o cadastro do administrador.
Escolha um nome e uma senha de 10+ caracteres (letras e números).

Depois disso, toda entrada é pela tela de login com nome + senha ou PIN.

### Encerrar

```
scripts\parar_sistema.bat
```

---

## O que já vem pronto

✅ **Não precisa instalar nada.** As dependências já estão na pasta
`node_modules`. Não precisa de internet para rodar.

✅ **Banco já criado e vazio.** Está em `data/lanchonete.sqlite`, com as 47
tabelas e todas as migrações aplicadas. **Nenhum dado comercial veio junto** —
nem clientes, nem vendas, nem comandas.

✅ **Segredo próprio.** A chave de criptografia (`.env`) foi gerada nova só
para esta pasta. Não compartilhe esse arquivo.

---

## Primeiros passos depois de instalar

| # | Tarefa | Onde |
|---|---|---|
| 1 | Cadastrar o administrador | aparece no primeiro acesso |
| 2 | Cadastrar os produtos | Administração → Operação → Produtos |
| 3 | Montar o salão | Mesas & Comandas → **+ Nova mesa** (ou "Editar layout" para arrastar) |
| 4 | Ajustar a empresa | Administração → Sistema → Configurações → **Empresa** |
| 5 | Personalizar a tela | Administração → Sistema → **Aparência** |
| 6 | Ler no celular | Configurações → **Celular**: escaneie o QR Code |

> **A pasta 1.3 começa com zero mesas.** Crie as mesas do seu salão manualmente
> em *Mesas & Comandas*. Para começar com a disposicão e os itens do salão
> antigo, use **Importar backup** em *Administração → Backups*.

---

## O que é diferente da versão 1.3

Esta é a **1.3.1**. As principais mudanças:

### Novidades

| Entrega | O que faz |
|---|---|
| **Impressão térmica customizável** | Impressoras USB/Bluetooth/Rede IP, bobinas 58/80mm, cabeçalho/rodapé próprios e pré-visualização em tempo real |
| **Tempo de preparo & KDS inteligente** | Cada produto tem tempo estimado; a cozinha vê cronômetro, progresso e alerta de atraso por pedido |
| **Notificações em tempo real** | Sino no topo avisa garçons e atendentes quando o pedido fica pronto, com não lidas e limpeza |
| **Relatórios com CSV** | Faturamento, ticket médio, pedidos e formas de pagamento exportáveis direto em CSV (Excel pt-BR) |
| **Sincronização de dispositivos** | `⟳ N dispositivos` no topo: PDV, garçons e celular atualizando juntos, com status online/offline |
| **Cloud AWS & DevOps** | Guia `DEPLOY_AWS.md` + Dockerfile e docker-compose otimizados para EC2, ECS Fargate e Elastic Beanstalk |
| **Sessões ativas** | Quem está logado (web/celular/APK), IP, última atividade e desconexão imediata |
| **Celular online ou local** | QR Code da rede local **e** endereço público na nuvem (`https://pdv.sualanchonete.com.br`) |
| **Mesas em lote** | Crie até 50 mesas de uma vez, numeradas em sequência e dispostas lado a lado no mapa |
| **Painel Conta nos 4 painéis** | Botão *Conta* no PDV, na mesa, nas comandas e no celular: confere o pedido e imprime a nota, **sem gravar nada** |
| **Cargo Proprietário** | Todos os privilégios do Administrador (inclusive desconto), **sem** o painel do desenvolvedor |
| **Painéis de venda padronizados** | Comanda/mesa e PDV com altura fixa, lista de itens rolável e ação principal (*Receber / Fechar*, *Finalizar*) na largura total |
| **Gorjeta no Receber / Fechar** | Gorjeta lançada na hora de receber, sem entrar no total nem no saldo do pedido |
| **Excluir / reativar usuário** | Painel do desenvolvedor (*Suporte técnico → Usuários*): exclui liberando o login e preservando o histórico, e reativa quando precisar |

> Detalhes por entrega: `docs/16-versao-1.3.1.md`. Alterações de **17/10/2026**:
> `docs/18-alteracoes-2026-10-17.md`.
### Correções

| Antes | Agora |
|---|---|
| IP ficava vazio nas sessões criadas no login | IP gravado desde o login (middleware global) |
| WebSocket com token inválido estourava exceção | Responde `auth_erro` e segue |
| Atraso do KDS usava 15 min fixos | Atraso calculado pelo tempo de preparo do pedido |

**Testes: 194 automatizados, todos passando.**

---

## Testes

```powershell
npm test
```

Resultado esperado: **195 testes, 195 passando.**

---

## Estrutura

```
MercuryPDV 1.3.1/
├── data/          banco SQLite (já criado, vazio)
├── backups/       cópias de segurança automáticas
├── logs/          registro do servidor
├── public/        interface (HTML, CSS, JavaScript)
├── server/        backend (Node.js + Express)
├── scripts/       iniciar, parar, backup, firewall, restaurar
├── deploy/         VPS (Docker) e deploy/aws/ (EC2, Fargate, Beanstalk)
├── docs/          manuais e documentação técnica
├── tests/         195 testes automatizados
└── node_modules/  dependências (já instaladas)
```

---

## Backup

Automático a cada 6 horas, com as últimas 30 cópias guardadas.
Para forçar um backup agora:

- **Administração → Sistema → Backups → "Fazer backup agora"**, ou
- PowerShell: `.\scripts\backup.ps1`

As cópias ficam em `backups/`. Para restaurar, **pare o servidor** antes —
veja *Administração → Backups → Restaurar*.

---

## Rede local (celular e outros computadores)

O servidor escuta em `0.0.0.0`, então outros aparelhos da mesma rede Wi-Fi
conectam usando o IP do computador:

```
http://192.168.X.X:3000
```

Se o Windows bloquear, rode uma vez: `.\scripts\firewall.ps1`

## Nuvem AWS (acesso de qualquer lugar)

Para os garçons conectarem **de fora da loja**, implante na AWS com o guia
completo **`DEPLOY_AWS.md`** (EC2 + Docker Compose, ECS Fargate ou Elastic
Beanstalk) e defina o endereço público em *Configurações → Celular → Online*.
O sistema gera o QR Code online no padrão:

```
https://pdv.sualanchonete.com.br/#comandas
```

---

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| "Sem conexão com o servidor" | O serviço parou. Rode `iniciar_sistema.bat` |
| Esqueci a senha do administrador | Há 4 tentativas; depois, restaure o último backup |
| Página abre "sem estilo nenhum" | Force a recarga: `Ctrl + F5` |
| Porta 3000 já em uso | Feche o outro programa que usa a porta 3000 |
| Quero recomeçar do zero | Apague `data/lanchonete.sqlite` e inicie de novo |

---

## Segurança

- A senha de cada operador fica **criptografada** no banco
- Sessões expiram após 12 h ou 30 min sem uso
- Cada cargo vê **apenas** o que tem permissão
- Toda operação sensível fica registrada em Auditoria

> **Nunca compartilhe o arquivo `.env`.** Ele contém a chave que protege as
> senhas. Se vazar, troque todas as senhas.