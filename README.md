# Mercury PDV 1.3

PDV offline-first para lanchonetes: caixa, comandas, KDS, estoque e relatórios
em rede local. **Funciona sem internet.**

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

## O que é diferente da versão 1.1

Esta é a **1.3**. As principais mudanças:

### Novidades

| Entrega | O que faz |
|---|---|
| **Salão Pro** | Mapa do salão com coordenadas, mesas arrastáveis, junção e transferência de mesas |
| **Comanda individual** | Mais de uma conta na mesma mesa, por cliente |
| **Check-in de cliente** | Registrar o cliente ao abrir a comanda |
| **Taxa de serviço** | Percentual ou valor fixo, por conta |
| **Gorjeta e comissão** | Gorjeta por garçom e cálculo de comissão |
| **Comandas no celular** | Tela própria para o garçom consultar comandas pelo celular |
| **Central de personalização** | Tema, fonte, cores, densidade e menu em um só lugar |
| **QR Code local** | Gerado no próprio aparelho — não envia o endereço da rede a terceiros |
| **Organização** | Administração em 4 categorias, com busca |

### Correções

| Antes | Agora |
|---|---|
| Tela do Caixa ficava em branco sem internet | Mostra "Sem conexão" e **mantém os últimos números** |
| Botão "Cobrar Mesa" nunca funcionava | Corrigido |
| Botões chamavam rotas que não existiam | Removidos |
| "Salvar" das configurações ficava no topo de uma página longa | Barra fixa no rodapé, com aviso de alteração não salva |
| Zoom era bloqueado no celular | Liberado |
| Vários textos com contraste insuficiente | Todos corrigidos |

**Acessibilidade auditada: 19 telas em 100, zero falhas.**

---

## Testes

```powershell
npm test
```

Resultado esperado: **183 testes, 183 passando.**

---

## Estrutura

```
MercuryPDV 1.3/
├── data/          banco SQLite (já criado, vazio)
├── backups/       cópias de segurança automáticas
├── logs/          registro do servidor
├── public/        interface (HTML, CSS, JavaScript)
├── server/        backend (Node.js + Express)
├── scripts/       iniciar, parar, backup, firewall, restaurar
├── docs/          manuais e documentação técnica
├── tests/         183 testes automatizados
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