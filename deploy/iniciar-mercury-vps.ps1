# Mercury PDV — inicia o stack apos o boot da VPS:
#   1) liga o Docker dentro do WSL2;  2) atualiza portproxy (IP do WSL muda a cada boot);
#   3) garante regras de firewall 80/443.
# Agendado como tarefa "MercuryPDV Boot" (veja Fase 2.3 do guia) e pode
# ser executado manualmente como Administrador a qualquer momento.
#Requires -RunAsAdministrator

$ErrorActionPreference = 'Stop'
$distro = 'Ubuntu-24.04'   # ajuste se sua distro tiver outro nome (wsl -l -v)

# 1) Docker ligado dentro do WSL2
wsl.exe -d $distro -u root systemctl start docker 2>$null | Out-Null
Start-Sleep -Seconds 8

# 2) IP atual do WSL (muda a cada boot)
$wslIp = ((wsl.exe -d $distro hostname -I | Select-Object -First 1) -split '\s+')[0]
if (-not $wslIp) { throw 'Sem IP do WSL — confira `wsl -l -v` (a distro existe? esta na versao 2?)' }

# 3) Portproxy 80/443 -> WSL
foreach ($porta in 80, 443) {
  netsh interface portproxy delete v4tov4 listenport=$porta listenaddress=0.0.0.0 2>$null
  netsh interface portproxy add    v4tov4 listenport=$porta listenaddress=0.0.0.0 connectport=$porta connectaddress=$wslIp
}

# 4) Firewall — regras abertas apenas ENQUANTO a VPS nao foi endurecida.
#    Apos endurecer-firewall.ps1, o marcador abaixo faz este bloco pular
#    (as regras restritas persistem entre reboots por si so).
$marcador = Join-Path $env:ProgramData 'MercuryPDV\firewall-restrito.txt'
if (Test-Path $marcador) {
  Write-Host '[OK] Firewall restrito (endurecer-firewall.ps1) — nada a fazer.'
} else {
  New-NetFirewallRule -DisplayName 'Mercury PDV HTTP (80)'  -Direction Inbound -Protocol TCP -LocalPort 80  -Action Allow -ErrorAction SilentlyContinue | Out-Null
  New-NetFirewallRule -DisplayName 'Mercury PDV HTTPS (443)' -Direction Inbound -Protocol TCP -LocalPort 443 -Action Allow -ErrorAction SilentlyContinue | Out-Null
  Write-Host '[!] Regras abertas 80/443 ativas — restrinja com endurecer-firewall.ps1 (guia secao 7).'
}

Write-Host "[OK] Mercury PDV exposto em http://<IP-DA-VPS>:80 (WSL IP: $wslIp)"
