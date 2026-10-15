# Manual de Utilização por Cargo

## Administrador / Dono
- **Acesso**: PIN ou e-mail/senha forte. Único cargo com senha obrigatória.
- **Pode**: tudo (relatórios, produtos, usuários, mesas, configurações, backups, auditoria, painel dev com reautenticação).
- **Fluxos principais**:
  - *Administração → Usuários*: criar operadores por cargo com PIN; alterar PIN/senha; desativar (revoga sessões na hora).
  - *Administração → Produtos*: categorias, produtos (preço auditado), adicionais.
  - *Administração → Configurações*: dados da empresa para o recibo, bloqueio de tela pós-venda, permissão de desconto ao caixa.
  - *Relatórios*: bruto/descontos/cancelados/líquido/ticket médio/top produtos (metodologia no rodapé).
  - *Auditoria*: trilha completa de operações (quem, quando, o quê).
  - Autorizações sensíveis (sangria do caixa, cancelamento pós-envio) são dadas informando seu usuário e senha na hora (step-up).

## Operador de Caixa
- **Acesso**: PIN.
- **Pode**: vender no balcão, dividir pagamentos, abrir/fechar o próprio turno, sangria/suprimento **com autorização de um admin**, ver o KDS, cancelar item não enviado; cancelamento pós-envio exige autorização admin na hora.
- **Não pode**: alterar preços, aplicar desconto (a menos que o admin libere nas configurações), ver relatórios gerenciais, gerenciar produtos/usuários.
- **Rotina**:
  1. Login → *Caixa → Abrir caixa* com o fundo de troco.
  2. *PDV Balcão*: toque nos produtos, ajuste quantidade/adicionais/observação → **Vender**.
  3. Pagamento dividido: escolha forma → valor → (dinheiro: informe o recebido para o troco). Repita até o **pendente zerar**; o fechamento só ocorre com saldo R$ 0,00.
  4. Recibo não fiscal é exibido → **Imprimir** (ou *Deixar aberta* e concluir depois em *Caixa*).
  5. *Caixa → Fechar caixa*: conte o dinheiro e informe por forma; a divergência é calculada e registrada.
  6. **Sair** (botão vermelho) ao deixar o terminal.

## Garçom
- **Acesso**: PIN, pelo celular (PWA) no Wi-Fi da loja.
- **Pode**: mapa de mesas, abrir comanda, adicionar itens com observações, encaminhar à cozinha, cancelar item **antes** do envio.
- **Não pode**: vender no balcão, receber pagamentos, avançar KDS, ver relatórios, cancelar item já enviado.
- **Rotina**: *Mesas* → toque na mesa livre → abra a comanda com o nome do cliente → adicione produtos → **Encaminhar à cozinha** (itens vão ao KDS instantaneamente). Quando o cliente pedir a conta, o caixa recebe e fecha — a mesa volta a "livre".

## Cozinha (KDS)
- **Acesso**: PIN, no tablet/monitor da cozinha.
- **Pode**: ver a fila em tempo real e avançar os estados: **Pendente → Preparando → Pronto** (entrega finaliza pelo mesmo botão), imprimir ticket operacional.
- **Não pode**: vender, receber, cancelar itens, ver valores de relatórios.
- **Leitura do quadro**: cartões verdes = novos; amarelos = em preparo; laranja = prontos; **vermelho = atrasado (> 15 min)**, com cronômetro calculado pelo servidor (não pelo navegador).

## Regras comerciais visíveis para todos
- **Nunca há taxa de serviço** (BR-001) — os recibos dizem isso explicitamente.
- Recibos são **não fiscais de conferência** (BR-002).
- Nenhuma conta fecha com **saldo pendente** (BR-003) — o servidor bloqueia.
- Toda operação financeira e cancelamento fica na **trilha de auditoria** (BR-005), com quem fez, quando e por quê.
