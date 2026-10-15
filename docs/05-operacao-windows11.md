# Guia de Operação — Windows 11 e Rede Local

Público: responsável pela implantação (dono/técnico). Tempo estimado: 30–45 min.

## 1. Pré-requisitos

| Item | Requisito |
|---|---|
| SO | Windows 11 64 bits (Home ou Pro) |
| Node.js | **LTS v20, v22 ou v24** (testado com v24.21.0) — https://nodejs.org |
| Navegador | Microsoft Edge (nativo) ou Google Chrome |
| Rede | Roteador Wi-Fi local com IP fixo no computador do caixa (ex.: 192.168.1.100) |
| Impressora | Térmica 58 mm ou 80 mm instalada no Windows (driver do fabricante) |

## 2. Instalação (uma vez)

1. Copie a pasta do projeto para `C:\lanchonete-pro` (evite caminhos com espaço).
2. Instale o Node.js LTS (opção padrão, "Automatically install the necessary tools" não é necessária).
3. Abra o PowerShell **como Administrador** na pasta do projeto e execute:
   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   npm install --no-fund --no-audit
   .\scripts\firewall.ps1      # libera a porta 3000 SOMENTE no perfil privado
   ```
4. Verifique em *Configurações > Rede e Internet > [sua rede]* que o perfil é **Privado**.

## 3. Primeira execução (produção)

1. Duplo clique em **`scripts\iniciar_sistema.bat`**.
   - Instala dependências (só na 1ª vez), sobe o servidor e abre o navegador em tela cheia.
2. Na tela inicial, o sistema pedirá o **cadastro do administrador** (nome + senha forte com 10+ caracteres, letras e números, e PIN opcional). Este formulário desaparece para sempre após o cadastro — **anote a senha em local seguro**.
3. No menu *Administração → Usuários*, cadastre os operadores por cargo (caixa, garçom, cozinha) com PIN de 4–6 dígitos.
4. Em *Administração → Produtos*, cadastre categorias e produtos (preços).
5. Em *Caixa*, abra o primeiro turno com o fundo de troco.

## 4. Dispositivos móveis (garçom) e tablet KDS

1. Descubra o IP do servidor: `ipconfig` → endereço IPv4 (ex.: 192.168.1.100).
2. No celular/tablet conectado ao **mesmo Wi-Fi**, abra `http://192.168.1.100:3000`.
3. Use o menu do navegador → **Instalar aplicativo** (PWA).
4. Cada dispositivo faz login com o usuário do cargo correspondente e vê apenas os módulos permitidos.

## 5. Rotina diária

| Momento | Ação |
|---|---|
| Abertura | `iniciar_sistema.bat` → login do caixa → *Caixa → Abrir* com fundo de troco |
| Durante o dia | Vendas no PDV; comandas pelo celular; cozinha avança o KDS; sangrias com autorização admin |
| Fechamento | *Caixa → Fechar caixa* → contar dinheiro e informar por forma → conferir divergências |
| Encerramento | `parar_sistema.bat` (ou fechar a janela do servidor com Ctrl+C — encerramento gracioso) |

## 6. Backups

- **Automático**: a cada 6 h (configurável em `.env`: `LP_BACKUP_INTERVALO_HORAS`) com retenção de 30 dias (`LP_BACKUP_RETENCAO`), gravados em `backups\` com verificação de integridade e histórico em `backups\historico.jsonl`.
- **Manual**: botão *Administração → Backups → Fazer backup agora*, ou `.\scripts\backup.ps1`.
- **Restauração** (sempre com o servidor PARADO):
  ```powershell
  .\scripts\parar_sistema.bat
  .\scripts\restaurar_backup.ps1 -Arquivo "lanchonete-<data>.sqlite"
  ```
  O script valida a integridade do arquivo antes de copiar e pede confirmação digitada. Copie o banco atual para `backups\` antes de restaurar (rollback).
- **Metas**: RPO ≤ 6 h (intervalo de backup automático); RTO ≈ 10 min (reinstalar + restaurar último backup).

## 7. Configuração avançada (`.env`, criado automaticamente na 1ª execução)

| Chave | Padrão | Descrição |
|---|---|---|
| `LP_PEPPER` | gerado | Segredo de hash — **nunca compartilhe/perca** |
| `LP_PORTA` | 3000 | Porta HTTP/WS |
| `LP_DB_PATH` | data/lanchonete.sqlite | Caminho do banco |
| `LP_BACKUP_DIR` | backups | Destino dos backups |
| `LP_SESSAO_HORAS` / `LP_SESSAO_INATIVIDADE_MIN` | 12 / 30 | Expiração de sessão |
| `LP_BACKUP_INTERVALO_HORAS` / `LP_BACKUP_RETENCAO` | 6 / 30 | Frequência e retenção de backup |

## 8. Diagnóstico de falhas

| Sintoma | Providência |
|---|---|
| Navegador não abre nada | Veja `logs\app-*.log` e `logs\servidor.log`; confirme a porta 3000 livre |
| "Não há caixa aberto" | Comportamento correto: abra o caixa antes de vender |
| Celular não conecta | Mesmo Wi-Fi? Perfil de rede Privado? `firewall.ps1` executado como admin? |
| Esqueci a senha do admin | Restaure o último backup ANTES do incidente, ou use um 2º admin; sem backdoor por projeto (BR-009) |
| Impressão sai cortada | Ajuste a largura (58/80 mm) no botão de recibo e o papel no driver da impressora |

## 9. Atualização do sistema

1. `parar_sistema.bat`; 2. `backup.ps1`; 3. substitua os arquivos do projeto; 4. `npm install`; 5. `iniciar_sistema.bat` (migrações versionadas aplicam sozinhas). Rollback = restaurar backup do passo 2.
