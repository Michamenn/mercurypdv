# Checklist de Pós-Instalação — VPS (go-live)

Data: 2026-10-15 · Deriva de: `docs/07-homologacao-checklist.md` (fluxos de negócio) e
`docs/12-deploy-vps-windows.md` (infraestrutura).

Marque cada item com data + iniciais do responsável. Nenhum item crítico pode ficar pendente.
IP de origem da lanchonete usado nos testes: **164.163.11.141**.

## V. Infraestrutura da VPS (antes de qualquer teste de negócio)

- [ ] V-01 `wsl -l -v` → distro `Ubuntu-24.04` em `VERSION 2`; `docker compose ps` → `app` **healthy** e `caddy` running
- [ ] V-02 `/health` responde localmente (curl no WSL) **e** de fora (`http://<IP-DA-VPS>/health`, de outro dispositivo)
- [ ] V-03 **Reboot de prova**: `Restart-Computer` → aguardar ~3 min → app volta sozinho e healthy
      (valida: tarefa "MercuryPDV Boot", portproxy atualizado, `restart: unless-stopped`)
- [ ] V-04 `netsh interface portproxy show all` → 80/443 apontando para o IP **atual** do WSL
- [ ] V-05 Firewall endurecido: `endurecer-firewall.ps1` executado;
      `C:\ProgramData\MercuryPDV\firewall-restrito.txt` existe — OU Tailscale ativo com 80/443 fechados
- [ ] V-06 **Prova negativa**: acesso por 4G (fora da lanchonete) **FALHA**;
      de dentro da lanchonete (164.163.11.141) **ABRE** normalmente
- [ ] V-07 HTTPS ativo (Tailscale `*.ts.net` ou Caddy `tls internal` com CA importada nos dispositivos)
      — OU risco do HTTP puro na internet **aceito por escrito** pelo responsável
- [ ] V-08 `deploy/.env` com pepper **único da VPS** (diferente da máquina local);
      cópia guardada FORA da VPS (gerenciador de senhas)
- [ ] V-09 Firewall do **provedor** da VPS conferido no painel (80/443, RDP)
- [ ] V-10 Disco ≥ 5 GB livres; projeto dentro do WSL (`~/mercurypdv`), **nunca** em `/mnt/c`
- [ ] V-11 Tarefa "MercuryPDV Exportar Backups" criada e executou 1× sem erro (`C:\BackupsMercuryPDV` populado)
- [ ] V-12 `.env` real não versionado/compartilhado; senha do admin forte e anotada em local seguro

## B/C/D. Negócio — executar INTEGRALMENTE os blocos B, C e D do `docs/07-homologacao-checklist.md`

Adaptações para o cenário VPS:

| Item original | Adaptação |
|---|---|
| A-01..A-06 (instalação local) | **Não se aplicam** — substituídos pelo bloco V acima |
| B-01 (setup do admin) | Acontece no navegador, em `http://<IP-DA-VPS>` |
| C-04 (KDS na hora, ≤ 2 s) | Medir a latência **pela internet**; > 5 s = investigar antes de liberar |
| D-02 (RBAC por cargo) | Testar os bloqueios em cada dispositivo real (caixa, celular, tablet KDS) |

## E. Persistência, falhas e backup (versão VPS)

- [ ] E-01 Venda confirmada → `docker compose restart app` → venda e caixa continuam lá
- [ ] E-02 Crash simulado: `docker kill mercury-pdv-app-1` → container volta sozinho
      (`restart: unless-stopped`) → sem perda dos últimos pagamentos (WAL)
- [ ] E-03 Backup manual: `docker compose exec app node server/src/tools/backup.js` → integrity "ok"
- [ ] E-04 **Restauração de teste**: `copiar-backups.sh` → conferir o arquivo em
      `C:\BackupsMercuryPDV` → `restaurar-backup.sh <arquivo>` → dados conferem
- [ ] E-05 Backup automático rodou no intervalo configurado
      (`docker compose logs app | grep "Backup automático"`)
- [ ] E-06 Último backup **baixado para fora da VPS** (máquina local/nuvem)
- [ ] E-07 Celular com conexão oscilando → app mostra "Sem conexão" e nada é perdido silenciosamente

## F. Impressão — igual ao bloco F do `docs/07` (impressoras 58/80 mm do caixa, via navegador — a VPS não muda nada)

- [ ] F-01 Recibo 80 mm legível · F-02 58 mm legível · F-03 reimpressão auditorada · F-04 ticket de cozinha

## G. Concorrência e multiusuário

- [ ] G-01 Venda no PDV + comanda no celular + KDS avançando **simultaneamente** por 10–30 min
      (agora via internet), sem travamentos
- [ ] G-02 Fechamento de caixa refletindo exatamente as vendas do período

## Critério de aceite

**Produção liberada somente com**: V + B + C + D + E-01..E-06 + G concluídos.
F e E-04 podem ter ressalva registrada, mas nunca omitida. Qualquer falha crítica =
corrigir e repetir o bloco afetado.
