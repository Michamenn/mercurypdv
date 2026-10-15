# Checklist de Homologação (executar no ambiente REAL antes da entrada em produção)

Marque cada item com data + iniciais do responsável. Nenhum item crítico pode ficar pendente.

## A. Instalação e rede
- [ ] A-01 Node.js LTS instalado (`node --version` ≥ 20)
- [ ] A-02 Projeto em caminho sem espaços; `npm install` sem erros
- [ ] A-03 `firewall.ps1` executado como admin; porta 3000 apenas no perfil **Privado**
- [ ] A-04 IP fixo do servidor definido (roteador ou Windows)
- [ ] A-05 Roteador SEM port-forward/exposição da porta 3000 para a internet
- [ ] A-06 Smartphone do garçom e tablet KDS acessam `http://<IP>:3000` e instalam como PWA

## B. Primeira execução e cadastros
- [ ] B-01 Setup do 1º admin com senha forte (anotada em local seguro) — formulário fecha depois
- [ ] B-02 PINs de caixa/garçom/cozinha criados (4–6 dígitos)
- [ ] B-03 Produtos, categorias e adicionais reais cadastrados (sem dados de demonstração)
- [ ] B-04 Fichas técnicas de estoque cadastradas para produtos controlados
- [ ] B-05 Dados da empresa preenchidos em Configurações (nome/CNPJ/endereço/telefone/rodapé)

## C. Fluxos comerciais críticos (repetir na prática, com valor baixo)
- [ ] C-01 Abrir caixa com fundo; confirmar que VENDA sem caixa é bloqueada
- [ ] C-02 Venda balcão com pagamento **dividido em ≥ 2 formas**, troco correto
- [ ] C-03 Tentar fechar conta pendente → bloqueio com mensagem de saldo
- [ ] C-04 Comanda de mesa pelo celular → encaminhar → KDS recebe **na hora** (≤ 2 s)
- [ ] C-05 Avanço completo no KDS (pendente→preparando→pronto) e mesa liberada no fechamento
- [ ] C-06 Sangria com autorização admin (caixa sem autorização é barrado)
- [ ] C-07 Cancelamento de item pós-envio com autorização admin + motivo
- [ ] C-08 Fechamento de caixa com contagem por forma; divergência registrada
- [ ] C-09 Desconto aplicado por admin com motivo (e barrado ao caixa se não liberado)

## D. Segurança
- [ ] D-01 5 PINs errados → bloqueio progressivo (aguardar expirar antes de prosseguir)
- [ ] D-02 Garçom não abre relatórios nem caixa; cozinha não vende (testar em cada dispositivo)
- [ ] D-03 Logout imediato funciona e volta à tela de PIN
- [ ] D-04 Painel dev exige reautenticação de senha admin

## E. Persistência, falhas e backup
- [ ] E-01 Venda confirmada → **reiniciar o servidor** → venda e caixa continuam lá
- [ ] E-02 Matar o processo (fechar janela bruscamente) → religar → sem perda dos últimos pagamentos (WAL)
- [ ] E-03 Backup manual (botão Admin/Backups) com integridade "ok"
- [ ] E-04 **Restauração de teste**: parar servidor → restaurar backup em pasta separada/outra máquina → dados conferidos → produção intacta
- [ ] E-05 Backup automático rodou no intervalo configurado (ver `backups\historico.jsonl`)
- [ ] E-06 Desconectar o Wi-Fi do celular durante comanda → app mostra "Sem conexão" e nada é perdido silenciosamente

## F. Impressão (hardware real)
- [ ] F-01 Recibo 80 mm impresso legível (largura correta, sem taxa de serviço)
- [ ] F-02 Recibo 58 mm impresso legível
- [ ] F-03 Reimpressão funciona e aparece na auditoria
- [ ] F-04 Ticket de cozinha impresso

## G. Concorrência e multiusuário
- [ ] G-01 Venda no PDV + comanda no celular + KDS avançando **simultaneamente** por 10 min sem travamentos
- [ ] G-02 Fechamento de caixa refletindo exatamente as vendas do período (conferir no relatório)

## Critério de aceite
**Produção liberada somente com**: A, B, C, D, E-01..E-05 e G concluídos. F e E-04 podem ter ressalva registrada, mas nunca omitida. Qualquer falha crítica = corrigir e repetir o bloco afetado.
